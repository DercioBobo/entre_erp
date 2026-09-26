# Cashflow — Roadmap

Next steps for the **Plano de Pagamentos** module and the **Cashflow** page (`/app/cashflow`).

_Last updated: 2026-09-26_

---

## Already built

| Area | What it does |
|---|---|
| Doctypes | `Plano de Pagamentos` (one per month, plus `PI-<ano>` for Investimentos), `Linha do Plano de Pagamentos`, `Despesa Recorrente`, `Categoria de Despesa`, `Resumo por Metodo de Pagamento` |
| Cashflow page | Excel-like sheet with the tabs Resumo Anual · Jan–Dez · Investimentos · Recorrentes frozen at the bottom; cells save as you edit them; KPI cards and a payment-method strip at the top |
| Import | **Importar Excel** button: upload → preview each sheet (warnings, new / already exists) → choose what to import or replace. Also available as a `bench execute` command |
| Próximo Mês | The unpaid part moves automatically to next month's sheet (the month is created if needed); → / ← links jump between the two lines; undoing it removes the copy |
| Cancelado | Line stays on the sheet but counts 0 in the totals |
| Auto-close | The month switches to **Fechado** when every line is Pago, Cancelado or Próximo Mês |
| Month lock | A month can't be edited while the previous one still has lines to settle |
| Filters | Excel-style header filters (Estado, Prior., Método, Categoria), search, **Por pagar** toggle; **TOTAL (filtrado)** row |
| Bulk actions | Select rows → Marcar como Pago, Estado, Método, Categoria, Prior., Pago em…, Remover — all in a single save |
| Payment date | **Pago em** — today's date when a line becomes Pago (editable); column hidden by default, "-" when empty |
| Factura → ERPNext | Factura is a link to **Purchase Invoice**: search as you type, ↗ opens it, fills the supplier (and the amount if empty); invalid or cancelled numbers are kept in Observações |
| Caixa (petty cash) | 💰 **Caixa** tab: its own running balance; top-ups come automatically when the plan's Caixa line is paid (and leave if undone); the operator records each spend with date, category and amount; leftover carries over; card on the Painel. The plan's Caixa line **is** the month's top-up: edit it from the Caixa tab ("Reforço de …" box) or the plan; the line shows the Caixa balance (💰) and its side panel the month's Caixa summary; a Caixa line at **0** = no top-up and doesn't keep the month open |
| Line side panel | **›** on each row (or double-click the row number): all fields incl. Fornecedor / Ordem de Compra, live Purchase Invoice card, links (Próximo Mês, Caixa), change history; ↑ / ↓ to move between lines, Esc to close |
| Data pretendida | Date by which the operator wants the payment done; red when past and not settled; **Em atraso** toggle with count; in the side panel and as a bulk action; not carried to the next month |
| Hide columns | **Colunas ▾** menu to show / hide any column except Descrição; remembered per browser |
| Monthly job | On the 1st, the month's plan is created with the recurring bills and the Próximo Mês lines |
| Painel Financeiro | Manager page (`/app/painel-financeiro`): money in from ERPNext (invoices / payments received) against money out from the plans; cards, chart, month-by-month table with running balance, spending by category, top clients to receive; clicking a month opens it in Cashflow |

---

## 1. Before adding more (recommended first)

> Nothing has run on the server yet and nothing is committed. Several features depend on each other (moving lines, lock, auto-close, bulk actions), so each new feature makes an untested bug harder to find.

- [ ] **Commit** everything on a `feature/cashflow` branch
- [ ] **Automated tests** for the rules that decide money — run with `bench run-tests --app entre_erp`:
  - [ ] Totals (Previsto / Pago / Remanescente, per payment method)
  - [ ] Moving Próximo Mês lines (create, sync, undo, refusal when already paid)
  - [ ] Month lock and auto-close (including reopening a month)
  - [ ] Payment date (becomes Pago, goes back, imported lines)
  - [ ] Bulk actions
- [ ] **Try it on the server** (`bench migrate`, `bench build`, import `cashflow.xlsx`) and fix what shows up

---

## 2. Make it a real cashflow (biggest value)

- [x] **Painel Financeiro** (`/app/painel-financeiro`, managers only) — Entradas previstas (Sales Invoices) and reais (payments received) from ERPNext against the Saídas from the plans; balance per month, running balance, spending by category, clients with the most to receive
- [ ] **Bank balances** — the balance of STB / BIM / BIM C at the start of the month
- [ ] **What's left per bank** — balance + money in − bills
- [ ] **Warning** when a bank can't cover its pending bills (e.g. "STB não chega para os pagamentos pendentes")
- [ ] **Forecast** for the rest of the year in the Resumo Anual, projected from the recurring bills

---

## 3. Quick wins

- [ ] **Proof of payment** — a 📎 on each row to attach the bank receipt (PDF / photo)
- [ ] **Smarter amounts** — a new month starts variable bills (IVA, AWS, INSS…) at **last month's actual amount** instead of the fixed default
- [x] **Clean-up** — remove the manual "Transportar" button (moving is automatic now)
- [ ] **Clean-up** — drop the unused `data_vencimento` and `pago_por` database columns

---

## 4. Nice to have

- [ ] **Live updates** — two people with the same month open see each other's changes without refreshing
- [ ] **Print / PDF / Excel export** of a month, for management
- [ ] **Reminder on the 1st** — email / notification about unsettled lines and locked months
- [ ] **Salários, INSS, IRPS (and maybe IVA) from ERPNext** — each Despesa Recorrente gets a "Fonte" (Manual / ERPNext); amounts come from submitted Salary Slips (net pay; INSS and IRPS deductions, plus the employer's 4% INSS) and update by themselves when payroll is submitted or cancelled. Salários land in the payroll month, INSS / IRPS in the **next** month. Shows "estimativa" until payroll runs; never changes a line already Pago. _Open questions: is payroll run in ERPNext? component names? is employer INSS set up? what are INSS-DH / IRPS-DH (another company)? include IVA?_
- [ ] **Caixa: side panel** — the same details panel for Caixa movements (history, notes)
- [ ] **Caixa: counting the cash** — the operator types the cash in hand; a difference is recorded as an adjustment so the Caixa matches reality
- [ ] **Caixa: split by category on the Painel** — in "Saídas por categoria", replace the single Caixa line by what the Caixa money was actually spent on
- [ ] **Change history per line** — who changed the amount or status, and when (Frappe already records it; just show it on the row)
- [ ] **Priority view** — "what to pay today", sorted by priority and filtered to what each bank can afford

---

## 5. Painel Financeiro (manager page)

### Decide faster (highest value)

- [ ] **Bank balances and "can we pay?"** — the real balance of each bank (STB / BIM / BIM C); per bank, *balance − bills still to pay this month*, with a red warning when a bank won't cover its bills (same work as section 2). _Open question: type the balances in, or read them from ERPNext Bank Accounts?_
- [ ] **30 / 60 / 90-day forecast** — money expected in from unpaid invoices (by due date) against the bills planned for the coming months, recurring ones included; the chart carries on past today as a dotted line
- [ ] **Receivables by age** — what clients owe split into *not yet due · 1–30 · 31–60 · 61–90 · 90+ days late*

### Control

- [ ] **Approval of the monthly plan** — the operator prepares the month, the manager approves it on the Painel, and only then can lines be marked Pago (same pattern as Deployment Plan)
- [ ] **"Needs your attention" list** — big payments above a chosen limit, bills that jumped against their average (e.g. "AWS +38%"), lines Pendente for too long, months still open after they ended
- [ ] **Budget per category** — yearly or monthly budget (e.g. "Pessoal e Eventos: 15,000/month"); used vs budget, orange at 80%, red when over

### Reading the numbers

- [ ] **Compare periods** — this month vs last month, vs the same month last year, and the year so far vs last year
- [ ] **Drill-down** — clicking a category bar lists its lines across the year; clicking a client opens their open invoices in ERPNext
- [ ] **Profit & cash-cover indicators** — salaries as a % of money received, the fixed monthly cost (sum of recurring bills), how many months of bills the money in the bank would cover

### Sharing

- [ ] **PDF / print of the Painel** for board or partner meetings
- [ ] **Weekly summary email to managers** (e.g. Monday) — money in vs out, what's still to pay, the most overdue clients, any locked month
- [ ] **Home-screen widget** in ERPNext with Saldo real, Por receber and Por pagar

### Smaller improvements to what exists

- [ ] **Issue date vs due date** — a switch for whether Entradas previstas counts invoices by issue date (current) or by due date
- [ ] **Date filter** — quarter / year so far / last 12 months, instead of only the calendar year
- [ ] **Plan vs reality gap** — Saídas previstas vs reais difference per month, to see how well the plan matches what was actually paid
- [ ] **Journal Entry receipts** — also count money received recorded as a manual Journal Entry (today only Payment Entries and POS invoices count)

---

## Suggested order

1. Commit + tests (section 1)
2. Bank balances with the "can we pay?" warning (sections 2 and 5)
3. 30 / 60 / 90-day forecast (section 5)
4. Proof of payment + smarter amounts (section 3)
5. The rest, as needed
