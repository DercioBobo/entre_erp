// Pendente → Pago → Concluído, or Pendente → Renovado (trusted, before paying)
// → Concluído. Every step is a button calling the server; the fields stay
// read-only so the history can't be edited by hand.

function marcar_como_pago(frm) {
	const d = new frappe.ui.Dialog({
		title: __("Marcar como pago"),
		fields: [
			{ fieldname: "data_pagamento", fieldtype: "Date", label: __("Data do pagamento"), reqd: 1, default: frappe.datetime.get_today() },
			{ fieldname: "valor_pago", fieldtype: "Currency", label: __("Valor pago"), reqd: 1, default: frm.doc.valor },
			{ fieldname: "comprovativo", fieldtype: "Attach", label: __("Comprovativo"), reqd: 1 },
		],
		primary_action_label: __("Marcar como pago"),
		primary_action(values) {
			frm.call({ method: "marcar_como_pago", doc: frm.doc, args: values, freeze: true }).then(() => {
				d.hide();
				frm.reload_doc();
			});
		},
	});
	d.show();
}

function confirmar_renovacao(frm, args = {}) {
	frm.call({
		method: "confirmar_renovacao",
		doc: frm.doc,
		args,
		freeze: true,
		freeze_message: __("A confirmar no registo..."),
	}).then(({ message }) => {
		if (message && message.confirmado === false) {
			pedir_confirmacao_sem_registo(frm, args, message);
		} else {
			frappe.show_alert({ message: __("Renovação confirmada"), indicator: "green" });
			frm.reload_doc();
		}
	});
}

// The registry doesn't show the renewal yet (or couldn't be reached).
function pedir_confirmacao_sem_registo(frm, args, { erro, expira_no_registo }) {
	const situacao = erro
		? __("Não foi possível consultar o registo: {0}", [erro])
		: __("O registo ainda mostra a expiração em {0}.", [frappe.datetime.str_to_user(expira_no_registo)]);
	const d = new frappe.ui.Dialog({
		title: __("O registo não confirma a renovação"),
		fields: [
			{
				fieldtype: "HTML",
				options: `<p>${frappe.utils.escape_html(situacao)}</p><p>${__(
					"Se renovou agora, o registo pode demorar alguns minutos. Tente de novo mais tarde, ou confirme mesmo assim: a nova data fica a data anterior mais o período."
				)}</p>`,
			},
			{ fieldname: "motivo_sem_registo", fieldtype: "Small Text", label: __("Motivo"), reqd: 1 },
		],
		primary_action_label: __("Confirmar mesmo assim"),
		primary_action(values) {
			d.hide();
			confirmar_renovacao(frm, { ...args, sem_registo: 1, ...values });
		},
	});
	d.show();
}

function renovar_sem_pagamento(frm) {
	frappe.prompt(
		{ fieldname: "motivo_sem_pagamento", fieldtype: "Small Text", label: __("Porque renovar antes do pagamento?"), reqd: 1 },
		(values) => confirmar_renovacao(frm, { sem_pagamento: 1, ...values }),
		__("Renovar antes do pagamento"),
		__("Renovar")
	);
}

function criar_factura(frm) {
	frm.call({ method: "criar_factura", doc: frm.doc, freeze: true, freeze_message: __("A criar a factura...") }).then(
		({ message }) => frappe.set_route("Form", "Sales Invoice", message)
	);
}

function desligar_factura(frm) {
	frappe.confirm(
		__("Desligar a factura {0} desta renovação? A factura não é apagada: apague-a ou cancele-a na própria factura.", [frm.doc.factura]),
		() => frm.call({ method: "desligar_factura", doc: frm.doc }).then(() => frm.reload_doc())
	);
}

function cancelar(frm) {
	frappe.prompt(
		{ fieldname: "motivo", fieldtype: "Small Text", label: __("Motivo"), reqd: 1 },
		(values) =>
			frm.call({ method: "cancelar", doc: frm.doc, args: values, freeze: true }).then(() => frm.reload_doc()),
		__("Cancelar renovação e domínio"),
		__("Cancelar")
	);
}

frappe.ui.form.on("Domain Renewal", {
	refresh(frm) {
		if (frm.is_new()) return;
		const estado = frm.doc.estado;

		if (estado === "Pendente" || estado === "Renovado") {
			frm.add_custom_button(__("Marcar como pago"), () => marcar_como_pago(frm)).addClass("btn-primary");
		}
		if (estado === "Pago") {
			frm.add_custom_button(__("Confirmar renovação"), () => confirmar_renovacao(frm)).addClass("btn-primary");
		}
		if (estado === "Pendente") {
			frm.add_custom_button(__("Renovar antes do pagamento"), () => renovar_sem_pagamento(frm), __("Mais"));
		}
		if (estado === "Pendente" || estado === "Pago") {
			frm.add_custom_button(__("Cancelar"), () => cancelar(frm), __("Mais"));
		}
		frm.add_custom_button(__("Domínio"), () => frappe.set_route("Form", "Domain Management", frm.doc.dominio));

		// Draft only: submitting and the payment are done on the invoice itself.
		if (frm.doc.factura) {
			frm.add_custom_button(__("Ver factura"), () => frappe.set_route("Form", "Sales Invoice", frm.doc.factura));
			frm.add_custom_button(__("Desligar factura"), () => desligar_factura(frm), __("Mais"));
		}
		// With an invoice already, under Mais: it only makes a new one if that was cancelled.
		if (estado !== "Cancelado" && frappe.model.can_create("Sales Invoice")) {
			frm.add_custom_button(__("Criar factura"), () => criar_factura(frm), frm.doc.factura ? __("Mais") : null);
		}

		if (estado === "Renovado") {
			frm.set_intro(__("Renovado antes do pagamento: falta marcar como pago."), "orange");
		}
	},
});
