"""Domain Management: renewal cycles, daily checks and settings.

Each renewal is a Domain Renewal (Pendente → Pago → Concluído, or
Pendente → Renovado → Concluído for a trusted customer renewed before paying).
The domain mirrors its current cycle in renovacao_actual/renovacao_estado and
stamps ultima_renovacao when a renewal is confirmed; the email Notifications
work from those fields.
"""

import frappe
from frappe import _
from frappe.utils import add_days, add_months, add_to_date, flt, get_url_to_form, getdate, now_datetime, today
from frappe.utils.user import get_users_with_role

PENDENTE = "Pendente"
PAGO = "Pago"
RENOVADO = "Renovado"  # renewed on trust, still to be paid
CONCLUIDO = "Concluído"
CANCELADO = "Cancelado"
# Cycles still waiting on something before the domain is renewed.
ABERTOS = (PENDENTE, PAGO)

ATIVO = "Ativo"
EXPIRADO = "Expirado"
# CANCELADO is shared with the renewal states.

MESES_POR_PERIODO = {
	"1 Mes": 1,
	"3 Meses": 3,
	"6 Meses": 6,
	"1 Ano": 12,
	"2 Anos": 24,
	"3 Anos": 36,
}

PADROES = {
	"papel_pagamento": "entretech suport",
	"papel_renovacao": "entretech suport",
	"papel_confianca": "System Manager",
	"dias_abrir_renovacao": 40,
	"dias_escalar": 3,
	"limite_consultas_hora": 30,
	"cache_minutos": 15,
	"item_dominio": "Dominio",
	"item_hospedagem": "Hospedagem de dominio",
}


def definicao(campo):
	"""A Domain Settings value, falling back to its default while never saved."""
	valor = frappe.get_cached_doc("Domain Settings").get(campo)
	return PADROES[campo] if valor is None or valor == "" or valor == 0 else valor


def exigir_papel(campo):
	papel = definicao(campo)
	roles = frappe.get_roles()
	if papel not in roles and "System Manager" not in roles:
		frappe.throw(_("Só o papel {0} pode fazer isto.").format(papel), frappe.PermissionError)


def meses(periodo):
	return MESES_POR_PERIODO.get(periodo, 12)


def renovacao_aberta(dominio):
	return frappe.db.get_value("Domain Renewal", {"dominio": dominio, "estado": ["in", ABERTOS]}, "name")


def abrir_renovacao(dominio):
	"""The domain's open renewal, created if there is none."""
	if nome := renovacao_aberta(dominio):
		return nome
	renovacao = frappe.get_doc({"doctype": "Domain Renewal", "dominio": dominio}).insert(ignore_permissions=True)
	actualizar_dominio(dominio, renovacao_actual=renovacao.name, renovacao_estado=renovacao.estado)
	return renovacao.name


def actualizar_dominio(dominio, **valores):
	"""Save the domain with new values, so its Value Change notifications run."""
	doc = frappe.get_doc("Domain Management", dominio)
	doc.update(valores)
	doc.flags.ignore_permissions = True
	doc.flags.ignore_mandatory = True
	doc.flags.ignore_links = True
	doc.save()


def comentar(dominio, texto):
	"""A line on the domain's timeline."""
	frappe.get_doc(
		{
			"doctype": "Comment",
			"comment_type": "Info",
			"reference_doctype": "Domain Management",
			"reference_name": dominio,
			"content": texto,
		}
	).insert(ignore_permissions=True)


def depois_do_whois(dominio, valores, automatico=True):
	"""What a successful registry lookup means for the domain:
	- no start date yet: the registry's creation date;
	- Expirado but valid in the registry again: Ativo;
	- a Pago renewal the registry shows done: confirmed (the customer gets the
	  "renewed" email), unless the caller is confirming it itself;
	- no renewal in progress: data_de_fim follows the registry's expiry.
	"""
	if valores.get("whois_error") or not valores.get("whois_expiry_date"):
		return
	expira = getdate(valores["whois_expiry_date"])
	d = frappe.db.get_value(
		"Domain Management", dominio, ["estado", "data_de_fim", "data_de_inicio"], as_dict=True
	)

	if not d.data_de_inicio and valores.get("whois_created_date"):
		frappe.db.set_value(
			"Domain Management", dominio, "data_de_inicio", valores["whois_created_date"], update_modified=False
		)

	if d.estado == EXPIRADO and expira >= getdate(today()):
		frappe.db.set_value("Domain Management", dominio, "estado", ATIVO, update_modified=False)
		comentar(dominio, _("Válido no registo até {0}: passou de Expirado a Ativo.").format(frappe.format(expira, "Date")))

	if not automatico:
		return
	if aberta := renovacao_aberta(dominio):
		renovacao = frappe.get_doc("Domain Renewal", aberta)
		if renovacao.estado == PAGO and expira > getdate(renovacao.expira_no_registo or renovacao.expira_em):
			renovacao.concluir(expira, automatico=True)
			comentar(dominio, _("Renovação {0} confirmada automaticamente pelo registo.").format(aberta))
	elif d.estado != CANCELADO and d.data_de_fim and getdate(d.data_de_fim) != expira:
		frappe.db.set_value("Domain Management", dominio, "data_de_fim", expira, update_modified=False)
		comentar(
			dominio,
			_("Data de renovação acertada pelo registo: {0} → {1}.").format(
				frappe.format(d.data_de_fim, "Date"), frappe.format(expira, "Date")
			),
		)


# Registry statuses (EPP; RDAP spells them with spaces) that mean the domain
# is off the air or about to be lost.
ESTADOS_PROBLEMA = {
	"clienthold": "Suspenso (clientHold)",
	"serverhold": "Suspenso pelo registo (serverHold)",
	"pendingdelete": "A ser apagado (pendingDelete)",
	"redemptionperiod": "Em período de resgate (redemptionPeriod)",
}


def problemas_no_registo(whois_status):
	estado = (whois_status or "").lower().replace(" ", "")
	return [_(rotulo) for codigo, rotulo in ESTADOS_PROBLEMA.items() if codigo in estado]


def com_problemas_no_registo():
	resultado = []
	for d in frappe.get_all(
		"Domain Management",
		filters={"estado": ["!=", CANCELADO], "whois_status": ["is", "set"]},
		fields=["name", "whois_status"],
	):
		if problemas := problemas_no_registo(d.whois_status):
			d.problemas = problemas
			resultado.append(d)
	return resultado


# ---------------------------------------------------------------------------
# Invoicing
# ---------------------------------------------------------------------------


def _valida(factura):
	"""The invoice, unless it was cancelled or deleted since."""
	if factura and frappe.db.get_value("Sales Invoice", factura, "docstatus") in (0, 1):
		return factura


def facturar(dominio):
	"""A draft Sales Invoice for a domain: for its renewal in progress if there
	is one, otherwise for the domain itself (a new domain, from its start date
	to its renewal date), without starting a renewal."""
	estado = frappe.db.get_value("Domain Management", dominio, ["renovacao_actual", "renovacao_estado"], as_dict=True)
	if renovacao := renovacao_aberta(dominio) or (
		estado.renovacao_actual if estado.renovacao_estado == RENOVADO else None
	):
		return criar_factura(renovacao)
	return criar_factura_dominio(dominio)


def criar_factura(renovacao):
	"""A draft Sales Invoice for a renewal, for the period after its expiry.
	Asking again returns the same invoice, unless it was cancelled."""
	r = frappe.get_doc("Domain Renewal", renovacao)
	if factura := _valida(r.factura):
		return factura
	if r.estado == CANCELADO:
		frappe.throw(_("Esta renovação foi cancelada."))
	d = frappe.get_doc("Domain Management", r.dominio)
	periodo = r.periodo or d.periodo
	inicio = getdate(r.expira_em) if r.expira_em else None
	fim = add_months(inicio, meses(periodo)) if inicio else None

	factura = _nova_factura(d, inicio, fim, flt(r.valor), _("Renovação {0} do domínio {1}").format(r.name, d.name))
	frappe.db.set_value("Domain Renewal", r.name, "factura", factura)
	comentar(d.name, _("Factura {0} criada (rascunho) para a renovação {1}.").format(factura, r.name))
	return factura


def criar_factura_dominio(dominio):
	d = frappe.get_doc("Domain Management", dominio)
	# A draft not dealt with yet: open that one instead of making another.
	if d.ultima_factura and frappe.db.get_value("Sales Invoice", d.ultima_factura, "docstatus") == 0:
		return d.ultima_factura
	inicio = getdate(d.data_de_inicio) if d.data_de_inicio else None
	fim = getdate(d.data_de_fim) if d.data_de_fim else None
	factura = _nova_factura(d, inicio, fim, None, _("Domínio {0}").format(d.name))
	comentar(d.name, _("Factura {0} criada (rascunho).").format(factura))
	return factura


def _nova_factura(d, inicio, fim, valor_renovacao, observacoes):
	"""One line for the domain and one for the hosting, from the domain's split
	values. Inserted with the user's own permissions and left in draft:
	submitting and the payment are done on the invoice, by hand."""
	if not d.customer:
		frappe.throw(_("O domínio {0} não tem cliente.").format(d.name))

	descricao = f"{d.nome_do_dominio or d.name} — {d.periodo or ''}"
	if inicio and fim:
		descricao += f" ({frappe.format(inicio, 'Date')} a {frappe.format(fim, 'Date')})"

	linhas = [
		(definicao("item_dominio"), flt(d.valor_dominio)),
		(definicao("item_hospedagem"), flt(d.valor_hospedagem)),
	]
	linhas = [(item, valor) for item, valor in linhas if valor]
	if not linhas:
		# Not split yet: the whole amount on the domain line, to fix on the draft.
		linhas = [(definicao("item_dominio"), valor_renovacao or flt(d.valor))]
	for item, _valor in linhas:
		if not frappe.db.exists("Item", item):
			frappe.throw(_("O item {0} não existe. Escolha os itens em Domain Settings.").format(item))

	factura = frappe.new_doc("Sales Invoice")
	factura.update(
		{
			"customer": d.customer,
			"company": frappe.defaults.get_user_default("Company")
			or frappe.db.get_single_value("Global Defaults", "default_company"),
			"posting_date": today(),
			"remarks": observacoes,
		}
	)
	for item, valor in linhas:
		factura.append("items", {"item_code": item, "qty": 1, "rate": valor, "description": descricao})
	factura.set_missing_values()
	# set_missing_values brings the item's own description and price back.
	for linha, (_item, valor) in zip(factura.items, linhas):
		linha.update({"rate": valor, "description": descricao})
	factura.insert()

	frappe.db.set_value("Domain Management", d.name, "ultima_factura", factura.name, update_modified=False)
	return factura.name


# ---------------------------------------------------------------------------
# Daily
# ---------------------------------------------------------------------------


def tarefa_diaria():
	abrir_renovacoes()
	marcar_expirados()
	enviar_alertas()


def abrir_renovacoes():
	"""Open a cycle for every active domain expiring within the configured days."""
	limite = add_days(today(), int(definicao("dias_abrir_renovacao")))
	for dominio in frappe.get_all(
		"Domain Management", filters={"estado": ATIVO, "data_de_fim": ["<=", limite]}, pluck="name"
	):
		abrir_renovacao(dominio)
		frappe.db.commit()


def marcar_expirados():
	"""Active domains past their registry expiry (or our date, before any WHOIS check)."""
	hoje = getdate(today())
	for d in frappe.get_all(
		"Domain Management", filters={"estado": ATIVO}, fields=["name", "whois_expiry_date", "data_de_fim"]
	):
		expira = d.whois_expiry_date or d.data_de_fim
		if expira and getdate(expira) < hoje:
			frappe.db.set_value("Domain Management", d.name, "estado", EXPIRADO, update_modified=False)


def renovacoes_atrasadas():
	"""Paid for longer than the configured days and still not renewed."""
	limite = add_to_date(now_datetime(), days=-int(definicao("dias_escalar")))
	return frappe.get_all(
		"Domain Renewal",
		filters={"estado": PAGO, "pago_em": ["<", limite]},
		fields=["name", "dominio", "pago_em", "expira_em"],
		order_by="pago_em asc",
	)


def renovadas_fora_do_sistema():
	"""Open cycles whose domain the registry already shows as renewed."""
	resultado = []
	for r in frappe.get_all(
		"Domain Renewal",
		filters={"estado": ["in", ABERTOS]},
		fields=["name", "dominio", "estado", "expira_no_registo"],
	):
		expira = frappe.db.get_value("Domain Management", r.dominio, "whois_expiry_date")
		if expira and r.expira_no_registo and getdate(expira) > getdate(r.expira_no_registo):
			r.whois_expiry_date = expira
			resultado.append(r)
	return resultado


def enviar_alertas():
	atrasadas = renovacoes_atrasadas()
	fora = renovadas_fora_do_sistema()
	problemas = com_problemas_no_registo()
	destinatarios = get_users_with_role(definicao("papel_renovacao"))
	if not (atrasadas or fora or problemas) or not destinatarios:
		return

	def ligacao(doctype, nome, texto):
		return f'<a href="{get_url_to_form(doctype, nome)}">{frappe.utils.escape_html(texto)}</a>'

	def seccao(titulo, linhas):
		return f"<h3>{titulo}</h3><ul>" + "".join(f"<li>{linha}</li>" for linha in linhas) + "</ul>" if linhas else ""

	mensagem = (
		seccao(
			_("Pagos há mais de {0} dias e ainda por renovar").format(definicao("dias_escalar")),
			[
				ligacao("Domain Renewal", r.name, r.dominio)
				+ ": "
				+ _("pago em {0}, expira em {1}").format(
					frappe.format(r.pago_em, "Datetime"), frappe.format(r.expira_em, "Date")
				)
				for r in atrasadas
			],
		)
		+ seccao(
			_("Já renovados no registo, mas por confirmar no ERP"),
			[
				ligacao("Domain Renewal", r.name, r.dominio)
				+ f" ({r.estado}): "
				+ _("o registo expira agora em {0}").format(frappe.format(r.whois_expiry_date, "Date"))
				for r in fora
			],
		)
		+ seccao(
			_("Com problemas no registo"),
			[ligacao("Domain Management", d.name, d.name) + ": " + ", ".join(d.problemas) for d in problemas],
		)
	)
	frappe.sendmail(
		recipients=destinatarios,
		subject=_("Domínios: {0} por tratar").format(len(atrasadas) + len(fora) + len(problemas)),
		message=mensagem,
	)
