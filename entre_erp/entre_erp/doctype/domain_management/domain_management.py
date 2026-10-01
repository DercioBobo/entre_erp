import frappe
from frappe.model.document import Document


class DomainManagement(Document):
	@frappe.whitelist()
	def consultar_whois(self):
		self.check_permission("write")
		from entre_erp.whois import actualizar

		return actualizar(self.name)
