import { valueAt } from './analytics'
import { Decimal, ZERO } from './decimal'
import { balances, isAssetType, postingAmounts, valueIn, type AccountType, type MixedAmount, type PriceDB } from './reports'
import type { Journal } from './types'

/**
 * Financial statements like hledger's `bs`, `is` and `cf`, valued in one reference currency:
 * a balance sheet at a date (balances valued at that date), an income statement over a period
 * (each posting valued at its transaction date, its own @@ cost first), a cash flow over a period.
 */

export interface StatementRow {
  account: string
  /** last segment of the account name */
  name: string
  /** 0 = first level under the section root */
  depth: number
  leaf: boolean
  value: Decimal
  byCommodity: Map<string, Decimal>
}

export interface Section {
  rows: StatementRow[]
  total: Decimal
  byCommodity: Map<string, Decimal>
}

export interface BalanceSheet {
  date: string
  assets: Section
  liabilities: Section
  equity: Section
  /** income − expenses since the beginning (shown positive when a profit) */
  result: Decimal
  /** valuation differences between currencies (assets − liabilities − equity − result) */
  exchange: Decimal
  /** commodities without a rate (left out of the values) */
  missing: string[]
}

export interface IncomeStatement {
  begin?: string
  end?: string
  revenues: Section
  expenses: Section
  /** revenues − expenses */
  result: Decimal
  missing: string[]
}

export interface CashFlow {
  begin?: string
  end?: string
  cash: Section
  missing: string[]
}

type Leaf = { value: Decimal; byCommodity: Map<string, Decimal> }

/** Builds an account tree under `root` from leaf values (parents summed), siblings largest first. */
export function tree(leaves: Map<string, Leaf>, root: string): Section {
  const nodes = new Map<string, Leaf & { leaf: boolean }>()
  const add = (name: string, v: Leaf, leaf: boolean) => {
    let n = nodes.get(name)
    if (!n) nodes.set(name, (n = { value: ZERO, byCommodity: new Map(), leaf }))
    if (!leaf) n.leaf = false
    n.value = n.value.plus(v.value)
    for (const [c, q] of v.byCommodity) n.byCommodity.set(c, (n.byCommodity.get(c) ?? ZERO).plus(q))
  }
  const total: Leaf = { value: ZERO, byCommodity: new Map() }
  for (const [name, v] of leaves) {
    if (name !== root && !name.startsWith(root + ':')) continue
    if (v.value.isZero() && [...v.byCommodity.values()].every((q) => q.isZero())) continue
    total.value = total.value.plus(v.value)
    for (const [c, q] of v.byCommodity) total.byCommodity.set(c, (total.byCommodity.get(c) ?? ZERO).plus(q))
    const parts = name.split(':')
    const rootDepth = root.split(':').length
    for (let k = rootDepth + 1; k <= parts.length; k++) add(parts.slice(0, k).join(':'), v, k === parts.length)
  }
  for (const [c, q] of total.byCommodity) if (q.toDecimalPlaces(2).isZero()) total.byCommodity.delete(c)
  const rootDepth = root.split(':').length
  const children = (parent: string) =>
    [...nodes.keys()]
      .filter((n) => n.startsWith(parent + ':') && n.split(':').length === parent.split(':').length + 1)
      .sort((a, b) => nodes.get(b)!.value.abs().cmp(nodes.get(a)!.value.abs()) || a.localeCompare(b))
  const rows: StatementRow[] = []
  const walk = (parent: string) => {
    for (const n of children(parent)) {
      const v = nodes.get(n)!
      for (const [c, q] of v.byCommodity) if (q.toDecimalPlaces(2).isZero()) v.byCommodity.delete(c)
      if (v.value.toDecimalPlaces(2).isZero() && !v.byCommodity.size) continue
      rows.push({ account: n, name: n.split(':').at(-1)!, depth: n.split(':').length - rootDepth - 1, leaf: v.leaf, value: v.value, byCommodity: v.byCommodity })
      walk(n)
    }
  }
  walk(root)
  return { rows, total: total.value, byCommodity: total.byCommodity }
}

function valued(bals: Map<string, MixedAmount>, ref: string, date: string, db: PriceDB, negate: (a: string) => boolean, missing: Set<string>) {
  const out = new Map<string, Leaf>()
  for (const [account, m] of bals) {
    const s = negate(account) ? -1 : 1
    const byCommodity = new Map([...m.byCommodity()].map(([c, q]) => [c, q.times(s)]))
    const v = valueIn(byCommodity, ref, date, db)
    for (const c of v.missing.keys()) missing.add(c)
    out.set(account, { value: v.total, byCommodity })
  }
  return out
}

const nextDay = (d: string) => {
  const t = new Date(d + 'T00:00:00Z')
  t.setUTCDate(t.getUTCDate() + 1)
  return t.toISOString().slice(0, 10)
}

/** Balance sheet at the end of `date` (inclusive). Liabilities and equity shown positive. */
export function balanceSheet(
  journal: Pick<Journal, 'transactions'>,
  typeOf: (account: string) => AccountType | undefined,
  date: string,
  ref: string,
  db: PriceDB
): BalanceSheet {
  const bals = balances(journal, { end: nextDay(date) })
  const missing = new Set<string>()
  const credit = (a: string) => ['L', 'E', 'R', 'X'].includes(typeOf(a) ?? '')
  const all = valued(bals, ref, date, db, credit, missing)
  const pick = (f: (t: AccountType | undefined) => boolean) => new Map([...all].filter(([a]) => f(typeOf(a))))
  const assets = tree(pick(isAssetType), 'assets')
  const liabilities = tree(pick((t) => t === 'L'), 'liabilities')
  const equity = tree(pick((t) => t === 'E' || t === undefined), 'equity')
  // R and X are negated above: result = income − expenses = Σ(−R) − Σ(X)
  let result = ZERO
  for (const [a, v] of all) {
    const t = typeOf(a)
    if (t === 'R') result = result.plus(v.value)
    if (t === 'X') result = result.plus(v.value)
  }
  const exchange = assets.total.minus(liabilities.total).minus(equity.total).minus(result)
  return { date, assets, liabilities, equity, result, exchange, missing: [...missing] }
}

/** Per account, the postings of [begin, end) valued at their transaction date (own @@ cost first). */
function flows(
  journal: Pick<Journal, 'transactions'>,
  include: (account: string) => boolean,
  ref: string,
  db: PriceDB,
  begin: string | undefined,
  end: string | undefined,
  sign: (account: string) => number,
  missing: Set<string>
) {
  const out = new Map<string, Leaf>()
  for (const tx of journal.transactions) {
    if (begin && tx.date < begin) continue
    if (end && tx.date >= end) continue
    const amounts = postingAmounts(tx)
    tx.postings.forEach((p, i) => {
      if (!include(p.account)) return
      let l = out.get(p.account)
      if (!l) out.set(p.account, (l = { value: ZERO, byCommodity: new Map() }))
      const s = sign(p.account)
      for (const a of amounts[i]) {
        l.byCommodity.set(a.commodity, (l.byCommodity.get(a.commodity) ?? ZERO).plus(a.qty.times(s)))
        const v = valueAt(a, ref, tx.date, db)
        if (v) l.value = l.value.plus(v.times(s))
        else missing.add(a.commodity)
      }
    })
  }
  return out
}

/** Income statement for [begin, end): revenues and expenses shown positive. */
export function incomeStatement(
  journal: Pick<Journal, 'transactions'>,
  typeOf: (account: string) => AccountType | undefined,
  begin: string | undefined,
  end: string | undefined,
  ref: string,
  db: PriceDB
): IncomeStatement {
  const missing = new Set<string>()
  const f = flows(journal, (a) => ['R', 'X'].includes(typeOf(a) ?? ''), ref, db, begin, end, (a) => (typeOf(a) === 'R' ? -1 : 1), missing)
  const revenues = tree(new Map([...f].filter(([a]) => typeOf(a) === 'R')), 'income')
  const expenses = tree(new Map([...f].filter(([a]) => typeOf(a) === 'X')), 'expenses')
  return { begin, end, revenues, expenses, result: revenues.total.minus(expenses.total), missing: [...missing] }
}

/** Cash flow for [begin, end): change of each cash account (type C), valued at transaction dates. */
export function cashFlowStatement(
  journal: Pick<Journal, 'transactions'>,
  typeOf: (account: string) => AccountType | undefined,
  begin: string | undefined,
  end: string | undefined,
  ref: string,
  db: PriceDB
): CashFlow {
  const missing = new Set<string>()
  const f = flows(journal, (a) => typeOf(a) === 'C', ref, db, begin, end, () => 1, missing)
  return { begin, end, cash: tree(f, 'assets'), missing: [...missing] }
}
