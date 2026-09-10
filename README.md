# Entre ERP

A custom Frappe v15 / ERPNext v15 app for Entre-specific DocTypes, reports, and workflow enhancements.

---

## Requirements

| Dependency | Version |
|---|---|
| Frappe | v15 |
| ERPNext | v15 |
| Python | 3.11+ |

---

## Installation

```bash
cd /path/to/your/bench
bench get-app https://github.com/your-org/entre_erp
bench --site your-site.com install-app entre_erp
bench --site your-site.com migrate
```

---

## Uninstall

```bash
bench --site your-site.com uninstall-app entre_erp
bench --site your-site.com migrate
```

---

## Roadmap

| Item | Status |
|---|---|
| App scaffold | ✅ Done |
| Job Order DocType | 🚧 Next |
