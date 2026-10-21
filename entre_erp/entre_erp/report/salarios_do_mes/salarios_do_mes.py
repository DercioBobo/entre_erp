"""The month's salaries in short: gross, deductions and net per employee,
and how the net pay changed from the month before."""

import frappe
from frappe import _
from frappe.utils import cint, flt

from entre_erp.pagamentos import normalizar


def execute(filters=None):
	filters = frappe._dict(filters or {})
	mes, ano = cint(filters.month), cint(filters.year)
	if not (1 <= mes <= 12 and ano):
		frappe.throw(_("Escolha o Mês e o Ano."))
	ano_ant, mes_ant = (ano - 1, 12) if mes == 1 else (ano, mes - 1)

	atuais = _recibos(mes, ano, filters.company)
	anteriores = {r.employee: flt(r.net_pay) for r in _recibos(mes_ant, ano_ant, filters.company)}

	dados = []
	for r in atuais:
		anterior = anteriores.get(r.employee)
		dados.append(
			{
				"employee_name": r.employee_name,
				"designation": r.designation,
				"gross_pay": flt(r.gross_pay),
				"total_deduction": flt(r.total_deduction),
				"net_pay": flt(r.net_pay),
				"anterior": anterior,
				"variacao": flt(r.net_pay) - anterior if anterior is not None else None,
				"salary_slip": r.name,
			}
		)
	dados.sort(key=lambda l: normalizar(l["employee_name"]))

	columns = [
		{"fieldname": "employee_name", "label": _("Funcionário"), "fieldtype": "Data", "width": 220},
		{"fieldname": "designation", "label": _("Cargo"), "fieldtype": "Data", "width": 180},
		{"fieldname": "gross_pay", "label": _("Bruto"), "fieldtype": "Currency", "width": 130},
		{"fieldname": "total_deduction", "label": _("Descontos"), "fieldtype": "Currency", "width": 130},
		{"fieldname": "net_pay", "label": _("Líquido"), "fieldtype": "Currency", "width": 130},
		{"fieldname": "anterior", "label": _("Líquido mês anterior"), "fieldtype": "Currency", "width": 150},
		{"fieldname": "variacao", "label": _("Variação"), "fieldtype": "Currency", "width": 120},
		{"fieldname": "salary_slip", "label": _("Recibo"), "fieldtype": "Link", "options": "Salary Slip", "width": 190},
	]
	return columns, dados, None, None, _resumo(dados, anteriores, atuais)


def _recibos(mes, ano, company):
	condicoes = ["docstatus = 1", "month(start_date) = %(mes)s", "year(start_date) = %(ano)s"]
	if company:
		condicoes.append("company = %(company)s")
	return frappe.db.sql(
		f"""
		select name, employee, employee_name, designation, gross_pay, total_deduction, net_pay
		from `tabSalary Slip`
		where {" and ".join(condicoes)}
		""",
		{"mes": mes, "ano": ano, "company": company},
		as_dict=True,
	)


def _resumo(dados, anteriores, atuais):
	liquido = sum(l["net_pay"] for l in dados)
	resumo = [
		{"label": _("Funcionários"), "value": len(dados), "datatype": "Int"},
		{"label": _("Bruto"), "value": sum(l["gross_pay"] for l in dados), "datatype": "Currency"},
		{"label": _("Descontos"), "value": sum(l["total_deduction"] for l in dados), "datatype": "Currency"},
		{"label": _("Líquido"), "value": liquido, "datatype": "Currency", "indicator": "Blue"},
	]
	if anteriores:
		variacao = liquido - sum(anteriores.values())
		resumo.append(
			{
				"label": _("Variação vs mês anterior"),
				"value": variacao,
				"datatype": "Currency",
				"indicator": "Red" if variacao > 0 else "Green",
			}
		)
	# Paid last month but not this one (left, or slip not yet submitted).
	sairam = set(anteriores) - {r.employee for r in atuais}
	if sairam:
		resumo.append({"label": _("Sem recibo este mês"), "value": len(sairam), "datatype": "Int", "indicator": "Orange"})
	return resumo
