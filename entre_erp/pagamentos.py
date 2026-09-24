"""Shared helpers for the Plano de Pagamentos (monthly cashflow planning)."""

import calendar
import datetime

import frappe
from frappe import _
from frappe.utils import flt

MESES = [
	"Janeiro",
	"Fevereiro",
	"Março",
	"Abril",
	"Maio",
	"Junho",
	"Julho",
	"Agosto",
	"Setembro",
	"Outubro",
	"Novembro",
	"Dezembro",
]

ESTADO_PAGO = "Pago"
ESTADO_PROXIMO_MES = "Próximo Mês"


def numero_mes(mes):
	return MESES.index(mes) + 1


def nome_plano(tipo, ano, mes=None):
	if tipo == "Investimentos":
		return f"PI-{ano}"
	return f"PP-{ano}-{numero_mes(mes):02d}"


def mes_anterior(ano, mes):
	n = numero_mes(mes)
	if n == 1:
		return ano - 1, MESES[11]
	return ano, MESES[n - 2]


def data_vencimento(ano, mes, dia):
	if not dia:
		return None
	n = numero_mes(mes)
	ultimo_dia = calendar.monthrange(ano, n)[1]
	return datetime.date(ano, n, min(max(dia, 1), ultimo_dia))


def criar_plano_do_mes():
	"""Scheduler (monthly): make sure the current month has a plan, filled
	with the active Despesas Recorrentes and last month's Próximo Mês lines.
	Safe to run more than once — an existing plan is only topped up."""
	hoje = frappe.utils.getdate()
	ano, mes = hoje.year, MESES[hoje.month - 1]
	nome = nome_plano("Mensal", ano, mes)

	if frappe.db.exists("Plano de Pagamentos", nome):
		plano = frappe.get_doc("Plano de Pagamentos", nome)
	else:
		plano = frappe.get_doc({"doctype": "Plano de Pagamentos", "tipo": "Mensal", "ano": ano, "mes": mes})

	plano.adicionar_despesas_recorrentes()
	plano.adicionar_linhas_proximo_mes()
	plano.save(ignore_permissions=True)


def valor_pago_da_linha(row):
	if row.estado == ESTADO_PAGO and not flt(row.valor_pago):
		return flt(row.valor)
	return flt(row.valor_pago)


# ----------------------------------------------------------------------
# API for the Cashflow page (page/cashflow)
# ----------------------------------------------------------------------

CAMPOS_EDITAVEIS = {
	"descricao",
	"valor",
	"prioridade",
	"estado",
	"valor_pago",
	"metodo_pagamento",
	"data_vencimento",
	"categoria",
	"fornecedor",
	"factura",
	"ordem_compra",
	"observacoes",
}
CAMPOS_NUMERICOS = {"valor", "valor_pago"}


@frappe.whitelist()
def obter_ano(ano):
	ano = int(ano)
	frappe.has_permission("Plano de Pagamentos", "read", throw=True)
	return {
		"planos": frappe.get_all(
			"Plano de Pagamentos",
			filters={"ano": ano},
			fields=["name", "tipo", "mes", "estado", "total_previsto", "total_pago", "total_remanescente"],
		),
		"metodos": frappe.get_all("Mode of Payment", filters={"enabled": 1}, pluck="name", order_by="name"),
		"categorias": frappe.get_all("Categoria de Despesa", pluck="name", order_by="name"),
	}


@frappe.whitelist()
def obter_plano(plano):
	doc = frappe.get_doc("Plano de Pagamentos", plano)
	doc.check_permission("read")
	return doc.as_dict()


@frappe.whitelist()
def criar_plano(ano, tipo="Mensal", mes=None):
	doc = frappe.get_doc({"doctype": "Plano de Pagamentos", "tipo": tipo, "ano": int(ano), "mes": mes})
	if tipo == "Mensal":
		doc.adicionar_despesas_recorrentes()
		doc.adicionar_linhas_proximo_mes()
	doc.insert()
	return doc.as_dict()


@frappe.whitelist()
def atualizar_linha(plano, linha, campo, valor=None):
	if campo not in CAMPOS_EDITAVEIS:
		frappe.throw(_("Campo não editável: {0}").format(campo))

	doc = _plano_editavel(plano)
	row = _linha(doc, linha)

	if campo in CAMPOS_NUMERICOS:
		valor = flt(valor)
	elif campo == "estado" and row.estado == ESTADO_PAGO and valor not in (ESTADO_PAGO, "Parcialmente Pago"):
		# Undoing a "Pago": drop the amount that was auto-filled with it.
		if flt(row.valor_pago) == flt(row.valor):
			row.valor_pago = 0

	row.set(campo, valor or (0 if campo in CAMPOS_NUMERICOS else None))
	doc.save()
	return {"linha": row.as_dict(), "plano": _cabecalho(doc)}


@frappe.whitelist()
def adicionar_linha(plano, descricao):
	doc = _plano_editavel(plano)
	doc.append(
		"linhas",
		{"descricao": descricao, "estado": "Pendente", "categoria": "Investimento" if doc.tipo == "Investimentos" else None},
	)
	doc.save()
	return doc.as_dict()


@frappe.whitelist()
def remover_linha(plano, linha):
	doc = _plano_editavel(plano)
	doc.remove(_linha(doc, linha))
	doc.save()
	return doc.as_dict()


@frappe.whitelist()
def preencher_plano(plano, acao):
	doc = _plano_editavel(plano)
	if acao == "recorrentes":
		n = doc.adicionar_despesas_recorrentes()
	elif acao == "proximo_mes":
		n = doc.adicionar_linhas_proximo_mes()
	else:
		frappe.throw(_("Ação desconhecida."))
	doc.save()
	return {"adicionadas": n, "plano": doc.as_dict()}


@frappe.whitelist()
def definir_estado_plano(plano, estado):
	doc = frappe.get_doc("Plano de Pagamentos", plano)
	doc.estado = estado
	doc.save()
	return _cabecalho(doc)


@frappe.whitelist()
def resumo_anual(ano):
	"""Matrix for the Resumo Anual tab: categoria → despesa → month.
	Recurring bills get their own row; one-off lines are grouped per
	categoria as "Pontuais"."""
	ano = int(ano)
	frappe.has_permission("Plano de Pagamentos", "read", throw=True)

	linhas = frappe.db.sql(
		"""
		select p.mes, l.categoria, l.despesa_recorrente, l.estado, l.valor, l.valor_pago
		from `tabLinha do Plano de Pagamentos` l
		join `tabPlano de Pagamentos` p on p.name = l.parent and l.parenttype = 'Plano de Pagamentos'
		where p.ano = %s and p.tipo = 'Mensal'
		""",
		ano,
		as_dict=True,
	)

	categorias, totais = {}, {}
	for l in linhas:
		previsto = flt(l.valor_pago) if l.estado == ESTADO_PROXIMO_MES else flt(l.valor)
		pendente = (
			0.0
			if l.estado in (ESTADO_PAGO, ESTADO_PROXIMO_MES)
			else max(flt(l.valor) - flt(l.valor_pago), 0.0)
		)
		categoria = l.categoria or _("Sem categoria")
		item = l.despesa_recorrente or _("Pontuais")
		celula = categorias.setdefault(categoria, {}).setdefault(item, {})
		celula[l.mes] = celula.get(l.mes, 0.0) + previsto

		t = totais.setdefault(l.mes, {"previsto": 0.0, "pago": 0.0, "remanescente": 0.0})
		t["previsto"] += previsto
		t["pago"] += flt(l.valor_pago)
		t["remanescente"] += pendente

	return {
		"meses": MESES,
		"categorias": [
			{
				"categoria": categoria,
				# Recurring rows first (alphabetical), "Pontuais" last.
				"itens": [
					{"item": item, "valores": valores}
					for item, valores in sorted(itens.items(), key=lambda kv: (kv[0] == _("Pontuais"), kv[0]))
				],
			}
			for categoria, itens in sorted(categorias.items())
		],
		"totais": totais,
	}


def _plano_editavel(plano):
	doc = frappe.get_doc("Plano de Pagamentos", plano)
	if doc.estado == "Fechado":
		frappe.throw(_("O plano {0} está Fechado. Reabra-o para editar.").format(doc.titulo))
	return doc


def _linha(doc, linha):
	row = next((r for r in doc.linhas if r.name == linha), None)
	if not row:
		frappe.throw(_("Linha não encontrada — atualize a página."))
	return row


def _cabecalho(doc):
	return {
		"name": doc.name,
		"estado": doc.estado,
		"total_previsto": doc.total_previsto,
		"total_pago": doc.total_pago,
		"total_remanescente": doc.total_remanescente,
		"resumo_metodos": [r.as_dict() for r in doc.resumo_metodos],
	}
