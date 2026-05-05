import frappe
from frappe import _
from frappe.model.document import Document


class CustomerPortalUser(Document):
    def validate(self):
        self._validate_unique_user()

    def on_update(self):
        if self.enabled:
            self._assign_portal_role()
        else:
            self._revoke_portal_role()

    def on_trash(self):
        self._revoke_portal_role()

    # ------------------------------------------------------------------
    # Private
    # ------------------------------------------------------------------

    def _validate_unique_user(self):
        duplicate = frappe.db.exists(
            "Customer Portal User",
            {"user": self.user, "name": ("!=", self.name)},
        )
        if duplicate:
            frappe.throw(
                _("User {0} is already mapped to another Customer Portal User record.").format(
                    frappe.bold(self.user)
                ),
                title=_("Duplicate Mapping"),
            )

    def _assign_portal_role(self):
        if frappe.db.exists("Has Role", {"parent": self.user, "role": "Portal Customer"}):
            return
        user_doc = frappe.get_doc("User", self.user)
        user_doc.append("roles", {"role": "Portal Customer"})
        user_doc.save(ignore_permissions=True)

    def _revoke_portal_role(self):
        role_entry = frappe.db.get_value(
            "Has Role",
            {"parent": self.user, "parenttype": "User", "role": "Portal Customer"},
            "name",
        )
        if not role_entry:
            return
        user_doc = frappe.get_doc("User", self.user)
        user_doc.roles = [r for r in user_doc.roles if r.role != "Portal Customer"]
        user_doc.save(ignore_permissions=True)
