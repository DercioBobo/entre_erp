frappe.ui.form.on("Issue Portal Field Config", {
	refresh(frm) {
		frm.add_custom_button(
			__("Fetch Issue Fields"),
			async function () {
				const result = await frappe.call({
					method: "entre_erp.utils.get_issue_fields_for_config",
					freeze: true,
					freeze_message: __("Loading Issue fields…"),
				});

				if (!result?.message?.length) {
					frappe.show_alert({ message: __("No fields returned"), indicator: "orange" });
					return;
				}

				const existing = new Set(
					(frm.doc.portal_fields || []).map((r) => r.fieldname)
				);

				let added = 0;
				for (const field of result.message) {
					if (!existing.has(field.fieldname)) {
						const row = frappe.model.add_child(
							frm.doc,
							"Issue Portal Field",
							"portal_fields"
						);
						Object.assign(row, field);
						added++;
					}
				}

				frm.refresh_field("portal_fields");
				frappe.show_alert({
					message:
						added > 0
							? __("{0} field(s) imported", [added])
							: __("All fields are already in the list"),
					indicator: added > 0 ? "green" : "blue",
				});
			},
			__("Tools")
		);
	},
});
