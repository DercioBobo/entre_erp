frappe.ui.form.on("Deployment Plan", {
	setup(frm) {
		["implemented_by", "standby", "people_involved"].forEach((fieldname) => {
			frm.set_query(fieldname, () => ({
				query: "entre_erp.api.get_users_by_role",
				filters: { role: "Tech" },
			}));
		});

		frm.set_query("approver", () => ({
			query: "entre_erp.api.get_users_by_role",
			filters: { role: "Tech Lead" },
		}));
	},
});
