"""The two Items a domain invoice is made of, created if missing (an existing
Item with the same code or name is used instead), and chosen in Domain Settings."""

import frappe

ITENS = {
	"item_dominio": "Dominio",
	"item_hospedagem": "Hospedagem de dominio",
}


def execute():
	if not frappe.db.table_exists("Item"):
		return
	frappe.reload_doc("entre_erp", "doctype", "domain_settings")
	for campo, nome in ITENS.items():
		if frappe.db.get_single_value("Domain Settings", campo):
			continue
		item = frappe.db.exists("Item", nome) or frappe.db.get_value("Item", {"item_name": nome}) or _criar(nome)
		frappe.db.set_single_value("Domain Settings", campo, item)


def _criar(nome):
	return (
		frappe.get_doc(
			{
				"doctype": "Item",
				"item_code": nome,
				"item_name": nome,
				"description": nome,
				"item_group": _grupo(),
				"stock_uom": frappe.db.get_single_value("Stock Settings", "stock_uom") or _unidade(),
				"is_stock_item": 0,
				"include_item_in_manufacturing": 0,
				"is_sales_item": 1,
				"is_purchase_item": 0,
			}
		)
		.insert(ignore_permissions=True)
		.name
	)


def _grupo():
	return (
		frappe.db.get_single_value("Stock Settings", "item_group")
		or frappe.db.exists("Item Group", "Services")
		or frappe.db.get_value("Item Group", {"is_group": 0})
		or "All Item Groups"
	)


def _unidade():
	return frappe.db.exists("UOM", "Unit") or frappe.db.exists("UOM", "Nos") or frappe.db.get_value("UOM", {})
