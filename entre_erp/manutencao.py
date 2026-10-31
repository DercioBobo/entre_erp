"""Manutenção Programada: maintenance windows announced to a client.

A Manutencao Programada goes Rascunho → Agendada → Em Curso → Concluída (or
Cancelada). Every email is a Notification with event "Method": the form's
buttons and the scheduler call doc.run_method("enviar_aviso") and so on, so
the texts live in the Notifications (docs/manutencao_programada_emails.md)
and the form previews exactly what each one would send.

A Modelo de Manutencao fills a new maintenance (application, window hours,
recipients...). A preventive one with a periodicidade also keeps the date of
the next maintenance (proxima_data); the daily job creates it
dias_de_antecedencia days before, scheduled straight away when
agendar_automaticamente is on (the aviso goes out then).
"""

from datetime import date, datetime, time, timedelta

import frappe
from frappe import _
from frappe.utils import add_days, add_months, cint, get_datetime, get_time, getdate, now_datetime, today

MANUTENCAO = "Manutencao Programada"
MODELO = "Modelo de Manutencao"

RASCUNHO = "Rascunho"
AGENDADA = "Agendada"
EM_CURSO = "Em Curso"
CONCLUIDA = "Concluída"
CANCELADA = "Cancelada"

PREVENTIVA = "Preventiva"

# The Notification methods (event "Method"), in the order they usually go out.
AVISO = "enviar_aviso"
LEMBRETE = "enviar_lembrete"
ADIAMENTO = "enviar_adiamento"
INICIO = "enviar_inicio"
PROLONGAMENTO = "enviar_prolongamento"
FIM_DA_JANELA = "enviar_fim_da_janela"
CONCLUSAO = "enviar_conclusao"
CANCELAMENTO = "enviar_cancelamento"
RELATORIO = "enviar_relatorio"
METODOS = (AVISO, LEMBRETE, ADIAMENTO, INICIO, PROLONGAMENTO, FIM_DA_JANELA, CONCLUSAO, CANCELAMENTO, RELATORIO)

# When each email last went out.
CARIMBOS = {
	AVISO: "aviso_enviado_em",
	LEMBRETE: "lembrete_enviado_em",
	CONCLUSAO: "conclusao_enviada_em",
	RELATORIO: "relatorio_enviado_em",
}

# periodicidade → (months, days) between two maintenances.
PERIODOS = {
	"Semanal": (0, 7),
	"Quinzenal": (0, 14),
	"Mensal": (1, 0),
	"Bimestral": (2, 0),
	"Trimestral": (3, 0),
	"Semestral": (6, 0),
	"Anual": (12, 0),
}
MESMO_DIA_DA_SEMANA = "Mesmo dia da semana (ex.: 2ª terça-feira)"

DIAS = ["segunda-feira", "terça-feira", "quarta-feira", "quinta-feira", "sexta-feira", "sábado", "domingo"]
MESES = [
	"Janeiro",
	"Fevereiro",
	"Março",
	"Abril",
	"Maio",
	"Junho",
	"Julho",
	"Agosto",
	"Setembro",
	"Outubro",
	"Novembro",
	"Dezembro",
]
ORDINAIS = ["1ª", "2ª", "3ª", "4ª", "última"]


# Texts for the Notifications (hooks.py jinja methods). "hoje" and "amanhã"
# are worked out when the email is rendered, i.e. when it is sent.


def _dia(d, ano):
	"""dia 19 de Outubro (with the year when it isn't this year's)."""
	texto = f"dia {d.day:02d} de {MESES[d.month - 1]}"
	return texto if d.year == ano else f"{texto} de {d.year}"


def _hora(dt):
	return f"{dt.hour:02d}h{dt.minute:02d}"


def _quando(d, hoje, artigo=True):
	"""hoje, dia 09 de Setembro · amanhã, quinta-feira, dia 10 de Setembro ·
	na segunda-feira, dia 19 de Outubro (artigo=False: segunda-feira, ...)."""
	dia = _dia(d, hoje.year)
	if d == hoje:
		return f"hoje, {dia}"
	if d == hoje + timedelta(days=1):
		return f"amanhã, {DIAS[d.weekday()]}, {dia}"
	if d == hoje - timedelta(days=1):
		return f"ontem, {DIAS[d.weekday()]}, {dia}"
	semana = DIAS[d.weekday()]
	if not artigo:
		return f"{semana}, {dia}"
	return f"{'no' if d.weekday() >= 5 else 'na'} {semana}, {dia}"


def periodo(inicio, fim, hoje=None, artigo=True):
	"""The window as the emails say it, e.g. "na segunda-feira, dia 19 de
	Outubro, entre as 21h00 e as 04h00 do dia 20 de Outubro"."""
	inicio, fim = get_datetime(inicio), get_datetime(fim)
	hoje = getdate(hoje or today())
	d1, d2 = inicio.date(), fim.date()
	# 20h00 to midnight reads "entre as 20h00 e as 00h00", not "do dia seguinte".
	if fim.time() == time(0) and d2 == d1 + timedelta(days=1):
		d2 = d1
	if d2 == d1:
		return f"{_quando(d1, hoje, artigo)}, entre as {_hora(inicio)} e as {_hora(fim)}"
	if d2 == d1 + timedelta(days=1):
		return f"{_quando(d1, hoje, artigo)}, entre as {_hora(inicio)} e as {_hora(fim)} do {_dia(d2, hoje.year)}"
	return (
		f"entre as {_hora(inicio)} de {_quando(d1, hoje, artigo=False)},"
		f" e as {_hora(fim)} de {_quando(d2, hoje, artigo=False)}"
	)


def periodo_manutencao(doc, anterior=False, artigo=True):
	"""Jinja: {{ periodo_manutencao(doc) }}; anterior=True for the window
	before the last Adiar (inicio_anterior/fim_anterior)."""
	if anterior:
		return periodo(doc.inicio_anterior, doc.fim_anterior, artigo=artigo)
	return periodo(doc.inicio, doc.fim, artigo=artigo)


def quando_manutencao(momento, artigo=True, hora=True):
	"""Jinja: "na segunda-feira, dia 20 de Outubro, às 04h00", "hoje, dia ...,
	às 03h40"; hora=False leaves the time out."""
	momento = get_datetime(momento)
	texto = _quando(momento.date(), getdate(today()), artigo)
	return f"{texto}, às {_hora(momento)}" if hora else texto


def duracao(inicio, fim):
	minutos = int((get_datetime(fim) - get_datetime(inicio)).total_seconds() // 60)
	return f"{minutos // 60}h{minutos % 60:02d}"


# Notifications


def notificacoes(metodo=None):
	filtros = {"document_type": MANUTENCAO, "enabled": 1}
	if metodo:
		filtros.update(event="Method", method=metodo)
	return frappe.get_all("Notification", filters=filtros, pluck="name", order_by="name")


def _contexto(doc):
	try:
		from frappe.email.doctype.notification.notification import get_context

		return get_context(doc)
	except ImportError:
		return {"doc": doc, "nowdate": today, "frappe": frappe._dict(utils=frappe.utils)}


def emails(doc, metodo=None):
	"""What each Notification would send for doc right now: subject, message,
	To/CC, and whether its condition holds. For the form's preview."""
	contexto = _contexto(doc)
	saida = []
	for nome in notificacoes(metodo):
		notificacao = frappe.get_doc("Notification", nome)
		email = {
			"nome": nome,
			"evento": notificacao.method if notificacao.event == "Method" else notificacao.event,
			"para": [],
			"cc": [],
		}
		try:
			email["condicao_ok"] = not notificacao.condition or bool(
				frappe.safe_eval(notificacao.condition, None, contexto)
			)
			email["assunto"] = frappe.render_template(notificacao.subject or "", contexto)
			mensagem = frappe.render_template(notificacao.message or "", contexto)
			if notificacao.message_type == "Markdown":
				mensagem = frappe.utils.md_to_html(mensagem)
			elif notificacao.message_type == "Plain Text":
				mensagem = f"<pre>{frappe.utils.escape_html(mensagem)}</pre>"
			email["mensagem"] = mensagem
			if notificacao.channel == "Email":
				para, cc, _bcc = notificacao.get_list_of_recipients(doc, contexto)
				email["para"], email["cc"] = sorted(para), sorted(c for c in cc if c)
		except Exception as e:
			email["erro"] = str(e)
		saida.append(email)
	return saida


# Recurrence of a preventive Modelo de Manutencao


def ocorrencia(modelo, k):
	"""The date of the k-th maintenance (k = 0 is comeca_em)."""
	base = getdate(modelo.comeca_em)
	meses, dias = PERIODOS[modelo.periodicidade]
	if dias:
		return base + timedelta(days=k * dias)
	if modelo.regra_mensal != MESMO_DIA_DA_SEMANA:
		# From comeca_em each time, so a 31st comes back after a short month.
		return getdate(add_months(base, k * meses))
	ordem = (base.day - 1) // 7  # 4 = the last one in the month
	mes = getdate(add_months(base.replace(day=1), k * meses))
	dia = mes + timedelta(days=(base.weekday() - mes.weekday()) % 7, weeks=ordem)
	if dia.month != mes.month:
		dia -= timedelta(weeks=1)
	return dia


def proxima_ocorrencia(modelo):
	"""The next maintenance not yet created: after ultima_gerada, from today on."""
	limite = getdate(today())
	if modelo.ultima_gerada:
		limite = max(limite, getdate(modelo.ultima_gerada) + timedelta(days=1))
	for k in range(5000):
		if (dia := ocorrencia(modelo, k)) >= limite:
			return dia


def descrever_recorrencia(modelo):
	"""Mensal, na 2ª quarta-feira · Mensal, dia 19 · Semanal, à quarta-feira."""
	base = getdate(modelo.comeca_em)
	meses, dias = PERIODOS[modelo.periodicidade]
	semana = DIAS[base.weekday()]
	if dias:
		return f"{modelo.periodicidade}, {'ao' if base.weekday() >= 5 else 'à'} {semana}"
	if modelo.regra_mensal == MESMO_DIA_DA_SEMANA:
		return f"{modelo.periodicidade}, {'no' if base.weekday() >= 5 else 'na'} {ORDINAIS[(base.day - 1) // 7]} {semana}"
	if meses >= 12:
		return f"{modelo.periodicidade}, a {base.day} de {MESES[base.month - 1]}"
	return f"{modelo.periodicidade}, dia {base.day}"


def criar_manutencao(nome_modelo, data=None):
	"""A Rascunho maintenance filled from the modelo for data (default: its
	next date). Creating the next date moves the modelo on to the one after."""
	modelo = frappe.get_doc(MODELO, nome_modelo)
	data = getdate(data or modelo.proxima_data or today())
	inicio = datetime.combine(data, get_time(modelo.hora_inicio))
	fim = datetime.combine(data, get_time(modelo.hora_fim))
	if fim <= inicio:
		fim += timedelta(days=1)

	doc = frappe.new_doc(MANUTENCAO)
	doc.update(
		{
			"modelo": modelo.name,
			"aplicacao": modelo.aplicacao,
			"customer": modelo.customer,
			"tipo": modelo.tipo,
			"impacto": modelo.impacto,
			"canais_afectados": modelo.canais_afectados,
			"canais_operacionais": modelo.canais_operacionais,
			"enviar_lembrete": modelo.enviar_lembrete,
			"hora_do_lembrete": modelo.hora_do_lembrete,
			"inicio": inicio,
			"fim": fim,
		}
	)
	for campo in ("destinatarios", "destinatarios_cc"):
		for linha in modelo.get(campo):
			doc.append(campo, {"email": linha.email, "nome": linha.nome})
	doc.insert(ignore_permissions=True)

	if modelo.proxima_data and data == getdate(modelo.proxima_data):
		modelo.ultima_gerada = data
		modelo.ultima_manutencao = doc.name
		modelo.save(ignore_permissions=True)  # works out the new proxima_data
	return doc


def ja_criada(modelo, data):
	return frappe.db.exists(
		MANUTENCAO,
		{
			"modelo": modelo,
			"estado": ["!=", CANCELADA],
			"inicio": ["between", [f"{data} 00:00:00", f"{data} 23:59:59"]],
		},
	)


# Scheduler


def criar_preventivas():
	"""Daily: create each preventive modelo's next maintenance once it is
	dias_de_antecedencia away, and schedule it when the modelo says so."""
	hoje = getdate(today())
	for nome in frappe.get_all(
		MODELO, filters={"activo": 1, "tipo": PREVENTIVA, "proxima_data": ["is", "set"]}, pluck="name"
	):
		try:
			modelo = frappe.get_doc(MODELO, nome)
			if getdate(modelo.proxima_data) < hoje:
				modelo.save(ignore_permissions=True)  # missed (server down): move on
			if add_days(modelo.proxima_data, -cint(modelo.dias_de_antecedencia)) > hoje:
				continue
			if existente := ja_criada(nome, modelo.proxima_data):
				modelo.ultima_gerada = modelo.proxima_data
				modelo.ultima_manutencao = existente
				modelo.save(ignore_permissions=True)
				frappe.db.commit()
				continue
			doc = criar_manutencao(nome)
			frappe.db.commit()
		except Exception:
			frappe.db.rollback()
			frappe.log_error(f"Manutenção preventiva do modelo {nome}")
			continue

		if modelo.agendar_automaticamente:
			try:
				doc.agendar(enviar=1)
				frappe.db.commit()
			except Exception:
				# Stays in Rascunho for someone to look at.
				frappe.db.rollback()
				frappe.log_error(f"Agendar {doc.name} automaticamente")


def tarefa_frequente():
	"""Every 15 minutes: the day's reminder, Agendada → Em Curso at the start,
	and the team's alert when the window is over but nobody concluded it."""
	agora = now_datetime()
	for nome in frappe.get_all(MANUTENCAO, filters={"estado": ["in", (AGENDADA, EM_CURSO)]}, pluck="name"):
		try:
			frappe.get_doc(MANUTENCAO, nome).avancar(agora)
			frappe.db.commit()
		except Exception:
			frappe.db.rollback()
			frappe.log_error(f"Manutenção {nome}")
