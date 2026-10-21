"""Payroll (HRMS Salary Slips) → monthly plan lines.

A Despesa Recorrente whose Fonte is a payroll figure gets its amount from
submitted Salary Slips instead of being typed by hand:

- Salários líquidos: net pay of the month's own payroll.
- INSS: the worker's deduction (Segurança Social, 3%) plus the company's
  share (4% of the taxable earnings of whoever had that deduction) — of
  the month BEFORE, since it is paid to the state the month after.
- IRPS: the "IRPS …" deductions of the month before, for the same reason.

A recurring expense may list the employees it covers (e.g. INSS-DH for one
person); one without a list covers everyone not listed on another expense
with the same Fonte. The line follows the payroll while nothing has been
paid on it; once paid, its amount stays as it is.

Synced when a Salary Slip is submitted or cancelled, when a month's plan
gets its recurring expenses, and when a payroll recurring expense is saved.
"""

import frappe
from frappe.utils import cint, flt, getdate

from entre_erp.pagamentos import MESES, definir_formula, mes_anterior, mes_seguinte, nome_plano, normalizar

FONTE_MANUAL = "Manual"
FONTE_SALARIOS = "Folha: Salários líquidos"
FONTE_INSS = "Folha: INSS"
FONTE_IRPS = "Folha: IRPS"
FONTES_DA_FOLHA = (FONTE_SALARIOS, FONTE_INSS, FONTE_IRPS)
# Paid to the state the month after the payroll they come from.
FONTES_DO_MES_ANTERIOR = (FONTE_INSS, FONTE_IRPS)

# Nothing paid on them yet, so the amount may still follow the payroll.
ESTADOS_ATUALIZAVEIS = ("Pendente", "Reservado", "Em Progresso", "Em Espera")


def _definicoes():
	from entre_erp.entre_erp.doctype.cashflow_settings.cashflow_settings import definicao

	return frappe._dict(
		componente_inss=normalizar(definicao("componente_inss", "Segurança Social")),
		prefixo_irps=normalizar(definicao("prefixo_irps", "IRPS")),
		taxa_inss_empresa=flt(definicao("taxa_inss_empresa", 4)),
	)


def despesas_da_folha():
	"""{Despesa Recorrente: {fonte, funcionarios (set, or None = the rest)}}."""
	despesas = frappe.get_all(
		"Despesa Recorrente", filters={"fonte": ["in", FONTES_DA_FOLHA]}, fields=["name", "fonte"]
	)
	if not despesas:
		return {}
	funcionarios = {}
	for r in frappe.get_all(
		"Despesa Recorrente Funcionario",
		filters={"parenttype": "Despesa Recorrente", "parent": ["in", [d.name for d in despesas]]},
		fields=["parent", "funcionario"],
	):
		funcionarios.setdefault(r.parent, set()).add(r.funcionario)
	return {d.name: frappe._dict(fonte=d.fonte, funcionarios=funcionarios.get(d.name)) for d in despesas}


def folha_por_funcionario(ano, mes):
	"""{employee: {fonte: amount}} from the month's submitted Salary Slips
	(period starting in the month, cashflow company, company currency).
	Empty while no payroll was submitted for the month."""
	if not frappe.db.exists("DocType", "Salary Slip"):
		return {}
	from entre_erp.pagamentos import _empresa_do_cashflow

	recibos = frappe.db.sql(
		"""
		select name, employee, base_net_pay, coalesce(nullif(exchange_rate, 0), 1) as cambio
		from `tabSalary Slip`
		where docstatus = 1 and company = %s and year(start_date) = %s and month(start_date) = %s
		""",
		(_empresa_do_cashflow(), cint(ano), MESES.index(mes) + 1),
		as_dict=True,
	)
	if not recibos:
		return {}

	d = _definicoes()
	por_recibo = {r.name: frappe._dict(inss=0.0, irps=0.0, tributavel=0.0, cambio=flt(r.cambio)) for r in recibos}
	for linha in frappe.get_all(
		"Salary Detail",
		filters={
			"parenttype": "Salary Slip",
			"parent": ["in", list(por_recibo)],
			"parentfield": ["in", ("earnings", "deductions")],
			"statistical_component": 0,
			"do_not_include_in_total": 0,
		},
		fields=["parent", "parentfield", "salary_component", "amount", "is_tax_applicable"],
	):
		r = por_recibo[linha.parent]
		valor = flt(linha.amount) * r.cambio
		componente = normalizar(linha.salary_component)
		if linha.parentfield == "earnings":
			if cint(linha.is_tax_applicable):
				r.tributavel += valor
		elif componente == d.componente_inss:
			r.inss += valor
		elif d.prefixo_irps and componente.startswith(d.prefixo_irps):
			r.irps += valor

	resultado = {}
	for recibo in recibos:
		r = por_recibo[recibo.name]
		# The company's share only for whoever pays INSS (exempt employees cost none).
		empresa = r.tributavel * d.taxa_inss_empresa / 100 if r.inss else 0.0
		f = resultado.setdefault(recibo.employee, {fonte: 0.0 for fonte in FONTES_DA_FOLHA})
		f[FONTE_SALARIOS] += flt(recibo.base_net_pay)
		f[FONTE_INSS] += r.inss + empresa
		f[FONTE_IRPS] += r.irps
	return resultado


def valores_para_plano(ano, mes, despesas):
	"""{Despesa Recorrente: amount} for the plan of (ano, mes). Expenses whose
	payroll month has no submitted slips are left out."""
	folhas = {}

	def folha(fonte):
		periodo = mes_anterior(ano, mes) if fonte in FONTES_DO_MES_ANTERIOR else (ano, mes)
		if periodo not in folhas:
			folhas[periodo] = folha_por_funcionario(*periodo)
		return folhas[periodo]

	valores = {}
	for nome, despesa in despesas.items():
		por_funcionario = folha(despesa.fonte)
		if not por_funcionario:
			continue
		if despesa.funcionarios:
			incluidos = despesa.funcionarios
		else:
			# Everyone not taken by another expense with the same Fonte.
			listados = set().union(
				*(o.funcionarios for n, o in despesas.items() if n != nome and o.fonte == despesa.fonte and o.funcionarios)
			)
			incluidos = set(por_funcionario) - listados
		valores[nome] = flt(sum(por_funcionario[e][despesa.fonte] for e in incluidos if e in por_funcionario), 2)
	return valores


def aplicar_folha(plano):
	"""Puts the payroll amounts on the plan's payroll lines (no save).
	Returns how many lines changed. Lines carried over from last month
	(Próximo Mês) are last month's bill and are left alone."""
	if plano.tipo != "Mensal":
		return 0
	despesas = despesas_da_folha()
	linhas = [
		r
		for r in plano.linhas
		if r.despesa_recorrente in despesas
		and not r.linha_origem
		and r.estado in ESTADOS_ATUALIZAVEIS
		and not flt(r.valor_pago)
	]
	if not linhas:
		return 0

	# All payroll expenses, not just this plan's: they decide who "the rest" are.
	valores = valores_para_plano(plano.ano, plano.mes, despesas)
	alteradas = 0
	for row in linhas:
		valor = valores.get(row.despesa_recorrente)
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
	"""A month's payroll feeds that month's plan (Salários) and the next
	one's (INSS, IRPS). Payroll Entry submits many slips in one go, so the
	months touched are collected and each plan is saved once, just before
	the commit."""
	from entre_erp.pagamentos import _empresa_do_cashflow

	if doc.company != _empresa_do_cashflow() or not despesas_da_folha():
		return
	inicio = getdate(doc.start_date)
	mes = (inicio.year, MESES[inicio.month - 1])
	meses = frappe.flags.folha_por_sincronizar
	if meses is None:
		meses = frappe.flags.folha_por_sincronizar = set()
		frappe.db.before_commit.add(_sincronizar_pendentes)
		frappe.db.after_rollback.add(lambda: frappe.flags.pop("folha_por_sincronizar", None))
	meses.update((mes, mes_seguinte(*mes)))


def _sincronizar_pendentes():
	for ano, mes in frappe.flags.pop("folha_por_sincronizar", None) or ():
		# A plan that refuses to save must never block the payroll.
		frappe.db.savepoint("folha_cashflow")
		try:
			sincronizar_mes(ano, mes)
		except Exception:
			frappe.db.rollback(save_point="folha_cashflow")
			frappe.log_error(title=f"Cashflow: folha de {mes} {ano} não atualizada")
