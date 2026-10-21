"""Payroll (HRMS Salary Slips) → monthly plan lines.

A Despesa Recorrente whose Fonte is a payroll figure (e.g. the net
salaries) gets its amount from the month's submitted Salary Slips instead
of being typed by hand. The line follows the payroll while nothing has
been paid on it; once paid, its amount stays as it is.

Synced when a Salary Slip is submitted or cancelled, when a month's plan
is created / gets its recurring expenses, and when a Fonte is set.
"""

import frappe
from frappe.utils import cint, flt, getdate

from entre_erp.pagamentos import MESES, definir_formula, nome_plano, numero_mes

FONTE_MANUAL = "Manual"
FONTE_SALARIOS = "Folha: Salários líquidos"
FONTES_DA_FOLHA = (FONTE_SALARIOS,)

# Nothing paid on them yet, so the amount may still follow the payroll.
ESTADOS_ATUALIZAVEIS = ("Pendente", "Reservado", "Em Progresso", "Em Espera")


def despesas_da_folha():
	"""{Despesa Recorrente: Fonte} for the ones filled from payroll."""
	return dict(
		frappe.get_all(
			"Despesa Recorrente", filters={"fonte": ["in", FONTES_DA_FOLHA]}, fields=["name", "fonte"], as_list=True
		)
	)


def valores_da_folha(ano, mes):
	"""{Fonte: amount} from the month's submitted Salary Slips (period
	starting in the month, company currency — the same basis as the Resumo
	da Folha report). Empty while no payroll was submitted for the month."""
	if not frappe.db.exists("DocType", "Salary Slip"):
		return {}
	from entre_erp.pagamentos import _empresa_do_cashflow

	liquido, recibos = frappe.db.sql(
		"""
		select sum(base_net_pay), count(*)
		from `tabSalary Slip`
		where docstatus = 1 and company = %s and year(start_date) = %s and month(start_date) = %s
		""",
		(_empresa_do_cashflow(), cint(ano), numero_mes(mes)),
	)[0]
	if not cint(recibos):
		return {}
	return {FONTE_SALARIOS: flt(liquido)}


def aplicar_folha(plano):
	"""Puts the payroll amounts on the plan's payroll lines (no save).
	Returns how many lines changed. Lines carried over from last month
	(Próximo Mês) are last month's bill and are left alone."""
	if plano.tipo != "Mensal":
		return 0
	fontes = despesas_da_folha()
	linhas = [
		r
		for r in plano.linhas
		if r.despesa_recorrente in fontes
		and not r.linha_origem
		and r.estado in ESTADOS_ATUALIZAVEIS
		and not flt(r.valor_pago)
	]
	if not linhas:
		return 0

	valores = valores_da_folha(plano.ano, plano.mes)
	alteradas = 0
	for row in linhas:
		valor = valores.get(fontes[row.despesa_recorrente])
		if valor is None or flt(row.valor) == flt(valor):
			continue
		row.valor = valor
		definir_formula(row, "valor")
		alteradas += 1
	return alteradas


def sincronizar_mes(ano, mes):
	nome = nome_plano("Mensal", ano, mes)
	if not frappe.db.exists("Plano de Pagamentos", nome):
		return
	plano = frappe.get_doc("Plano de Pagamentos", nome)
	if plano.estado == "Fechado" or not aplicar_folha(plano):
		return
	# Payroll must update the month even while the month before still locks it.
	plano.flags.ignorar_bloqueio = True
	plano.save(ignore_permissions=True)


def sincronizar_planos_abertos():
	for p in frappe.get_all(
		"Plano de Pagamentos", filters={"tipo": "Mensal", "estado": ["!=", "Fechado"]}, fields=["ano", "mes"]
	):
		sincronizar_mes(p.ano, p.mes)


# ----------------------------------------------------------------------
# Salary Slip on_submit / on_cancel (hooks.py)
# ----------------------------------------------------------------------


def ao_mudar_recibo(doc, method=None):
	"""Payroll Entry submits many slips in one go, so the months touched are
	collected and each plan is saved once, just before the commit."""
	from entre_erp.pagamentos import _empresa_do_cashflow

	if doc.company != _empresa_do_cashflow() or not despesas_da_folha():
		return
	inicio = getdate(doc.start_date)
	meses = frappe.flags.folha_por_sincronizar
	if meses is None:
		meses = frappe.flags.folha_por_sincronizar = set()
		frappe.db.before_commit.add(_sincronizar_pendentes)
		frappe.db.after_rollback.add(lambda: frappe.flags.pop("folha_por_sincronizar", None))
	meses.add((inicio.year, MESES[inicio.month - 1]))


def _sincronizar_pendentes():
	for ano, mes in frappe.flags.pop("folha_por_sincronizar", None) or ():
		# A plan that refuses to save must never block the payroll.
		frappe.db.savepoint("folha_cashflow")
		try:
			sincronizar_mes(ano, mes)
		except Exception:
			frappe.db.rollback(save_point="folha_cashflow")
			frappe.log_error(title=f"Cashflow: salários de {mes} {ano} não atualizados")
