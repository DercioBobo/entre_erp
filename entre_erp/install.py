import frappe


def after_install():
    create_tech_lead_role()


def create_tech_lead_role():
    """Create the Tech Lead role if it doesn't already exist.

    Tech Lead approves Deployment Plans (see the Deployment Plan Workflow
    and the doctype's permissions). Safe to call again — e.g. via
    `bench --site your-site.com execute entre_erp.install.create_tech_lead_role`
    to backfill on a site where the app was installed before this existed.
    """
    if frappe.db.exists("Role", "Tech Lead"):
        return

    role = frappe.get_doc(
        {
            "doctype": "Role",
            "role_name": "Tech Lead",
            "desk_access": 1,
        }
    )
    role.insert(ignore_permissions=True)
