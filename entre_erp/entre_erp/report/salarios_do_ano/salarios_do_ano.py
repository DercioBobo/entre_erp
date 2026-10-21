"""The year's salaries at a glance: one line per employee, one column per
month (net pay, gross or base salary), and the year's total."""

import frappe
from frappe import _
from frappe.utils import cint, flt

from entre_erp.pagamentos import normalizar

MESES_CURTOS = ["Jan", "Fev", "Mar", "Abr", "Mai", "Jun", "Jul", "Ago", "Set", "Out", "Nov", "Dez"]
LIQUIDO, BRUTO, BASE = "Líquido", "Bruto", "Salário Base"
SALARIO_BASE = "Salario Base"


def execute(filters=None):
	filters = frappe._dict(filters or {})
	ano = cint(filters.year)
	if not ano:
		frappe.throw(_("Escolha o Ano."))
	valor = filters.valor or LIQUIDO

	linhas = {}
	for r in _valores(ano, valor, filters.company):
		linha = linhas.setdefault(
			r.employee, {"employee": r.employee, "employee_name": r.employee_name, "designation": r.designation}
		)
		campo = f"m{cint(r.mes)}"
		linha[campo] = flt(linha.get(campo)) + flt(r.valor)
		# The latest designation of the year.
		linha["designation"] = r.designation or linha["designation"]

	meses = [m for m in range(1, 13) if any(f"m{m}" in l for l in linhas.values())]
	for linha in linhas.values():
		linha["total"] = sum(flt(linha.get(f"m{m}")) for m in meses)
		linha["meses"] = sum(1 for m in meses if f"m{m}" in linha)
		linha["media"] = linha["total"] / linha["meses"] if linha["meses"] else 0

	columns = [
		{"fieldname": "employee_name", "label": _("Funcionário"), "fieldtype": "Data", "width": 220},
		{"fieldname": "designation", "label": _("Cargo"), "fieldtype": "Data", "width": 180},
		*(
			{"fieldname": f"m{m}", "label": _(MESES_CURTOS[m - 1]), "fieldtype": "Currency", "width": 110}
			for m in meses
		),
		{"fieldname": "total", "label": _("Total"), "fieldtype": "Currency", "width": 130},
		{"fieldname": "media", "label": _("Média mensal"), "fieldtype": "Currency", "width": 120},
	]
	dados = sorted(linhas.values(), key=lambda l: normalizar(l["employee_name"]))
	return columns, dados, None, _grafico(meses, dados), _resumo(dados)


def _valores(ano, valor, company):
	condicoes = ["ss.docstatus = 1", "year(ss.start_date) = %(ano)s"]
	if company:
		condicoes.append("ss.company = %(company)s")
	base = {"ano": ano, "company": company}
	comum = "ss.employee, ss.employee_name, ss.designation, month(ss.start_date) as mes"
	ordem = "order by ss.start_date asc"

	if valor == BASE:
		return frappe.db.sql(
			f"""
			select {comum}, sd.amount as valor
			from `tabSalary Slip` ss
			join `tabSalary Detail` sd on sd.parent = ss.name and sd.parenttype = 'Salary Slip'
				and sd.parentfield = 'earnings' and sd.salary_component = %(componente)s
			where {" and ".join(condicoes)}
			{ordem}
			""",
			{**base, "componente": SALARIO_BASE},
			as_dict=True,
		)
	campo = "ss.gross_pay" if valor == BRUTO else "ss.net_pay"
	return frappe.db.sql(
		f"""
		select {comum}, {campo} as valor
		from `tabSalary Slip` ss
		where {" and ".join(condicoes)}
		{ordem}
		""",
		base,
		as_dict=True,
	)


def _grafico(meses, dados):
	if not meses:
		return None
	return {
		"data": {
			"labels": [_(MESES_CURTOS[m - 1]) for m in meses],
			"datasets": [{"name": _("Total"), "values": [sum(flt(l.get(f"m{m}")) for l in dados) for m in meses]}],
		},
		"type": "bar",
		"fieldtype": "Currency",
		"height": 220,
	}


def _resumo(dados):
	total = sum(l["total"] for l in dados)
	return [
		{"label": _("Funcionários"), "value": len(dados), "datatype": "Int"},
		{"label": _("Total do ano"), "value": total, "datatype": "Currency", "indicator": "Blue"},
	]
