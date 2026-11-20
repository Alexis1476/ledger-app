# 04 · Features and screens

Goal: what a budgeting app does, plus who owes whom and money kept for someone. Every feature
maps to plain hledger, so nothing depends on the app.

## Features

| Feature | In hledger | In the app | Phase |
| --- | --- | --- | --- |
| Accounts (bank, cash, card, savings) with icon and color | `account` directive + tags | Icon (Lucide via Iconify, bundled with Nuxt UI) + color from `app.config.json`, order, archive | 1 |
| Multi-currency account (e.g. CHF + EUR) | One pocket per currency | One row per bank, its pockets unfold under it | 1 |
| Categories and sub-categories with icon and color | `expenses:*`, `income:*` accounts | Colored icon grid in quick entry; managed in Settings | 1 |
| Types: expense, income, transfer | Derived from accounts | Tabs at the top of the form | 1 |
| Currency exchange | `@@` cost + `equity:conversion` | Part of Transfer: a received amount appears when the accounts' currencies differ, rate computed | 1 |
| Payee, note | Description `Payee \| note` | Autocomplete | 1 |
| Search and filters | hledger-style queries | Text search + filters (account, category, label, period, currency) | 1 |
| Payment type | Dropped (2026-11): the account already says how it was paid | — | — |
| Record state | `*` / `!` | Status icon + reconciliation screen against a statement | 2 |
| Debts and loans | `assets:receivables:*`, `liabilities:people:*`, tag `due:` | Debts screen: open balances, partial repayment, auto-close at 0, due reminder | 2 |
| People: I owe (liability) / owes me (asset), money kept in their pockets | `liabilities:people:*`, `assets:receivables:*` | People screen | 1 |
| Templates | `app.config.json` | One-tap entry | 2 |
| Planned payments | Periodic transactions `~` in `planned.journal` | "Upcoming" list, "Confirm" creates the real transaction | 3 |
| Budgets | `budgets` in `app.config.json` (monthly limit per category or group) | Budgets page (month, progress, on track / spending fast / over), card on Home | done |
| Savings goals | Dedicated account + target in config | Progress gauge | 3 |
| Attachments | File in `attachments/` + tag `attachment:` | Receipt photo from the camera | 3 |
| Export | `hledger print`, CSV | Export CSV button | 3 |

Not included: automatic bank sync, shared accounts, GPS.

## Screens

| Screen | Content | Phase |
| --- | --- | --- |
| Home | Net worth (me) + one card per owner, balances per account with icons/colors, last transactions, CI badge, floating + button | 1 |
| Quick entry | Three types only, accounts only: **Expense** (pocket → category or person account, split), **Income** (category or person account → pocket), **Transfer** (any account → any account; other currency = exchange; optional fee) | 1 |
| Transactions | List by month, search, filters, detail, edit, delete | 1 (read) / 2 (edit) |
| Accounts | List + detail: register, running balance, balance chart | 2 |
| People | One card per person: money kept for them (their pockets), reminder of what to put back, what they owe me | 1 |
| Accounting | Balance sheet (assets, liabilities, equity, result to date, exchange differences), income statement, cash flow; period (year / month / all), depth, currencies. Same numbers as `hledger bs/is/cf` (valued in CHF). Includes the money kept for people |
| Scheduled payments | hledger periodic transactions in `journals/scheduled.journal` (`~ monthly from …  Payee`). Created from the entry form (Repeat: daily … yearly, optional end); Scheduled page: due (late + 30 days) with Record / Skip, all schedules (tap to edit / delete); Home: upcoming 7 days. Recording writes a normal transaction tagged `schedule:<id>, planned:<date>`; skip = tag `skip:<dates>` on the schedule. Dates follow hledger (`--forecast`) |
| Shopping list | `lists/shopping.md` in ledger-data (Markdown checklist `- [ ] item`): add (several at once with commas), tick, remove, clear the cart, record the groceries expense. Changes are replayed on the latest file text and committed after 1.5 s; offline they wait on the device |
| Inventory | Page \"Inventory\" (More menu): the things I own and what they cost. Search a purchase (payee / note) and tap it to add it: the purchase stays a normal expense, its header gets `item:<name>` (kept by the entry form). Tap a thing to rename it, open the purchase or remove it |
| Loans | Page \"Loans\" (More menu): owed to me (`assets:receivables:<who>`) / I owe (`liabilities:people:<who>`), one card per person with history and Lent / Got repaid / Borrowed / Repaid (entry form prefilled). \"New loan\" declares the person's account in accounts.journal. \"Find a transaction that was a loan\" moves an imported People expense/income to the person's account |
| Setup of a new repository | Settings → Connect on an empty repository → \"Set up\": main currency + accounts (name, currency, balance) → the app writes every file (journals, categories, workflows, opening balances), see docs/11 |
| Accounts | More → Accounts: my pockets (bank, card, cash); add one with its currency (a new one is declared) and today's balance (opening entry) |
| Chart of accounts | More → Chart of accounts: **Expenses** (charges, by purpose) and **Revenue** (produits, by source) as a tree (groups bold and collapsible, categories indented, number of lines). + on a group adds a category in it; Add on a section adds one in a group or a new group (declared with its name). Tap a category to rename it (`label:`), move it to another group (renamed in every journal and app.config.json, balances unchanged) or archive it (`archived: yes`: hidden from the forms); tap a group to rename it. Colors: a group has one color (its own in the config, else its first category's), its categories the same a bit lighter per level |
| Navigation (phone) | Home · List · + · Shopping · More (Scheduled, People, Inventory, Accounting, Settings); desktop sidebar lists everything |
| Debts | Open/closed debts per person | 2 |
| Stats | Charts below, period selector | 2 / 3 |
| Planned & budgets | Upcoming payments, monthly budgets | 3 |
| Settings | Token, repo, accounts, categories, labels (icon, color), templates, reference currency, theme | 1 |

## Quick entry (the most important screen)

Target: record an expense in under 10 seconds.

1. The + button opens a drawer (`UDrawer`) with the amount field focused, `inputmode="decimal"`.
2. The 6 most used categories show as colored icons; default account and "for whom = me" are remembered.
3. Payee autocompletes from past entries and pre-fills the category last used with that payee.
4. "Paid with" is a pocket; people are picked as accounts ("Max's money", "Eva owes me") in the split.
5. "For whom" defaults to me; a split editor offers 50/50, thirds, or custom amounts.
6. Templates pre-fill recurring entries (Rent, health insurance).
7. A preview shows the exact hledger text that will be added.

## Charts

| Chart | Shows | Phase |
| --- | --- | --- |
| Balance trend | Total and per-account balance over time, in CHF | 2 |
| My money vs kept for people | Home stats (month, categories, cash flow, "My money" trend) count only transactions touching my own pockets; the balance sheet splits kept for people / free | 2 |
| Spending structure | Expenses by category over a period (donut + list) | 2 |
| Cash flow | Income vs expenses per month | 2 |
| Spending by label | E.g. total cost of a trip, in COP and CHF | 3 |
| Budget vs actual | Per category per month | 3 |
| Calendar heatmap | Spending intensity per day | 3 |

### Insights page (`/insights`)

Five charts over a chosen period, all in the reference currency: Summary (income, spent, net,
savings rate), Spending by category (ranked bars or donut; by group or by category), Income vs
expenses (bars or lines), Net worth over time (area or bars), Spending over time (the four
largest groups of the period and "Other", month by month; stacked bars or lines; nothing to pick).

- Period: this month, last 3 / 6 / 12 months, this year, last year, all time. The charts over
  time show at least 6 months when the period is shorter.
- Filters, for the whole page: accounts (replaces the My money / All choice) and expense
  categories. Tapping a group in "Spending by category" filters the page on it.
- With a category filter every chart is about those categories only: the summary becomes spent,
  per month, share of all spending and change vs the period before; the breakdown and the split
  over time go down to categories; "Income vs expenses" becomes "Spending per month"; net worth
  is not shown (it does not depend on categories), nor the split when there is one category.
- Customize: show, hide and reorder the charts; each chart remembers its form.
- The choices are kept in `localStorage` (`ledger.insights`), per device, like My money / All.
- Numbers: `src/ledger/insights.ts` (pure, unit-tested) on top of `analytics.ts`.
- Colors: the trend uses four categorical slots validated with the dataviz checker on both
  surfaces; the donut uses each category's own color, with the list under it as legend.

Use vue-echarts. Data from the in-app parser (always available offline); CI JSON reports
(`reports/*.json`) can be used as a cross-check.

## Android specifics

- Installed from Chrome ("Install app"), standalone display, own icon.
- Manifest `shortcuts` (long-press the icon): "New expense", "New income", "New transfer".
- Web Share Target: sharing a receipt photo opens a new entry with the attachment (phase 3).


> 2026-11-10: labels removed (unused). A value-less tag still parses and is kept when a transaction is edited.
