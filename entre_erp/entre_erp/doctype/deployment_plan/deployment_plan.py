import html

import frappe
from frappe import _
from frappe.model.document import Document


class DeploymentPlan(Document):
	def validate(self):
		self._sync_description_from_clickup_tasks()
		self._validate_outage_details()
		self._validate_git_references()
		self._validate_people_have_tech_role()
		self._validate_approver_has_tech_lead_role()
		self._validate_clickup_tasks()
		self._validate_outcome_matches_workflow_state()

	def on_update(self):
		self._sync_clickup_status_on_done()

	def on_update_after_submit(self):
		# Approved -> Done (and -> Rolled Back) update an already-submitted
		# doc (docstatus stays 1) — Frappe routes that through this hook,
		# not on_update, since only allow_on_submit fields are changing.
		self._sync_clickup_status_on_done()

	# ------------------------------------------------------------------
	# Private
	# ------------------------------------------------------------------

	def _sync_description_from_clickup_tasks(self):
		"""Server-side mirror of the client's silent auto-fill (see
		deployment_plan.js) — a safety net for saves that don't go through
		that form (API, Data Import, bench console), so Description can't go
		stale just because nobody clicked "Generate Description" again."""
		fresh_html = self._build_clickup_description_html()
		if not fresh_html:
			return

		untouched = not self.description or self.description == self.clickup_description_snapshot
		if untouched:
			self.description = fresh_html
			self.clickup_description_snapshot = fresh_html

	def _build_clickup_description_html(self):
		fetched = [row for row in (self.get("clickup_tasks") or []) if row.task_name]
		if not fetched:
			return None

		parts = []
		for row in fetched:
			heading = f"<h4>{html.escape(row.task_name)}</h4>"
			body = f"<p>{html.escape(row.task_description).replace(chr(10), '<br>')}</p>" if row.task_description else ""
			parts.append(heading + body)
		return "<hr>".join(parts)

	def _validate_outage_details(self):
		if self.causes_service_outage and not self.outage_details:
			frappe.throw(
				_("Please describe the expected outage in {0}.").format(frappe.bold("Outage Details")),
				title=_("Outage Details Required"),
			)

	def _validate_git_references(self):
		if not self.git_references:
			frappe.throw(
				_("Add at least one Git reference for this deployment."),
				title=_("Git Reference Required"),
			)

	def _validate_people_have_tech_role(self):
		for fieldname in ("implemented_by", "standby", "people_involved"):
			for row in self.get(fieldname) or []:
				if "Tech" not in frappe.get_roles(row.user):
					frappe.throw(
						_("{0} does not have the {1} role required for {2}.").format(
							frappe.bold(row.user),
							frappe.bold("Tech"),
							frappe.bold(self.meta.get_field(fieldname).label),
						),
						title=_("Invalid User"),
					)

	def _validate_approver_has_tech_lead_role(self):
		if self.approver and "Tech Lead" not in frappe.get_roles(self.approver):
			frappe.throw(
				_("{0} does not have the {1} role required to be the Approver.").format(
					frappe.bold(self.approver), frappe.bold("Tech Lead")
				),
				title=_("Invalid Approver"),
			)

	def _validate_clickup_tasks(self):
		for row in self.get("clickup_tasks") or []:
			if row.task_ref and not row.task_id:
				frappe.throw(
					_("Row {0}: {1} was not fetched from ClickUp. Fix or clear the reference before saving.").format(
						row.idx, frappe.bold(row.task_ref)
					),
					title=_("ClickUp Task Not Verified"),
				)

	def _validate_outcome_matches_workflow_state(self):
		"""Outcome becomes mandatory once execution is over (see
		mandatory_depends_on on the field itself); this just blocks a
		contradictory pairing once one is chosen — e.g. Done + Failed."""
		if not self.outcome:
			return

		positive = self.outcome in ("Success", "Success with Issues")
		negative = self.outcome in ("Rolled Back", "Failed")

		if self.workflow_state == "Done" and negative:
			frappe.throw(
				_("Outcome {0} doesn't match a {1} deployment. Use Roll Back instead, or change the Outcome.").format(
					frappe.bold(self.outcome), frappe.bold("Done")
				),
				title=_("Outcome Doesn't Match Status"),
			)

		if self.workflow_state == "Rolled Back" and positive:
			frappe.throw(
				_("Outcome {0} doesn't match a {1} deployment. Use Mark as Done instead, or change the Outcome.").format(
					frappe.bold(self.outcome), frappe.bold("Rolled Back")
				),
				title=_("Outcome Doesn't Match Status"),
			)

	def _sync_clickup_status_on_done(self):
		"""Push the ClickUp status update exactly once, on the transition
		into Done — not on every later save while already Done (e.g. adding
		Outcome Notes afterward)."""
		if self.workflow_state != "Done" or self.clickup_synced_on_done:
			return

		from entre_erp.integrations.clickup import sync_tasks_to_done

		sync_tasks_to_done(self)
		self.db_set("clickup_synced_on_done", 1, update_modified=False)
