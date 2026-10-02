app_name = "entre_erp"
app_title = "Entre ERP"
app_publisher = "Dércio Bobo"
app_description = "Custom ERPNext enhancements"
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
    {
        "dt": "Workflow State",
        "filters": [
            [
                "name",
                "in",
                ["Draft", "Pending Approval", "Approved", "Done", "Rolled Back", "Rejected", "Cancelled"],
            ]
        ],
    },
    {"dt": "Workflow", "filters": [["name", "in", ["Deployment Plan Workflow"]]]},
]

# ---------------------------------------------------------------------------
# Install
# ---------------------------------------------------------------------------
after_install = "entre_erp.install.after_install"

# ---------------------------------------------------------------------------
# Doc events
# ---------------------------------------------------------------------------
doc_events = {
    "Purchase Invoice": {
        "on_cancel": "entre_erp.pagamentos.desligar_factura_cancelada",
    },
    "Sales Invoice": {
        "after_insert": "entre_erp.dominios.ao_guardar_factura",
        # Before Frappe's link check, so a domain's invoice can be deleted.
        "on_trash": "entre_erp.dominios.ao_apagar_factura",
        "on_cancel": "entre_erp.dominios.ao_apagar_factura",
    },
}

# ---------------------------------------------------------------------------
# Scheduled tasks
# ---------------------------------------------------------------------------
scheduler_events = {
    "monthly": ["entre_erp.pagamentos.criar_plano_do_mes"],
    "daily": ["entre_erp.dominios.tarefa_diaria"],
    "weekly_long": ["entre_erp.whois.actualizar_todos"],
}
