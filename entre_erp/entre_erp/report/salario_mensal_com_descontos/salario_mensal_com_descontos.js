(() => {
	const hoje = frappe.datetime.get_today().split("-");

	frappe.query_reports["Salario Mensal com Descontos"] = {
		filters: [
			{
				fieldname: "month",
				label: __("Mês"),
				fieldtype: "Select",
				options: "1\n2\n3\n4\n5\n6\n7\n8\n9\n10\n11\n12",
				default: String(cint(hoje[1])),
				reqd: 1,
			},
			{ fieldname: "year", label: __("Ano"), fieldtype: "Int", default: cint(hoje[0]), reqd: 1 },
			{
				fieldname: "company",
				label: __("Empresa"),
				fieldtype: "Link",
				options: "Company",
				default: frappe.defaults.get_user_default("Company"),
			},
		],
	};
})();
