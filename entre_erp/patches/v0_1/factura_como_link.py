"""Linha do Plano de Pagamentos.factura went from free text to a Link to
Purchase Invoice. Numbers that don't match a (non-cancelled) Purchase
Invoice would make every later save of their month fail, so they move to
Observações and the link is cleared."""

import frappe

from entre_erp.pagamentos import factura_existe, factura_para_observacoes


def execute():
	for linha in frappe.get_all(
		"Linha do Plano de Pagamentos",
		filters={"factura": ["is", "set"]},
		fields=["name", "factura", "observacoes"],
	):
		if factura_existe(linha.factura):
			continue
		frappe.db.set_value(
			"Linha do Plano de Pagamentos",
			linha.name,
			{
				"factura": None,
				"observacoes": factura_para_observacoes(linha.factura, linha.observacoes, "não existe no ERPNext"),
			},
			update_modified=False,
		)
