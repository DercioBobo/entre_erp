frappe.query_reports["Salarios do Ano"] = {
	filters: [
		{
			fieldname: "year",
			label: __("Ano"),
			fieldtype: "Int",
			default: cint(frappe.datetime.get_today().split("-")[0]),
			reqd: 1,
		},
		{
			fieldname: "valor",
			label: __("Valor"),
			fieldtype: "Select",
			options: "Líquido\nBruto\nSalário Base",
			default: "Líquido",
			reqd: 1,
		},
		{
			fieldname: "company",
			label: __("Empresa"),
			fieldtype: "Link",
			options: "Company",
			default: frappe.defaults.get_user_default("Company"),
		},
	],
};
