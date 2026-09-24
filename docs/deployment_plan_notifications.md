# Deployment Plan — Notification Texts

Draft copy for the other app's WhatsApp + email notifications, keyed to the
`Deployment Plan Workflow` states/transitions (`Draft → Pending Approval →
Approved → Done / Rolled Back`, plus `Rejected` and `Cancelled`).

Not implemented in this repo — this is just the text/templates for the other
app to send. Written as Frappe Jinja, assuming these are wired up as
`Notification` documents (or Server Script email alerts) where `doc` is the
Deployment Plan in context. If the other app isn't Frappe, treat `doc.x` as
"the `x` field on the Deployment Plan" and adapt to whatever templating it uses.

## Variables used below

| Variable | Source field | Notes |
|---|---|---|
| `{{ doc.title }}` | `title` | |
| `{{ doc.application }}` | `application` | |
| `{{ doc.implementation_datetime }}` | `implementation_datetime` | raw value is UTC; use `frappe.utils.format_datetime(doc.implementation_datetime)` to render in site timezone |
| `{{ doc.duration }}` | `duration` | |
| `{{ frappe.db.get_value("User", doc.approver, "full_name") }}` | `approver` | `doc.approver` alone is the user ID/email; resolve to a display name |
| `{{ doc.implemented_by | map(attribute='user') | join(', ') }}` | `implemented_by` | it's a child table (`Deployment Plan User` rows), not a plain value — needs `map`/`join` |
| `{{ doc.standby | map(attribute='user') | join(', ') }}` | `standby` | same — **not** `{{ doc.standby }}`, that would print the row objects |
| `{{ doc.people_involved | map(attribute='user') | join(', ') }}` | `people_involved` | same |
| `{{ doc.causes_service_outage }}` / `{{ doc.outage_details }}` | `causes_service_outage`, `outage_details` | only relevant when `causes_service_outage` is truthy |
| `{{ doc.rollback_plan }}` | `rollback_plan` | |
| `{{ doc.outcome }}` / `{{ doc.outcome_notes }}` | `outcome`, `outcome_notes` | set on Done / Rolled Back |
| `{{ frappe.session.user }}` | — | who's performing the workflow action right now (Approve/Reject/etc); use this inside the Server Script/hook that fires the notification, not from `doc` itself — nothing on the doc records "who just clicked the button" |
| `{{ doc.get_url() }}` | — | absolute desk URL to this Deployment Plan |

Where a template says "list the recipients", that's who the other app should
send it to — not part of the text itself. For `implemented_by` / `standby` /
`people_involved`, that means resolving each row's `.user` to an email/phone,
not just rendering the joined string above.

---

## 1. Submitted for Approval (`Draft → Pending Approval`)

Recipients: `doc.approver`

**WhatsApp**
```
🚀 *Deployment Approval Needed*
*{{ doc.title }}* ({{ doc.application }})
Requested by {{ frappe.session.user }}

🗓️ {{ frappe.utils.format_datetime(doc.implementation_datetime) }} · ⏱️ {{ doc.duration }}

Please review and approve: {{ doc.get_url() }}
```

**Email**
- Subject: `[Action Needed] Approve deployment: {{ doc.title }} ({{ doc.application }})`
- Body:
```
Hi {{ frappe.db.get_value("User", doc.approver, "full_name") }},

{{ frappe.session.user }} submitted a deployment plan that needs your approval.

Title:            {{ doc.title }}
Application:      {{ doc.application }}
Scheduled for:     {{ frappe.utils.format_datetime(doc.implementation_datetime) }} ({{ doc.duration }})

Review and approve/reject here: {{ doc.get_url() }}

— Entre ERP
```

---

## 2. Approved (`Pending Approval → Approved`)

Recipients: `doc.implemented_by`, `doc.standby`, `doc.people_involved`

**WhatsApp**
```
✅ *Deployment Approved*
*{{ doc.title }}* ({{ doc.application }})
Approved by {{ frappe.session.user }}

🗓️ {{ frappe.utils.format_datetime(doc.implementation_datetime) }} · ⏱️ {{ doc.duration }}

Details: {{ doc.get_url() }}
```

**Email**
- Subject: `Deployment approved: {{ doc.title }} ({{ doc.application }})`
- Body:
```
Hi team,

{{ doc.title }} for {{ doc.application }} has been approved by
{{ frappe.db.get_value("User", doc.approver, "full_name") }} and is
scheduled to go ahead.

Scheduled for:  {{ frappe.utils.format_datetime(doc.implementation_datetime) }} ({{ doc.duration }})
Implemented by: {{ doc.implemented_by | map(attribute='user') | join(', ') }}
Standby:        {{ doc.standby | map(attribute='user') | join(', ') }}

Full plan: {{ doc.get_url() }}

— Entre ERP
```

---

## 3. Rejected (`Pending Approval → Rejected`)

Recipients: `doc.owner`, `doc.implemented_by`

**WhatsApp**
```
❌ *Deployment Rejected*
*{{ doc.title }}* ({{ doc.application }})
Rejected by {{ frappe.session.user }}

Please review the comments and resubmit: {{ doc.get_url() }}
```

**Email**
- Subject: `Deployment rejected: {{ doc.title }} ({{ doc.application }})`
- Body:
```
Hi,

{{ frappe.db.get_value("User", doc.approver, "full_name") }} rejected the
deployment plan below. Please review, make the needed changes, and
resubmit for approval.

Title:       {{ doc.title }}
Application: {{ doc.application }}

Open it here: {{ doc.get_url() }}

— Entre ERP
```

---

## 4. Reminder — upcoming deployment window

Recipients: `doc.implemented_by`, `doc.standby`, `doc.people_involved`
(send this X minutes/hours before `implementation_datetime`, e.g. 30–60 min out)

**WhatsApp**
```
⏰ *Deployment starting soon*
*{{ doc.title }}* ({{ doc.application }})
Starts at {{ frappe.utils.format_datetime(doc.implementation_datetime) }} (~{{ doc.duration }})

Implementers: {{ doc.implemented_by | map(attribute='user') | join(', ') }}
Standby: {{ doc.standby | map(attribute='user') | join(', ') }}

Plan: {{ doc.get_url() }}
```

**Email**
- Subject: `Reminder: {{ doc.title }} deployment starts at {{ frappe.utils.format_datetime(doc.implementation_datetime) }}`
- Body:
```
Hi team,

This is a reminder that the deployment below is starting soon.

Title:          {{ doc.title }}
Application:    {{ doc.application }}
Starts at:      {{ frappe.utils.format_datetime(doc.implementation_datetime) }}
Duration:       {{ doc.duration }}
Implemented by: {{ doc.implemented_by | map(attribute='user') | join(', ') }}
Standby:        {{ doc.standby | map(attribute='user') | join(', ') }}

Full plan: {{ doc.get_url() }}

— Entre ERP
```

---

## 5. Service outage warning

Recipients: broader distribution list (e.g. all internal users / affected teams)
Send only when `doc.causes_service_outage` is checked — send alongside #2
(Approved) or #4 (Reminder), not as its own workflow transition.

**WhatsApp**
```
⚠️ *Planned Service Outage*
*{{ doc.application }}* will be affected during a deployment.

🗓️ {{ frappe.utils.format_datetime(doc.implementation_datetime) }} · ⏱️ {{ doc.duration }}
Impact: {{ doc.outage_details }}

Details: {{ doc.get_url() }}
```

**Email**
- Subject: `[Planned Outage] {{ doc.application }} — {{ frappe.utils.format_datetime(doc.implementation_datetime) }}`
- Body:
```
Hi all,

A planned deployment will cause a service outage.

Application:  {{ doc.application }}
When:         {{ frappe.utils.format_datetime(doc.implementation_datetime) }} ({{ doc.duration }})
Expected impact:
{{ doc.outage_details }}

Deployment plan: {{ doc.get_url() }}

— Entre ERP
```

---

## 6. Marked as Done (`Approved → Done`)

Recipients: `doc.approver`, `doc.implemented_by`, `doc.standby`, `doc.people_involved`

**WhatsApp — Success**
```
🎉 *Deployment Completed*
*{{ doc.title }}* ({{ doc.application }})
Outcome: {{ doc.outcome }}

{{ doc.outcome_notes }}

Details: {{ doc.get_url() }}
```

**WhatsApp — Success with Issues**
```
⚠️ *Deployment Completed (with issues)*
*{{ doc.title }}* ({{ doc.application }})
Outcome: {{ doc.outcome }}

Notes: {{ doc.outcome_notes }}

Details: {{ doc.get_url() }}
```

**Email**
- Subject: `Deployment completed: {{ doc.title }} ({{ doc.application }}) — {{ doc.outcome }}`
- Body:
```
Hi team,

The deployment below has been completed.

Title:       {{ doc.title }}
Application: {{ doc.application }}
Outcome:     {{ doc.outcome }}
Notes:       {{ doc.outcome_notes }}

Full plan: {{ doc.get_url() }}

— Entre ERP
```

---

## 7. Rolled Back (`Approved → Rolled Back`)

Recipients: `doc.approver`, `doc.implemented_by`, `doc.standby`, `doc.people_involved`

**WhatsApp**
```
🔄 *Deployment Rolled Back*
*{{ doc.title }}* ({{ doc.application }})
Outcome: {{ doc.outcome }}

Reason: {{ doc.outcome_notes }}
Rollback plan followed: {{ doc.rollback_plan }}

Details: {{ doc.get_url() }}
```

**Email**
- Subject: `Deployment rolled back: {{ doc.title }} ({{ doc.application }})`
- Body:
```
Hi team,

{{ doc.title }} for {{ doc.application }} was rolled back.

Outcome:       {{ doc.outcome }}
Notes:         {{ doc.outcome_notes }}
Rollback plan: {{ doc.rollback_plan }}

Full plan: {{ doc.get_url() }}

— Entre ERP
```

---

## 8. Cancelled (`Draft → Cancelled`)

Recipients: `doc.implemented_by`, `doc.approver` (if already assigned)

**WhatsApp**
```
🚫 *Deployment Cancelled*
*{{ doc.title }}* ({{ doc.application }})
Cancelled by {{ frappe.session.user }}

Details: {{ doc.get_url() }}
```

**Email**
- Subject: `Deployment cancelled: {{ doc.title }} ({{ doc.application }})`
- Body:
```
Hi,

{{ frappe.session.user }} cancelled the deployment plan below before it went ahead.

Title:       {{ doc.title }}
Application: {{ doc.application }}

Full plan: {{ doc.get_url() }}

— Entre ERP
```

---

## Formatting notes

- **WhatsApp**: `*text*` = bold, `_text_` = italic, no HTML. Keep it to
  4–6 lines; put anything longer (outage details, outcome notes) in the
  linked doc, not the message.
- **Email**: bodies above are plain-text-friendly; if the other app sends
  HTML email, wrap labels in `<strong>` and drop the linked plan in as a
  proper `<a href="{{ doc.get_url() }}">`. The plan's own `description`
  field (built from ClickUp tasks) is already HTML and safe to embed as-is
  if you want the full "what's being implemented" writeup in the email body.
- **Child-table fields** (`implemented_by`, `standby`, `people_involved`):
  never reference these bare (`{{ doc.standby }}`) — that renders the raw
  list of row objects. Always go through `map(attribute='user') | join(', ')`
  as shown above, and remember `.user` is a User ID/email, not a display
  name — wrap individual entries in `frappe.db.get_value("User", u,
  "full_name")` if you want names instead of emails in the text.
