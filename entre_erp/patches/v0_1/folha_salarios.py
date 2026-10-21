import frappe

from entre_erp.folha import FONTE_SALARIOS, sincronizar_planos_abertos
from entre_erp.pagamentos import normalizar


def execute():
	"""The "Salários" recurring expense now takes its amount from payroll;
	open months pick up the net pay of the payroll already submitted."""
	frappe.reload_doc("entre_erp", "doctype", "despesa_recorrente")
	salarios = [
		d.name
		for d in frappe.get_all("Despesa Recorrente", fields=["name", "fonte"])
		if normalizar(d.name) == "salarios" and (d.fonte or "Manual") == "Manual"
	]
	if not salarios:
		return
	for nome in salarios:
		frappe.db.set_value("Despesa Recorrente", nome, "fonte", FONTE_SALARIOS, update_modified=False)
	sincronizar_planos_abertos()
