"""Domain Management's logic now lives in the app: remove what was built in
the UI before it (the Client Script that moved the date when the status
changed, two Server Scripts that did nothing, an inactive Workflow and its
field) and the columns of fields deleted long ago, when they hold no data."""

import frappe

DOCTYPE = "Domain Management"
COLUNAS_ORFAS = ("preço", "data_8")


def execute():
	frappe.delete_doc_if_exists("Client Script", "Domain Management-Form")
	for nome in ("Dominio erp", "Domain Script"):
		frappe.delete_doc_if_exists("Server Script", nome)
	frappe.delete_doc_if_exists("Workflow", "Estados do dominio")
	frappe.delete_doc_if_exists("Custom Field", "Domain Management-estado_do_dominio")

	for coluna in COLUNAS_ORFAS:
		if coluna in frappe.get_meta(DOCTYPE).get_valid_columns() or not frappe.db.has_column(DOCTYPE, coluna):
			continue
		if any(frappe.db.sql(f"select `{coluna}` from `tab{DOCTYPE}`", pluck=True)):
			print(f"Domain Management: a coluna {coluna} tem dados, fica.")
			continue
		frappe.db.sql_ddl(f"alter table `tab{DOCTYPE}` drop column `{coluna}`")
