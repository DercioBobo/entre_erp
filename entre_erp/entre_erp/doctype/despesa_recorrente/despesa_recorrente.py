import frappe
from frappe.model.document import Document


class DespesaRecorrente(Document):
	def on_update(self):
		# Source or employee list changed: open months pick up the payroll amounts now.
		# Also when it stops being a payroll expense, as "the rest" changes for the others.
		from entre_erp.folha import FONTES_DA_FOLHA, sincronizar_planos_abertos
		from entre_erp.pagamentos import avisar_alteracao

		avisar_alteracao("recorrentes")
		antes = self.get_doc_before_save()
		if self.fonte in FONTES_DA_FOLHA or (antes and antes.fonte in FONTES_DA_FOLHA):
			sincronizar_planos_abertos()

	def on_trash(self):
		from entre_erp.pagamentos import avisar_alteracao

		avisar_alteracao("recorrentes")
