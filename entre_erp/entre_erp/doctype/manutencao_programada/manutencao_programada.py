import frappe
from frappe import _
from frappe.model.document import Document
from frappe.utils import cint, escape_html, get_datetime, get_time, now_datetime

from entre_erp.manutencao import (
	ADIAMENTO,
	AGENDADA,
	AVISO,
	CANCELADA,
	CANCELAMENTO,
	CARIMBOS,
	CONCLUIDA,
	CONCLUSAO,
	EM_CURSO,
	FIM_DA_JANELA,
	INICIO,
	LEMBRETE,
	METODOS,
	MODELO,
	PROLONGAMENTO,
	RASCUNHO,
	duracao,
	emails,
	notificacoes,
)

# Each action is _preparar (in memory, also used by the preview) + save +
# the email, when asked: {action: (allowed estados, Notification method)}.
ACCOES = {
	"agendar": ((RASCUNHO,), AVISO),
	"adiar": ((AGENDADA,), ADIAMENTO),
	"prolongar": ((EM_CURSO,), PROLONGAMENTO),
	"concluir": ((EM_CURSO,), CONCLUSAO),
	"cancelar": ((RASCUNHO, AGENDADA), CANCELAMENTO),
}


class ManutencaoProgramada(Document):
	def onload(self):
		self.set_onload("avisos", self.avisos())
		if self.modelo:
			self.set_onload(
				"modelo",
				frappe.db.get_value(MODELO, self.modelo, ["proxima_data", "repete", "activo"], as_dict=True),
			)

	def validate(self):
		if get_datetime(self.fim) <= get_datetime(self.inicio):
			frappe.throw(_("O fim tem de ser depois do início."))
		self.duracao = duracao(self.inicio, self.fim)

		# Once announced, the window only moves through Adiar / Prolongar,
		# so the client is always told.
		antes = self.get_doc_before_save()
		if antes and antes.estado != RASCUNHO and not self.flags.alteracao_autorizada:
			for campo in ("inicio", "fim"):
				if get_datetime(antes.get(campo)) != get_datetime(self.get(campo)):
					frappe.throw(_("Esta manutenção já foi anunciada: use Adiar ou Prolongar para mudar a janela."))

	def sobrepostas(self):
		return frappe.get_all(
			self.doctype,
			filters={
				"aplicacao": self.aplicacao,
				"estado": ["!=", CANCELADA],
				"name": ["!=", self.name or ""],
				"inicio": ["<", self.fim],
				"fim": [">", self.inicio],
			},
			pluck="name",
		)

	def avisos(self):
		"""Things to check before telling the client."""
		if not (self.inicio and self.fim):
			return []
		saida = []
		if self.estado in (RASCUNHO, AGENDADA):
			horas = (get_datetime(self.inicio) - now_datetime()).total_seconds() / 3600
			if horas < 0:
				saida.append(_("O início já passou."))
			elif horas < 24:
				saida.append(_("Começa daqui a {0} h: o cliente fica a saber em cima da hora.").format(int(horas)))
		for nome in self.sobrepostas():
			saida.append(_("Sobrepõe-se à manutenção {0} do {1}.").format(nome, self.aplicacao))
		return saida

	# Actions. The _preparar_* only change the document in memory: the
	# preview runs them too, to show the email as it will go.

	def _preparar_agendar(self):
		if not self.destinatarios:
			frappe.throw(_("Indique pelo menos um destinatário em Para."))
		if get_datetime(self.inicio) <= now_datetime():
			frappe.throw(_("O início já passou: corrija a janela antes de agendar."))
		self.estado = AGENDADA

	def _preparar_adiar(self, inicio, fim):
		self.inicio_anterior, self.fim_anterior = self.inicio, self.fim
		self.inicio, self.fim = get_datetime(inicio), get_datetime(fim)
		if self.inicio <= now_datetime():
			frappe.throw(_("O novo início já passou."))
		self.adiamentos = cint(self.adiamentos) + 1
		self.lembrete_enviado_em = None

	def _preparar_prolongar(self, fim):
		if get_datetime(fim) <= get_datetime(self.fim):
			frappe.throw(_("O novo fim tem de ser depois do actual."))
		self.fim_anterior = self.fim
		self.fim = get_datetime(fim)
		self.prolongamentos = cint(self.prolongamentos) + 1
		self.fim_alertado = 0

	def _preparar_concluir(self, fim_real=None):
		self.fim_real = get_datetime(fim_real) if fim_real else now_datetime()
		self.inicio_real = self.inicio_real or self.inicio
		self.estado = CONCLUIDA

	def _preparar_cancelar(self):
		self.estado = CANCELADA

	def _executar(self, accao, enviar, **valores):
		estados, metodo = ACCOES[accao]
		self.check_permission("write")
		if self.estado not in estados:
			frappe.throw(_("Não é possível {0} uma manutenção {1}.").format(accao, self.estado))
		getattr(self, f"_preparar_{accao}")(**valores)
		self.flags.alteracao_autorizada = True
		self.save()
		if cint(enviar):
			self.enviar(metodo)

	@frappe.whitelist()
	def agendar(self, enviar=1):
		self._executar("agendar", enviar)

	@frappe.whitelist()
	def adiar(self, inicio, fim, enviar=1):
		self._executar("adiar", enviar, inicio=inicio, fim=fim)

	@frappe.whitelist()
	def prolongar(self, fim, enviar=1):
		self._executar("prolongar", enviar, fim=fim)

	@frappe.whitelist()
	def concluir(self, fim_real=None, enviar=1):
		self._executar("concluir", enviar, fim_real=fim_real)

	@frappe.whitelist()
	def cancelar(self, enviar=1):
		self._executar("cancelar", enviar)

	@frappe.whitelist()
	def iniciar(self):
		"""By hand (the scheduler does it at the start time otherwise)."""
		self.check_permission("write")
		if self.estado != AGENDADA:
			frappe.throw(_("Só uma manutenção Agendada pode começar."))
		self._iniciar()

	def _iniciar(self):
		self.estado = EM_CURSO
		self.inicio_real = now_datetime()
		self.save(ignore_permissions=True)
		self.enviar(INICIO, avisar=False)

	@frappe.whitelist()
	def enviar_email(self, metodo):
		"""Send (again) one of the emails, e.g. the aviso or the relatório."""
		self.check_permission("write")
		if metodo not in METODOS:
			frappe.throw(_("Email desconhecido: {0}").format(metodo))
		self.enviar(metodo)

	def enviar(self, metodo, avisar=True):
		"""Fire the Notifications with event Method = metodo."""
		if not notificacoes(metodo):
			if avisar:
				frappe.msgprint(
					_("Não há nenhuma Notification activa com o método {0}: nada foi enviado.").format(
						f"<code>{metodo}</code>"
					),
					indicator="orange",
				)
			return False
		if campo := CARIMBOS.get(metodo):
			self.db_set(campo, now_datetime())
		self.run_method(metodo)
		return True

	@frappe.whitelist()
	def pre_visualizar(self, metodo=None, accao=None, valores=None):
		"""The emails as they would go now; with accao, as they will go after it."""
		self.check_permission("read")
		if accao:
			if accao not in ACCOES:
				frappe.throw(_("Acção desconhecida: {0}").format(accao))
			getattr(self, f"_preparar_{accao}")(**(frappe.parse_json(valores) or {}))
		return {"emails": emails(self, metodo), "avisos": self.avisos()}

	@frappe.whitelist()
	def relatorio_do_deployment_plan(self):
		"""The Deployment Plan's ClickUp tasks as a list (or its description)."""
		if not self.deployment_plan:
			return ""
		plano = frappe.get_doc("Deployment Plan", self.deployment_plan)
		plano.check_permission("read")
		itens = []
		for tarefa in plano.clickup_tasks:
			texto = f"<b>{escape_html(tarefa.task_name or tarefa.task_ref or '')}</b>"
			if tarefa.task_description:
				texto += f" – {escape_html(tarefa.task_description)}"
			itens.append(f"<li>{texto}</li>")
		if itens:
			return f"<ol>{''.join(itens)}</ol>"
		return plano.description or ""

	# Scheduler (manutencao.tarefa_frequente)

	def avancar(self, agora):
		if self.estado == AGENDADA:
			if agora >= get_datetime(self.inicio):
				self._iniciar()
			elif self.lembrete_em_falta(agora):
				self.enviar(LEMBRETE, avisar=False)
		elif self.estado == EM_CURSO and not self.fim_alertado and agora >= get_datetime(self.fim):
			self.db_set("fim_alertado", 1)
			self.enviar(FIM_DA_JANELA, avisar=False)

	def lembrete_em_falta(self, agora):
		inicio = get_datetime(self.inicio)
		if not self.enviar_lembrete or self.lembrete_enviado_em or agora.date() != inicio.date():
			return False
		if agora.time() < get_time(self.hora_do_lembrete or "08:00:00"):
			return False
		# The aviso already went out today: no need to remind.
		return not (self.aviso_enviado_em and get_datetime(self.aviso_enviado_em).date() == inicio.date())
