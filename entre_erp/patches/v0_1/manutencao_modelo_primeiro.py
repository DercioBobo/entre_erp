"""Manutencao Programada links to Modelo de Manutencao (and its recipients
table), so these must exist before the model sync creates it."""

import frappe


def execute():
	frappe.reload_doc("entre_erp", "doctype", "destinatario_de_manutencao")
	frappe.reload_doc("entre_erp", "doctype", "modelo_de_manutencao")
