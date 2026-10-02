import frappe
from frappe.model.document import Document
from frappe.utils import flt


class DomainManagement(Document):
	def validate(self):
		# Split into domain + hosting (the invoice lines): the total follows.
		if self.valor_dominio or self.valor_hospedagem:
			self.valor = flt(self.valor_dominio) + flt(self.valor_hospedagem)
		# Unarchived by hand: the daily job leaves it visible from now on.
		if self.has_value_changed("arquivado") and not self.is_new():
			self.manter_visivel = int(not self.arquivado)

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
	def criar_factura(self):
		"""A draft Sales Invoice: for the renewal in progress, or for the domain itself."""
		self.check_permission("write")
		from entre_erp.dominios import facturar

		return facturar(self.name)

	@frappe.whitelist()
	def ver_password(self):
		"""The password is stored encrypted; whoever can edit the domain can read it."""
		self.check_permission("write")
		return self.get_password("password", raise_exception=False)
