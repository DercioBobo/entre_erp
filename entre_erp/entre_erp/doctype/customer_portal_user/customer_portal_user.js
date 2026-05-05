frappe.ui.form.on("Customer Portal User", {
	user(frm) {
		if (!frm.doc.user) return;
		frappe.db.get_value("User", frm.doc.user, "user_type", ({ user_type } = {}) => {
			if (user_type === "System User") {
				frappe.msgprint({
					title: __("Warning"),
					message: __(
						"<b>{0}</b> is a desk (System) user. Portal Customer mappings are intended for Website Users only.",
						[frm.doc.user]
					),
					indicator: "orange",
				});
			}
		});
	},
});
