frappe.views.calendar["Manutencao Programada"] = {
	field_map: {
		start: "inicio",
		end: "fim",
		id: "name",
		title: "aplicacao",
		status: "estado",
	},
	filters: ["aplicacao", "estado", "tipo"],
	get_events_method: "frappe.desk.calendar.get_events",
};
