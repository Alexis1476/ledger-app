import { Decimal } from './decimal'
import { format } from './formatter'
import type { Posting, Transaction } from './types'

/**
 * Chart of accounts: declaring accounts / currencies in the journal text, and the starter files
 * of a new data repository. The display name is an account tag (`label:`), so the app never has
 * to rewrite app.config.json.
 */

export type AccountTypeCode = 'A' | 'C' | 'L' | 'E' | 'R' | 'X'

/** "Revolut EUR" → "revolut-eur" */
export function slug(name: string): string {
  return name
    .normalize('NFD')
    .replace(/[̀-ͯ]/g, '')
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, '-')
    .replace(/^-+|-+$/g, '')
}

/** Tag values end at a comma. */
const clean = (s: string) => s.replace(/,/g, ' ').replace(/\s+/g, ' ').trim()

/** `account <name>  ; type: C, currency: EUR, label: Revolut EUR` (two spaces before the comment). */
export function accountLine(account: string, tags: Record<string, string>): string {
  const comment = Object.entries(tags)
    .filter(([, v]) => v !== '')
    .map(([k, v]) => `${k}: ${clean(v)}`)
    .join(', ')
  return comment ? `account ${account}${' '.repeat(Math.max(2, 36 - account.length))}; ${comment}` : `account ${account}`
}

/**
 * The text with a new account declaration after the declaration sharing the longest prefix with
 * it (its siblings or its parent), else at the end.
 */
export function addDeclaration(text: string, account: string, tags: Record<string, string>): string {
  const lines = text.replace(/\r\n?/g, '\n').split('\n')
  const parts = account.split(':')
  let at = -1
  for (let k = parts.length - 1; k >= 1 && at < 0; k--) {
    const prefix = parts.slice(0, k).join(':')
    lines.forEach((l, i) => {
      const name = /^account\s+(\S+)/.exec(l)?.[1]
      if (name && (name === prefix || name.startsWith(prefix + ':'))) at = i
    })
  }
  const line = accountLine(account, tags)
  if (at < 0) return `${text.replace(/\n*$/, '')}\n${line}\n`
  lines.splice(at + 1, 0, line)
  return lines.join('\n')
}

/** commodities.journal with `commodity 1000.00 XXX` added (once). */
export function addCommodity(text: string, code: string): string {
  if (new RegExp(`^commodity\\s+\\S*\\s*${code}\\s*$`, 'm').test(text)) return text
  return `${text.replace(/\n*$/, '')}\ncommodity 1000.00 ${code}\n`
}

// ── New repository ───────────────────────────────────────────────────────

export interface StarterPocket {
  name: string
  currency: string
  /** current balance (opening balance), optional */
  balance?: string
}

export interface SetupInput {
  referenceCurrency: string
  pockets: StarterPocket[]
  /** opening date, YYYY-MM-DD */
  date: string
  /** id of the opening transaction (ULID) */
  openingId: string
}

/** A standard category tree (labels as account tags). */
export const STARTER_CATEGORIES: [string, string][] = [
  // income, by source
  ['income:work:salary', 'Salary'],
  ['income:sales', 'Sales'],
  ['income:interest', 'Interest'],
  ['income:transfers:gifts', 'Gifts'],
  ['income:transfers:people', 'People'],
  ['income:refunds', 'Refunds'],
  ['income:other', 'Other income'],
  // expenses, by purpose
  ['expenses:food:groceries', 'Groceries'],
  ['expenses:dining:restaurants', 'Restaurants'],
  ['expenses:dining:bars', 'Bars & cafés'],
  ['expenses:housing:rent', 'Rent'],
  ['expenses:housing:utilities', 'Utilities'],
  ['expenses:housing:maintenance', 'Maintenance & repairs'],
  ['expenses:shopping:clothes', 'Clothes'],
  ['expenses:shopping:electronics', 'Electronics'],
  ['expenses:shopping:other', 'Other shopping'],
  ['expenses:health:care', 'Health care'],
  ['expenses:insurance:health', 'Health insurance'],
  ['expenses:insurance:other', 'Other insurance'],
  ['expenses:transport:public', 'Public transport'],
  ['expenses:transport:long-distance', 'Long distance'],
  ['expenses:transport:taxi', 'Taxi'],
  ['expenses:transport:car', 'Car & parking'],
  ['expenses:travel', 'Travel'],
  ['expenses:leisure:going-out', 'Going out'],
  ['expenses:leisure:hobbies', 'Hobbies'],
  ['expenses:leisure:sport', 'Sport'],
  ['expenses:leisure:streaming', 'Streaming'],
  ['expenses:communication:mobile', 'Mobile'],
  ['expenses:communication:internet', 'Internet'],
  ['expenses:communication:software', 'Software & apps'],
  ['expenses:education', 'Education'],
  ['expenses:personal-care', 'Personal care'],
  ['expenses:taxes', 'Taxes'],
  ['expenses:fees:bank', 'Bank fees'],
  ['expenses:transfers:gifts', 'Gifts'],
  ['expenses:transfers:people', 'People'],
  ['expenses:misc:other', 'Other expenses'],
  ['expenses:uncategorized', 'Uncategorized']
]

export function pocketAccount(name: string): string {
  return `assets:${slug(name) || 'account'}`
}

const CHECK_YML = `# Validates the journal on every push and publishes JSON reports for the app.
name: check
on:
  push:
    branches: [main]
    paths-ignore: ['reports/**']
  workflow_dispatch:

permissions:
  contents: write
  checks: write

concurrency:
  group: hledger-check
  cancel-in-progress: false

env:
  HLEDGER_VERSION: "1.52.1"

jobs:
  check:
    runs-on: ubuntu-latest
    timeout-minutes: 5
    steps:
      - uses: actions/checkout@v5
      - name: Cache hledger
        id: cache
        uses: actions/cache@v4
        with:
          path: ~/.local/bin/hledger
          key: hledger-\${{ env.HLEDGER_VERSION }}
      - name: Install hledger
        if: steps.cache.outputs.cache-hit != 'true'
        run: |
          mkdir -p ~/.local/bin
          curl -fsSL "https://github.com/simonmichael/hledger/releases/download/\${HLEDGER_VERSION}/hledger-linux-x64.tar.gz" \\
            | tar -xz -C ~/.local/bin hledger
      - run: echo "$HOME/.local/bin" >> "$GITHUB_PATH"
      - name: hledger check
        id: check
        continue-on-error: true
        run: hledger -f main.journal check --strict ordereddates 2> check.log
      - name: Reports
        run: |
          mkdir -p reports
          OK=\${{ steps.check.outcome == 'success' }}
          jq -n --arg sha "$GITHUB_SHA" --argjson ok "$OK" \\
                --arg at "$(date -u +%FT%TZ)" --rawfile log check.log \\
                '{sha:$sha, ok:$ok, checkedAt:$at, log:$log}' > reports/status.json
      - name: Commit reports
        run: |
          git config user.name "github-actions[bot]"
          git config user.email "41898282+github-actions[bot]@users.noreply.github.com"
          git add reports
          git diff --cached --quiet || git commit -m "reports: \${GITHUB_SHA::7}"
          git pull --rebase && git push
      - name: Fail if check failed
        if: steps.check.outcome != 'success'
        run: cat check.log && exit 1
`

/** Daily rates of every currency of commodities.journal, in the reference currency of app.config.json. */
export const RATES_YML = `# Appends one daily exchange rate per currency of commodities.journal to prices.journal,
# in the reference currency of app.config.json. Source: github.com/fawazahmed0/exchange-api (free, no key).
name: rates
on:
  schedule:
    - cron: '17 5 * * *'
  workflow_dispatch:

permissions:
  contents: write

jobs:
  rates:
    runs-on: ubuntu-latest
    steps:
      - uses: actions/checkout@v5
      - name: Fetch rates
        run: |
          REF=$(jq -r '.referenceCurrency // "CHF"' app.config.json | tr 'A-Z' 'a-z')
          CURS=$(grep -oE '^commodity +[^ ]+ +[A-Z]{3}' commodities.journal | awk '{print tolower($3)}' | grep -vx "$REF" | paste -sd, -)
          [ -z "$CURS" ] && exit 0
          URL=https://cdn.jsdelivr.net/npm/@fawazahmed0/currency-api@latest/v1/currencies/$REF.json
          FALLBACK=https://latest.currency-api.pages.dev/v1/currencies/$REF.json
          touch prices.journal
          # only a date and a positive number from the third-party API reach the journal
          (curl -fsSL "$URL" || curl -fsSL "$FALLBACK") | jq -r --arg ref "$REF" --arg curs "$CURS" '
            .date as $d | .[$ref] | to_entries[]
            | select(.key as $k | ($curs | split(",") | index($k)))
            | select(($d | type == "string" and test("^[0-9]{4}-[0-9]{2}-[0-9]{2}$")) and (.value | type == "number") and .value > 0)
            | "P \\($d) \\(.key | ascii_upcase) \\(1 / .value) \\($ref | ascii_upcase)"' >> prices.journal
      - name: Commit
        run: |
          git config user.name "github-actions[bot]"
          git config user.email "41898282+github-actions[bot]@users.noreply.github.com"
          git add prices.journal
          git diff --cached --quiet || git commit -m "rates: $(date -u +%F)"
          git pull --rebase && git push
`

export const WORKFLOW_FILES = ['.github/workflows/check.yml', '.github/workflows/rates.yml']

/** Every file of a new data repository (path → text). */
export function setupFiles(i: SetupInput): Record<string, string> {
  const ref = i.referenceCurrency.toUpperCase()
  const currencies = [...new Set([ref, ...i.pockets.map((p) => p.currency.toUpperCase())])]
  const year = i.date.slice(0, 4)
  const pockets = i.pockets.filter((p) => p.name.trim())

  const accounts = [
    '; accounts.journal — chart of accounts. Types: C cash/bank, A asset, L liability, E equity,',
    '; R revenue, X expense. `label:` is the name shown in the app; `currency:` the currency of a pocket.',
    '',
    '; ── Assets: where the money is ──',
    accountLine('assets', { type: 'A' }),
    ...pockets.map((p) => accountLine(pocketAccount(p.name), { type: 'C', currency: p.currency.toUpperCase(), label: p.name.trim() })),
    '',
    '; ── Liabilities: what I owe ──',
    accountLine('liabilities', { type: 'L' }),
    '',
    '; ── Equity ──',
    accountLine('equity:opening', { type: 'E', label: 'Opening balances' }),
    accountLine('equity:conversion', { type: 'E', label: 'Currency conversion' }),
    accountLine('equity:adjustments', { type: 'E', label: 'Adjustments' }),
    '',
    '; ── Income ──',
    ...STARTER_CATEGORIES.filter(([a]) => a.startsWith('income:')).map(([a, label]) => accountLine(a, { type: 'R', label })),
    '',
    '; ── Expenses ──',
    ...STARTER_CATEGORIES.filter(([a]) => a.startsWith('expenses:')).map(([a, label]) => accountLine(a, { type: 'X', label }))
  ].join('\n')

  const files: Record<string, string> = {
    'main.journal': '; main.journal — entry point (only includes; the app adds journals/<year>.journal)\ninclude commodities.journal\ninclude accounts.journal\ninclude prices.journal\n',
    'commodities.journal': `; commodities.journal — currencies and display format\n${currencies.map((c) => `commodity 1000.00 ${c}`).join('\n')}\n`,
    'accounts.journal': `${accounts}\n`,
    'prices.journal': `; prices.journal — exchange rates (P date CUR rate ${ref}), appended daily by .github/workflows/rates.yml\n`,
    'app.config.json': `${JSON.stringify({ version: 1, referenceCurrency: ref, people: {}, accounts: {}, categories: {} }, null, 2)}\n`,
    'README.md': '# My ledger data\n\nPlain-text accounting (hledger) written by the ledger app. Private.\n\n```sh\nhledger -f main.journal bal\n```\n',
    '.github/workflows/check.yml': CHECK_YML,
    '.github/workflows/rates.yml': RATES_YML
  }

  // opening balances, dated the setup day
  const postings: Posting[] = []
  for (const p of pockets) {
    const q = p.balance?.trim() ? new Decimal(p.balance.replace(/['\s]/g, '').replace(',', '.')) : undefined
    if (q && !q.isZero()) postings.push({ account: pocketAccount(p.name), amount: { qty: q, commodity: p.currency.toUpperCase() }, tags: {} })
  }
  if (postings.length) {
    const byCur = new Map<string, Decimal>()
    for (const p of postings) byCur.set(p.amount!.commodity, (byCur.get(p.amount!.commodity) ?? new Decimal(0)).plus(p.amount!.qty))
    for (const [c, q] of byCur) postings.push({ account: 'equity:opening', amount: { qty: q.neg(), commodity: c }, tags: {} })
    const tx: Transaction = { date: i.date, status: '*', payee: 'Opening balances', id: i.openingId, tags: { via: 'app', id: i.openingId }, postings }
    files[`journals/${year}.journal`] = `; ${year} — transactions written by the app (via:app). Keep sorted by date.\n\n${format(tx)}\n`
    files['main.journal'] += `include journals/${year}.journal\n`
  }
  return files
}

// ── Editing the chart ────────────────────────────────────────────────────

const POSTING_LINE = /^(\s+(?:[*!] )?)(\S+)(\s{2,}\S.*|\s*(?:;.*)?)$/
const DECL_LINE = /^account\s+(\S+)(?:(?: {2,}|\t)\s*;\s?(.*))?$/

/** "type: X, label: Coffee" → { type: 'X', label: 'Coffee' } */
export function parseDeclTags(comment: string | undefined): Record<string, string> {
  const out: Record<string, string> = {}
  for (const part of (comment ?? '').split(',')) {
    const m = /^\s*([^\s:]+):\s*(.*?)\s*$/.exec(part)
    if (m) out[m[1]] = m[2]
  }
  return out
}

/**
 * Renames accounts (exact names) in a journal text: posting lines and declarations. The amount
 * column stays where it was. Returns the new text and how many lines changed.
 */
export function renameAccounts(text: string, map: Record<string, string>): { text: string; count: number } {
  let count = 0
  const lines = text.split('\n').map((line) => {
    const d = DECL_LINE.exec(line)
    if (d) {
      if (!(d[1] in map)) return line
      count++
      return accountLine(map[d[1]], parseDeclTags(d[2]))
    }
    const m = POSTING_LINE.exec(line)
    if (!m || line.trimStart().startsWith(';') || !(m[2] in map)) return line
    const old = m[2]
    const next = map[old]
    let rest = m[3]
    if (rest.trim() && !rest.trimStart().startsWith(';')) {
      const gap = rest.length - rest.trimStart().length
      rest = ' '.repeat(Math.max(2, gap + old.length - next.length)) + rest.trimStart()
    }
    count++
    return m[1] + next + rest
  })
  return { text: lines.join('\n'), count }
}

/** The declaration of `account` with some tags set (a value of '' removes the tag). */
export function setDeclarationTags(text: string, account: string, tags: Record<string, string>): string {
  return text
    .split('\n')
    .map((line) => {
      const d = DECL_LINE.exec(line)
      if (!d || d[1] !== account) return line
      const merged = { ...parseDeclTags(d[2]), ...tags }
      for (const [k, v] of Object.entries(merged)) if (v === '') delete merged[k]
      return accountLine(account, merged)
    })
    .join('\n')
}

// ── Tree of a chart section (expenses / income) ─────────────────────────

export interface ChartNode {
  account: string
  /** last segment */
  name: string
  depth: number
  /** a category (posted to) or a group (only holds categories) */
  leaf: boolean
  children: ChartNode[]
}

/** The accounts under `root` as a tree: groups first by name, then categories by name. */
export function chartTree(accounts: string[], root: string): ChartNode[] {
  const names = new Set<string>()
  for (const a of accounts) {
    if (!a.startsWith(root + ':')) continue
    const parts = a.split(':')
    for (let k = 2; k <= parts.length; k++) names.add(parts.slice(0, k).join(':'))
  }
  const build = (parent: string, depth: number): ChartNode[] =>
    [...names]
      .filter((n) => n.startsWith(parent + ':') && n.split(':').length === parent.split(':').length + 1)
      .map((n) => {
        const children = build(n, depth + 1)
        return { account: n, name: n.split(':').at(-1)!, depth, leaf: children.length === 0, children }
      })
      .sort((a, b) => Number(a.leaf) - Number(b.leaf) || a.name.localeCompare(b.name))
  return build(root, 0)
}
