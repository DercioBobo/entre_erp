"""Domain Management: renewal cycles, daily checks and settings.

Each renewal is a Domain Renewal (Pendente → Pago → Concluído, or
Pendente → Renovado → Concluído for a trusted customer renewed before paying).
The domain mirrors its current cycle in renovacao_actual/renovacao_estado and
stamps ultima_renovacao when a renewal is confirmed; the email Notifications
work from those fields.
"""

import frappe
from frappe import _
from frappe.utils import add_days, add_to_date, get_url_to_form, getdate, now_datetime, today
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


def depois_do_whois(dominio, valores):
	"""A domain marked Expirado that the registry shows as valid again was renewed."""
	expira = valores.get("whois_expiry_date")
	if expira and getdate(expira) >= getdate(today()):
		if frappe.db.get_value("Domain Management", dominio, "estado") == EXPIRADO:
			frappe.db.set_value("Domain Management", dominio, "estado", ATIVO, update_modified=False)


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
	destinatarios = get_users_with_role(definicao("papel_renovacao"))
	if not (atrasadas or fora) or not destinatarios:
		return

	def ligacao(r):
		return f'<a href="{get_url_to_form("Domain Renewal", r.name)}">{frappe.utils.escape_html(r.dominio)}</a>'

	partes = []
	if atrasadas:
		partes.append(
			"<h3>"
			+ _("Pagos há mais de {0} dias e ainda por renovar").format(definicao("dias_escalar"))
			+ "</h3><ul>"
			+ "".join(
				f"<li>{ligacao(r)}: "
				+ _("pago em {0}, expira em {1}").format(
					frappe.format(r.pago_em, "Datetime"), frappe.format(r.expira_em, "Date")
				)
				+ "</li>"
				for r in atrasadas
			)
			+ "</ul>"
		)
	if fora:
		partes.append(
			"<h3>"
			+ _("Já renovados no registo, mas por confirmar no ERP")
			+ "</h3><ul>"
			+ "".join(
				f"<li>{ligacao(r)} ({r.estado}): "
				+ _("o registo expira agora em {0}").format(frappe.format(r.whois_expiry_date, "Date"))
				+ "</li>"
				for r in fora
			)
			+ "</ul>"
		)

	frappe.sendmail(
		recipients=destinatarios,
		subject=_("Domínios: {0} renovações por tratar").format(len(atrasadas) + len(fora)),
		message="".join(partes),
	)
