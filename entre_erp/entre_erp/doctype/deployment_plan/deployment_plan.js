function build_clickup_description_html(tasks) {
	const fetched = (tasks || []).filter((row) => row.task_name);
	if (!fetched.length) return null;

	return fetched
		.map((row) => {
			const heading = `<h4>${frappe.utils.escape_html(row.task_name)}</h4>`;
			const body = row.task_description
				? `<p>${frappe.utils.escape_html(row.task_description).replace(/\n/g, "<br>")}</p>`
				: "";
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

// Search ClickUp by title (there's no search endpoint in ClickUp's API, so
// entre_erp.integrations.clickup.search_tasks fetches and filters by name
// itself) and add the picked task as a new, fully-fetched grid row.
function open_clickup_search_dialog(frm) {
	const dialog = new frappe.ui.Dialog({
		title: __("Search ClickUp Tasks"),
		fields: [
			{ fieldtype: "Data", fieldname: "search", label: __("Task title contains...") },
			{ fieldtype: "HTML", fieldname: "results" },
		],
	});

	const $results = dialog.fields_dict.results.$wrapper;

	const render_results = (rows) => {
		if (!rows.length) {
			$results.html(`<div class="text-muted" style="padding:8px;">${__("No matches.")}</div>`);
			return;
		}
		$results.html(
			rows
				.map(
					(t) => `
				<div class="dp-search-result" data-task-id="${frappe.utils.escape_html(t.task_id)}"
					style="padding:8px;border-bottom:1px solid var(--border-color,#eee);cursor:pointer;">
					<strong>${frappe.utils.escape_html(t.name)}</strong>
					${t.status ? `<span class="text-muted"> — ${frappe.utils.escape_html(t.status)}</span>` : ""}
				</div>`
				)
				.join("")
		);
		$results.find(".dp-search-result").on("click", function () {
			const task_id = $(this).data("task-id");
			dialog.hide();
			add_clickup_task_row(frm, task_id);
		});
	};

	dialog.fields_dict.search.$input.on(
		"input",
		frappe.utils.debounce(() => {
			const txt = dialog.get_value("search");
			if (!txt) {
				$results.empty();
				return;
			}
			frappe.call({
				method: "entre_erp.integrations.clickup.search_tasks",
				args: { txt },
				callback: (r) => render_results(r.message || []),
			});
		}, 400)
	);

	dialog.show();
}

function add_clickup_task_row(frm, task_id) {
	frappe.call({
		method: "entre_erp.integrations.clickup.get_task",
		args: { task_ref: task_id },
		freeze: true,
		freeze_message: __("Fetching from ClickUp..."),
		callback(r) {
			if (!r.message) return;
			const task = r.message;
			frm.add_child("clickup_tasks", {
				task_ref: task.task_id,
				task_id: task.task_id,
				task_name: task.name,
				task_status: task.status,
				task_url: task.url,
				task_description: task.description,
			});
			frm.refresh_field("clickup_tasks");
			apply_clickup_description(frm, { silent: true });
		},
	});
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

	refresh(frm) {
		if (!frm.__clickup_search_button_added) {
			frm.fields_dict.clickup_tasks.grid.add_custom_button(__("Search ClickUp"), () =>
				open_clickup_search_dialog(frm)
			);
			frm.__clickup_search_button_added = true;
		}
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
