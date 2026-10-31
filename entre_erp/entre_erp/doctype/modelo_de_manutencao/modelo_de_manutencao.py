import frappe
from frappe import _
from frappe.model.document import Document
from frappe.utils import cint, getdate

from entre_erp.manutencao import (
	PREVENTIVA,
	criar_manutencao,
	descrever_recorrencia,
	ocorrencia,
	proxima_ocorrencia,
)


class ModelodeManutencao(Document):
	def validate(self):
		if self.tipo != PREVENTIVA:
			self.periodicidade = None
		if not self.periodicidade:
			self.repete = self.proxima_data = None
			return
		if not self.comeca_em:
			frappe.throw(_("Indique a data da primeira manutenção."))
		if cint(self.dias_de_antecedencia) < 0:
			frappe.throw(_("A antecedência não pode ser negativa."))
		self.repete = descrever_recorrencia(self)
		self.proxima_data = proxima_ocorrencia(self) if self.activo else None

	@frappe.whitelist()
	def proximas_datas(self, quantas=4):
		"""The next few dates, to check the rule reads as meant."""
		if not (self.periodicidade and self.proxima_data):
			return []
		proxima, k = getdate(self.proxima_data), 0
		while ocorrencia(self, k) < proxima:
			k += 1
		return [ocorrencia(self, k + i) for i in range(cint(quantas))]

	@frappe.whitelist()
	def criar_manutencao(self, data=None):
		"""A Rascunho maintenance from this modelo, to review and schedule."""
		frappe.has_permission("Manutencao Programada", "create", throw=True)
		return criar_manutencao(self.name, data).name
