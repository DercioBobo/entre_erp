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

	generate_description(frm) {
		const tasks = (frm.doc.clickup_tasks || []).filter((row) => row.task_name);
		if (!tasks.length) {
			frappe.msgprint(__("Fetch at least one ClickUp task first."));
			return;
		}

		const html = tasks
			.map((row) => {
				const heading = `<h4>${frappe.utils.escape_html(row.task_name)}</h4>`;
				const body = row.task_description
					? `<p>${frappe.utils.escape_html(row.task_description).replace(/\n/g, "<br>")}</p>`
					: `<p><em>${__("No description provided.")}</em></p>`;
				return heading + body;
			})
			.join("<hr>");

		const apply = () => frm.set_value("description", html);

		if (frm.doc.description) {
			frappe.confirm(__("This will replace the current Description. Continue?"), apply);
		} else {
			apply();
		}
	},
});

frappe.ui.form.on("Deployment Plan ClickUp Task", {
	task_ref(frm, cdt, cdn) {
		const row = locals[cdt][cdn];
		if (!row.task_ref) {
			return;
		}

		// The link/ID text changed — clear the stale cached fetch, if any.
		["task_id", "task_name", "task_status", "task_url", "task_description"].forEach((fieldname) => {
			frappe.model.set_value(cdt, cdn, fieldname, "");
		});

		frappe.call({
			method: "entre_erp.integrations.clickup.get_task",
			args: { task_ref: row.task_ref },
			freeze: true,
			freeze_message: __("Fetching from ClickUp..."),
			callback(r) {
				if (!r.message) return;
				const task = r.message;
				frappe.model.set_value(cdt, cdn, "task_id", task.task_id);
				frappe.model.set_value(cdt, cdn, "task_name", task.name);
				frappe.model.set_value(cdt, cdn, "task_status", task.status);
				frappe.model.set_value(cdt, cdn, "task_url", task.url);
				frappe.model.set_value(cdt, cdn, "task_description", task.description);
			},
		});
	},
});
