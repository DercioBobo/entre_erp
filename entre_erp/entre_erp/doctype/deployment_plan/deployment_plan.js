function build_clickup_description_html(tasks) {
	const fetched = (tasks || []).filter((row) => row.task_name);
	if (!fetched.length) return null;

	return fetched
		.map((row) => {
			const heading = `<h4>${frappe.utils.escape_html(row.task_name)}</h4>`;
			const body = row.task_description
				? `<p>${frappe.utils.escape_html(row.task_description).replace(/\n/g, "<br>")}</p>`
				: `<p><em>${__("No description provided.")}</em></p>`;
			return heading + body;
		})
		.join("<hr>");
}

// Manual (button click, always offers to overwrite) and automatic (silent,
// only fills in while the description hasn't been hand-edited since the
// last auto-fill) share this. `frm._dp_last_generated` tracks the last
// value *we* wrote, so a manual edit in between stops silent overwrites
// until the user clicks the button again.
function apply_clickup_description(frm, { silent } = {}) {
	const html = build_clickup_description_html(frm.doc.clickup_tasks);
	if (!html) {
		if (!silent) frappe.msgprint(__("Fetch at least one ClickUp task first."));
		return;
	}

	const apply = () => {
		frm.set_value("description", html);
		frm._dp_last_generated = html;
	};

	const untouched = !frm.doc.description || frm.doc.description === frm._dp_last_generated;

	if (silent) {
		if (untouched) apply();
		return;
	}

	if (untouched) {
		apply();
	} else {
		frappe.confirm(__("This will replace the current Description. Continue?"), apply);
	}
}

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
		apply_clickup_description(frm);
	},

	clickup_tasks_remove(frm) {
		apply_clickup_description(frm, { silent: true });
	},
});

frappe.ui.form.on("Deployment Plan ClickUp Task", {
	task_ref(frm, cdt, cdn) {
		const row = locals[cdt][cdn];
		if (!row.task_ref) {
			apply_clickup_description(frm, { silent: true });
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
				apply_clickup_description(frm, { silent: true });
			},
		});
	},
});
