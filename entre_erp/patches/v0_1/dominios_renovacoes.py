"""Domain Management's old `status` (Ativo/Inativo/Pago/Não Pago) becomes
`estado` (Ativo/Expirado) plus a renewal cycle: Pago → a Pago cycle, the
tech still has to renew it; Não Pago → a Pendente cycle. Written straight to
the database, so no email goes out. The old column is left in place."""

import frappe
from frappe.utils import getdate, today

from entre_erp.dominios import ATIVO, EXPIRADO, PAGO, PENDENTE, renovacao_aberta


def execute():
	if not frappe.db.has_column("Domain Management", "status"):
		return

	hoje = getdate(today())
	for d in frappe.db.sql(
		"""select name, status, data_de_fim, whois_expiry_date, valor, comprovativo, modified
		from `tabDomain Management`""",
		as_dict=True,
	):
		expira = d.whois_expiry_date or d.data_de_fim
		expirado = d.status == "Inativo" or (expira and getdate(expira) < hoje)
		frappe.db.set_value(
			"Domain Management", d.name, "estado", EXPIRADO if expirado else ATIVO, update_modified=False
		)

		if d.status not in (PAGO, "Não Pago") or renovacao_aberta(d.name):
			continue
		renovacao = frappe.get_doc({"doctype": "Domain Renewal", "dominio": d.name})
		renovacao.flags.ignore_links = True  # a customer deleted since must not stop the migration
		renovacao.insert(ignore_permissions=True)
		if d.status == PAGO:
			# Who marked it and the exact amount aren't known: the domain's own values.
			frappe.db.set_value(
				"Domain Renewal",
				renovacao.name,
				{
					"estado": PAGO,
					"data_pagamento": getdate(d.modified),
					"valor_pago": d.valor,
					"comprovativo": d.comprovativo,
					"pago_em": d.modified,
				},
			)
		frappe.db.set_value(
			"Domain Management",
			d.name,
			{"renovacao_actual": renovacao.name, "renovacao_estado": PAGO if d.status == PAGO else PENDENTE},
			update_modified=False,
		)
