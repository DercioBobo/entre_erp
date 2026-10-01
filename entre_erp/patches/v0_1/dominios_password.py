"""Domain Management's password became a Password field: move the plain-text
values into Frappe's encrypted store, leaving the usual asterisks behind."""

import frappe
from frappe.utils.password import set_encrypted_password


def execute():
	for nome, password in frappe.db.sql(
		"select name, password from `tabDomain Management` where ifnull(password, '') != ''"
	):
		if set(password) == {"*"}:
			continue
		set_encrypted_password("Domain Management", nome, password, "password")
		frappe.db.set_value("Domain Management", nome, "password", "*" * len(password), update_modified=False)
