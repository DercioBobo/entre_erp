"""The month's payroll, one line per Salary Slip: base salary, each
deduction that has a value this month, total deduction and net pay.

All "IRPS …" components (0 Dependentes, 1 Dependentes…) share a single
IRPS column — an employee only ever has one of them. Earnings other than
the base salary (allowances, intern stipends…) go to "Outras
remunerações", so every line adds up: base + others − deductions = net.
"""

import frappe
from frappe import _
from frappe.utils import cint, flt

from entre_erp.pagamentos import normalizar

SALARIO_BASE = "Salario Base"
IRPS = "IRPS"
SEGURANCA_SOCIAL = "Segurança Social"
# Deduction columns: these first, the rest alphabetically.
ORDEM_DESCONTOS = (IRPS, SEGURANCA_SOCIAL)


def execute(filters=None):
	filters = frappe._dict(filters or {})
	mes, ano = cint(filters.month), cint(filters.year)
	if not (1 <= mes <= 12 and ano):
		frappe.throw(_("Escolha o Mês e o Ano."))

	recibos = _recibos(mes, ano, filters.company)
	if not recibos:
		return _colunas([], False), []

	linhas = {r.name: _linha(r) for r in recibos}
	descontos = set()
	tem_outras = False
	for d in _componentes(list(linhas)):
		linha = linhas[d.parent]
		if d.parentfield == "earnings":
			campo = "salario_base" if normalizar(d.salary_component) == normalizar(SALARIO_BASE) else "outras_remuneracoes"
			tem_outras = tem_outras or campo == "outras_remuneracoes"
		else:
			coluna = _coluna_desconto(d.salary_component)
			descontos.add(coluna)
			campo = _campo(coluna)
		linha[campo] = flt(linha.get(campo)) + flt(d.amount)

	return _colunas(sorted(descontos, key=_ordem), tem_outras), list(linhas.values())


def _recibos(mes, ano, company):
	condicoes = ["docstatus = 1", "month(start_date) = %(mes)s", "year(start_date) = %(ano)s"]
	if company:
		condicoes.append("company = %(company)s")
	return frappe.db.sql(
		f"""
		select name, employee, employee_name, designation, total_deduction, net_pay
		from `tabSalary Slip`
		where {" and ".join(condicoes)}
		order by employee_name asc
		""",
		{"mes": mes, "ano": ano, "company": company},
		as_dict=True,
	)


def _componentes(recibos):
	"""Earnings and deductions that count for the slip's totals (statistical
	components and "do not include in total" ones are left out)."""
	return frappe.get_all(
		"Salary Detail",
		filters={
			"parenttype": "Salary Slip",
			"parent": ["in", recibos],
			"parentfield": ["in", ("earnings", "deductions")],
			"statistical_component": 0,
			"do_not_include_in_total": 0,
			"amount": ["!=", 0],
		},
		fields=["parent", "parentfield", "salary_component", "amount"],
	)


def _linha(r):
	return {
		"salary_slip": r.name,
		"employee": r.employee,
		"employee_name": r.employee_name,
		"designation": r.designation,
		"total_deduction": flt(r.total_deduction),
		"net_pay": flt(r.net_pay),
	}


def _coluna_desconto(componente):
	return IRPS if normalizar(componente).startswith(normalizar(IRPS)) else componente


def _campo(coluna):
	return "d_" + frappe.scrub(normalizar(coluna))


def _ordem(coluna):
	return (ORDEM_DESCONTOS.index(coluna), "") if coluna in ORDEM_DESCONTOS else (len(ORDEM_DESCONTOS), coluna)


def _colunas(descontos, tem_outras):
	dinheiro = lambda campo, label: {"fieldname": campo, "label": label, "fieldtype": "Currency", "width": 130}
	return [
		{"fieldname": "employee_name", "label": _("Funcionário"), "fieldtype": "Data", "width": 220},
		{"fieldname": "designation", "label": _("Cargo"), "fieldtype": "Data", "width": 200},
		dinheiro("salario_base", _("Salário Base")),
		*([dinheiro("outras_remuneracoes", _("Outras remunerações"))] if tem_outras else []),
		*(dinheiro(_campo(c), c) for c in descontos),
		dinheiro("total_deduction", _("Total Descontos")),
		dinheiro("net_pay", _("Líquido")),
		{"fieldname": "salary_slip", "label": _("Recibo"), "fieldtype": "Link", "options": "Salary Slip", "width": 190},
	]
