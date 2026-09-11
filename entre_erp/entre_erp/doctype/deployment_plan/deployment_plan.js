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

	clickup_task_ref(frm) {
		// The link/ID text changed — the cached fetch, if any, is now stale.
		if (frm.doc.clickup_task_id) {
			frm.set_value("clickup_task_id", "");
			frm.set_value("clickup_task_name", "");
			frm.set_value("clickup_task_status", "");
			frm.set_value("clickup_task_html", "");
		}
	},

	fetch_clickup_task(frm) {
		if (!frm.doc.clickup_task_ref) {
			frappe.msgprint(__("Paste a ClickUp task link or ID first."));
			return;
		}
		frappe.call({
			method: "entre_erp.integrations.clickup.get_task",
			args: { task_ref: frm.doc.clickup_task_ref },
			freeze: true,
			freeze_message: __("Fetching from ClickUp..."),
			callback(r) {
				if (!r.message) return;
				const task = r.message;
				frm.set_value("clickup_task_id", task.task_id);
				frm.set_value("clickup_task_name", task.name);
				frm.set_value("clickup_task_status", task.status);
				frm.set_value(
					"clickup_task_html",
					`<a href="${task.url}" target="_blank">${__("Open in ClickUp")} ↗</a>`
				);
				frappe.show_alert({ message: __("ClickUp task linked."), indicator: "green" });
			},
		});
	},
});
