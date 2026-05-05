app_name = "entre_erp"
app_title = "Entre ERP"
app_publisher = "Dércio Bobo"
app_description = "Custom ERPNext enhancements with modern customer portal"
app_email = "derciobob@gmail.com"
app_license = "MIT"
app_version = "0.0.1"

required_apps = ["erpnext"]

# ---------------------------------------------------------------------------
# Assets
# ---------------------------------------------------------------------------
app_include_css = []
app_include_js = []
web_include_css = []
web_include_js = []

# ---------------------------------------------------------------------------
# Fixtures — exported/imported on bench migrate
# ---------------------------------------------------------------------------
fixtures = [
    {"dt": "Role", "filters": [["name", "in", ["Portal Customer"]]]},
]

# ---------------------------------------------------------------------------
# Permission hooks — dynamic Issue filtering per portal user
# ---------------------------------------------------------------------------
permission_query_conditions = {
    "Issue": "entre_erp.permissions.get_issue_permission_query_conditions",
}

has_permission = {
    "Issue": "entre_erp.permissions.has_issue_permission",
}

# ---------------------------------------------------------------------------
# Doc events
# ---------------------------------------------------------------------------
doc_events = {}

# ---------------------------------------------------------------------------
# Scheduled tasks
# ---------------------------------------------------------------------------
scheduler_events = {}
