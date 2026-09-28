"""A Purchase Invoice may now be linked to one active line only. Data
imported before that rule may have the same invoice on several lines,
which would make every later save of those months fail: keep the first
link (oldest plan, first row) and move the other ones to Observações."""

import frappe

from entre_erp.pagamentos import factura_para_observacoes


def execute():
	vistas = set()
	for linha in frappe.db.sql(
		"""
		select l.name, l.factura, l.observacoes
		from `tabLinha do Plano de Pagamentos` l
		join `tabPlano de Pagamentos` p on p.name = l.parent and l.parenttype = 'Plano de Pagamentos'
		where ifnull(l.factura, '') != '' and l.estado not in ('Próximo Mês', 'Cancelado')
		order by p.ano, p.name, l.idx
		""",
		as_dict=True,
	):
		if linha.factura not in vistas:
			vistas.add(linha.factura)
			continue
		frappe.db.set_value(
			"Linha do Plano de Pagamentos",
			linha.name,
			{"factura": None, "observacoes": factura_para_observacoes(linha.factura, linha.observacoes, "duplicada")},
			update_modified=False,
		)
