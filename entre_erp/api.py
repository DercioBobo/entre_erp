import frappe
from frappe import _


# ---------------------------------------------------------------------------
# Internal helpers
# ---------------------------------------------------------------------------

def _get_customer_or_raise() -> str:
    if frappe.session.user == "Guest":
        frappe.throw(_("Please log in to access the support portal."), frappe.AuthenticationError)

    from entre_erp.permissions import get_customer_for_user

    customer = get_customer_for_user(frappe.session.user)
    if not customer:
        frappe.throw(_("No portal access is configured for your account."), frappe.PermissionError)
    return customer


def _assert_issue_belongs_to_customer(issue_name: str, customer: str):
    owner = frappe.db.get_value("Issue", issue_name, "customer")
    if owner != customer:
        frappe.throw(_("Access denied."), frappe.PermissionError)


# ---------------------------------------------------------------------------
# API endpoints
# ---------------------------------------------------------------------------

@frappe.whitelist()
def get_portal_issues(page: int = 1, page_size: int = 20, status: str = None):
    customer = _get_customer_or_raise()

    filters = {"customer": customer}
    if status and status != "All":
        filters["status"] = status

    page = int(page)
    page_size = int(page_size)

    issues = frappe.get_list(
        "Issue",
        filters=filters,
        fields=["name", "subject", "status", "priority", "creation", "modified"],
        order_by="modified desc",
        page_length=page_size,
        start=(page - 1) * page_size,
    )

    total = frappe.db.count("Issue", filters)

    return {"issues": issues, "total": total, "page": page, "page_size": page_size}


@frappe.whitelist()
def get_portal_issue(issue_id: str):
    customer = _get_customer_or_raise()
    _assert_issue_belongs_to_customer(issue_id, customer)

    issue = frappe.get_doc("Issue", issue_id)

    communications = frappe.get_list(
        "Communication",
        filters={
            "reference_doctype": "Issue",
            "reference_name": issue_id,
            "communication_type": "Communication",
        },
        fields=[
            "name",
            "sender",
            "sender_full_name",
            "content",
            "creation",
            "sent_or_received",
        ],
        order_by="creation asc",
    )

    return {"issue": issue.as_dict(), "communications": communications}


@frappe.whitelist()
def create_portal_issue(subject: str, description: str, priority: str = "Medium"):
    customer = _get_customer_or_raise()

    if priority not in {"Low", "Medium", "High", "Urgent"}:
        frappe.throw(_("Invalid priority value."))

    issue = frappe.get_doc(
        {
            "doctype": "Issue",
            "subject": frappe.utils.strip_html(subject)[:140],
            "customer": customer,
            "priority": priority,
            "description": frappe.utils.sanitize_html(description),
            "status": "Open",
        }
    )
    issue.insert(ignore_permissions=True)
    frappe.db.commit()

    return {"issue_id": issue.name, "subject": issue.subject}


@frappe.whitelist()
def add_portal_reply(issue_id: str, content: str):
    customer = _get_customer_or_raise()
    _assert_issue_belongs_to_customer(issue_id, customer)

    safe_content = frappe.utils.sanitize_html(content)

    comm = frappe.get_doc(
        {
            "doctype": "Communication",
            "communication_type": "Communication",
            "communication_medium": "Website",
            "reference_doctype": "Issue",
            "reference_name": issue_id,
            "content": safe_content,
            "sender": frappe.session.user,
            "sender_full_name": frappe.utils.get_fullname(frappe.session.user),
            "sent_or_received": "Received",
            "status": "Linked",
        }
    )
    comm.insert(ignore_permissions=True)

    # Re-open if the issue was closed/resolved after a customer reply
    current_status = frappe.db.get_value("Issue", issue_id, "status")
    if current_status in ("Resolved", "Closed"):
        frappe.db.set_value("Issue", issue_id, "status", "Open")

    frappe.db.commit()

    return {
        "name": comm.name,
        "creation": str(comm.creation),
        "sender_full_name": comm.sender_full_name,
        "content": comm.content,
        "sent_or_received": comm.sent_or_received,
    }
