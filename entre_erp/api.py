import frappe
from frappe import _
from frappe.desk.search import validate_and_sanitize_search_inputs
from frappe.model.workflow import get_transitions
from frappe.utils import cint


@frappe.whitelist()
@validate_and_sanitize_search_inputs
def get_users_by_role(doctype, txt, searchfield, start, page_len, filters):
    """Link query for Deployment Plan's people fields — Users with a given role.

    `filters` must include {"role": "<Role Name>"} (e.g. "Tech", "Tech Lead").
    """
    role = filters.get("role") if filters else None
    if not role:
        frappe.throw(_("A role filter is required."))

    return frappe.db.sql(
        """
        select u.name, u.full_name
        from `tabUser` u
        inner join `tabHas Role` hr on hr.parent = u.name and hr.role = %(role)s
        where u.enabled = 1
            and u.name not in ('Administrator', 'Guest')
            and (u.name like %(txt)s or u.full_name like %(txt)s)
        order by u.full_name
        limit %(page_len)s offset %(start)s
        """,
        {
            "role": role,
            "txt": f"%{txt}%",
            "start": cint(start),
            "page_len": cint(page_len),
        },
    )


@frappe.whitelist()
def get_deployment_plan_transitions(name):
    """Workflow actions the current user may take on this Deployment Plan
    right now — used by the Deployment Plan Studio page to render action
    buttons instead of the desk's own workflow button."""
    doc = frappe.get_doc("Deployment Plan", name)
    doc.check_permission("read")
    return [
        {"action": t.action, "next_state": t.next_state}
        for t in get_transitions(doc)
    ]
