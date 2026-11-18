# 11 · Using the app with your own data

The app is the same for everyone (open its URL, install it on the phone). Each person keeps their
own data in their own **private** GitHub repository; the token and the data stay in that
person's browser and repository.

## 1. Create an empty private repository

GitHub → **New repository** → a name (e.g. `ledger-data`) → **Private** → Create.
Nothing else is needed (no README, no files).

## 2. Create a token for this repository only

GitHub → Settings → Developer settings → **Fine-grained tokens** → Generate new token:

- Repository access: **Only select repositories** → the repository of step 1.
- Permissions (Repository):
  - **Contents: Read and write**
  - **Actions: Read**
  - **Workflows: Read and write** (only needed for the first setup, which installs the checks)
- Note the expiry date.

## 3. Connect and set up

In the app: **Settings** → GitHub repository → paste the token, your GitHub user name (owner),
the repository name and the branch `main` → **Connect & load**.

The repository is empty, so the app shows **Set up …**: choose the main currency and your accounts
(name, currency, balance today), then **Create my ledger**. The app writes:

| File | What |
| --- | --- |
| `main.journal` | entry point (includes) |
| `accounts.journal` | your accounts + a standard list of categories (names in `label:` tags) |
| `commodities.journal` | your currencies |
| `prices.journal` | exchange rates (filled every day by the `rates` workflow) |
| `journals/<year>.journal` | your opening balances, then everything you record |
| `app.config.json` | main currency (icons and colours are optional) |
| `.github/workflows/check.yml` | `hledger check` on every save (the green / red badge) |
| `.github/workflows/rates.yml` | daily exchange rates for the currencies of `commodities.journal` |

Without the Workflows permission the two workflows are skipped (the app says so); add them later
by copying the files from another ledger, or give the permission and set up again in a new repo.

## 4. Later

**More → Accounts**: add accounts (with a currency, a new one if needed, and today's balance).
**More → Chart of accounts**: the expense and revenue categories (add, rename, move, archive). Everything else (expenses, transfers, scheduled payments, loans…) works the same.
