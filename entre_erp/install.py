import frappe


def after_install():
    create_tech_lead_role()
    create_tech_role()


def create_tech_lead_role():
    """Tech Lead approves Deployment Plans (see the Deployment Plan Workflow
    and the doctype's permissions)."""
    _create_role_if_missing("Tech Lead")


def create_tech_role():
    """Tech gates who can appear in a Deployment Plan's Implemented By,
    Standby and People Involved fields."""
    _create_role_if_missing("Tech")


def _create_role_if_missing(role_name):
    """Safe to call again — e.g. via
    `bench --site your-site.com execute entre_erp.install.create_tech_role`
    (or `...create_tech_lead_role`) to backfill on a site where the app
    was installed before these roles existed.
    """
    if frappe.db.exists("Role", role_name):
        return

    frappe.get_doc(
        {
            "doctype": "Role",
            "role_name": role_name,
            "desk_access": 1,
        }
    ).insert(ignore_permissions=True)
