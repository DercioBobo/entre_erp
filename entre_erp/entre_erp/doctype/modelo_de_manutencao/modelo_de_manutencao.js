// A modelo fills new maintenances; a preventive one with a periodicidade also
// creates them on its own (manutencao.criar_preventivas, daily). The header
// card with the next dates is public/js/manutencao_cartao.js.

function criar_manutencao(frm) {
	frappe.prompt(
		{
			fieldname: "data",
			fieldtype: "Date",
			label: __("Dia da manutenção"),
			reqd: 1,
			default: frm.doc.proxima_data || frappe.datetime.get_today(),
		},
		({ data }) =>
			frm.call({ method: "criar_manutencao", doc: frm.doc, args: { data }, freeze: true }).then(({ message }) =>
				frappe.set_route("Form", "Manutencao Programada", message)
			),
		__("Criar manutenção"),
		__("Criar")
	);
}

frappe.ui.form.on("Modelo de Manutencao", {
	refresh(frm) {
		// The window and the reminder hour use the picker (public/js/janela_picker.js).
		entre_erp.janela.ligar(frm, "janela", { modo: "horas", campos: { hora_inicio: "hora_inicio", hora_fim: "hora_fim" } });
		entre_erp.janela.ligar(frm, "lembrete", {
			modo: "hora",
			campos: { hora: "hora_do_lembrete" },
			rotulo: __("Hora do lembrete"),
			padrao: { ini: 8 * 60 },
		});
		if (frm.is_new()) return;
		frm.add_custom_button(__("Criar manutenção"), () => criar_manutencao(frm)).addClass("btn-primary");
	},
});
