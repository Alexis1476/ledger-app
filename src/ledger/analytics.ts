import { Decimal, ZERO } from './decimal'
import { costTotal, postingAmounts, sortByDate, type AccountType, type PriceDB } from './reports'
import type { Amount, Journal, Transaction } from './types'

/** Value of an amount in `ref` on `date`: its own @@ cost when that is in `ref`, else the market rate. */
export function valueAt(a: Amount, ref: string, date: string, db: PriceDB): Decimal | undefined {
  if (a.commodity === ref) return a.qty
  const ct = costTotal(a)
  if (ct && ct.commodity === ref) return ct.qty
  const r = db.rateNear(a.commodity, ref, date)
  return r ? a.qty.times(r) : undefined
}

export interface Flow {
  /** YYYY-MM */
  month: string
  /** account → value in ref (expenses positive, income positive) */
  byAccount: Map<string, Decimal>
  total: Decimal
}

/**
 * Per month, the flows of accounts of one type (X = expenses, R = income) converted to `ref`
 * at the transaction date. Income is returned positive. `include` keeps only some transactions
 * (e.g. those touching my own pockets).
 */
export function monthlyFlows(
  journal: Pick<Journal, 'transactions'>,
  typeOf: (account: string) => AccountType | undefined,
  type: 'X' | 'R',
  ref: string,
  db: PriceDB,
  include: (tx: Transaction) => boolean = () => true
): Map<string, Flow> {
  const out = new Map<string, Flow>()
  const sign = type === 'R' ? -1 : 1
  for (const tx of journal.transactions) {
    if (!include(tx)) continue
    const amounts = postingAmounts(tx)
    tx.postings.forEach((p, i) => {
      if (typeOf(p.account) !== type) return
      for (const a of amounts[i]) {
        const v = valueAt(a, ref, tx.date, db)
        if (!v) continue
        const month = tx.date.slice(0, 7)
        let f = out.get(month)
        if (!f) out.set(month, (f = { month, byAccount: new Map(), total: ZERO }))
        const q = v.times(sign)
        f.byAccount.set(p.account, (f.byAccount.get(p.account) ?? ZERO).plus(q))
        f.total = f.total.plus(q)
      }
    })
  }
  return out
}

/** Consecutive months (YYYY-MM) ending with `last`, oldest first. */
export function lastMonths(last: string, n: number): string[] {
  const [y, m] = last.split('-').map(Number)
  return Array.from({ length: n }, (_, k) => {
    const d = new Date(Date.UTC(y, m - 1 - (n - 1 - k), 1))
    return `${d.getUTCFullYear()}-${String(d.getUTCMonth() + 1).padStart(2, '0')}`
  })
}

export interface CashFlowRow {
  month: string
  income: Decimal
  expenses: Decimal
  net: Decimal
}

export function cashFlow(income: Map<string, Flow>, expenses: Map<string, Flow>, months: string[]): CashFlowRow[] {
  return months.map((month) => {
    const i = income.get(month)?.total ?? ZERO
    const e = expenses.get(month)?.total ?? ZERO
    return { month, income: i, expenses: e, net: i.minus(e) }
  })
}

/** Accounts sorted by value for one period (several months summed), largest first. */
export function topAccounts(flows: Map<string, Flow>, months: string[]): { account: string; value: Decimal }[] {
  const sum = new Map<string, Decimal>()
  for (const m of months) for (const [a, v] of flows.get(m)?.byAccount ?? []) sum.set(a, (sum.get(a) ?? ZERO).plus(v))
  return [...sum].map(([account, value]) => ({ account, value })).filter((x) => !x.value.isZero()).sort((a, b) => b.value.cmp(a.value))
}

export interface NetWorthPoint {
  month: string
  /** value in ref at the end of the month */
  value: Decimal
  /** commodities without any rate (excluded from value) */
  missing: string[]
}

/**
 * Worth (sum of the accounts where `inNetWorth` is true, e.g. assets + liabilities) at the end of
 * each month, valued with the rate of that month end.
 */
export function netWorthSeries(
  journal: Pick<Journal, 'transactions'>,
  inNetWorth: (account: string) => boolean,
  months: string[],
  ref: string,
  db: PriceDB
): NetWorthPoint[] {
  const txs = sortByDate(journal.transactions)
  const byC = new Map<string, Decimal>()
  const out: NetWorthPoint[] = []
  let i = 0
  for (const month of months) {
    const end = monthEnd(month)
    for (; i < txs.length && txs[i].date <= end; i++) {
      const amounts = postingAmounts(txs[i])
      txs[i].postings.forEach((p, k) => {
        if (!inNetWorth(p.account)) return
        for (const a of amounts[k]) byC.set(a.commodity, (byC.get(a.commodity) ?? ZERO).plus(a.qty))
      })
    }
    let value = ZERO
    const missing: string[] = []
    for (const [c, q] of byC) {
      if (q.isZero()) continue
      const r = c === ref ? new Decimal(1) : db.rateNear(c, ref, end)
      if (r) value = value.plus(q.times(r))
      else missing.push(c)
    }
    out.push({ month, value, missing })
  }
  return out
}

export function monthEnd(month: string): string {
  const [y, m] = month.split('-').map(Number)
  const d = new Date(Date.UTC(y, m, 0))
  return `${month}-${String(d.getUTCDate()).padStart(2, '0')}`
}
