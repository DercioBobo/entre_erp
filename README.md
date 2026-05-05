# Entre ERP

A custom Frappe v15 / ERPNext v15 app that adds a modern customer support portal on top of the standard Issue doctype.

Customers get a clean, branded web portal to open tickets, track progress, and reply — without any access to the ERPNext desk.

---

## Features

- **Modern support portal** at `/support` — ticket list, detail view with conversation timeline, new ticket form
- **Dynamic user ↔ customer mapping** — `Customer Portal User` records automatically assign/revoke the `Portal Customer` role; no manual User Permissions needed
- **Portal field configuration** — choose which Issue fields are visible in the portal and which are editable on the new-ticket form, with a one-click field importer
- **Desk unaffected** — Customer Support and System Manager users continue using `/app/issue` as normal

---

## Requirements

| Dependency | Version |
|---|---|
| Frappe | v15 |
| ERPNext | v15 |
| Python | 3.11+ |
| Node.js | 18+ |

---

## Production Installation

### 1 — Get the app

```bash
cd /path/to/your/bench
bench get-app https://github.com/your-org/entre_erp
```

### 2 — Install on your site

```bash
bench --site your-site.com install-app entre_erp
```

### 3 — Run migrations (creates DocTypes and imports fixtures)

```bash
bench --site your-site.com migrate
```

### 4 — Build the frontend

```bash
cd apps/entre_erp/frontend
npm install
npm run build
```

The compiled assets are written to `entre_erp/public/support/` and served by Frappe at `/assets/entre_erp/support/`.

> **Tip:** Commit the built assets (`entre_erp/public/support/`) to your fork so future deployments skip the build step.

---

## First-time Setup

### Create a Customer Portal User mapping

1. Log into the desk as **System Manager**
2. Search for **Customer Portal User** → click **New**
3. Set **Customer** to the ERPNext customer record
4. Set **Portal User** to the user's account (must be a Website User, not a System User)
5. Ensure **Enabled** is checked → **Save**

The `Portal Customer` role is automatically assigned to the user. They can now access `/support`.

### Configure portal fields *(optional)*

1. Search for **Issue Portal Field Config** in the desk
2. Click **Fetch Issue Fields** — all Issue fields are imported into the table
3. Toggle **Visible** (shows in ticket detail) and **Editable on New** (shows in the new-ticket form) for each field
4. **Save**

---

## Portal Access

| User type | Redirect on visiting `/support` |
|---|---|
| Not logged in | `/login?redirect-to=/support` |
| System User (desk) | `/app/issue` |
| Portal Customer (mapped) | Portal home |
| Website User (no mapping) | 403 error |

---

## Development Workflow

Start your Frappe bench in one terminal, then in another:

```bash
cd apps/entre_erp/frontend
npm install
npm run dev          # Vite dev server at http://localhost:5173
                     # API calls proxy to http://localhost:8000
```

Visit `http://localhost:5173` in your browser (logged into Frappe on port 8000 first).

After making frontend changes for production:

```bash
npm run build
bench --site your-site.com clear-cache
```

---

## Uninstall

```bash
bench --site your-site.com uninstall-app entre_erp
bench --site your-site.com migrate
```

---

## Roadmap

| Phase | Status |
|---|---|
| App scaffold + Customer Portal User + dynamic Issue permissions | ✅ Done |
| Vue 3 portal — ticket list, detail, new ticket, conversation timeline | ✅ Done |
| Issue Portal Field Config — dynamic visible/editable field control | ✅ Done |
| Email notifications, SLA indicator, portal branding settings | Planned |
