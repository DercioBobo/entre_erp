import frappe


# ---------------------------------------------------------------------------
# Public helpers
# ---------------------------------------------------------------------------

def get_customer_for_user(user: str) -> str | None:
    """Return the Customer name linked to a portal user, or None."""
    return frappe.db.get_value(
        "Customer Portal User",
        {"user": user, "enabled": 1},
        "customer",
    )


def is_desk_user(user: str) -> bool:
    return frappe.db.get_value("User", user, "user_type") == "System User"


# ---------------------------------------------------------------------------
# Issue permission hooks
# ---------------------------------------------------------------------------

def get_issue_permission_query_conditions(user: str = None) -> str:
    """
    Appended as a WHERE clause to every Issue list query.
    - Administrator / desk users  →  no restriction
    - Portal Customer             →  only their customer's issues
    - Anyone else with no mapping →  sees nothing (1=0 guard)
    """
    if not user:
        user = frappe.session.user

    if user == "Administrator" or is_desk_user(user):
        return ""

    customer = get_customer_for_user(user)
    if not customer:
        return "1=0"

    return f"`tabIssue`.`customer` = {frappe.db.escape(customer)}"


def has_issue_permission(doc, ptype: str = "read", user: str = None) -> bool | None:
    """
    Called when a user opens a specific Issue document.
    Returns True/False for portal users; None falls through to standard checks.
    """
    if not user:
        user = frappe.session.user

    if user == "Administrator" or is_desk_user(user):
        return None  # let standard role-based check decide

    customer = get_customer_for_user(user)
    if not customer:
        return False

    return doc.get("customer") == customer
