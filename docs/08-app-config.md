# 08 · `app.config.json` (in `ledger-data`)

Presentation and UX settings. Never financial data: changing a color must not touch the
journal. Validated with a Zod schema at load; unknown keys are kept as-is on save.

```json
{
  "version": 1,
  "referenceCurrency": "CHF",
  "people": {
    "sam": { "label": "Sam", "color": "#a855f7", "pockets": ["assets:sam:neo:chf", "assets:sam:neo:eur", "assets:sam:cash:eur"],
             "toReturn": { "amount": "500.00", "currency": "CHF", "since": "2026-11-01" } },
    "max": { "label": "Max", "color": "#0ea5e9" },
    "eva": { "label": "Eva", "color": "#f97316" }
  },
  "accounts": {
    "assets:bank":          { "label": "Bank" },
    "assets:bank:checking": { "label": "Bank Checking", "icon": "i-lucide-landmark", "color": "#ef4444", "order": 1 },
    "assets:neo:chf":       { "label": "Neo CHF",       "icon": "i-lucide-wallet",   "color": "#eab308", "order": 2 },
    "assets:neo:eur":       { "label": "Neo EUR",       "icon": "i-lucide-euro",     "color": "#eab308", "order": 3 },
    "assets:sam:neo:chf":   { "label": "Sam · Neo CHF", "icon": "i-lucide-piggy-bank","color": "#a855f7", "order": 20 },
    "assets:bank:card":     { "label": "Bank Card",     "archived": false }
  },
  "categories": {
    "expenses:food:groceries":     { "label": "Groceries",   "icon": "i-lucide-shopping-cart", "color": "#22c55e" },
    "expenses:dining:restaurants": { "label": "Restaurants", "icon": "i-lucide-utensils",      "color": "#f97316" },
    "expenses:transport:public":   { "label": "Public transport", "icon": "i-lucide-train-front", "color": "#3b82f6" }
  },
  "templates": [
    { "name": "Rent", "kind": "expense", "account": "assets:bank:checking", "category": "expenses:housing:rent", "payee": "Landlord", "amount": "1200.00", "currency": "CHF" }
  ],
  "favorites": { "categories": ["expenses:food:groceries", "expenses:dining:restaurants", "expenses:transport:public"] },
  "budgets": { "expenses:dining": "200.00", "expenses:food:groceries": "450.00" }
}
```

Rules:
- Every key under `accounts` / `categories` must be a declared account (or a parent of one); warn otherwise.
- Accounts or categories missing from the config get a default icon and a color derived
  from a hash of the account name.
- `people`: label and color per person key. `pockets`: your pockets kept for that person.
  `toReturn`: reminder of money to put back into their pockets (amount, currency, since, note).
  Accounts by convention: categories ending in `:<key>`, `assets:receivables:<key>` (they owe
  you), `liabilities:people:<key>` (a real debt).
- Template `kind`: `expense` | `income` | `transfer`.
- `budgets`: a monthly limit per expense category or group (a group counts all its categories),
  in the reference currency. Compared with my own spending (not the money kept for people);
  "Spending fast" when the share spent is more than 10 points ahead of the share of the month gone by.
- Icons: Iconify names. Older `i-lucide-*` names are shown as their Material Symbols equivalent.

## Naming rules

- **Account names** (journal): English, lowercase, kebab-case segments, `<type>:<group>:<leaf>`
  (`expenses:communication:software`, `assets:sam:neo:eur`). Never renamed for display.
- **Labels** (`accounts` / `categories`): sentence case, acronyms in capitals (CHF, DIY),
  **nouns, not phrases** ("Eva", "People", not "Eva owes me").
- **Every group has a label** (`expenses:food` → "Food", `assets:bank` → "Bank"); a group
  `assets:<person>` shows the person's name. Missing labels fall back to the segment with a capital.
- **Pockets**: "<Institution> <type or currency>" ("Bank Checking", "Neo CHF"); pockets kept for
  someone: "<Person> · <Institution> <currency>" ("Sam · Neo EUR").
- **Leaves named "other"** say what they are: "Other shopping", "Other expenses", "Other income".
- `order`: your pockets 1–19, then each person's pockets (20+, 30+…), receivables 40, transit 50.
