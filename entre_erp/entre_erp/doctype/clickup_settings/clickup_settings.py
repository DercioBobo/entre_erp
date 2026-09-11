import frappe
import requests
from frappe import _
from frappe.model.document import Document


class ClickUpSettings(Document):
	def validate(self):
		self._verify_token()

	def _verify_token(self):
		if not self.api_token or self.api_token.startswith("*"):
			# Unchanged (masked) value coming back from the form — nothing to verify.
			return

		response = requests.get(
			"https://api.clickup.com/api/v2/user",
			headers={"Authorization": self.api_token},
			timeout=10,
		)
		if not response.ok:
			frappe.throw(
				_("Could not verify this ClickUp API Token (HTTP {0}). Check it and try again.").format(
					response.status_code
				),
				title=_("Invalid ClickUp Token"),
			)
