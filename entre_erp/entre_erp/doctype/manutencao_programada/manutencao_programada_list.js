const CORES_MANUTENCAO = {
	Rascunho: "gray",
	Agendada: "blue",
	"Em Curso": "orange",
	"Concluída": "green",
	Cancelada: "red",
};

frappe.listview_settings["Manutencao Programada"] = {
	add_fields: ["estado"],
	get_indicator(doc) {
		return [__(doc.estado), CORES_MANUTENCAO[doc.estado] || "gray", "estado,=," + doc.estado];
	},
};
