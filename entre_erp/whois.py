"""WHOIS lookups for Domain Management.

.mz domains are looked up on the registry's WHOIS server (it has no RDAP);
.com and .net through Verisign's RDAP. Results only ever go into the whois_*
fields, written straight to the database: no save, so the domain's
notifications, client/server scripts and "Modified" are left alone.
"""

import json
import socket
import time

import frappe
import requests
from frappe import _
from frappe.utils import getdate, now_datetime

WHOIS_MZ = "whois.nic.mz"
RDAP = {
	"com": "https://rdap.verisign.com/com/v1/domain/",
	"net": "https://rdap.verisign.com/net/v1/domain/",
}
TIMEOUT = 15
# The .mz registry's terms forbid high-volume automated queries.
PAUSA_ENTRE_CONSULTAS = 3


def consultar(dominio):
	"""The registry's data for a domain, as Domain Management whois_* values."""
	dominio = (dominio or "").strip().lower()
	tld = dominio.rsplit(".", 1)[-1]
	if tld == "mz":
		return _de_whois(_whois(WHOIS_MZ, dominio))
	if tld in RDAP:
		return _de_rdap(RDAP[tld] + dominio)
	frappe.throw(_("Sem servidor WHOIS configurado para domínios .{0}").format(tld))


def actualizar(nome):
	"""Look a Domain Management up and store the result. A failed lookup keeps
	the last good data and records the error instead."""
	dominio = frappe.db.get_value("Domain Management", nome, "nome_do_dominio") or nome
	try:
		valores = consultar(dominio)
		valores["whois_error"] = None
	except Exception as e:
		valores = {"whois_error": str(e)[:500] or e.__class__.__name__}
	valores["whois_last_checked"] = now_datetime()
	frappe.db.set_value("Domain Management", nome, valores, update_modified=False)

	from entre_erp.dominios import depois_do_whois

	depois_do_whois(nome, valores)
	return valores


def actualizar_todos():
	"""Weekly: refresh every domain, oldest check first, one query at a time."""
	nomes = frappe.get_all("Domain Management", pluck="name", order_by="whois_last_checked asc")
	for i, nome in enumerate(nomes):
		if i:
			time.sleep(PAUSA_ENTRE_CONSULTAS)
		actualizar(nome)
		frappe.db.commit()


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
		frappe.throw(_("Domínio não encontrado no registo .mz"))

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
		frappe.throw(_("Domínio não encontrado no registo"))
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
