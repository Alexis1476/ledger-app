# 05 · Ledger core (`src/ledger/`)

Pure TypeScript, no Vue/DOM imports, fully unit-tested. Modules:

| Module | Responsibility |
| --- | --- |
| `types.ts` | `Amount`, `Posting`, `Transaction`, `Directive`, `Journal` |
| `parser.ts` | Text → `Journal` (AST with source positions) |
| `formatter.ts` | `Transaction` → text (deterministic) |
| `builder.ts` | Form input (`TxKind` + fields) → `Transaction`, following the recipes in docs/02 |
| `validate.ts` | Pre-commit checks (layer 2 in docs/03) |
| `insert.ts` | Find chronological insertion line; replace/delete a transaction's line range |
| `reports.ts` | Balances, registers, monthly aggregates, conversion to CHF with `P` prices |

## Types

```ts
import Decimal from 'decimal.js'

type Commodity = 'CHF' | 'EUR' | 'USD' | 'COP' | string
interface Amount {
  qty: Decimal
  commodity: Commodity
  cost?: { qty: Decimal; commodity: Commodity; kind: 'unit' | 'total' }   // @ or @@
}
interface Posting {
  account: string
  amount?: Amount            // undefined = implicit (parser only; the app always writes it)
  assertion?: { amount: Amount; inclusive: boolean }   // = or =*
  comment?: string
  tags: Record<string, string>
}
interface Transaction {
  id?: string                // from tag id: (ULID)
  date: string               // YYYY-MM-DD
  status: '' | '!' | '*'
  code?: string
  payee?: string             // text before " | "
  note?: string              // text after " | "
  postings: Posting[]
  tags: Record<string, string>   // value '' for label tags like holiday:
  comment?: string
  src?: { file: string; startLine: number; endLine: number; raw: string }
}
type TxKind = 'expense' | 'income' | 'transfer' | 'assertion'
  | 'loan-repayment' | 'assertion'
```

## Parser: supported syntax

| Element | Support |
| --- | --- |
| Transaction header: date, status, code `(…)`, description, `Payee \| note` split | yes |
| Postings: account, amount, commodity on the right, implicit amount (≤ 1 per txn) | yes |
| Comments `;` (header, posting, own line) and tags `name:value` / `name:` | yes |
| Costs `@` (unit) and `@@` (total) | yes |
| Balance assertions `=` and `=*` | yes |
| Directives `account`, `commodity`, `P`, `include` | yes (include: relative paths + simple `*` globs) |
| Periodic transactions `~` | phase 3 (planned payments, budgets) |
| Auto postings `=`, timedot, lots `{}`, virtual postings `()` `[]` | no: keep the raw lines, flag them as "unsupported", never rewrite them |

Rules:
- Account names may contain single spaces and non-ASCII (`expenses:santé`); the account ends
  at two spaces or a tab before the amount.
- Parse amounts directly into `Decimal` from the string, never through `Number`.
- Keep `src` (file, line range, raw text) on every transaction so edits rewrite only those lines.
- Unknown or broken lines produce parse diagnostics with file:line, they do not throw.

## Formatter

Deterministic output matching `tests/fixtures/recipes.journal` byte for byte:

```ts
// header
`${date} ${status} ${payee}${note ? ' | ' + note : ''}  ; ${tags.join(', ')}`
// posting: the quantity's last digit always ends at column 58
const prefix = '    ' + account
const qty = amount.qty.toFixed(2)                    // "-84.35"
const gap = Math.max(2, 58 - prefix.length - qty.length)
let line = prefix + ' '.repeat(gap) + qty + ' ' + amount.commodity
if (amount.cost) line += ` @@ ${amount.cost.qty.toFixed(2)} ${amount.cost.commodity}`
if (assertion) line += ` = ${assertion.qty.toFixed(2)} ${assertion.commodity}`
```

- Two spaces before `;` on the header; transactions separated by one blank line.
- 4-space indent, amounts with exactly 2 decimals, minus sign directly before digits.
- Tags on the header line, comma-separated; `via:app` and `id:` always first.
- No thousands separators in the file.
- Round-trip test: `format(parse(text)) === text` for every transaction in `tests/fixtures/recipes.journal`.

## Builder

`build(kind, input, ctx) → Transaction` implements the recipes in docs/02 exactly. It is generic: every
posting goes to an account the input names (no rules about people). `ctx` (`makeContext(refCurrency)`)
only carries the reference currency (the `@@` cost goes on the non-reference leg) and the fee account.
`reverse(tx)` (`reverse.ts`) is the inverse, used to edit a transaction and to prefill a payee's habits.
Expense algorithm (the core of the app) is in docs/02 "Posting builder". Equal split:
`share = floor(A / n, 2 decimals)`, then add 0.01 to the first `(A − share·n) / 0.01` splits.

## Validation (`validate(tx, journal)`)

Return a list of `{ code, message, postingIndex? }`, empty = OK:

- `UNBALANCED`: sum per commodity ≠ 0 after converting `@@` / `@` costs (hledger rules).
- `MULTIPLE_IMPLICIT`: more than one posting without amount.
- `UNDECLARED_ACCOUNT`, `UNDECLARED_COMMODITY`: not in `accounts.journal` / `commodities.journal`.
- `NON_LEAF_ACCOUNT`: posting to an account that has declared children.
- `BAD_DATE`, `BAD_PRECISION` (> 2 decimals), `ZERO_AMOUNT` (except assertions).
- `ASSERTION_FAILED`: recompute balance assertions of the whole journal after insertion.
- `DUPLICATE_ID`: an existing transaction already has this `id:`.

## Tests

- Golden tests: parse `tests/fixtures/recipes.journal` and compare against
  `recipes.print.json` (hledger's own parse) and `recipes.bal.json` (balances).
  Compare quantities with `decimalMantissa` / `decimalPlaces`, never `floatingPoint`.
- Builder tests: for each recipe, `format(build(kind, input))` equals the fixture text.
- Regenerate fixtures with `tests/fixtures/regenerate.sh` (needs hledger 1.52.x).
- Optional integration test (local only, skipped in CI): parse the real `ledger-data`
  checkout pointed to by env `LEDGER_DATA_DIR` and compare totals with
  `hledger -f $LEDGER_DATA_DIR/main.journal bal -O json`.

## Statements (`src/ledger/statements.ts`)

`balanceSheet` (balances at a date valued at that date; result to date and exchange differences close
the equation assets = liabilities + equity + result + exchange), `incomeStatement` and
`cashFlowStatement` (postings of a period valued at their own date, @@ cost first), each as an
account tree. The integration test compares their per-currency totals with `hledger bal`.
