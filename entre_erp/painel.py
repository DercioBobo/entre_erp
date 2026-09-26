"""Data for the Painel Financeiro page (page/painel_financeiro) — the
manager's view of the year: money in (from ERPNext) against money out
(from the Planos de Pagamentos the operator keeps in the Cashflow page).

- Entradas previstas: submitted Sales Invoices, by posting date
  (credit notes count negative, so this is net of returns).
- Entradas reais: money received from customers, by posting date —
  Payment Entries (Receive) plus POS invoices paid on the spot.
- Saídas: total_previsto / total_pago of each monthly plan.
All amounts are in the company currency.
"""

import frappe
from frappe.utils import flt, getdate

from entre_erp import caixa
from entre_erp.entre_erp.doctype.cashflow_settings.cashflow_settings import definicao
from entre_erp.pagamentos import (
	ESTADOS_FORA_DO_MES,
	MESES,
	bloqueio_do_mes_anterior,
	linha_por_liquidar,
	nome_plano,
)

PAPEIS = ("Accounts Manager", "System Manager")


@frappe.whitelist()
def obter_painel(ano, company=None):
	frappe.only_for(PAPEIS)
	ano = int(ano)
	empresas = frappe.get_all("Company", pluck="name", order_by="name")
	company = (
		company
		or definicao("empresa_padrao")
		or frappe.defaults.get_user_default("Company")
		or (empresas[0] if empresas else None)
	)
	# Expected money in: invoices by issue date, or by when they fall due.
	por_vencimento = definicao("entradas_previstas_por", "Data da factura") == "Data de vencimento"
	data_prevista = "due_date" if por_vencimento else "posting_date"
	moeda = frappe.get_cached_value("Company", company, "default_currency") if company else None

	entradas_previstas = _por_mes(
		f"""
		select month({data_prevista}), sum(base_grand_total)
		from `tabSales Invoice`
		where docstatus = 1 and company = %(company)s and year({data_prevista}) = %(ano)s
		group by month({data_prevista})
		""",
		company,
		ano,
	)
	entradas_reais = _somar(
		_por_mes(
			"""
			select month(posting_date), sum(base_received_amount)
			from `tabPayment Entry`
			where docstatus = 1 and payment_type = 'Receive' and party_type = 'Customer'
				and company = %(company)s and year(posting_date) = %(ano)s
			group by month(posting_date)
			""",
			company,
			ano,
		),
		_por_mes(
			"""
			select month(posting_date), sum(base_paid_amount)
			from `tabSales Invoice`
			where docstatus = 1 and is_pos = 1 and company = %(company)s and year(posting_date) = %(ano)s
			group by month(posting_date)
			""",
			company,
			ano,
		),
	)

	planos = {
		p.mes: p
		for p in frappe.get_all(
			"Plano de Pagamentos",
			filters={"ano": ano, "tipo": "Mensal"},
			fields=["name", "mes", "estado", "total_previsto", "total_pago", "total_remanescente"],
		)
	}

	meses = []
	acumulado = 0.0
	ultimo_mes_real = _ultimo_mes_com_dados(ano, entradas_reais, planos)
	for n, mes in enumerate(MESES, start=1):
		plano = planos.get(mes)
		linha = {
			"mes": mes,
			"entradas_previstas": entradas_previstas.get(n, 0.0),
			"entradas_reais": entradas_reais.get(n, 0.0),
			"saidas_previstas": flt(plano.total_previsto) if plano else 0.0,
			"saidas_reais": flt(plano.total_pago) if plano else 0.0,
			"por_pagar": flt(plano.total_remanescente) if plano else 0.0,
			"estado_plano": plano.estado if plano else None,
		}
		linha["saldo_previsto"] = linha["entradas_previstas"] - linha["saidas_previstas"]
		linha["saldo_real"] = linha["entradas_reais"] - linha["saidas_reais"]
		# Running balance only up to the last month with real movement —
		# future months would just repeat the same number.
		if n <= ultimo_mes_real:
			acumulado += linha["saldo_real"]
			linha["acumulado"] = acumulado
		else:
			linha["acumulado"] = None
		meses.append(linha)

	return {
		"ano": ano,
		"company": company,
		"empresas": empresas,
		"moeda": moeda,
		"entradas_por_vencimento": por_vencimento,
		"pode_configurar": frappe.has_permission("Cashflow Settings", "write"),
		"meses": meses,
		"por_receber": _por_receber(company, moeda),
		"clientes_por_receber": _clientes_por_receber(company, moeda),
		"investimentos": frappe.db.get_value(
			"Plano de Pagamentos",
			nome_plano("Investimentos", ano),
			["total_previsto", "total_pago", "total_remanescente"],
			as_dict=True,
		),
		"categorias": _saidas_por_categoria(ano),
		"caixa": caixa.resumo_atual(),
		"mes_atual": _mes_atual(ano, planos),
	}


def _por_mes(sql, company, ano):
	return {int(m): flt(v) for m, v in frappe.db.sql(sql, {"company": company, "ano": ano})}


def _somar(*dicionarios):
	total = {}
	for d in dicionarios:
		for k, v in d.items():
			total[k] = total.get(k, 0.0) + v
	return total


def _ultimo_mes_com_dados(ano, entradas_reais, planos):
	hoje = getdate()
	if ano < hoje.year:
		return 12
	if ano > hoje.year:
		return 0
	com_dados = [n for n in entradas_reais] + [
		MESES.index(m) + 1 for m, p in planos.items() if flt(p.total_pago)
	]
	return max(com_dados + [hoje.month])


def _valor_em_moeda_da_empresa():
	# outstanding_amount is in the party account currency; convert only
	# when that isn't the company currency.
	return (
		"case when party_account_currency = %(moeda)s then outstanding_amount "
		"else outstanding_amount * conversion_rate end"
	)


def _por_receber(company, moeda):
	return flt(
		frappe.db.sql(
			f"""
			select sum({_valor_em_moeda_da_empresa()})
			from `tabSales Invoice`
			where docstatus = 1 and company = %(company)s and outstanding_amount > 0
			""",
			{"company": company, "moeda": moeda},
		)[0][0]
	)


def _clientes_por_receber(company, moeda, limite=5):
	return frappe.db.sql(
		f"""
		select customer_name as cliente, count(*) as facturas,
			sum({_valor_em_moeda_da_empresa()}) as valor,
			min(due_date) as vencimento_mais_antigo
		from `tabSales Invoice`
		where docstatus = 1 and company = %(company)s and outstanding_amount > 0
		group by customer_name
		order by valor desc
		limit %(limite)s
		""",
		{"company": company, "moeda": moeda, "limite": limite},
		as_dict=True,
	)


def _saidas_por_categoria(ano):
	linhas = frappe.db.sql(
		"""
		select l.categoria, l.estado, l.valor, l.valor_pago
		from `tabLinha do Plano de Pagamentos` l
		join `tabPlano de Pagamentos` p on p.name = l.parent and l.parenttype = 'Plano de Pagamentos'
		where p.ano = %s and p.tipo = 'Mensal'
		""",
		ano,
		as_dict=True,
	)
	categorias = {}
	for l in linhas:
		c = categorias.setdefault(l.categoria or "Sem categoria", {"previsto": 0.0, "pago": 0.0})
		c["previsto"] += flt(l.valor_pago) if l.estado in ESTADOS_FORA_DO_MES else flt(l.valor)
		c["pago"] += flt(l.valor_pago)
	return sorted(
		({"categoria": k, **v} for k, v in categorias.items()),
		key=lambda c: c["previsto"],
		reverse=True,
	)


def _mes_atual(ano, planos):
	hoje = getdate()
	if ano != hoje.year:
		return None
	mes = MESES[hoje.month - 1]
	plano = planos.get(mes)
	resultado = {"mes": mes, "existe": bool(plano)}
	if plano:
		por_liquidar = len(
			[
				r
				for r in frappe.get_all(
					"Linha do Plano de Pagamentos",
					filters={"parent": plano.name, "parenttype": "Plano de Pagamentos"},
					fields=["estado", "valor", "descricao", "despesa_recorrente"],
				)
				if linha_por_liquidar(r)
			]
		)
		resultado.update(
			{
				"estado": plano.estado,
				"por_pagar": flt(plano.total_remanescente),
				"linhas_por_liquidar": por_liquidar,
				"bloqueio": bloqueio_do_mes_anterior(ano, mes) if plano.estado != "Fechado" else None,
			}
		)
	return resultado
