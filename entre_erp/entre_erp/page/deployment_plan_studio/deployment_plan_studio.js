frappe.pages["deployment-plan-studio"].on_page_load = function (wrapper) {
	const page = frappe.ui.make_app_page({
		parent: wrapper,
		title: "Deployment Plans",
		single_column: true,
	});

	new DeploymentPlanStudio(page);
};

const WORKFLOW_STATES = ["Draft", "Pending Approval", "Approved", "Done", "Rolled Back", "Rejected", "Cancelled"];

const STATUS_CLASS = {
	Draft: "gray",
	"Pending Approval": "amber",
	Approved: "blue",
	Done: "green",
	"Rolled Back": "orange",
	Rejected: "red",
	Cancelled: "gray",
};

function status_pill(state) {
	const cls = STATUS_CLASS[state] || "gray";
	return `<span class="dp-pill dp-pill-${cls}">${frappe.utils.escape_html(state || "Draft")}</span>`;
}

class DeploymentPlanStudio {
	constructor(page) {
		this.page = page;
		this.$body = $(page.body).empty();
		this.controls = {};
		inject_styles();
		this.show_list();
	}

	// ------------------------------------------------------------------
	// List view
	// ------------------------------------------------------------------

	show_list() {
		this.current_doc = null;
		this.page.clear_primary_action();
		this.page.set_title(__("Deployment Plans"));
		this.page.set_primary_action(__("New Deployment Plan"), () => this.show_editor(), "add");

		this.$body.html(`
			<div class="dp-studio">
				<div class="dp-list-toolbar">
					<input type="text" class="form-control dp-search" placeholder="${__("Search title or application...")}">
					<select class="form-control dp-status-filter">
						<option value="">${__("All statuses")}</option>
						${WORKFLOW_STATES.map((s) => `<option value="${s}">${__(s)}</option>`).join("")}
					</select>
				</div>
				<div class="dp-list"><div class="dp-empty">${__("Loading...")}</div></div>
			</div>
		`);

		this.$body.find(".dp-search").on("input", frappe.utils.debounce(() => this.load_list(), 300));
		this.$body.find(".dp-status-filter").on("change", () => this.load_list());

		this.load_list();
	}

	load_list() {
		const txt = this.$body.find(".dp-search").val();
		const status = this.$body.find(".dp-status-filter").val();
		const filters = [];
		if (status) filters.push(["workflow_state", "=", status]);
		if (txt) filters.push(["title", "like", `%${txt}%`]);

		frappe.call({
			method: "frappe.client.get_list",
			args: {
				doctype: "Deployment Plan",
				fields: ["name", "title", "application", "workflow_state", "implementation_datetime"],
				filters,
				order_by: "implementation_datetime desc",
				limit_page_length: 100,
			},
			callback: (r) => this.render_list(r.message || []),
		});
	}

	render_list(rows) {
		const $list = this.$body.find(".dp-list");
		if (!rows.length) {
			$list.html(`<div class="dp-empty">${__("No deployment plans yet.")}</div>`);
			return;
		}

		$list.html(
			rows
				.map(
					(d) => `
			<div class="dp-card" data-name="${frappe.utils.escape_html(d.name)}">
				<div class="dp-card-main">
					<div class="dp-card-title">${frappe.utils.escape_html(d.title || d.name)}</div>
					<div class="dp-card-meta">
						${d.application ? frappe.utils.escape_html(d.application) : ""}
						${d.implementation_datetime ? " · " + frappe.datetime.str_to_user(d.implementation_datetime) : ""}
					</div>
				</div>
				${status_pill(d.workflow_state)}
			</div>`
				)
				.join("")
		);

		$list.find(".dp-card").on("click", (e) => this.show_editor($(e.currentTarget).data("name")));
	}

	// ------------------------------------------------------------------
	// Editor
	// ------------------------------------------------------------------

	show_editor(name) {
		this.page.clear_primary_action();
		this.page.set_title(name ? __("Deployment Plan") : __("New Deployment Plan"));

		if (name) {
			frappe.call({
				method: "frappe.client.get",
				args: { doctype: "Deployment Plan", name },
				callback: (r) => this.render_editor(r.message),
			});
		} else {
			this.render_editor(this.blank_doc());
		}
	}

	blank_doc() {
		return {
			doctype: "Deployment Plan",
			title: "",
			application: "",
			implementation_datetime: "",
			duration: "",
			git_references: [],
			clickup_tasks: [],
			causes_service_outage: 0,
			outage_details: "",
			description: "",
			implemented_by: [],
			standby: [],
			people_involved: [],
			approver: "",
			what_was_tested: "",
			tested_by: "",
			rollback_plan: "",
			outcome: "",
			outcome_notes: "",
		};
	}

	render_editor(doc) {
		this.current_doc = doc;
		this.controls = {};
		const locked = doc.docstatus === 1;

		this.$body.html(`
			<div class="dp-studio">
				<div class="dp-editor-top">
					<button class="btn btn-default btn-sm dp-back">← ${__("Back to list")}</button>
					<div class="dp-editor-top-right">
						${doc.workflow_state ? status_pill(doc.workflow_state) : ""}
						<div class="dp-workflow-actions"></div>
					</div>
				</div>
				<div class="dp-editor"></div>
				<div class="dp-savebar">
					<button class="btn btn-primary dp-save">${__("Save")}</button>
					${
						doc.name && doc.workflow_state === "Draft"
							? `<button class="btn btn-danger dp-delete">${__("Delete")}</button>`
							: ""
					}
				</div>
			</div>
		`);

		this.$body.find(".dp-back").on("click", () => this.show_list());
		this.$body.find(".dp-save").on("click", () => this.save());
		this.$body.find(".dp-delete").on("click", () => this.delete_doc());

		const $editor = this.$body.find(".dp-editor");
		this.resolve_user_names(doc).then((names) => {
			this.user_names = names;
			this.build_sections($editor, doc, locked);
		});

		if (doc.name) {
			this.render_workflow_actions(this.$body.find(".dp-workflow-actions"), doc);
		}
	}

	resolve_user_names(doc) {
		const ids = new Set();
		["implemented_by", "standby", "people_involved"].forEach((f) => {
			(doc[f] || []).forEach((row) => row.user && ids.add(row.user));
		});
		if (doc.approver) ids.add(doc.approver);
		if (doc.tested_by) ids.add(doc.tested_by);

		if (!ids.size) return Promise.resolve({});

		return new Promise((resolve) => {
			frappe.call({
				method: "frappe.client.get_list",
				args: {
					doctype: "User",
					fields: ["name", "full_name"],
					filters: [["name", "in", Array.from(ids)]],
					limit_page_length: 0,
				},
				callback: (r) => {
					const map = {};
					(r.message || []).forEach((u) => (map[u.name] = u.full_name));
					resolve(map);
				},
				error: () => resolve({}),
			});
		});
	}

	build_sections($editor, doc, locked) {
		// Overview -------------------------------------------------------
		const $overview = this.make_section($editor, __("Overview"));
		const $row = $('<div class="dp-field-row"></div>').appendTo($overview);
		this.controls.title = this.make_field($row, { fieldtype: "Data", fieldname: "title", label: __("Title"), reqd: 1 }, doc.title);
		this.controls.application = this.make_field(
			$row,
			{ fieldtype: "Link", fieldname: "application", label: __("Application"), options: "Application", reqd: 1 },
			doc.application
		);

		const $row2 = $('<div class="dp-field-row"></div>').appendTo($overview);
		this.controls.implementation_datetime = this.make_field(
			$row2,
			{ fieldtype: "Datetime", fieldname: "implementation_datetime", label: __("Implementation Date & Time"), reqd: 1 },
			doc.implementation_datetime
		);
		this.controls.duration = this.make_field(
			$row2,
			{
				fieldtype: "Select",
				fieldname: "duration",
				label: __("Duration"),
				reqd: 1,
				options: "< 15 minutes\n15 - 30 minutes\n30 - 60 minutes\n1 - 2 hours\n2 - 4 hours\n> 4 hours",
			},
			doc.duration
		);

		// Git References --------------------------------------------------
		this.git_picker = this.make_git_references($editor, doc.git_references || []);

		// ClickUp -----------------------------------------------------------
		this.clickup_picker = this.make_clickup_tasks($editor, doc.clickup_tasks || []);

		// Service outage ------------------------------------------------
		const $outage = this.make_section($editor, __("Service Outage"));
		this.controls.causes_service_outage = this.make_field(
			$outage,
			{ fieldtype: "Check", fieldname: "causes_service_outage", label: __("Will this cause a service outage?") },
			doc.causes_service_outage
		);
		const $outage_details_wrap = $('<div class="dp-conditional"></div>').appendTo($outage);
		this.controls.outage_details = this.make_field(
			$outage_details_wrap,
			{ fieldtype: "Small Text", fieldname: "outage_details", label: __("Outage Details") },
			doc.outage_details
		);
		const toggle_outage = () => {
			$outage_details_wrap.toggle(!!this.controls.causes_service_outage.get_value());
		};
		toggle_outage();
		this.controls.causes_service_outage.df.onchange = toggle_outage;

		// Description -----------------------------------------------------
		const $desc = this.make_section($editor, __("What Will Be Implemented"));
		this.controls.description = this.make_field(
			$desc,
			{ fieldtype: "Text Editor", fieldname: "description", label: __("Description"), reqd: 1 },
			doc.description
		);

		// People ------------------------------------------------------------
		const $people = this.make_section($editor, __("People"));
		const $prow = $('<div class="dp-field-row"></div>').appendTo($people);
		this.implemented_by_picker = this.make_people_picker(
			$prow,
			__("Implemented By"),
			"Tech",
			this.rows_to_users(doc.implemented_by)
		);
		this.standby_picker = this.make_people_picker($prow, __("Standby"), "Tech", this.rows_to_users(doc.standby));
		const $prow2 = $('<div class="dp-field-row"></div>').appendTo($people);
		this.people_involved_picker = this.make_people_picker(
			$prow2,
			__("People Involved"),
			"Tech",
			this.rows_to_users(doc.people_involved)
		);
		this.controls.approver = this.make_field(
			$prow2,
			{
				fieldtype: "Link",
				fieldname: "approver",
				label: __("Approver"),
				options: "User",
				reqd: 1,
				get_query: () => ({ query: "entre_erp.api.get_users_by_role", filters: { role: "Tech Lead" } }),
			},
			doc.approver
		);

		// Testing -------------------------------------------------------
		const $testing = this.make_section($editor, __("Testing"));
		const $trow = $('<div class="dp-field-row"></div>').appendTo($testing);
		this.controls.what_was_tested = this.make_field(
			$trow,
			{ fieldtype: "Text", fieldname: "what_was_tested", label: __("What Was Tested") },
			doc.what_was_tested
		);
		this.controls.tested_by = this.make_field(
			$trow,
			{ fieldtype: "Link", fieldname: "tested_by", label: __("Tested By"), options: "User" },
			doc.tested_by
		);

		// Rollback --------------------------------------------------------
		const $rollback = this.make_section($editor, __("Roll Back Plan"));
		this.controls.rollback_plan = this.make_field(
			$rollback,
			{ fieldtype: "Text", fieldname: "rollback_plan", label: __("Roll Back Plan"), reqd: 1 },
			doc.rollback_plan
		);

		// Outcome -----------------------------------------------------------
		const $outcome = this.make_section($editor, __("Outcome"));
		const $orow = $('<div class="dp-field-row"></div>').appendTo($outcome);
		this.controls.outcome = this.make_field(
			$orow,
			{ fieldtype: "Select", fieldname: "outcome", label: __("Outcome"), options: "\nSuccess\nSuccess with Issues\nRolled Back\nFailed" },
			doc.outcome
		);
		this.controls.outcome_notes = this.make_field(
			$orow,
			{ fieldtype: "Small Text", fieldname: "outcome_notes", label: __("Outcome Notes") },
			doc.outcome_notes
		);

		if (locked) {
			Object.entries(this.controls).forEach(([fieldname, control]) => {
				if (fieldname === "outcome" || fieldname === "outcome_notes") return;
				control.df.read_only = 1;
				control.refresh();
			});
		}
	}

	rows_to_users(rows) {
		return (rows || []).map((r) => ({ name: r.user, full_name: (this.user_names && this.user_names[r.user]) || r.user }));
	}

	make_section($parent, title) {
		const $section = $(`<div class="dp-card"><h4>${frappe.utils.escape_html(title)}</h4></div>`).appendTo($parent);
		return $section;
	}

	make_field($parent, df, value) {
		const $wrapper = $('<div class="dp-field"></div>').appendTo($parent);
		const control = frappe.ui.form.make_control({
			df,
			parent: $wrapper.get(0),
			render_input: true,
			only_input: false,
		});
		control.refresh();
		if (value !== undefined && value !== null && value !== "") {
			control.set_value(value);
		}
		return control;
	}

	// ------------------------------------------------------------------
	// Git References — card list, no grid
	// ------------------------------------------------------------------

	make_git_references($parent, initial) {
		const $wrap = this.make_section($parent, __("Git References"));
		$wrap.addClass("dp-card-with-list");
		const $list = $('<div class="dp-chip-list"></div>').appendTo($wrap);
		const $add = $(`<button class="btn btn-xs btn-default dp-add-btn">+ ${__("Add reference")}</button>`).appendTo($wrap);

		let rows = initial.map((r) => r.git_reference || "");

		const render = () => {
			$list.html(
				rows
					.map(
						(val, i) => `
				<div class="dp-chip-row" data-idx="${i}">
					<input type="text" class="form-control dp-git-input" value="${frappe.utils.escape_html(val)}" placeholder="${__("branch / tag / commit / PR")}">
					<span class="dp-chip-remove" title="${__("Remove")}">&times;</span>
				</div>`
					)
					.join("")
			);
			$list.find(".dp-git-input").on("change", function () {
				rows[$(this).closest(".dp-chip-row").data("idx")] = $(this).val();
			});
			$list.find(".dp-chip-remove").on("click", function () {
				rows.splice($(this).closest(".dp-chip-row").data("idx"), 1);
				render();
			});
		};
		render();

		$add.on("click", () => {
			rows.push("");
			render();
		});

		return { get_value: () => rows.filter((v) => v).map((v) => ({ git_reference: v })) };
	}

	// ------------------------------------------------------------------
	// ClickUp Tasks — card list with inline fetch
	// ------------------------------------------------------------------

	make_clickup_tasks($parent, initial) {
		const $wrap = this.make_section($parent, __("ClickUp"));
		$wrap.addClass("dp-card-with-list");
		const $list = $('<div class="dp-task-list"></div>').appendTo($wrap);
		const $actions = $('<div class="dp-task-actions"></div>').appendTo($wrap);
		const $add = $(`<button class="btn btn-xs btn-default dp-add-btn">+ ${__("Add task")}</button>`).appendTo($actions);
		const $gen = $(`<button class="btn btn-xs btn-default dp-generate-btn">${__("Generate Description from ClickUp Tasks")}</button>`).appendTo(
			$actions
		);

		let rows = initial.map((r) => ({
			task_ref: r.task_ref || "",
			task_id: r.task_id || "",
			task_name: r.task_name || "",
			task_status: r.task_status || "",
			task_url: r.task_url || "",
			task_description: r.task_description || "",
		}));

		const render = () => {
			$list.html(
				rows
					.map(
						(row, i) => `
				<div class="dp-task-card" data-idx="${i}">
					<div class="dp-task-top">
						<input type="text" class="form-control dp-task-ref" value="${frappe.utils.escape_html(row.task_ref)}" placeholder="${__("ClickUp task link or ID")}">
						<span class="dp-chip-remove" title="${__("Remove")}">&times;</span>
					</div>
					${
						row.task_name
							? `<div class="dp-task-info">
								<a href="${frappe.utils.escape_html(row.task_url || "#")}" target="_blank">${frappe.utils.escape_html(row.task_name)} ↗</a>
								${row.task_status ? `<span class="dp-pill dp-pill-blue">${frappe.utils.escape_html(row.task_status)}</span>` : ""}
							</div>
							${row.task_description ? `<div class="dp-task-desc">${frappe.utils.escape_html(row.task_description)}</div>` : ""}`
							: ""
					}
				</div>`
					)
					.join("")
			);

			$list.find(".dp-task-ref").on("change", (e) => {
				const idx = $(e.currentTarget).closest(".dp-task-card").data("idx");
				const val = $(e.currentTarget).val();
				Object.assign(rows[idx], { task_ref: val, task_id: "", task_name: "", task_status: "", task_url: "", task_description: "" });
				if (!val) {
					render();
					return;
				}
				frappe.call({
					method: "entre_erp.integrations.clickup.get_task",
					args: { task_ref: val },
					freeze: true,
					freeze_message: __("Fetching from ClickUp..."),
					callback: (r) => {
						if (r.message) {
							Object.assign(rows[idx], {
								task_id: r.message.task_id,
								task_name: r.message.name,
								task_status: r.message.status,
								task_url: r.message.url,
								task_description: r.message.description,
							});
						}
						render();
					},
					error: () => render(),
				});
			});
			$list.find(".dp-chip-remove").on("click", (e) => {
				rows.splice($(e.currentTarget).closest(".dp-task-card").data("idx"), 1);
				render();
			});
		};
		render();

		$add.on("click", () => {
			rows.push({ task_ref: "", task_id: "", task_name: "", task_status: "", task_url: "", task_description: "" });
			render();
		});

		$gen.on("click", () => {
			const fetched = rows.filter((r) => r.task_name);
			if (!fetched.length) {
				frappe.msgprint(__("Fetch at least one ClickUp task first."));
				return;
			}
			const html = fetched
				.map((r) => {
					const heading = `<h4>${frappe.utils.escape_html(r.task_name)}</h4>`;
					const body = r.task_description
						? `<p>${frappe.utils.escape_html(r.task_description).replace(/\n/g, "<br>")}</p>`
						: `<p><em>${__("No description provided.")}</em></p>`;
					return heading + body;
				})
				.join("<hr>");
			const apply = () => this.controls.description.set_value(html);
			if (this.controls.description.get_value()) {
				frappe.confirm(__("This will replace the current Description. Continue?"), apply);
			} else {
				apply();
			}
		});

		return {
			get_value: () =>
				rows
					.filter((r) => r.task_ref)
					.map((r) => ({
						task_ref: r.task_ref,
						task_id: r.task_id,
						task_name: r.task_name,
						task_status: r.task_status,
						task_url: r.task_url,
						task_description: r.task_description,
					})),
		};
	}

	// ------------------------------------------------------------------
	// People — role-filtered tag pickers (no Table MultiSelect grid)
	// ------------------------------------------------------------------

	make_people_picker($parent, label, role, initial) {
		const $wrap = $(`
			<div class="dp-field dp-people-field">
				<label>${frappe.utils.escape_html(label)}</label>
				<div class="dp-pills"></div>
				<div class="dp-people-input-wrap">
					<input type="text" class="form-control dp-people-input" placeholder="${__("Search {0} users...", [role])}">
					<div class="dp-suggest" style="display:none;"></div>
				</div>
			</div>
		`).appendTo($parent);

		const $pills = $wrap.find(".dp-pills");
		const $input = $wrap.find(".dp-people-input");
		const $suggest = $wrap.find(".dp-suggest");
		const state = { users: initial.slice() };

		const render_pills = () => {
			$pills.html(
				state.users
					.map(
						(u) => `
				<span class="dp-pill dp-pill-user" data-user="${frappe.utils.escape_html(u.name)}">
					${frappe.utils.escape_html(u.full_name || u.name)}
					<span class="dp-pill-remove">&times;</span>
				</span>`
					)
					.join("")
			);
			$pills.find(".dp-pill-remove").on("click", function () {
				const user = $(this).parent().data("user");
				state.users = state.users.filter((u) => u.name !== String(user));
				render_pills();
			});
		};
		render_pills();

		$input.on(
			"input",
			frappe.utils.debounce(() => {
				const txt = $input.val();
				if (!txt) {
					$suggest.hide();
					return;
				}
				frappe.call({
					method: "entre_erp.api.get_users_by_role",
					args: { doctype: "User", txt, searchfield: "name", start: 0, page_len: 10, filters: { role } },
					callback: (r) => {
						const rows = r.message || [];
						if (!rows.length) {
							$suggest.hide();
							return;
						}
						$suggest
							.html(
								rows
									.map(
										([name, full_name]) => `
								<div class="dp-suggest-item" data-name="${frappe.utils.escape_html(name)}" data-full-name="${frappe.utils.escape_html(full_name || name)}">
									${frappe.utils.escape_html(full_name || name)}
								</div>`
									)
									.join("")
							)
							.show();
						$suggest.find(".dp-suggest-item").on("click", function () {
							const name = $(this).data("name");
							const full_name = $(this).data("full-name");
							if (!state.users.find((u) => u.name === name)) {
								state.users.push({ name, full_name });
								render_pills();
							}
							$input.val("");
							$suggest.hide();
						});
					},
				});
			}, 300)
		);

		return { get_value: () => state.users.map((u) => u.name) };
	}

	// ------------------------------------------------------------------
	// Workflow actions
	// ------------------------------------------------------------------

	render_workflow_actions($container, doc) {
		$container.empty();
		frappe.call({
			method: "entre_erp.api.get_deployment_plan_transitions",
			args: { name: doc.name },
			callback: (r) => {
				(r.message || []).forEach((t) => {
					$(`<button class="btn btn-sm btn-primary dp-workflow-btn">${frappe.utils.escape_html(t.action)}</button>`)
						.appendTo($container)
						.on("click", () => this.apply_workflow_action(t.action));
				});
			},
		});
	}

	apply_workflow_action(action) {
		frappe.call({
			method: "frappe.model.workflow.apply_workflow",
			args: { doc: this.current_doc, action },
			freeze: true,
			freeze_message: __("Updating..."),
			callback: (r) => {
				frappe.show_alert({ message: __("Updated."), indicator: "green" });
				this.show_editor(r.message.name);
			},
		});
	}

	// ------------------------------------------------------------------
	// Save / delete
	// ------------------------------------------------------------------

	save() {
		const doc = Object.assign({}, this.current_doc, {
			doctype: "Deployment Plan",
			title: this.controls.title.get_value(),
			application: this.controls.application.get_value(),
			implementation_datetime: this.controls.implementation_datetime.get_value(),
			duration: this.controls.duration.get_value(),
			git_references: this.git_picker.get_value(),
			clickup_tasks: this.clickup_picker.get_value(),
			causes_service_outage: this.controls.causes_service_outage.get_value() ? 1 : 0,
			outage_details: this.controls.outage_details.get_value(),
			description: this.controls.description.get_value(),
			implemented_by: this.implemented_by_picker.get_value().map((u) => ({ user: u })),
			standby: this.standby_picker.get_value().map((u) => ({ user: u })),
			people_involved: this.people_involved_picker.get_value().map((u) => ({ user: u })),
			approver: this.controls.approver.get_value(),
			what_was_tested: this.controls.what_was_tested.get_value(),
			tested_by: this.controls.tested_by.get_value(),
			rollback_plan: this.controls.rollback_plan.get_value(),
			outcome: this.controls.outcome.get_value(),
			outcome_notes: this.controls.outcome_notes.get_value(),
		});

		const method = doc.name ? "frappe.client.save" : "frappe.client.insert";
		frappe.call({
			method,
			args: { doc },
			freeze: true,
			freeze_message: __("Saving..."),
			callback: (r) => {
				frappe.show_alert({ message: __("Saved."), indicator: "green" });
				this.show_editor(r.message.name);
			},
		});
	}

	delete_doc() {
		frappe.confirm(__("Delete this Deployment Plan? This cannot be undone."), () => {
			frappe.call({
				method: "frappe.client.delete",
				args: { doctype: "Deployment Plan", name: this.current_doc.name },
				freeze: true,
				callback: () => {
					frappe.show_alert({ message: __("Deleted."), indicator: "green" });
					this.show_list();
				},
			});
		});
	}
}

function inject_styles() {
	if (document.getElementById("dp-studio-style")) return;
	const style = document.createElement("style");
	style.id = "dp-studio-style";
	style.innerHTML = `
		.dp-studio {
			--dp-accent: #6366f1;
			--dp-accent-soft: #eef2ff;
			--dp-bg: #f8f9fc;
			--dp-card-bg: #ffffff;
			--dp-border: #e5e7eb;
			--dp-text: #1f2430;
			--dp-text-muted: #6b7280;
			max-width: 880px;
			margin: 0 auto;
			padding: 8px 4px 80px;
			color: var(--dp-text);
		}
		html[data-theme="dark"] .dp-studio {
			--dp-accent: #818cf8;
			--dp-accent-soft: rgba(129, 140, 248, 0.12);
			--dp-bg: #14161c;
			--dp-card-bg: #1c1f28;
			--dp-border: #2c303c;
			--dp-text: #e5e7eb;
			--dp-text-muted: #9ca3af;
		}

		.dp-list-toolbar { display: flex; gap: 10px; margin-bottom: 16px; }
		.dp-list-toolbar .dp-search { flex: 1; }
		.dp-list-toolbar .dp-status-filter { max-width: 200px; }

		.dp-list { display: flex; flex-direction: column; gap: 10px; }
		.dp-empty { padding: 40px; text-align: center; color: var(--dp-text-muted); }

		.dp-card {
			background: var(--dp-card-bg);
			border: 1px solid var(--dp-border);
			border-radius: 10px;
			padding: 16px 18px;
			margin-bottom: 16px;
			transition: box-shadow 0.15s ease, transform 0.15s ease;
		}
		.dp-card > h4 {
			margin: 0 0 14px;
			font-size: 13px;
			font-weight: 600;
			text-transform: uppercase;
			letter-spacing: 0.04em;
			color: var(--dp-accent);
		}

		.dp-list .dp-card {
			display: flex;
			align-items: center;
			justify-content: space-between;
			cursor: pointer;
			margin-bottom: 0;
		}
		.dp-list .dp-card:hover { box-shadow: 0 4px 16px rgba(0, 0, 0, 0.08); transform: translateY(-1px); }
		.dp-card-title { font-weight: 600; font-size: 14px; }
		.dp-card-meta { font-size: 12px; color: var(--dp-text-muted); margin-top: 2px; }

		.dp-pill {
			display: inline-block;
			padding: 3px 10px;
			border-radius: 999px;
			font-size: 11px;
			font-weight: 600;
			white-space: nowrap;
		}
		.dp-pill-gray { background: #e5e7eb; color: #374151; }
		.dp-pill-amber { background: #fef3c7; color: #92400e; }
		.dp-pill-blue { background: #dbeafe; color: #1d4ed8; }
		.dp-pill-green { background: #d1fae5; color: #065f46; }
		.dp-pill-orange { background: #fed7aa; color: #9a3412; }
		.dp-pill-red { background: #fee2e2; color: #991b1b; }

		.dp-editor-top { display: flex; align-items: center; justify-content: space-between; margin-bottom: 16px; }
		.dp-editor-top-right { display: flex; align-items: center; gap: 10px; }
		.dp-workflow-actions { display: flex; gap: 8px; }

		.dp-field-row { display: flex; gap: 16px; flex-wrap: wrap; }
		.dp-field-row > .dp-field, .dp-field-row > .dp-people-field { flex: 1; min-width: 220px; }
		.dp-field { margin-bottom: 12px; }
		.dp-field:last-child { margin-bottom: 0; }
		.dp-conditional { margin-top: 10px; }

		.dp-card-with-list .dp-add-btn, .dp-card-with-list .dp-generate-btn { margin-top: 8px; margin-right: 8px; }

		.dp-chip-row, .dp-task-top { display: flex; align-items: center; gap: 8px; margin-bottom: 8px; }
		.dp-chip-row input, .dp-task-top input { flex: 1; font-family: monospace; font-size: 13px; }
		.dp-chip-remove {
			cursor: pointer;
			color: var(--dp-text-muted);
			font-size: 18px;
			line-height: 1;
			padding: 0 4px;
		}
		.dp-chip-remove:hover { color: #dc2626; }

		.dp-task-card {
			border: 1px solid var(--dp-border);
			border-radius: 8px;
			padding: 10px 12px;
			margin-bottom: 10px;
			background: var(--dp-bg);
		}
		.dp-task-info { display: flex; align-items: center; gap: 8px; margin-top: 6px; font-size: 13px; }
		.dp-task-desc { margin-top: 6px; font-size: 12px; color: var(--dp-text-muted); }

		.dp-people-field label { display: block; font-size: 12px; font-weight: 600; margin-bottom: 6px; color: var(--dp-text-muted); }
		.dp-pills { display: flex; flex-wrap: wrap; gap: 6px; margin-bottom: 6px; }
		.dp-pill-user { background: var(--dp-accent-soft); color: var(--dp-accent); }
		.dp-pill-remove { cursor: pointer; margin-left: 4px; }
		.dp-people-input-wrap { position: relative; }
		.dp-suggest {
			position: absolute;
			z-index: 20;
			top: 100%;
			left: 0;
			right: 0;
			background: var(--dp-card-bg);
			border: 1px solid var(--dp-border);
			border-radius: 6px;
			box-shadow: 0 4px 16px rgba(0, 0, 0, 0.12);
			max-height: 200px;
			overflow-y: auto;
		}
		.dp-suggest-item { padding: 8px 12px; cursor: pointer; font-size: 13px; }
		.dp-suggest-item:hover { background: var(--dp-accent-soft); }

		.dp-savebar {
			position: sticky;
			bottom: 0;
			background: var(--dp-bg);
			padding: 14px 0;
			border-top: 1px solid var(--dp-border);
			display: flex;
			gap: 10px;
			margin-top: 8px;
		}
	`;
	document.head.appendChild(style);
}
