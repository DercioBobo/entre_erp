import frappe
from frappe import _
from frappe.model.document import Document


class DeploymentPlan(Document):
	def validate(self):
		self._validate_outage_details()
		self._validate_git_references()
		self._validate_people_have_tech_role()
		self._validate_approver_has_tech_lead_role()
		self._validate_clickup_task()

	# ------------------------------------------------------------------
	# Private
	# ------------------------------------------------------------------

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

	def _validate_clickup_task(self):
		if self.clickup_task_ref and not self.clickup_task_id:
			frappe.throw(
				_("Click {0} to validate the ClickUp task before saving.").format(
					frappe.bold(_("Fetch from ClickUp"))
				),
				title=_("ClickUp Task Not Verified"),
			)
