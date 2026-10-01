"""The Domain Management notifications worked from `status`, which is gone.
Same emails, same moments, same recipients and messages; only the triggers
change:

- customer reminders around the expiry stop once the renewal is paid, and
  for cancelled domains;
- "paid, renew it" goes to the tech when the renewal becomes Pago;
- "renewed" goes to the customer when a renewal is confirmed
  (ultima_renovacao), not when someone picks Ativo;
- "Dominio inativo" compared against "Não pago" (lower-case p), which never
  matched, so it never sent. It will now.
"""

import frappe

POR_PAGAR_E_ATIVO = 'doc.estado != "Cancelado" and doc.renovacao_estado != "Pago"'

NOTIFICACOES = {
	"notificacao  dominio -40 dias": {"condition": f'doc.nots == "Sim" and {POR_PAGAR_E_ATIVO}'},
	"notificação 20 dias antes": {"condition": f'doc.nots == "Sim" and {POR_PAGAR_E_ATIVO}'},
	"Aviso Interno": {"condition": 'doc.estado != "Cancelado"'},
	"Dominios": {"condition": f'doc.nots == "Sim" and {POR_PAGAR_E_ATIVO}'},
	"notificacao depois de 5 dias": {"condition": 'doc.estado != "Cancelado"'},
	"Dominio inativo": {"condition": f'doc.nots == "Sim" and {POR_PAGAR_E_ATIVO}'},
	"Renovar Dominio": {
		"event": "Value Change",
		"value_changed": "renovacao_estado",
		"condition": 'doc.renovacao_estado == "Pago"',
	},
	"notificacao depois de renovar": {
		"event": "Value Change",
		"value_changed": "ultima_renovacao",
		"condition": 'doc.nots == "Sim"',
	},
}


def execute():
	for nome, valores in NOTIFICACOES.items():
		if not frappe.db.exists("Notification", nome):
			print(f"Notificação {nome!r} não existe: ignorada.")
			continue
		notificacao = frappe.get_doc("Notification", nome)
		notificacao.update(valores)
		notificacao.save(ignore_permissions=True)
		for campo in ("subject", "message"):
			if "doc.status" in (notificacao.get(campo) or ""):
				print(f"Notificação {nome!r}: o {campo} ainda usa doc.status, que mostra o valor antigo. Rever.")
