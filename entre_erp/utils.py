import frappe

_SKIP_FIELDTYPES = frozenset(
    {
        "Section Break",
        "Column Break",
        "Tab Break",
        "HTML",
        "Button",
        "Heading",
        "Image",
        "Attach Image",
        "Code",
        "Barcode",
        "Geolocation",
        "Signature",
    }
)

_SKIP_FIELDNAMES = frozenset(
    {
        "name",
        "owner",
        "creation",
        "modified",
        "modified_by",
        "docstatus",
        "idx",
        "amended_from",
        "naming_series",
    }
)


@frappe.whitelist()
def get_issue_fields_for_config():
    """
    Return all meaningful Issue fields suitable for portal configuration.
    Called by the 'Fetch Issue Fields' button on Issue Portal Field Config.
    """
    meta = frappe.get_meta("Issue")

    fields = []
    for df in meta.fields:
        if df.fieldtype in _SKIP_FIELDTYPES:
            continue
        if df.fieldname in _SKIP_FIELDNAMES:
            continue
        if df.hidden:
            continue

        fields.append(
            {
                "fieldname": df.fieldname,
                "label": df.label or df.fieldname.replace("_", " ").title(),
                "fieldtype": df.fieldtype,
                "options": df.options or "",
                "visible": 1,
                "editable": 0,
                "required": 0,
            }
        )

    return fields
