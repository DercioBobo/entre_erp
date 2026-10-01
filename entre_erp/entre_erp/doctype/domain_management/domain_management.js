// The registry's expiry (whois_expiry_date) against our own renewal date
// (data_de_fim): the registry date is the one that actually takes the site down.
const DIAS_AVISO_REGISTO = 30;

function mostrar_aviso_whois(frm) {
	frm.set_intro("");
	const fmt = (d) => frappe.datetime.str_to_user(d);

	if (frm.doc.whois_error) {
		frm.set_intro(__("A última consulta WHOIS falhou: {0}", [frm.doc.whois_error]), "orange");
		return;
	}
	const expira = frm.doc.whois_expiry_date;
	if (!expira) return;

	const dias = frappe.datetime.get_diff(expira, frappe.datetime.get_today());
	if (dias < 0) {
		frm.set_intro(__("O domínio expirou no registo em {0}.", [fmt(expira)]), "red");
	} else if (frm.doc.data_de_fim && expira < frm.doc.data_de_fim) {
		frm.set_intro(
			__("O registo expira em {0}, antes da data de renovação ({1}).", [fmt(expira), fmt(frm.doc.data_de_fim)]),
			"red"
		);
	} else if (dias <= DIAS_AVISO_REGISTO) {
		frm.set_intro(__("O domínio expira no registo dentro de {0} dias ({1}).", [dias, fmt(expira)]), "orange");
	}
}

frappe.ui.form.on("Domain Management", {
	refresh(frm) {
		mostrar_aviso_whois(frm);
		if (frm.is_new()) return;

		frm.add_custom_button(__("Consultar WHOIS"), () => {
			frm.call({
				method: "consultar_whois",
				doc: frm.doc,
				freeze: true,
				freeze_message: __("A consultar o registo..."),
			}).then(() => frm.reload_doc());
		});
	},
});
