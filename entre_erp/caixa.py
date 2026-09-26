"""Caixa (petty cash): a small cashflow of its own, kept apart from the
monthly plans.

- Reforço (money in): created automatically when a plan's Caixa line is
  paid — and removed when that Pago is undone — or entered by hand
  (e.g. an opening balance).
- Gasto (money out): what the operator spends from it, line by line.

The balance runs continuously: what's left at the end of a month stays
for the next one.
"""

import calendar
import datetime

import frappe
from frappe import _
from frappe.utils import flt, getdate

from entre_erp.pagamentos import (
	DESPESA_CAIXA,
	ESTADO_PAGO,
	ESTADO_PARCIAL,
	MESES,
	bloqueio_do_mes_anterior,
	e_linha_de_caixa,
	nome_plano,
	numero_mes,
)
REFORCO = "Reforço"
GASTO = "Gasto"
CAMPOS_EDITAVEIS = {"data", "descricao", "tipo", "valor", "categoria", "observacoes"}


# ----------------------------------------------------------------------
# Plan → Caixa (called from Plano de Pagamentos.on_update / on_trash)
# ----------------------------------------------------------------------


def sincronizar_reforcos(plano):
	"""Keeps one Reforço per paid Caixa line of the plan. A new one is only
	created when the line *becomes* paid, so months imported as already
	paid don't flood the Caixa with past top-ups."""
	if plano.flags.importacao:
		return

	pagos = (ESTADO_PAGO, ESTADO_PARCIAL)
	antes = plano.get_doc_before_save()
	estado_antes = {r.name: r.estado for r in (antes.linhas if antes else [])}
	existentes = {
		m.linha_plano: m
		for m in frappe.get_all(
			"Movimento de Caixa", filters={"plano": plano.name}, fields=["name", "linha_plano", "valor", "data"]
		)
	}

	linhas_de_caixa = set()
	for row in plano.linhas:
		if not e_linha_de_caixa(row):
			continue
		linhas_de_caixa.add(row.name)
		movimento = existentes.get(row.name)
		pago = row.estado in pagos and flt(row.valor_pago) > 0
		data = getdate(row.data_pagamento or frappe.utils.today())

		if not pago:
			if movimento:
				_apagar(movimento.name)
		elif movimento:
			if flt(movimento.valor) != flt(row.valor_pago) or getdate(movimento.data) != data:
				doc = frappe.get_doc("Movimento de Caixa", movimento.name)
				doc.update({"valor": flt(row.valor_pago), "data": data})
				doc.flags.do_plano = True
				doc.save(ignore_permissions=True)
		elif estado_antes.get(row.name) not in pagos:
			doc = frappe.get_doc(
				{
					"doctype": "Movimento de Caixa",
					"tipo": REFORCO,
					"descricao": _("Reforço — {0}").format(plano.titulo),
					"valor": flt(row.valor_pago),
					"data": data,
					"plano": plano.name,
					"linha_plano": row.name,
				}
			)
			doc.flags.do_plano = True
			doc.insert(ignore_permissions=True)

	for linha, movimento in existentes.items():
		if linha not in linhas_de_caixa:
			_apagar(movimento.name)


def apagar_reforcos_do_plano(plano):
	for nome in frappe.get_all("Movimento de Caixa", filters={"plano": plano.name}, pluck="name"):
		_apagar(nome)


def _apagar(nome):
	doc = frappe.get_doc("Movimento de Caixa", nome)
	doc.flags.do_plano = True
	doc.delete(ignore_permissions=True)


# ----------------------------------------------------------------------
# API for the Caixa tab of the Cashflow page
# ----------------------------------------------------------------------


@frappe.whitelist()
def obter_caixa(ano, mes):
	frappe.has_permission("Movimento de Caixa", "read", throw=True)
	ano = int(ano)
	inicio, fim = _limites(ano, mes)
	movimentos = frappe.get_all(
		"Movimento de Caixa",
		filters={"data": ["between", (inicio, fim)]},
		fields=["name", "data", "tipo", "descricao", "valor", "categoria", "observacoes", "plano", "linha_plano"],
		order_by="data asc, creation asc",
	)
	return {
		"ano": ano,
		"mes": mes,
		"movimentos": movimentos,
		"resumo": resumo(ano, mes),
		"reforco_do_mes": reforco_do_mes(ano, mes),
	}


def reforco_do_mes(ano, mes):
	"""The month's plan Caixa line, as the Caixa tab shows and edits it."""
	nome = nome_plano("Mensal", ano, mes)
	plano = frappe.db.get_value("Plano de Pagamentos", nome, ["name", "estado", "titulo"], as_dict=True)
	if not plano:
		return {"plano": None}
	bloqueio = bloqueio_do_mes_anterior(ano, mes) if plano.estado != "Fechado" else None
	linha = next(
		(
			r
			for r in frappe.get_all(
				"Linha do Plano de Pagamentos",
				filters={"parent": nome, "parenttype": "Plano de Pagamentos"},
				fields=["name", "descricao", "despesa_recorrente", "valor", "valor_pago", "estado", "data_pagamento"],
				order_by="idx asc",
			)
			if e_linha_de_caixa(r)
		),
		None,
	)
	return {
		"plano": plano.name,
		"titulo": plano.titulo,
		"estado_plano": plano.estado,
		"bloqueio": bloqueio,
		"editavel": plano.estado != "Fechado" and not bloqueio,
		"linha": linha,
	}


@frappe.whitelist()
def adicionar_linha_caixa(ano, mes):
	"""Adds a Caixa line (amount 0 = no top-up yet) to the month's plan."""
	from entre_erp.pagamentos import _plano_editavel

	doc = _plano_editavel(nome_plano("Mensal", int(ano), mes))
	if not any(e_linha_de_caixa(r) for r in doc.linhas):
		recorrente = frappe.db.get_value(
			"Despesa Recorrente", DESPESA_CAIXA, ["categoria", "metodo_pagamento", "prioridade"], as_dict=True
		)
		doc.append(
			"linhas",
			{
				"descricao": DESPESA_CAIXA,
				"despesa_recorrente": DESPESA_CAIXA if recorrente else None,
				"categoria": recorrente.categoria if recorrente else None,
				"metodo_pagamento": recorrente.metodo_pagamento if recorrente else None,
				"prioridade": recorrente.prioridade if recorrente else None,
				"valor": 0,
				"estado": "Pendente",
			},
		)
		doc.save()
	return obter_caixa(ano, mes)


@frappe.whitelist()
def adicionar_movimento(ano, mes, descricao, tipo=GASTO):
	inicio, fim = _limites(int(ano), mes)
	hoje = getdate()
	doc = frappe.get_doc(
		{
			"doctype": "Movimento de Caixa",
			"tipo": tipo,
			"descricao": descricao,
			"valor": 0,
			# Today when working on the current month, otherwise the month's last day.
			"data": hoje if inicio <= hoje <= fim else fim,
		}
	).insert()
	return {"nome": doc.name, "caixa": obter_caixa(ano, mes)}


@frappe.whitelist()
def atualizar_movimento(nome, campo, valor, ano, mes):
	if campo not in CAMPOS_EDITAVEIS:
		frappe.throw(_("Campo não editável: {0}").format(campo))
	doc = frappe.get_doc("Movimento de Caixa", nome)
	doc.set(campo, flt(valor) if campo == "valor" else (valor or None))
	doc.save()
	return {"movimento": doc.as_dict(), "resumo": resumo(int(ano), mes)}


@frappe.whitelist()
def remover_movimentos(nomes, ano, mes):
	for nome in frappe.parse_json(nomes):
		frappe.delete_doc("Movimento de Caixa", nome)
	return obter_caixa(ano, mes)


def resumo(ano, mes):
	inicio, fim = _limites(ano, mes)
	saldo_inicial = _saldo(["<", inicio])
	no_mes = frappe.db.sql(
		"""
		select tipo, coalesce(categoria, ''), sum(valor)
		from `tabMovimento de Caixa`
		where data between %s and %s
		group by tipo, categoria
		""",
		(inicio, fim),
	)
	reforcos = sum(flt(v) for tipo, _c, v in no_mes if tipo == REFORCO)
	gastos = sum(flt(v) for tipo, _c, v in no_mes if tipo == GASTO)
	por_categoria = sorted(
		({"categoria": c or _("Sem categoria"), "valor": flt(v)} for tipo, c, v in no_mes if tipo == GASTO and flt(v)),
		key=lambda x: x["valor"],
		reverse=True,
	)
	return {
		"saldo_inicial": saldo_inicial,
		"reforcos": reforcos,
		"gastos": gastos,
		"saldo_final": saldo_inicial + reforcos - gastos,
		"saldo_atual": _saldo(None),
		"por_categoria": por_categoria,
	}


def resumo_atual():
	"""For the Painel Financeiro card."""
	hoje = getdate()
	mes = MESES[hoje.month - 1]
	r = resumo(hoje.year, mes)
	return {"mes": mes, "saldo_atual": r["saldo_atual"], "gastos": r["gastos"], "reforcos": r["reforcos"]}


def _saldo(filtro_data):
	condicao, valores = "", []
	if filtro_data:
		condicao, valores = "where data < %s", [filtro_data[1]]
	return flt(
		frappe.db.sql(
			f"""
			select sum(case when tipo = %s then valor else -valor end)
			from `tabMovimento de Caixa` {condicao}
			""",
			[REFORCO, *valores],
		)[0][0]
	)


def _limites(ano, mes):
	n = numero_mes(mes)
	return datetime.date(ano, n, 1), datetime.date(ano, n, calendar.monthrange(ano, n)[1])
