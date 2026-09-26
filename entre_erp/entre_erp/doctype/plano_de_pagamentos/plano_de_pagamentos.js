frappe.ui.form.on("Plano de Pagamentos", {
	refresh(frm) {
		if (frm.is_new()) return;

		frm.add_custom_button(__("Copiar Despesas Recorrentes"), () =>
			run_and_report(frm, "copiar_despesas_recorrentes"),
		);
	},
});

frappe.ui.form.on("Linha do Plano de Pagamentos", {
	estado(frm, cdt, cdn) {
		const row = locals[cdt][cdn];
		if (row.estado === "Pago" && !row.valor_pago) {
			frappe.model.set_value(cdt, cdn, "valor_pago", row.valor);
		}
	},
});

function run_and_report(frm, method) {
	if (frm.is_dirty()) {
		frappe.msgprint(__("Guarde o plano antes de continuar."));
		return;
	}
	frm.call(method).then((r) => {
		const n = r.message || 0;
		frappe.show_alert({
			message: n ? __("{0} linha(s) adicionada(s).", [n]) : __("Nada novo para adicionar."),
			indicator: n ? "green" : "blue",
		});
		frm.reload_doc();
	});
}
