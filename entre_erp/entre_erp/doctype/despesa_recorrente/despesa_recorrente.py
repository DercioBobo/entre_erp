import frappe
from frappe.model.document import Document


class DespesaRecorrente(Document):
	def on_update(self):
		# Newly filled from payroll: open months pick up the payroll amount now.
		from entre_erp.folha import FONTES_DA_FOLHA, sincronizar_planos_abertos

		if self.fonte in FONTES_DA_FOLHA and self.has_value_changed("fonte"):
			sincronizar_planos_abertos()
