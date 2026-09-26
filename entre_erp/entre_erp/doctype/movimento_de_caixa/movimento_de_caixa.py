import frappe
from frappe import _
from frappe.model.document import Document
from frappe.utils import flt

# Automatic top-ups mirror the Caixa line of a Plano de Pagamentos; they
# are only changed from there (entre_erp.caixa.sincronizar_reforcos).
CAMPOS_DO_PLANO = ("tipo", "valor", "data")


class MovimentodeCaixa(Document):
	def validate(self):
		if flt(self.valor) < 0:
			frappe.throw(_("O valor não pode ser negativo — use o Tipo (Gasto / Reforço)."))
		if self.plano and not self.flags.do_plano and not self.is_new():
			for campo in CAMPOS_DO_PLANO:
				if self.has_value_changed(campo):
					frappe.throw(
						_("Este reforço vem do plano {0}. Altere-o lá (linha Caixa).").format(
							frappe.bold(self.plano)
						)
					)

	def on_trash(self):
		if self.plano and not self.flags.do_plano:
			frappe.throw(
				_("Este reforço vem do plano {0}. Para o retirar, desfaça o Pago da linha Caixa lá.").format(
					frappe.bold(self.plano)
				)
			)
