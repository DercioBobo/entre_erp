import frappe
from frappe.model.document import Document

# Grid columns that can be hidden by default (Check fields "ocultar_<campo>").
COLUNAS_OCULTAVEIS = (
	"valor",
	"prioridade",
	"estado",
	"data_pretendida",
	"valor_pago",
	"data_pagamento",
	"metodo_pagamento",
	"categoria",
	"factura",
	"observacoes",
)


class CashflowSettings(Document):
	pass


def definicao(campo, padrao=None):
	"""A setting, falling back to its default while the settings were never saved."""
	valor = frappe.get_cached_doc("Cashflow Settings").get(campo)
	return padrao if valor is None or valor == "" else valor


def ligado(campo, padrao=True):
	return bool(int(definicao(campo, 1 if padrao else 0)))


def para_a_pagina():
	"""What the Cashflow page needs to know."""
	return {
		"despesa_caixa": definicao("despesa_caixa", "Caixa"),
		"aviso_saldo_caixa": float(definicao("aviso_saldo_caixa", 0) or 0),
		"permitir_facturas_rascunho": ligado("permitir_facturas_rascunho"),
		"colunas_ocultas": [
			c for c in COLUNAS_OCULTAVEIS if ligado(f"ocultar_{c}", c in ("data_pagamento", "factura"))
		],
		"pode_configurar": frappe.has_permission("Cashflow Settings", "write"),
	}
