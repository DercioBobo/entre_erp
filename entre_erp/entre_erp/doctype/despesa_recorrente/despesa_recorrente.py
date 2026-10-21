import frappe
from frappe.model.document import Document


class DespesaRecorrente(Document):
	def on_update(self):
		# Source or employee list changed: open months pick up the payroll amounts now.
		# Also when it stops being a payroll expense, as "the rest" changes for the others.
		from entre_erp.folha import FONTES_DA_FOLHA, sincronizar_planos_abertos

		antes = self.get_doc_before_save()
		if self.fonte in FONTES_DA_FOLHA or (antes and antes.fonte in FONTES_DA_FOLHA):
			sincronizar_planos_abertos()
