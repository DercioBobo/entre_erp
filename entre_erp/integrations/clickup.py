import re

import frappe
import requests
from frappe import _
from frappe.utils.password import get_decrypted_password

CLICKUP_API_BASE = "https://api.clickup.com/api/v2"
TASK_URL_PATTERN = re.compile(r"clickup\.com/t/([a-zA-Z0-9-]+)")


def get_api_token():
	token = get_decrypted_password(
		"ClickUp Settings", "ClickUp Settings", fieldname="api_token", raise_exception=False
	)
	if not token:
		frappe.throw(
			_("Set an API Token in {0} before linking ClickUp tasks.").format(frappe.bold(_("ClickUp Settings"))),
			title=_("ClickUp Not Configured"),
		)
	return token


def extract_task_id(task_ref):
	"""Pull a bare ClickUp task ID out of a pasted task URL, or return the
	input unchanged if it already looks like a bare ID."""
	task_ref = (task_ref or "").strip()
	if not task_ref:
		frappe.throw(_("Paste a ClickUp task link or ID."))

	match = TASK_URL_PATTERN.search(task_ref)
	if match:
		return match.group(1)

	if "/" in task_ref or " " in task_ref:
		frappe.throw(_("Could not find a task ID in {0}.").format(frappe.bold(task_ref)))

	return task_ref


@frappe.whitelist()
def get_task(task_ref):
	"""Fetch a single task from ClickUp by pasted link or bare ID.

	Returns {task_id, name, status, url} for the caller to cache on its own doc.
	"""
	task_id = extract_task_id(task_ref)
	token = get_api_token()

	response = requests.get(
		f"{CLICKUP_API_BASE}/task/{task_id}",
		headers={"Authorization": token},
		timeout=10,
	)

	if response.status_code == 404:
		frappe.throw(_("No ClickUp task found for {0}.").format(frappe.bold(task_id)))
	if not response.ok:
		frappe.throw(_("ClickUp API error ({0}): {1}").format(response.status_code, response.text[:200]))

	data = response.json()
	return {
		"task_id": data.get("id"),
		"name": data.get("name"),
		"status": (data.get("status") or {}).get("status"),
		"description": data.get("text_content"),
		"url": build_task_url(data.get("id"), data.get("url")),
	}


def build_task_url(task_id, fallback_url=None):
	"""Build a task's link from the configured prefix; fall back to whatever
	ClickUp's API itself reported if no prefix is configured."""
	prefix = frappe.db.get_single_value("ClickUp Settings", "task_url_prefix")
	if prefix:
		return f"{prefix}{task_id}"
	return fallback_url
