"""Standard Bank payroll file: one line per submitted Salary Slip of the
month, in the layout the bank's upload takes (comma separated, no quotes).

The bank rejects long references — "Salario Agosto" (14 characters) went
through, "Salario Setembro" (16) was refused — so the reference is short
by default, editable in the filters and never longer than LIMITE_REFERENCIA.
"""

import csv
import io
import unicodedata

import frappe
from frappe import _
from frappe.utils import cint, flt, getdate

LIMITE_REFERENCIA = 14
MESES_CURTOS = ["Jan", "Fev", "Mar", "Abr", "Mai", "Jun", "Jul", "Ago", "Set", "Out", "Nov", "Dez"]

# The bank file's columns, in order (also its header row).
COLUNAS = [
	("SEQ_NO", _("Nº"), "Int", 60),
	("VALUE_DATE", _("Data Valor"), "Data", 100),
	("REFERENCE", _("Referência"), "Data", 140),
	("DESTINATION_NAME", _("Nome"), "Data", 240),
	("DESTINATION_SORT_CODE", _("Sort Code"), "Data", 90),
	("DESTINATION_ACCOUNT_NUMBER", _("NIB / Conta"), "Data", 200),
	("AMOUNT", _("Valor"), "Float", 120),
	("CURRENCY", _("Moeda"), "Data", 70),
	("DESTINATION_EMAIL", _("Email"), "Data", 160),
]


def execute(filters=None):
	filters = frappe._dict(filters or {})
	linhas = obter_linhas(filters)
	columns = [
		{"fieldname": campo, "label": label, "fieldtype": tipo, "width": largura, **({"precision": 2} if tipo == "Float" else {})}
		for campo, label, tipo, largura in COLUNAS
	]
	return columns, linhas, None, None, _resumo(linhas)


def referencia_padrao(mes):
	return f"Salario {MESES_CURTOS[cint(mes) - 1]}"


def obter_linhas(filters):
	mes, ano = cint(filters.month), cint(filters.year)
	if not (1 <= mes <= 12 and ano):
		frappe.throw(_("Escolha o Mês e o Ano."))
	referencia = _limpar(filters.reference or referencia_padrao(mes), ascii=True)
	if len(referencia) > LIMITE_REFERENCIA:
		frappe.throw(
			_("A referência {0} tem {1} caracteres — o banco aceita no máximo {2}.").format(
				frappe.bold(referencia), len(referencia), LIMITE_REFERENCIA
			)
		)

	conta = "coalesce(nullif(e.nib, ''), e.bank_ac_no)" if frappe.get_meta("Employee").has_field("nib") else "e.bank_ac_no"
	condicoes = ["ss.docstatus = 1", "month(ss.start_date) = %(mes)s", "year(ss.start_date) = %(ano)s"]
	if filters.company:
		condicoes.append("ss.company = %(company)s")
	recibos = frappe.db.sql(
		f"""
		select ss.name, ss.employee, ss.employee_name, ss.posting_date, ss.net_pay, ss.currency,
			{conta} as conta
		from `tabSalary Slip` ss
		join `tabEmployee` e on e.name = ss.employee
		where {" and ".join(condicoes)}
		order by ss.employee_name asc
		""",
		{"mes": mes, "ano": ano, "company": filters.company},
		as_dict=True,
	)

	linhas = []
	for r in recibos:
		if flt(r.net_pay) <= 0:
			continue
		linhas.append(
			{
				"SEQ_NO": len(linhas) + 1,
				"VALUE_DATE": getdate(filters.value_date or r.posting_date).strftime("%d-%m-%Y"),
				"REFERENCE": referencia,
				"DESTINATION_NAME": _limpar(r.employee_name),
				"DESTINATION_SORT_CODE": "",
				"DESTINATION_ACCOUNT_NUMBER": "".join(ch for ch in (r.conta or "") if ch.isalnum()),
				"AMOUNT": flt(r.net_pay, 2),
				"CURRENCY": r.currency,
				"DESTINATION_EMAIL": "",
				"employee": r.employee,
			}
		)
	return linhas


def _limpar(texto, ascii=False):
	"""No commas, quotes or line breaks: the file has no quoting, so any of
	them would shift the columns. The reference also loses its accents."""
	texto = " ".join(str(texto or "").replace(",", " ").replace('"', "").replace(";", " ").split())
	if ascii:
		texto = unicodedata.normalize("NFKD", texto).encode("ascii", "ignore").decode()
	return texto


def _resumo(linhas):
	sem_conta = sum(1 for l in linhas if not l["DESTINATION_ACCOUNT_NUMBER"])
	return [
		{"label": _("Funcionários"), "value": len(linhas), "datatype": "Int"},
		{"label": _("Total a transferir"), "value": sum(l["AMOUNT"] for l in linhas), "datatype": "Float", "indicator": "Blue"},
		{
			"label": _("Sem NIB"),
			"value": sem_conta,
			"datatype": "Int",
			"indicator": "Red" if sem_conta else "Green",
		},
	]


@frappe.whitelist()
def descarregar(filters):
	"""The file for the bank: header row + one line per employee, comma
	separated, no quoting."""
	frappe.has_permission("Salary Slip", "read", throw=True)
	filters = frappe._dict(frappe.parse_json(filters))
	linhas = obter_linhas(filters)
	if not linhas:
		frappe.throw(_("Sem recibos de vencimento submetidos para este mês."))
	sem_conta = [l["DESTINATION_NAME"] for l in linhas if not l["DESTINATION_ACCOUNT_NUMBER"]]
	if sem_conta:
		frappe.throw(_("Sem NIB: {0}. Preencha-o no Funcionário antes de gerar o ficheiro.").format(", ".join(sem_conta)))

	saida = io.StringIO()
	escritor = csv.writer(saida, delimiter=",", quoting=csv.QUOTE_NONE, escapechar="\\", lineterminator="\r\n")
	campos = [c[0] for c in COLUNAS]
	if cint(filters.get("header", 1)):
		escritor.writerow(campos)
	for l in linhas:
		escritor.writerow([f"{l[c]:.2f}" if c == "AMOUNT" else l[c] for c in campos])

	mes, ano = cint(filters.month), cint(filters.year)
	frappe.response["filename"] = f"folha_stdb_{ano}_{mes:02d}.csv"
	frappe.response["filecontent"] = saida.getvalue().encode("utf-8")
	frappe.response["type"] = "download"
