import frappe
from frappe import _
from frappe.model.document import Document


class DespesaRecorrente(Document):
	def validate(self):
		if self.dia_vencimento and not (1 <= self.dia_vencimento <= 31):
			frappe.throw(_("O Dia de Vencimento deve estar entre 1 e 31."))
