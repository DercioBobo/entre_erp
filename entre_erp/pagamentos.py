"""Shared helpers for the Plano de Pagamentos (monthly cashflow planning)."""

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
ESTADO_PARCIAL = "Parcialmente Pago"
ESTADO_PROXIMO_MES = "Próximo Mês"
ESTADO_CANCELADO = "Cancelado"
# Lines that stay on the sheet but don't count for this month, except for
# anything already paid on them.
ESTADOS_FORA_DO_MES = (ESTADO_PROXIMO_MES, ESTADO_CANCELADO)
# A line is settled ("liquidada") once it needs nothing more this month.
ESTADOS_LIQUIDADOS = (ESTADO_PAGO, ESTADO_CANCELADO, ESTADO_PROXIMO_MES)


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


def mes_seguinte(ano, mes):
	n = numero_mes(mes)
	if n == 12:
		return ano + 1, MESES[0]
	return ano, MESES[n]


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
	# Created even while last month is still open — it just stays locked
	# for editing until last month is settled.
	plano.flags.ignorar_bloqueio = True
	plano.save(ignore_permissions=True)


def bloqueio_do_mes_anterior(ano, mes):
	"""A month is locked while the month before it is not Fechado and still
	has lines to settle (pay, cancel or move to Próximo Mês)."""
	ano_ant, mes_ant = mes_anterior(ano, mes)
	nome = nome_plano("Mensal", ano_ant, mes_ant)
	anterior = frappe.db.get_value("Plano de Pagamentos", nome, ["estado", "titulo"], as_dict=True)
	if not anterior or anterior.estado == "Fechado":
		return None

	pendentes, valor = frappe.db.sql(
		"""
		select count(*), coalesce(sum(greatest(valor - valor_pago, 0)), 0)
		from `tabLinha do Plano de Pagamentos`
		where parent = %s and parenttype = 'Plano de Pagamentos' and estado not in %s
		""",
		(nome, ESTADOS_LIQUIDADOS),
	)[0]
	if not pendentes:
		return None
	return {
		"plano": nome,
		"titulo": anterior.titulo,
		"ano": ano_ant,
		"mes": mes_ant,
		"pendentes": pendentes,
		"valor": flt(valor),
	}


def factura_existe(factura):
	"""A Purchase Invoice that a line may link to (not cancelled)."""
	return bool(frappe.db.exists("Purchase Invoice", {"name": factura, "docstatus": ["!=", 2]}))


def factura_para_observacoes(factura, observacoes, motivo):
	"""Keeps an unusable invoice number as text, so the reference isn't lost."""
	nota = f"Factura: {factura} ({motivo})"
	return f"{nota} · {observacoes}" if observacoes else nota


def desligar_factura_cancelada(doc, method=None):
	"""Purchase Invoice on_cancel: a plan line can't keep linking to a
	cancelled invoice (Frappe would refuse to save that month again), so
	the number moves to Observações and the link is cleared."""
	for linha in frappe.get_all(
		"Linha do Plano de Pagamentos",
		filters={"factura": doc.name, "parenttype": "Plano de Pagamentos"},
		fields=["name", "observacoes"],
	):
		frappe.db.set_value(
			"Linha do Plano de Pagamentos",
			linha.name,
			{"factura": None, "observacoes": factura_para_observacoes(doc.name, linha.observacoes, "cancelada")},
			update_modified=False,
		)


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
	"data_pagamento",
	"metodo_pagamento",
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
	resultado = doc.as_dict()
	if doc.tipo == "Mensal" and doc.estado != "Fechado":
		resultado["bloqueio"] = bloqueio_do_mes_anterior(doc.ano, doc.mes)
	return resultado


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
	doc = _plano_editavel(plano)
	row = _linha(doc, linha)
	_aplicar(row, campo, valor)
	doc.save()
	return {"linha": row.as_dict(), "plano": _cabecalho(doc), "transporte": doc.flags.transporte}


@frappe.whitelist()
def atualizar_linhas(plano, linhas, valores):
	"""Bulk edit: the same values on several lines, in a single save — so
	moving to Próximo Mês and auto-closing happen once for the whole batch."""
	linhas, valores = frappe.parse_json(linhas), frappe.parse_json(valores)
	doc = _plano_editavel(plano)
	for nome in linhas:
		row = _linha(doc, nome)
		for campo, valor in valores.items():
			_aplicar(row, campo, valor)
	doc.save()
	return _resposta_completa(doc)


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
	return remover_linhas(plano, [linha])


@frappe.whitelist()
def remover_linhas(plano, linhas):
	doc = _plano_editavel(plano)
	for nome in frappe.parse_json(linhas):
		doc.remove(_linha(doc, nome))
	doc.save()
	return _resposta_completa(doc)


@frappe.whitelist()
def preencher_plano(plano, acao):
	doc = _plano_editavel(plano)
	if acao == "recorrentes":
		n = doc.adicionar_despesas_recorrentes()
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
		previsto = flt(l.valor_pago) if l.estado in ESTADOS_FORA_DO_MES else flt(l.valor)
		pendente = (
			0.0
			if l.estado == ESTADO_PAGO or l.estado in ESTADOS_FORA_DO_MES
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


def _aplicar(row, campo, valor):
	if campo not in CAMPOS_EDITAVEIS:
		frappe.throw(_("Campo não editável: {0}").format(campo))

	if campo in CAMPOS_NUMERICOS:
		valor = flt(valor)
	elif campo == "estado" and row.estado == ESTADO_PAGO and valor not in (ESTADO_PAGO, ESTADO_PARCIAL):
		# Undoing a "Pago": drop the amount that was auto-filled with it.
		if flt(row.valor_pago) == flt(row.valor):
			row.valor_pago = 0

	row.set(campo, valor or (0 if campo in CAMPOS_NUMERICOS else None))


def _resposta_completa(doc):
	return {"plano": doc.as_dict(), "cabecalho": _cabecalho(doc), "transporte": doc.flags.transporte}


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
		"fechado_automaticamente": bool(doc.flags.fechado_automaticamente),
	}
