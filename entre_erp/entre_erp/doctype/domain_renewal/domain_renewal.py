import frappe
from frappe import _
from frappe.model.document import Document
from frappe.utils import add_months, cint, flt, getdate, now_datetime

from entre_erp.dominios import (
	ABERTOS,
	ATIVO,
	CANCELADO,
	CONCLUIDO,
	PAGO,
	PENDENTE,
	RENOVADO,
	actualizar_dominio,
	exigir_papel,
	meses,
	renovacao_aberta,
)


class DomainRenewal(Document):
	def before_insert(self):
		dominio = frappe.db.get_value(
			"Domain Management", self.dominio, ["data_de_fim", "whois_expiry_date"], as_dict=True
		)
		self.estado = PENDENTE
		self.expira_em = self.expira_em or dominio.data_de_fim
		self.expira_no_registo = self.expira_no_registo or dominio.whois_expiry_date
		if outra := renovacao_aberta(self.dominio):
			frappe.throw(_("O domínio {0} já tem uma renovação em aberto: {1}").format(self.dominio, outra))

	@frappe.whitelist()
	def criar_factura(self):
		"""A draft Sales Invoice for this renewal (see dominios.criar_factura)."""
		from entre_erp.dominios import criar_factura

		return criar_factura(self.name)

	@frappe.whitelist()
	def marcar_como_pago(self, data_pagamento, valor_pago, comprovativo):
		"""Pendente → Pago (the tech is told to renew), or Renovado → Concluído."""
		exigir_papel("papel_pagamento")
		if self.estado not in (PENDENTE, RENOVADO):
			frappe.throw(_("Esta renovação está {0}: já não pode ser marcada como paga.").format(self.estado))
		if not comprovativo:
			frappe.throw(_("Anexe o comprovativo de pagamento."))

		self.update(
			{
				"data_pagamento": getdate(data_pagamento),
				"valor_pago": flt(valor_pago),
				"comprovativo": comprovativo,
				"pago_por": frappe.session.user,
				"pago_em": now_datetime(),
				"estado": PAGO if self.estado == PENDENTE else CONCLUIDO,
			}
		)
		self.save(ignore_permissions=True)
		actualizar_dominio(
			self.dominio, renovacao_actual=self.name, renovacao_estado=self.estado, comprovativo=comprovativo
		)

	@frappe.whitelist()
	def confirmar_renovacao(
		self, sem_pagamento=0, motivo_sem_pagamento=None, sem_registo=0, motivo_sem_registo=None
	):
		"""After renewing on the hosting panel. The registry (WHOIS) must show the
		new expiry; otherwise this returns {"confirmado": False} and the user can
		retry with sem_registo and a reason."""
		exigir_papel("papel_renovacao")
		if self.estado == PAGO:
			novo_estado = CONCLUIDO
		elif self.estado == PENDENTE:
			if not cint(sem_pagamento):
				frappe.throw(_("Ainda não está pago. Marque como pago ou renove antes do pagamento."))
			exigir_papel("papel_confianca")
			if not (motivo_sem_pagamento or "").strip():
				frappe.throw(_("Indique porque é renovado antes do pagamento."))
			novo_estado = RENOVADO
		else:
			frappe.throw(_("Esta renovação está {0}: não há nada a renovar.").format(self.estado))

		from entre_erp.whois import actualizar

		# Fresh: the renewal may have happened minutes ago.
		registo = actualizar(self.dominio, automatico=False, usar_cache=False)
		expira = registo.get("whois_expiry_date")
		referencia = self.expira_no_registo or self.expira_em
		confirmado = bool(expira and not registo.get("whois_error") and getdate(expira) > getdate(referencia))

		if not confirmado:
			if not cint(sem_registo):
				return {
					"confirmado": False,
					"erro": registo.get("whois_error"),
					"expira_no_registo": expira,
				}
			if not (motivo_sem_registo or "").strip():
				frappe.throw(_("Indique porque confirma sem o registo mostrar a renovação."))
			expira = add_months(self.expira_em, meses(self.periodo))

		self.concluir(
			expira,
			motivo_sem_registo=None if confirmado else motivo_sem_registo,
			motivo_sem_pagamento=motivo_sem_pagamento if novo_estado == RENOVADO else None,
		)
		return {"confirmado": True}

	def concluir(self, expira, automatico=False, motivo_sem_registo=None, motivo_sem_pagamento=None):
		"""Record the renewal and move the domain to its new expiry. automatico:
		the registry showed a paid renewal done before anyone confirmed it."""
		self.update(
			{
				"estado": RENOVADO if motivo_sem_pagamento else CONCLUIDO,
				"nova_expiracao": getdate(expira),
				"verificado_no_registo": int(not motivo_sem_registo),
				"motivo_sem_registo": motivo_sem_registo,
				"sem_pagamento": int(bool(motivo_sem_pagamento)),
				"motivo_sem_pagamento": motivo_sem_pagamento,
				"confirmado_automaticamente": int(automatico),
				"renovado_por": None if automatico else frappe.session.user,
				"renovado_em": now_datetime(),
			}
		)
		self.save(ignore_permissions=True)
		actualizar_dominio(
			self.dominio,
			data_de_fim=self.nova_expiracao,
			estado=ATIVO,
			renovacao_actual=self.name,
			renovacao_estado=self.estado,
			ultima_renovacao=self.renovado_em,
		)

	@frappe.whitelist()
	def cancelar(self, motivo):
		"""The customer won't renew: the domain is Cancelado and its emails stop."""
		exigir_papel("papel_pagamento")
		if self.estado not in ABERTOS:
			frappe.throw(_("Só uma renovação Pendente ou Paga pode ser cancelada."))
		if not (motivo or "").strip():
			frappe.throw(_("Indique o motivo do cancelamento."))

		self.update(
			{
				"estado": CANCELADO,
				"motivo_cancelamento": motivo,
				"cancelado_por": frappe.session.user,
				"cancelado_em": now_datetime(),
			}
		)
		self.save(ignore_permissions=True)
		actualizar_dominio(self.dominio, estado=CANCELADO, renovacao_actual=self.name, renovacao_estado=CANCELADO)
