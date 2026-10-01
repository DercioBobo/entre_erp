const CORES_RENOVACAO = {
	Pendente: "orange",
	Pago: "blue",
	Renovado: "purple",
	"Concluído": "green",
	Cancelado: "gray",
};

frappe.listview_settings["Domain Renewal"] = {
	add_fields: ["estado"],
	get_indicator(doc) {
		return [__(doc.estado), CORES_RENOVACAO[doc.estado] || "gray", "estado,=," + doc.estado];
	},
};
