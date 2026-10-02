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

function somar_valor(frm) {
	if (frm.doc.valor_dominio || frm.doc.valor_hospedagem) {
		frm.set_value("valor", flt(frm.doc.valor_dominio) + flt(frm.doc.valor_hospedagem));
	}
}

// The server answers {existente} or {doc}: a new invoice filled in, not saved yet.
function abrir_factura(r) {
	if (r.existente) {
		frappe.set_route("Form", "Sales Invoice", r.existente);
		return;
	}
	const [doc] = frappe.model.sync(r.doc);
	frappe.set_route("Form", doc.doctype, doc.name);
}

frappe.ui.form.on("Domain Management", {
	valor_dominio: somar_valor,
	valor_hospedagem: somar_valor,

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

		const em_aberto = ["Pendente", "Pago"].includes(frm.doc.renovacao_estado);
		if (em_aberto) {
			frm.add_custom_button(__("Abrir renovação"), () =>
				frappe.set_route("Form", "Domain Renewal", frm.doc.renovacao_actual)
			).addClass("btn-primary");
		} else if (frm.doc.estado !== "Cancelado") {
			frm.add_custom_button(__("Nova renovação"), () =>
				frm.call({ method: "abrir_renovacao", doc: frm.doc }).then(({ message }) =>
					frappe.set_route("Form", "Domain Renewal", message)
				)
			);
		}

		if (frappe.model.can_create("Sales Invoice") && frm.doc.estado !== "Cancelado") {
			frm.add_custom_button(__("Criar factura"), () =>
				frm
					.call({ method: "criar_factura", doc: frm.doc, freeze: true, freeze_message: __("A preparar a factura...") })
					.then(({ message }) => abrir_factura(message))
			);
		}

		if (frm.doc.ultima_factura) {
			frm.add_custom_button(__("Desligar factura"), () =>
				frappe.confirm(
					__("Desligar a factura {0}? A factura não é apagada: apague-a ou cancele-a na própria factura.", [frm.doc.ultima_factura]),
					() => frm.call({ method: "desligar_factura", doc: frm.doc }).then(() => frm.reload_doc())
				)
			);
		}

		if (frm.doc.password) {
			frm.add_custom_button(__("Ver password"), () =>
				frm.call({ method: "ver_password", doc: frm.doc }).then(({ message }) =>
					frappe.msgprint({ title: __("Password"), message: frappe.utils.escape_html(message || "") })
				)
			);
		}
	},
});
