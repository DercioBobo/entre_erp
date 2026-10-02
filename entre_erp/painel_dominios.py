"""Data for the Domínios page (page/dominios): the whole portfolio at a glance,
one domain in detail, and a registry lookup for any domain, managed or not."""

import re

import frappe
from frappe import _
from frappe.rate_limiter import rate_limit
from frappe.utils import add_to_date, get_datetime, getdate, now_datetime, today

from entre_erp.dominios import (
	ABERTOS,
	CANCELADO,
	PAGO,
	RENOVADO,
	definicao,
	meses,
	problemas_no_registo,
)

CAMPOS = [
	"name",
	"nome_do_dominio",
	"customer",
	"email",
	"telemovel",
	"nots",
	"estado",
	"arquivado",
	"pacote",
	"periodo",
	"valor",
	"data_de_inicio",
	"data_de_fim",
	"renovacao_actual",
	"renovacao_estado",
	"ultima_renovacao",
	"whois_expiry_date",
	"whois_created_date",
	"whois_registrar",
	"whois_status",
	"whois_nameservers",
	"whois_last_checked",
	"whois_error",
	"ultima_factura",
]

# A domain as people type it: no scheme, no "www.", no path.
FORMATO_DOMINIO = re.compile(r"^(?=.{4,253}$)([a-z0-9]([a-z0-9-]{0,61}[a-z0-9])?\.)+[a-z]{2,63}$")


def _exigir_leitura():
	if not frappe.has_permission("Domain Management", "read"):
		frappe.throw(_("Sem permissão para ver domínios."), frappe.PermissionError)


@frappe.whitelist()
def obter_dominios():
	_exigir_leitura()
	hoje = getdate(today())
	limite_pago = add_to_date(now_datetime(), days=-int(definicao("dias_escalar")))
	renovacoes = {
		r.name: r
		for r in frappe.get_all(
			"Domain Renewal",
			filters={"estado": ["in", (*ABERTOS, RENOVADO)]},
			fields=["name", "estado", "pago_em", "expira_no_registo", "factura"],
		)
	}

	dominios = frappe.get_all("Domain Management", fields=CAMPOS, order_by="data_de_fim asc", limit_page_length=0)
	for d in dominios:
		expira = d.whois_expiry_date or d.data_de_fim
		d.expira = expira
		d.dias = (getdate(expira) - hoje).days if expira else None
		d.dias_periodo = meses(d.periodo) * 30
		renovacao = renovacoes.get(d.renovacao_actual)
		d.factura = renovacao.factura if renovacao else None
		d.alertas = _alertas(d, renovacao, limite_pago)

	return {
		"dominios": dominios,
		"dias_abrir_renovacao": int(definicao("dias_abrir_renovacao")),
		"pode_criar": frappe.has_permission("Domain Management", "create"),
		"pode_apagar": frappe.has_permission("Domain Management", "delete"),
		"pode_facturar": frappe.has_permission("Sales Invoice", "create"),
		"registo": _estado_do_registo(),
		"pode_configurar": frappe.has_permission("Domain Settings", "write"),
	}


def _estado_do_registo():
	from entre_erp.whois import estado_do_registo

	return estado_do_registo()


def _alertas(d, renovacao, limite_pago):
	"""What needs someone's attention on this domain, most serious first."""
	alertas = []
	if d.estado == CANCELADO or d.arquivado:
		return alertas
	for problema in problemas_no_registo(d.whois_status):
		alertas.append({"nivel": "erro", "texto": problema})
	if d.dias is not None and d.dias < 0:
		alertas.append({"nivel": "erro", "texto": _("Expirou há {0} dias").format(-d.dias)})
	if renovacao and renovacao.estado == PAGO and renovacao.pago_em and get_datetime(renovacao.pago_em) < limite_pago:
		alertas.append({"nivel": "aviso", "texto": _("Pago e ainda por renovar")})
	if (
		renovacao
		and renovacao.estado in ABERTOS
		and d.whois_expiry_date
		and renovacao.expira_no_registo
		and getdate(d.whois_expiry_date) > getdate(renovacao.expira_no_registo)
	):
		alertas.append({"nivel": "aviso", "texto": _("Renovado no registo, por confirmar no ERP")})
	if renovacao and renovacao.estado == RENOVADO:
		alertas.append({"nivel": "aviso", "texto": _("Renovado antes do pagamento")})
	if d.whois_error:
		alertas.append({"nivel": "aviso", "texto": _("A última consulta ao registo falhou")})
	if not d.whois_last_checked:
		alertas.append({"nivel": "info", "texto": _("Nunca consultado no registo")})
	return alertas


@frappe.whitelist()
def obter_detalhe(nome):
	_exigir_leitura()
	frappe.has_permission("Domain Management", "read", nome, throw=True)
	return {
		"renovacoes": frappe.get_all(
			"Domain Renewal",
			filters={"dominio": nome},
			fields=[
				"name",
				"estado",
				"expira_em",
				"nova_expiracao",
				"valor_pago",
				"data_pagamento",
				"renovado_em",
				"confirmado_automaticamente",
				"sem_pagamento",
				"factura",
			],
			order_by="creation desc",
			limit_page_length=10,
		),
		"historico": frappe.get_all(
			"Comment",
			filters={"reference_doctype": "Domain Management", "reference_name": nome, "comment_type": "Info"},
			fields=["content", "creation"],
			order_by="creation desc",
			limit_page_length=15,
		),
		"whois_raw": frappe.db.get_value("Domain Management", nome, "whois_raw"),
	}


@frappe.whitelist()
def consultar_agora(nome):
	"""The page's "Consultar agora": same as the form's button."""
	frappe.get_doc("Domain Management", nome).check_permission("write")
	from entre_erp.whois import actualizar

	actualizar(nome)
	return frappe.db.get_value("Domain Management", nome, CAMPOS, as_dict=True)


@frappe.whitelist(methods=["POST"])
def apagar_dominio(nome):
	"""Delete a domain together with its renewals. Deleting renewals (payment
	history) needs that permission too; otherwise mark the domain Cancelado."""
	frappe.has_permission("Domain Management", "delete", nome, throw=True)
	renovacoes = frappe.get_all("Domain Renewal", filters={"dominio": nome}, pluck="name")
	if renovacoes and not frappe.has_permission("Domain Renewal", "delete"):
		frappe.throw(
			_("Este domínio tem {0} renovações registadas e não tem permissão para as apagar. Marque-o como Cancelado.").format(
				len(renovacoes)
			),
			frappe.PermissionError,
		)
	# The domain points at its current renewal and every renewal at the domain.
	frappe.db.set_value("Domain Management", nome, "renovacao_actual", None, update_modified=False)
	for renovacao in renovacoes:
		frappe.delete_doc("Domain Renewal", renovacao, ignore_permissions=True)
	frappe.delete_doc("Domain Management", nome)


@frappe.whitelist(methods=["POST"])
def criar_factura(nome):
	frappe.get_doc("Domain Management", nome).check_permission("write")
	from entre_erp.dominios import facturar

	return facturar(nome)


@frappe.whitelist(methods=["POST"])
def arquivar(nome, arquivado):
	doc = frappe.get_doc("Domain Management", nome)
	doc.check_permission("write")
	doc.arquivado = int(arquivado)
	doc.flags.ignore_mandatory = True
	doc.save()


@frappe.whitelist()
def abrir_renovacao(nome):
	frappe.get_doc("Domain Management", nome).check_permission("write")
	from entre_erp.dominios import abrir_renovacao

	return abrir_renovacao(nome)


def normalizar_dominio(texto):
	texto = (texto or "").strip().lower()
	texto = re.sub(r"^[a-z]+://", "", texto)
	texto = texto.split("/", 1)[0].split("?", 1)[0].split(":", 1)[0]
	return texto.removeprefix("www.").strip(".")


@frappe.whitelist()
@rate_limit(limit=30, seconds=60 * 60)
def consultar_dominio(dominio):
	"""Any domain in the registry, managed or not. Read-only: nothing is saved.
	Rate-limited, because the .mz registry forbids high-volume queries."""
	_exigir_leitura()
	from entre_erp.whois import DominioNaoEncontrado, consultar

	dominio = normalizar_dominio(dominio)
	if not FORMATO_DOMINIO.match(dominio):
		return {"dominio": dominio, "erro": _("Isto não parece um domínio (ex: exemplo.co.mz).")}

	gerido = frappe.db.get_value("Domain Management", {"nome_do_dominio": dominio}) or frappe.db.exists(
		"Domain Management", dominio
	)
	try:
		registo = consultar(dominio)
	except DominioNaoEncontrado:
		frappe.clear_messages()
		return {"dominio": dominio, "gerido": gerido, "registado": False, "registo": _estado_do_registo()}
	except Exception as e:
		frappe.clear_messages()
		return {"dominio": dominio, "gerido": gerido, "erro": str(e)[:300], "registo": _estado_do_registo()}
	return {"dominio": dominio, "gerido": gerido, "registado": True, **registo, "registo": _estado_do_registo()}
