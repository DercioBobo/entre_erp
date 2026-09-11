import frappe
from frappe import _
from frappe.model.document import Document


class DeploymentPlan(Document):
	def validate(self):
		self._validate_outage_details()
		self._validate_git_references()

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
