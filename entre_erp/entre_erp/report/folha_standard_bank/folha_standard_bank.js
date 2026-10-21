// Standard Bank payroll file. The reference has a character limit (the bank
// refused "Salario Setembro"), so it is editable here and checked on the server.
(() => {
	const LIMITE_REFERENCIA = 14;
	const MESES_CURTOS = ["Jan", "Fev", "Mar", "Abr", "Mai", "Jun", "Jul", "Ago", "Set", "Out", "Nov", "Dez"];
	const referencia_padrao = (mes) => `Salario ${MESES_CURTOS[cint(mes) - 1]}`;
	const hoje = frappe.datetime.get_today().split("-");

	frappe.query_reports["Folha Standard Bank"] = {
		filters: [
			{
				fieldname: "month",
				label: __("Mês"),
				fieldtype: "Select",
				options: "1\n2\n3\n4\n5\n6\n7\n8\n9\n10\n11\n12",
				default: String(cint(hoje[1])),
				reqd: 1,
				on_change(report) {
					// A new month gets its own default reference.
					report.set_filter_value("reference", referencia_padrao(report.get_filter_value("month")));
				},
			},
			{ fieldname: "year", label: __("Ano"), fieldtype: "Int", default: cint(hoje[0]), reqd: 1 },
			{
				fieldname: "company",
				label: __("Empresa"),
				fieldtype: "Link",
				options: "Company",
				default: frappe.defaults.get_user_default("Company"),
			},
			{
				fieldname: "reference",
				label: __("Referência (máx. {0})", [LIMITE_REFERENCIA]),
				fieldtype: "Data",
				default: referencia_padrao(hoje[1]),
				reqd: 1,
			},
			{
				fieldname: "value_date",
				label: __("Data Valor"),
				fieldtype: "Date",
				description: __("Vazio: a data de lançamento de cada recibo."),
			},
			{ fieldname: "header", label: __("Linha de cabeçalho"), fieldtype: "Check", default: 1 },
		],

		formatter(value, row, column, data, default_formatter) {
			value = default_formatter(value, row, column, data);
			if (data && column.fieldname === "DESTINATION_ACCOUNT_NUMBER" && !data.DESTINATION_ACCOUNT_NUMBER && data.employee) {
				return `<span class="text-danger">${__("Sem NIB")}</span>`;
			}
			return value;
		},

		onload(report) {
			report.page.add_inner_button(__("Descarregar ficheiro do banco"), () => {
				const filters = report.get_filter_values(true);
				if (!filters) return;
				if ((filters.reference || "").length > LIMITE_REFERENCIA) {
					frappe.msgprint(__("A referência tem {0} caracteres — o banco aceita no máximo {1}.", [filters.reference.length, LIMITE_REFERENCIA]));
					return;
				}
				open_url_post(
					"/api/method/entre_erp.entre_erp.report.folha_standard_bank.folha_standard_bank.descarregar",
					{ filters: JSON.stringify(filters) },
				);
			});
		},
	};
})();
