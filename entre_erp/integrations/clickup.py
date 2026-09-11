import re

import frappe
import requests
from frappe import _
from frappe.utils.password import get_decrypted_password

CLICKUP_API_BASE = "https://api.clickup.com/api/v2"
TASK_URL_PATTERN = re.compile(r"clickup\.com/t/([a-zA-Z0-9-]+)")
TASK_ID_PATTERN = re.compile(r"^[A-Za-z0-9-]+$")


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

	if not TASK_ID_PATTERN.match(task_ref):
		frappe.throw(
			_("{0} doesn't look like a ClickUp task link or ID. Paste the full link, or pick a result from the search suggestions.").format(
				frappe.bold(task_ref)
			),
			title=_("Not a ClickUp Task"),
		)

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
	name = data.get("name")
	status = (data.get("status") or {}).get("status")
	validate_task_status(name, status)

	return {
		"task_id": data.get("id"),
		"name": name,
		"status": status,
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


@frappe.whitelist()
def search_tasks(txt):
	"""Approximate 'search by title' — ClickUp's v2 API has no full-text task
	search endpoint, so this fetches open tasks (optionally scoped to the
	configured Lists) and filters by name here. Returns at most 20 matches:
	[{task_id, name, status}], for a caller to render as suggestions and,
	once one is picked, resolve fully via get_task().
	"""
	txt = (txt or "").strip()
	if not txt:
		return []

	team_id = frappe.db.get_single_value("ClickUp Settings", "team_id")
	if not team_id:
		frappe.throw(
			_("Set a Team ID in {0} to search ClickUp tasks by title.").format(frappe.bold(_("ClickUp Settings"))),
			title=_("ClickUp Not Configured"),
		)

	token = get_api_token()
	params = [("page", 0)]
	for list_id in get_search_list_ids():
		params.append(("list_ids[]", list_id))

	response = requests.get(
		f"{CLICKUP_API_BASE}/team/{team_id}/task",
		headers={"Authorization": token},
		params=params,
		timeout=15,
	)
	if not response.ok:
		frappe.throw(_("ClickUp API error ({0}): {1}").format(response.status_code, response.text[:200]))

	txt_lower = txt.lower()
	matches = [
		task for task in response.json().get("tasks", []) if txt_lower in (task.get("name") or "").lower()
	]

	return [
		{
			"task_id": task.get("id"),
			"name": task.get("name"),
			"status": (task.get("status") or {}).get("status"),
		}
		for task in matches[:20]
	]


def get_search_list_ids():
	raw = frappe.db.get_single_value("ClickUp Settings", "search_list_ids") or ""
	return [line.strip() for line in raw.splitlines() if line.strip()]


def get_allowed_statuses():
	raw = frappe.db.get_single_value("ClickUp Settings", "allowed_statuses") or ""
	return [line.strip().lower() for line in raw.splitlines() if line.strip()]


def validate_task_status(task_name, status):
	"""Block fetching a task whose ClickUp status isn't on the configured
	allowlist. No allowlist configured = any status is fine."""
	allowed = get_allowed_statuses()
	if not allowed:
		return

	if (status or "").strip().lower() not in allowed:
		frappe.throw(
			_("{0} is in status {1}, which isn't allowed here. Allowed statuses: {2}.").format(
				frappe.bold(task_name), frappe.bold(status or _("(none)")), ", ".join(allowed)
			),
			title=_("ClickUp Status Not Allowed"),
		)


def update_task_status(task_id, status):
	"""Push a new status to a ClickUp task. Raises on failure — callers that
	want to sync several tasks without one failure blocking the rest should
	catch per task (see sync_tasks_to_done)."""
	token = get_api_token()
	response = requests.put(
		f"{CLICKUP_API_BASE}/task/{task_id}",
		headers={"Authorization": token, "Content-Type": "application/json"},
		json={"status": status},
		timeout=10,
	)
	if not response.ok:
		raise frappe.ValidationError(f"ClickUp API error ({response.status_code}): {response.text[:200]}")


def sync_tasks_to_done(doc):
	"""Push the configured 'Status to Set on Done' to every linked ClickUp
	task. Best-effort per task: one failure (e.g. that status doesn't exist
	on a particular task's List) is reported, not raised — it must never
	block the Deployment Plan itself from being marked Done."""
	done_status = frappe.db.get_single_value("ClickUp Settings", "done_status")
	if not done_status:
		return

	rows_with_id = [row for row in (doc.clickup_tasks or []) if row.task_id]
	if not rows_with_id:
		return

	failed = []
	for row in rows_with_id:
		try:
			update_task_status(row.task_id, done_status)
			row.db_set("task_status", done_status, update_modified=False)
		except Exception as e:
			frappe.log_error(title="ClickUp status sync failed", message=frappe.get_traceback())
			failed.append(f"{row.task_name or row.task_id} — {e}")

	if failed:
		frappe.msgprint(
			"<br>".join(frappe.utils.escape_html(line) for line in failed),
			title=_("Could Not Update ClickUp Status"),
			indicator="orange",
		)
