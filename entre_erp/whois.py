"""WHOIS lookups for Domain Management.

.mz domains are looked up on the registry's WHOIS server (it has no RDAP);
.com and .net through Verisign's RDAP. Results go into the whois_* fields,
written straight to the database: no save, so "Modified" is left alone and
no notification fires. Changes since the previous check are recorded on the
domain's timeline; what they mean for the domain (dates, estado, a paid
renewal now done) is dominios.depois_do_whois.

Gentle on the registries (the .mz terms forbid high-volume automated
queries): every query, from any user or job, goes through one gate with an
hourly allowance and a minimum gap, and answers are cached per domain.
"""

import json
import socket
import time

import frappe
import requests
from frappe import _
from frappe.utils import add_days, add_to_date, escape_html, get_datetime, getdate, now_datetime, today

WHOIS_MZ = "whois.nic.mz"
RDAP = {
	"com": "https://rdap.verisign.com/com/v1/domain/",
	"net": "https://rdap.verisign.com/net/v1/domain/",
}
TIMEOUT = 15
# Minimum gap between two registry queries, across all users and jobs.
PAUSA_ENTRE_CONSULTAS = 3
# The weekly job checks these every week; the others about once a month.
DIAS_PERTO_DE_EXPIRAR = 60
DIAS_ENTRE_CONSULTAS_NORMAIS = 30

# Registry fields whose changes are written on the domain's timeline.
SEGUIDOS = {
	"whois_expiry_date": "Expiração no registo",
	"whois_registrar": "Registrar",
	"whois_status": "Estado no registo",
	"whois_nameservers": "Name servers",
}


class DominioNaoEncontrado(frappe.ValidationError):
	pass


class LimiteDeConsultas(frappe.ValidationError):
	pass


def consultar(dominio, usar_cache=True):
	"""The registry's data for a domain, as Domain Management whois_* values
	(whois_last_checked: when the registry was actually asked). A recent answer
	comes from the cache. Raises DominioNaoEncontrado when the registry doesn't
	have the domain, LimiteDeConsultas when the hourly allowance is used up."""
	from entre_erp.dominios import definicao

	dominio = (dominio or "").strip().lower()
	chave = f"entre_erp:whois:{dominio}"
	if usar_cache and (guardado := frappe.cache.get_value(chave)):
		if guardado.get("nao_encontrado"):
			frappe.throw(_("Domínio não encontrado no registo"), DominioNaoEncontrado)
		return dict(guardado)

	_aguardar_vez()
	validade = int(definicao("cache_minutos")) * 60
	try:
		valores = _perguntar_ao_registo(dominio)
	except DominioNaoEncontrado:
		frappe.cache.set_value(chave, {"nao_encontrado": True}, expires_in_sec=validade)
		raise
	valores["whois_last_checked"] = now_datetime()
	frappe.cache.set_value(chave, valores, expires_in_sec=validade)
	return dict(valores)


def _aguardar_vez():
	"""One allowance per clock hour for all registry queries, and a minimum gap."""
	from entre_erp.dominios import definicao

	limite = int(definicao("limite_consultas_hora"))
	chave_hora = frappe.cache.make_key(f"entre_erp:whois:hora:{now_datetime():%Y%m%d%H}")
	if frappe.cache.incr(chave_hora) > limite:
		frappe.throw(
			_("Atingido o limite de {0} consultas ao registo nesta hora. Tente mais tarde.").format(limite),
			LimiteDeConsultas,
		)
	frappe.cache.expire(chave_hora, 3600)

	chave_ultima = frappe.cache.make_key("entre_erp:whois:ultima")
	espera = PAUSA_ENTRE_CONSULTAS - (time.time() - float(frappe.cache.get(chave_ultima) or 0))
	if espera > 0:
		time.sleep(espera)
	frappe.cache.set(chave_ultima, time.time())


def _perguntar_ao_registo(dominio):
	tld = dominio.rsplit(".", 1)[-1]
	if tld == "mz":
		return _de_whois(_whois(WHOIS_MZ, dominio))
	if tld in RDAP:
		return _de_rdap(RDAP[tld] + dominio)
	frappe.throw(_("Sem servidor WHOIS configurado para domínios .{0}").format(tld))


def actualizar(nome, automatico=True, usar_cache=True):
	"""Look a Domain Management up and store the result. A failed lookup keeps
	the last good data and records the error instead; running out of the
	hourly allowance is not a lookup failure and is raised. automatico=False
	when the caller is itself confirming the renewal."""
	anteriores = frappe.db.get_value(
		"Domain Management", nome, ["nome_do_dominio", "whois_last_checked", *SEGUIDOS], as_dict=True
	)
	try:
		valores = consultar(anteriores.nome_do_dominio or nome, usar_cache=usar_cache)
		valores["whois_error"] = None
	except LimiteDeConsultas:
		raise
	except Exception as e:
		frappe.clear_messages()  # stored in whois_error instead of popping up
		valores = {"whois_error": str(e)[:500] or e.__class__.__name__, "whois_last_checked": now_datetime()}
	frappe.db.set_value("Domain Management", nome, valores, update_modified=False)

	from entre_erp.dominios import comentar, depois_do_whois

	if anteriores.whois_last_checked and not valores["whois_error"]:
		if alteracoes := _alteracoes(anteriores, valores):
			comentar(nome, _("WHOIS: {0}").format("; ".join(alteracoes)))
	depois_do_whois(nome, valores, automatico)
	return valores


def actualizar_todos():
	"""Weekly: the domains that need it, oldest check first. One domain failing
	doesn't stop the others; the hourly allowance running out does, and the
	next run starts with whatever was left."""
	for nome in a_consultar():
		try:
			actualizar(nome)
			frappe.db.commit()
		except LimiteDeConsultas:
			frappe.clear_messages()
			break
		except Exception:
			frappe.db.rollback()
			frappe.log_error(title=f"WHOIS: {nome}")


def a_consultar():
	"""Domains close to expiring, with a renewal in progress, expired, never
	checked, or not checked for a month."""
	from entre_erp.dominios import CANCELADO, EXPIRADO, PAGO, PENDENTE

	perto = getdate(add_days(today(), DIAS_PERTO_DE_EXPIRAR))
	antigo = add_to_date(now_datetime(), days=-DIAS_ENTRE_CONSULTAS_NORMAIS)
	for d in frappe.get_all(
		"Domain Management",
		fields=["name", "estado", "data_de_fim", "whois_expiry_date", "whois_last_checked", "renovacao_estado"],
		order_by="whois_last_checked asc",
	):
		expira = d.whois_expiry_date or d.data_de_fim
		if (
			not d.whois_last_checked
			or get_datetime(d.whois_last_checked) < antigo
			or (
				d.estado != CANCELADO
				and (
					d.estado == EXPIRADO
					or d.renovacao_estado in (PENDENTE, PAGO)
					or (expira and getdate(expira) <= perto)
				)
			)
		):
			yield d.name


def _alteracoes(anteriores, valores):
	def normal(campo, valor):
		if not valor:
			return None
		if campo == "whois_expiry_date":
			return getdate(valor)
		if campo == "whois_nameservers":
			return tuple(sorted(valor.split()))
		return valor.strip()

	alteracoes = []
	for campo, rotulo in SEGUIDOS.items():
		antes, depois = normal(campo, anteriores.get(campo)), normal(campo, valores.get(campo))
		if antes != depois:
			mostrar = lambda v: ", ".join(v) if isinstance(v, tuple) else str(v or "—")  # noqa: E731
			alteracoes.append(escape_html(f"{_(rotulo)}: {mostrar(antes)} → {mostrar(depois)}"))
	return alteracoes


def _whois(servidor, dominio):
	with socket.create_connection((servidor, 43), timeout=TIMEOUT) as ligacao:
		ligacao.sendall(f"{dominio}\r\n".encode())
		partes = []
		while dados := ligacao.recv(4096):
			partes.append(dados)
	return b"".join(partes).decode("utf-8", "replace")


def _de_whois(texto):
	campos, servidores, estados = {}, [], []
	for linha in texto.splitlines():
		chave, separador, valor = linha.partition(":")
		chave, valor = chave.strip().lower(), valor.strip()
		if not separador or not valor:
			continue
		if chave == "name server":
			servidores.append(valor.lower())
		elif chave == "domain status":
			estados.append(valor.split()[0])
		else:
			campos.setdefault(chave, valor)

	# A missing domain still answers with a "Domain Name:" line.
	if "registry expiry date" not in campos:
		frappe.throw(_("Domínio não encontrado no registo .mz"), DominioNaoEncontrado)

	return {
		"whois_expiry_date": _data(campos.get("registry expiry date")),
		"whois_created_date": _data(campos.get("creation date")),
		"whois_updated_date": _data(campos.get("updated date")),
		"whois_registrar": campos.get("registrar"),
		"whois_status": ", ".join(estados),
		"whois_nameservers": "\n".join(servidores),
		"whois_raw": texto,
	}


def _de_rdap(url):
	resposta = requests.get(url, timeout=TIMEOUT, headers={"Accept": "application/rdap+json"})
	if resposta.status_code == 404:
		frappe.throw(_("Domínio não encontrado no registo"), DominioNaoEncontrado)
	resposta.raise_for_status()
	dados = resposta.json()

	eventos = {e.get("eventAction"): e.get("eventDate") for e in dados.get("events", [])}
	return {
		"whois_expiry_date": _data(eventos.get("expiration")),
		"whois_created_date": _data(eventos.get("registration")),
		"whois_updated_date": _data(eventos.get("last changed")),
		"whois_registrar": _registrar(dados),
		"whois_status": ", ".join(dados.get("status", [])),
		"whois_nameservers": "\n".join(ns.get("ldhName", "").lower() for ns in dados.get("nameservers", [])),
		"whois_raw": json.dumps(dados, indent=1, ensure_ascii=False),
	}


def _registrar(dados):
	for entidade in dados.get("entities", []):
		if "registrar" in entidade.get("roles", []):
			for item in (entidade.get("vcardArray") or [None, []])[1]:
				if item[0] == "fn":
					return item[3]


def _data(valor):
	"""Registry timestamps are ISO 8601 ("2026-11-29T13:35:05Z"); the day is enough."""
	return getdate(valor[:10]) if valor else None
