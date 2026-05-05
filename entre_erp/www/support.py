import frappe
from frappe import _


def get_context(context):
    # Not authenticated — send to login and come back
    if frappe.session.user == "Guest":
        frappe.local.flags.redirect_location = "/login?redirect-to=/support"
        raise frappe.Redirect

    # Desk / System users belong on /app, not the portal
    if frappe.db.get_value("User", frappe.session.user, "user_type") == "System User":
        frappe.local.flags.redirect_location = "/app/issue"
        raise frappe.Redirect

    from entre_erp.permissions import get_customer_for_user

    customer = get_customer_for_user(frappe.session.user)
    if not customer:
        frappe.throw(
            _("You don't have portal access. Please contact your administrator."),
            frappe.PermissionError,
        )

    context.no_cache = 1

    context.customer = customer
    context.customer_label = (
        frappe.db.get_value("Customer", customer, "customer_name") or customer
    )
    context.user = frappe.session.user
    context.user_fullname = frappe.utils.get_fullname(frappe.session.user)
