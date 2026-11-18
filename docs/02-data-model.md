# 02 · Data model

**Accounts are classified by nature** (correct double-entry):

- **Assets**: where the money is (every pocket in your name), and what someone owes you
  (`assets:receivables:<who>`).
- **Liabilities**: real debts only (`liabilities:people:<who>`).

**Money kept for someone** stays yours in the books. Money received for them is income
(`income:transfers:family:<who>`), money spent for them is an expense
(`expenses:transfers:family:<who>`). You keep it for them in **their pockets**
(`assets:<who>:<institution>:<currency>`, e.g. "Sam · Neo EUR"): a label in the books only, the
physical cash and the bank balance stay shared (their total = the sum of the pockets).
`app.config.json` → `people.<who>.pockets` lists them; the balance sheet splits "In my accounts"
into kept for each person / free.

**Reminder**: `people.<who>.toReturn` (amount, currency, since) = money you used and want to put
back into their pockets. It goes down with every transfer from one of your pockets to one of
theirs dated on/after `since`. Not a debt: an intention shown in the app.

Any person can have pockets, categories ending in `:<who>`, a receivable or a real debt.

## Accounts

Source of truth: `ledger-data/accounts.journal`. Naming: `<type>:<institution>:<pocket>`,
one currency per pocket. Never post to a parent account, always to a declared leaf.

| Account | Side | Holds |
| --- | --- | --- |
| `assets:<institution>:<pocket>` (e.g. `assets:bank:checking`, `assets:neo:eur`, `assets:cash:chf`) | asset | your pockets, one currency each |
| `assets:<who>:<institution>:<currency>` (e.g. `assets:sam:neo:eur`) | asset | your money kept for that person, split **in the books only** |
| `assets:receivables:<who>` | asset | what someone owes you |
| `assets:transit:to-reconcile` | asset | money between two registers |
| `liabilities:people:<who>` | liability | a real debt to that person |
| `income:transfers:family:<who>`, `expenses:transfers:family:<who>` | — | received from / spent for that person |
| `equity:opening`, `equity:conversion`, `equity:adjustments` | — | opening balances, FX, corrections |
| `income:*`, `expenses:*` | — | categories (see `accounts.journal`) |

Adding a person = a label/color (+ optional pockets and reminder) in `app.config.json` → `people`,
and their accounts in `accounts.journal` (pockets, family categories, or
`assets:receivables:<who>` if they owe you).

Derived numbers the UI shows:

- **Kept for X** = balance of X's pockets, per currency + total in the reference currency.
- **To put back into X's pockets** = `toReturn.amount` − transfers from your pockets into X's since `toReturn.since`.
- **X owes me** = balance(`assets:receivables:X`).
- **Free (mine)** = in my accounts − kept for people.
- **Net worth** = assets + liabilities (money kept for people is yours: it counts).

**Scope (app)**: "My money" (default) counts only transactions touching your own pockets in the
Home stats, charts and lists; "All" includes the pockets kept for people. Remembered per device.

## The three entry types (generic: accounts only)

The quick-entry form has only **Expense**, **Income** and **Transfer**, and it only **picks
accounts**: what you choose is exactly what is written. There are no hidden rules about people.
People appear in the pickers as accounts, by name; the account type says the side:

| Account | Shown as |
| --- | --- |
| `liabilities:people:<who>` (liability) | the person's name, e.g. "Rosa" |
| `assets:receivables:<who>` (asset) | the person's name, e.g. "Eva" |

- **Expense**: a pocket pays → one destination (a category or a person account), or several
  ("split") whose amounts add up to the total. "Me" in the split is the chosen category.
- **Income**: into a pocket ← from an income category or a person account.
- **Transfer**: from **any** account → to **any** account: pocket ↔ pocket, pocket ↔ person,
  person ↔ person. Different currencies = an exchange (received amount); optional fee.

Putting money back for Sam = a transfer from one of your pockets to one of hers (the reminder goes
down). Paying something for Max = an expense "For Max" (from his pocket or yours).

### Cost rule

Conversions are written with a total cost `@@` on **the leg that is not in the reference
currency**. Both are valid hledger, but this keeps every market price inferred from costs
in the form `X → CHF`, and avoids CHF amounts that carry a cost (hledger values those oddly
under `-X CHF`). A foreign-currency expense split across lines gives each line its share of the
debited amount as `@@`.

## Recipes

Every recipe exists in `tests/fixtures/recipes.journal` (generated from `tests/unit/recipes.ts`
with `pnpm fixtures:recipes`) and passes `hledger check --strict ordereddates`. The formatter
must produce these exact shapes. **The app always writes every amount explicitly.**

| # | Form | Postings |
| --- | --- | --- |
| R1 | expense → category | `E +A` · `S −A` |
| R2 | expense → person (a family category, or a real debt) | `people:max +A` · `S −A` |
| R3 | expense split: category + people | `E +s1` · `people:max +s2` · `receivables:eva +s3` · `S −A` |
| R4 | income ← person (a family category, or a real debt) | `S +A` · `people:sam −A` |
| R5 | transfer pocket → pocket, other currency, fee | `D +B EUR @@ X CHF` · `fees:bank +f` · `S −(X+f) CHF` |
| R6 | transfer pocket → pocket | `D +A` · `S −A` |
| R7 | transfer pocket → person (paying back) | `people:sam +A` · `S −A` |
| R8 | expense → "Lucas owes me" (lend, tag `due:`) | `receivables:lucas +A` · `S −A` |
| R9 | income ← "Lucas owes me" (repayment) | `S +A` · `receivables:lucas −A` |
| R10 | expense in a foreign currency | `E +A COP @@ X CHF` · `S −X CHF` |
| R11 | transfer across currencies | `D +B COP @@ A CHF` · `S −A CHF` |
| R12 | income | `S +A` · `income:* −A` |
| R13 | balance assertion | `S 0 = <balance>` |

Imported or hand-written shapes the app reads but does not write (H1–H3 in the fixture) are
valid; in the app they can be deleted, not edited.

Example (R3):

```hledger
2026-11-04 * Bistro | Dinner for 4  ; via:app, id:01JC0000000000000000000003
    expenses:food:restaurants                        21.15 CHF
    liabilities:people:max                           42.30 CHF
    assets:receivables:eva                           21.15 CHF
    assets:bank:checking                            -84.60 CHF
```

## Transaction text conventions

| Element | Rule |
| --- | --- |
| Date | `YYYY-MM-DD` |
| Status | `*` cleared, `!` pending, none = draft |
| Description | `Payee \| note` (hledger splits payee/note on `\|`) |
| Value-less tags | `; travel:, holiday:` are kept as they are |
| App tags | `via:app`, `id:<ULID>` (idempotency), optional `due:YYYY-MM-DD` (loans), `item:<name>` (inventory), `schedule:<id>, planned:<date>` (a recorded scheduled payment) |
| Amounts | Dot decimal, no thousands separator in the file, 2 decimals, commodity symbol on the right with one space (`84.35 CHF`). UI shows Swiss format (`1'234.50`) |
| Order | Transactions sorted by date inside each yearly file (`ordereddates` check) |

## Currencies and rates

- Every amount stays in its original currency. Conversions are recorded with `@@` total cost.
- One reference currency. `prices.journal` gets `P <date> <CUR> <rate> <REF>` lines daily
  from CI (docs/06). Reports use `-X <REF>`; the app uses the latest price on or before the date shown.
- Market rates are for display only; real debited amounts are the `@@` costs.

## Scheduled payments

`journals/scheduled.journal` (included from main.journal) holds hledger **periodic transactions**:

```
~ monthly from 2026-12-01  Landlord | Rent  ; via:app, id:01…, skip:2027-01-01
    expenses:housing:rent                          1200.00 CHF
    assets:bank:checking                          -1200.00 CHF
```

They are not part of the balances (`hledger bal --forecast` shows them as a forecast). The app
understands `daily | weekly | every N weeks | monthly | every N months | quarterly | yearly`
`from DATE [to DATE]` (others are read-only). Dates follow hledger: anchored on the start day,
clipped to the month end, the end excluded. Recording an occurrence writes a normal transaction
tagged `schedule:<id>, planned:<date>`; skipping adds the date to `skip:` on the schedule.

## Inventory

The things you own are their purchases, tagged in the header: `2026-09-14 * Camera store  ; item:Compact camera`.
The purchase stays an expense (no fixed assets, no depreciation).

## Categories (chart of accounts)

Grouped by **purpose** for expenses and by **source** for income:

- expenses: food · dining · housing · shopping · health · insurance · transport · travel · leisure ·
  communication · education · personal-care · taxes · fees · transfers (gifts, family, people) ·
  misc · uncategorized
- income: work · sales · interest · transfers (gifts, family, people) · refunds · other

A group (`expenses:dining`) is never posted to; its categories are the leaves. The app edits the
chart (Chart of accounts page): add, rename (`label:` tag), move to another group (renamed
everywhere), archive (`archived: yes`).
