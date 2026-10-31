frappe.listview_settings["Modelo de Manutencao"] = {
	add_fields: ["activo"],
	get_indicator(doc) {
		return doc.activo ? [__("Activo"), "green", "activo,=,1"] : [__("Inactivo"), "gray", "activo,=,0"];
	},
};
