import frappe
from frappe.model.document import Document


class DomainManagement(Document):
	@frappe.whitelist()
	def consultar_whois(self):
		self.check_permission("write")
		from entre_erp.whois import actualizar

		return actualizar(self.name)

	@frappe.whitelist()
	def abrir_renovacao(self):
		self.check_permission("write")
		from entre_erp.dominios import abrir_renovacao

		return abrir_renovacao(self.name)

	@frappe.whitelist()
	def ver_password(self):
		"""The password is stored encrypted; whoever can edit the domain can read it."""
		self.check_permission("write")
		return self.get_password("password", raise_exception=False)
