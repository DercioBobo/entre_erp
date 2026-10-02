"""Which domain (and renewal) a Sales Invoice is for. Filled in by
"Criar factura"; when the invoice is first saved, the domain and renewal are
linked back to it (dominios.ao_guardar_factura)."""

from frappe.custom.doctype.custom_field.custom_field import create_custom_fields


def execute():
	create_custom_fields(
		{
			"Sales Invoice": [
				{
					"fieldname": "dominio",
					"fieldtype": "Link",
					"label": "Domínio",
					"options": "Domain Management",
					"insert_after": "customer",
					"read_only": 1,
					"no_copy": 1,
					"print_hide": 1,
					"in_standard_filter": 1,
					"depends_on": "dominio",
				},
				{
					"fieldname": "renovacao_dominio",
					"fieldtype": "Link",
					"label": "Renovação de domínio",
					"options": "Domain Renewal",
					"insert_after": "dominio",
					"read_only": 1,
					"no_copy": 1,
					"print_hide": 1,
					"depends_on": "renovacao_dominio",
				},
			]
		},
		update=True,
	)
