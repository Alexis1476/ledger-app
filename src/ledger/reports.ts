import { Decimal, ZERO } from './decimal'
import type { AccountDecl, Amount, Journal, Transaction } from './types'

// ── Amount helpers ─────────────────────────────────────────────────────

/** Signed total cost of an amount (hledger convention: same sign as the quantity). */
export function costTotal(a: Amount): Amount | undefined {
  if (!a.cost) return undefined
  const c = a.cost
  const qty = c.kind === 'total' ? c.qty.abs().times(a.qty.isNeg() ? -1 : 1) : c.qty.times(a.qty)
  return { qty, commodity: c.commodity }
}

/** The amount that counts for balancing: its cost if it has one, else itself. */
export function balancingAmount(a: Amount): Amount {
  return costTotal(a) ?? { qty: a.qty, commodity: a.commodity }
}

export interface AmountLine {
  commodity: string
  qty: Decimal
  /** summed signed total cost, when the amounts carried a cost */
  cost?: { commodity: string; qty: Decimal }
}

/** A sum of amounts in several commodities. Costed amounts are kept apart, like hledger's balance report. */
export class MixedAmount {
  readonly lines = new Map<string, AmountLine>()

  add(a: Amount): this {
    const ct = costTotal(a)
    const key = ct ? `${a.commodity}@@${ct.commodity}` : a.commodity
    const cur = this.lines.get(key)
    if (!cur) {
      this.lines.set(key, {
        commodity: a.commodity,
        qty: a.qty,
        cost: ct ? { commodity: ct.commodity, qty: ct.qty } : undefined
      })
    } else {
      cur.qty = cur.qty.plus(a.qty)
      if (ct && cur.cost) cur.cost.qty = cur.cost.qty.plus(ct.qty)
    }
    return this
  }

  addMixed(m: MixedAmount): this {
    for (const l of m.lines.values()) {
      this.add({
        qty: l.qty,
        commodity: l.commodity,
        cost: l.cost ? { qty: l.cost.qty, commodity: l.cost.commodity, kind: 'total' } : undefined
      })
    }
    return this
  }

  /** Quantities per commodity, costs ignored. Zero commodities removed. */
  byCommodity(): Map<string, Decimal> {
    const out = new Map<string, Decimal>()
    for (const l of this.lines.values()) out.set(l.commodity, (out.get(l.commodity) ?? ZERO).plus(l.qty))
    for (const [k, v] of out) if (v.isZero()) out.delete(k)
    return out
  }

  isZero(): boolean {
    return this.byCommodity().size === 0
  }

  /** Non-zero lines (hledger drops zero amounts from a row). */
  nonZeroLines(): AmountLine[] {
    return [...this.lines.values()].filter((l) => !l.qty.isZero())
  }
}

// ── Implicit amounts ───────────────────────────────────────────────────

/** Amounts for each posting, inferring the implicit one (possibly several commodities). */
export function postingAmounts(tx: Transaction): Amount[][] {
  const sums = new Map<string, Decimal>()
  let implicit = -1
  tx.postings.forEach((p, i) => {
    if (!p.amount) {
      if (implicit < 0) implicit = i
      return
    }
    const b = balancingAmount(p.amount)
    sums.set(b.commodity, (sums.get(b.commodity) ?? ZERO).plus(b.qty))
  })
  return tx.postings.map((p, i) => {
    if (p.amount) return [p.amount]
    if (i !== implicit) return []
    return [...sums]
      .filter(([, q]) => !q.isZero())
      .map(([commodity, q]) => ({ qty: q.neg(), commodity }))
  })
}

// ── Accounts ───────────────────────────────────────────────────────────

export type AccountType = 'A' | 'L' | 'E' | 'R' | 'X' | 'C' | 'V'

export function accountType(name: string, decls: AccountDecl[]): AccountType | undefined {
  const byName = new Map(decls.map((d) => [d.name, d]))
  const parts = name.split(':')
  for (let k = parts.length; k > 0; k--) {
    const t = byName.get(parts.slice(0, k).join(':'))?.tags.type?.trim()
    if (t) return t[0].toUpperCase() as AccountType
  }
  const top = name.split(':')[0].toLowerCase()
  const guess: Record<string, AccountType> = {
    assets: 'A',
    asset: 'A',
    liabilities: 'L',
    liability: 'L',
    equity: 'E',
    income: 'R',
    revenues: 'R',
    revenue: 'R',
    expenses: 'X',
    expense: 'X'
  }
  return guess[top]
}

export function isAssetType(t: AccountType | undefined): boolean {
  return t === 'A' || t === 'C'
}

export function isEquityType(t: AccountType | undefined): boolean {
  return t === 'E' || t === 'V'
}

/** Declared accounts that have no declared children. */
export function leafAccounts(decls: AccountDecl[]): string[] {
  const names = decls.map((d) => d.name)
  return names.filter((n) => !names.some((o) => o.startsWith(n + ':')))
}

export function isLeaf(name: string, decls: AccountDecl[]): boolean {
  return decls.some((d) => d.name === name) && !decls.some((d) => d.name.startsWith(name + ':'))
}

// ── Balances ───────────────────────────────────────────────────────────

export interface BalanceOptions {
  /** inclusive start date YYYY-MM-DD */
  begin?: string
  /** exclusive end date YYYY-MM-DD (hledger -e) */
  end?: string
  filter?: (account: string) => boolean
}

/** Balance per account (exclusive of subaccounts), like `hledger bal` in flat mode. */
export function balances(journal: Pick<Journal, 'transactions'>, opts: BalanceOptions = {}): Map<string, MixedAmount> {
  const out = new Map<string, MixedAmount>()
  for (const tx of journal.transactions) {
    if (opts.begin && tx.date < opts.begin) continue
    if (opts.end && tx.date >= opts.end) continue
    const amounts = postingAmounts(tx)
    tx.postings.forEach((p, i) => {
      if (opts.filter && !opts.filter(p.account)) return
      let m = out.get(p.account)
      for (const a of amounts[i]) {
        if (!m) out.set(p.account, (m = new MixedAmount()))
        m.add(a)
      }
    })
  }
  return out
}

/** Sum of an account and all its subaccounts. */
export function inclusiveBalance(bals: Map<string, MixedAmount>, account: string): MixedAmount {
  const out = new MixedAmount()
  for (const [name, m] of bals) if (name === account || name.startsWith(account + ':')) out.addMixed(m)
  return out
}

// ── Prices and valuation ───────────────────────────────────────────────

interface PriceEntry {
  date: string
  rate: Decimal
  declared: boolean
  order: number
}

export class PriceDB {
  private pairs = new Map<string, PriceEntry[]>()

  add(from: string, to: string, date: string, rate: Decimal, declared: boolean, order: number) {
    if (from === to || rate.isZero()) return
    const key = `${from}>${to}`
    let list = this.pairs.get(key)
    if (!list) this.pairs.set(key, (list = []))
    list.push({ date, rate, declared, order })
  }

  /** Latest entry on or before `date`; same date: declared beats inferred, then parse order. */
  private latest(from: string, to: string, date: string): PriceEntry | undefined {
    const list = this.pairs.get(`${from}>${to}`)
    if (!list) return undefined
    let best: PriceEntry | undefined
    for (const e of list) {
      if (e.date > date) continue
      if (
        !best ||
        e.date > best.date ||
        (e.date === best.date && (Number(e.declared) > Number(best.declared) ||
          (e.declared === best.declared && e.order > best.order)))
      ) {
        best = e
      }
    }
    return best
  }

  /**
   * Rate on `date`, or — for dates before the first known price — the first rate after it.
   * Used for history charts (2023 entries before any recorded rate).
   */
  rateNear(from: string, to: string, date: string): Decimal | undefined {
    const r = this.rate(from, to, date)
    if (r) return r
    let first: string | undefined
    for (const [key, list] of this.pairs) {
      const [a, b] = key.split('>')
      if (!((a === from && b === to) || (a === to && b === from))) continue
      for (const e of list) if (e.date > date && (!first || e.date < first)) first = e.date
    }
    return this.rate(from, to, first ?? '9999-12-31')
  }

  private direct(from: string, to: string, date: string): { rate: Decimal; date: string } | undefined {
    const d = this.latest(from, to, date)
    const r = this.latest(to, from, date)
    if (d && (!r || d.date >= r.date)) return { rate: d.rate, date: d.date }
    if (r) return { rate: new Decimal(1).div(r.rate), date: r.date }
    return undefined
  }

  /** Rate to convert 1 `from` into `to` on `date` (direct, reverse, or through one intermediate). */
  rate(from: string, to: string, date: string): Decimal | undefined {
    if (from === to) return new Decimal(1)
    const d = this.direct(from, to, date)
    if (d) return d.rate
    for (const key of this.pairs.keys()) {
      const [a, b] = key.split('>')
      const mid = a === from ? b : b === from ? a : undefined
      if (!mid || mid === to) continue
      const r1 = this.direct(from, mid, date)
      const r2 = this.direct(mid, to, date)
      if (r1 && r2) return r1.rate.times(r2.rate)
    }
    return undefined
  }

  commodities(): string[] {
    const s = new Set<string>()
    for (const k of this.pairs.keys()) k.split('>').forEach((c) => s.add(c))
    return [...s]
  }
}

/** Prices from `P` directives, plus prices inferred from costs (hledger --infer-market-prices). */
export function buildPriceDB(journal: Pick<Journal, 'prices' | 'transactions'>, inferFromCosts = true): PriceDB {
  const db = new PriceDB()
  let order = 0
  for (const p of journal.prices) db.add(p.commodity, p.price.commodity, p.date, p.price.qty, true, order++)
  if (inferFromCosts) {
    for (const tx of journal.transactions) {
      for (const p of tx.postings) {
        const a = p.amount
        if (!a?.cost || a.qty.isZero()) continue
        const unit = a.cost.kind === 'total' ? a.cost.qty.abs().div(a.qty.abs()) : a.cost.qty.abs()
        db.add(a.commodity, a.cost.commodity, tx.date, unit, false, order++)
      }
    }
  }
  return db
}

export interface Valuation {
  total: Decimal
  /** commodities that could not be converted, with their unconverted quantity */
  missing: Map<string, Decimal>
}

/** Market value of an amount in `target` on `date` (costs ignored, like hledger -X). */
export function valueIn(m: MixedAmount | Map<string, Decimal>, target: string, date: string, db: PriceDB): Valuation {
  const byC = m instanceof MixedAmount ? m.byCommodity() : m
  let total = ZERO
  const missing = new Map<string, Decimal>()
  for (const [c, q] of byC) {
    if (q.toDecimalPlaces(2).isZero()) continue
    const r = db.rate(c, target, date)
    if (r) total = total.plus(q.times(r))
    else missing.set(c, q)
  }
  return { total, missing }
}

// ── Balance assertions ─────────────────────────────────────────────────

export interface AssertionFailure {
  tx: Transaction
  postingIndex: number
  account: string
  expected: Decimal
  actual: Decimal
  commodity: string
  message: string
}

/** Recompute every balance assertion in date order (then parse order), like hledger. */
export function checkAssertions(transactions: Transaction[]): AssertionFailure[] {
  const sorted = transactions
    .map((tx, i) => ({ tx, i }))
    .sort((a, b) => (a.tx.date < b.tx.date ? -1 : a.tx.date > b.tx.date ? 1 : (a.tx.index ?? a.i) - (b.tx.index ?? b.i)))
  const running = new Map<string, Map<string, Decimal>>()
  const failures: AssertionFailure[] = []
  const bal = (account: string, commodity: string, inclusive: boolean): Decimal => {
    let sum = ZERO
    for (const [name, m] of running) {
      if (name === account || (inclusive && name.startsWith(account + ':'))) sum = sum.plus(m.get(commodity) ?? ZERO)
    }
    return sum
  }
  for (const { tx } of sorted) {
    const amounts = postingAmounts(tx)
    tx.postings.forEach((p, i) => {
      let m = running.get(p.account)
      if (!m) running.set(p.account, (m = new Map()))
      for (const a of amounts[i]) m.set(a.commodity, (m.get(a.commodity) ?? ZERO).plus(a.qty))
      const as = p.assertion
      if (!as) return
      const c = as.amount.commodity
      const actual = bal(p.account, c, as.inclusive)
      if (!actual.eq(as.amount.qty)) {
        failures.push({
          tx,
          postingIndex: i,
          account: p.account,
          expected: as.amount.qty,
          actual,
          commodity: c,
          message: `balance assertion failed: ${p.account} is ${actual.toFixed()} ${c}, expected ${as.amount.qty.toFixed()} ${c}`
        })
      }
      if (as.total) {
        const others = new Map<string, Decimal>()
        for (const [name, mm] of running) {
          if (name !== p.account && !(as.inclusive && name.startsWith(p.account + ':'))) continue
          for (const [cc, q] of mm) if (cc !== c) others.set(cc, (others.get(cc) ?? ZERO).plus(q))
        }
        for (const [cc, q] of others) {
          if (!q.isZero()) {
            failures.push({
              tx,
              postingIndex: i,
              account: p.account,
              expected: ZERO,
              actual: q,
              commodity: cc,
              message: `total balance assertion failed: ${p.account} also holds ${q.toFixed()} ${cc}`
            })
          }
        }
      }
    })
  }
  return failures
}

// ── Registers and aggregates ───────────────────────────────────────────

export interface RegisterRow {
  tx: Transaction
  postingIndex: number
  amounts: Amount[]
  /** running balance per commodity after this row */
  balance: Map<string, Decimal>
}

export function sortByDate(txs: Transaction[]): Transaction[] {
  return [...txs].sort((a, b) => (a.date < b.date ? -1 : a.date > b.date ? 1 : (a.index ?? 0) - (b.index ?? 0)))
}

/** Postings of one account (and its subaccounts if `inclusive`) with a running balance. */
export function register(journal: Pick<Journal, 'transactions'>, account: string, inclusive = true): RegisterRow[] {
  const rows: RegisterRow[] = []
  const bal = new Map<string, Decimal>()
  for (const tx of sortByDate(journal.transactions)) {
    const amounts = postingAmounts(tx)
    tx.postings.forEach((p, i) => {
      if (!(p.account === account || (inclusive && p.account.startsWith(account + ':')))) return
      for (const a of amounts[i]) bal.set(a.commodity, (bal.get(a.commodity) ?? ZERO).plus(a.qty))
      rows.push({ tx, postingIndex: i, amounts: amounts[i], balance: new Map(bal) })
    })
  }
  return rows
}

/** Per month (YYYY-MM) per account: sum by commodity, for accounts matching `filter`. */
export function monthlyFlows(
  journal: Pick<Journal, 'transactions'>,
  filter: (account: string) => boolean
): Map<string, Map<string, Map<string, Decimal>>> {
  const out = new Map<string, Map<string, Map<string, Decimal>>>()
  for (const tx of journal.transactions) {
    const month = tx.date.slice(0, 7)
    const amounts = postingAmounts(tx)
    tx.postings.forEach((p, i) => {
      if (!filter(p.account)) return
      let byAcc = out.get(month)
      if (!byAcc) out.set(month, (byAcc = new Map()))
      let byC = byAcc.get(p.account)
      if (!byC) byAcc.set(p.account, (byC = new Map()))
      for (const a of amounts[i]) byC.set(a.commodity, (byC.get(a.commodity) ?? ZERO).plus(a.qty))
    })
  }
  return out
}
