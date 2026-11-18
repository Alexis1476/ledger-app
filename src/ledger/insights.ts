import { lastMonths, type CashFlowRow, type Flow } from './analytics'
import { Decimal, ZERO } from './decimal'

/**
 * Numbers behind the Insights page (pure: no Vue, no DOM). Everything is derived from the
 * monthly flows of analytics.ts, already valued in the reference currency.
 */

export const PERIODS = ['month', '3m', '6m', '12m', 'year', 'lastYear', 'all'] as const
export type PeriodKey = (typeof PERIODS)[number]

export const PERIOD_LABEL: Record<PeriodKey, string> = {
  month: 'This month',
  '3m': 'Last 3 months',
  '6m': 'Last 6 months',
  '12m': 'Last 12 months',
  year: 'This year',
  lastYear: 'Last year',
  all: 'All time'
}

/** The months (YYYY-MM, oldest first) of a period. `first` is the month of the oldest transaction. */
export function periodMonths(key: PeriodKey, thisMonth: string, first: string = thisMonth): string[] {
  const year = Number(thisMonth.slice(0, 4))
  switch (key) {
    case 'month':
      return [thisMonth]
    case '3m':
      return lastMonths(thisMonth, 3)
    case '6m':
      return lastMonths(thisMonth, 6)
    case '12m':
      return lastMonths(thisMonth, 12)
    case 'year':
      return lastMonths(thisMonth, Number(thisMonth.slice(5, 7)))
    case 'lastYear':
      return lastMonths(`${year - 1}-12`, 12)
    case 'all': {
      const from = first < thisMonth ? first : thisMonth
      const n = (year - Number(from.slice(0, 4))) * 12 + Number(thisMonth.slice(5, 7)) - Number(from.slice(5, 7)) + 1
      return lastMonths(thisMonth, n)
    }
  }
}

/** A chart over time needs a few points: a period shorter than `min` months is widened to it. */
export function seriesMonths(months: string[], min = 6): string[] {
  return months.length >= 3 || !months.length ? months : lastMonths(months[months.length - 1], min)
}

/** The same number of months just before a period (to compare with it). */
export function previousMonths(months: string[]): string[] {
  if (!months.length) return []
  const [y, m] = months[0].split('-').map(Number)
  const d = new Date(Date.UTC(y, m - 2, 1))
  return lastMonths(`${d.getUTCFullYear()}-${String(d.getUTCMonth() + 1).padStart(2, '0')}`, months.length)
}

/** Does `account` belong to `key` (itself, or one of its sub-accounts)? */
export const within = (account: string, key: string) => account === key || account.startsWith(key + ':')

/** The group of a category: expenses:food:groceries → expenses:food (a category without a group is its own). */
export const groupOf = (account: string) => account.split(':').slice(0, 2).join(':')

/** The flows restricted to some accounts (totals recomputed). */
export function filterFlows(flows: Map<string, Flow>, keep: (account: string) => boolean): Map<string, Flow> {
  const out = new Map<string, Flow>()
  for (const [month, f] of flows) {
    const byAccount = new Map([...f.byAccount].filter(([a]) => keep(a)))
    out.set(month, { month, byAccount, total: [...byAccount.values()].reduce((s, v) => s.plus(v), ZERO) })
  }
  return out
}

export interface Share {
  account: string
  value: Decimal
}
export interface Breakdown {
  /** largest first */
  items: Share[]
  /** what is beyond the `keep` largest, in one amount */
  other: Decimal
  total: Decimal
}

/**
 * Where the money went over some months, by group (expenses:food) or by category, largest first.
 * Only what is positive counts (a category that is a net refund is left out).
 */
export function breakdown(flows: Map<string, Flow>, months: string[], level: 'group' | 'category', keep = 6): Breakdown {
  const sum = new Map<string, Decimal>()
  for (const m of months) {
    for (const [a, v] of flows.get(m)?.byAccount ?? []) {
      const k = level === 'group' ? groupOf(a) : a
      sum.set(k, (sum.get(k) ?? ZERO).plus(v))
    }
  }
  const all = [...sum].map(([account, value]) => ({ account, value })).filter((x) => x.value.gt(0)).sort((a, b) => b.value.cmp(a.value))
  return {
    items: all.slice(0, keep),
    other: all.slice(keep).reduce((s, x) => s.plus(x.value), ZERO),
    total: all.reduce((s, x) => s.plus(x.value), ZERO)
  }
}

/** Month by month, what went to each of `keys` (a group counts all its categories). */
export function trend(flows: Map<string, Flow>, months: string[], keys: string[]): { key: string; values: Decimal[]; total: Decimal }[] {
  return keys.map((key) => {
    const values = months.map((m) => [...(flows.get(m)?.byAccount ?? [])].reduce((s, [a, v]) => (within(a, key) ? s.plus(v) : s), ZERO))
    return { key, values, total: values.reduce((s, v) => s.plus(v), ZERO) }
  })
}

/**
 * Spending month by month, split between the `keep` largest groups (or categories) of the period
 * and everything else in one "other" series: nothing to choose, and the parts add up to the total.
 */
export function topSeries(
  flows: Map<string, Flow>,
  months: string[],
  level: 'group' | 'category',
  keep = 4
): { series: { key: string; values: Decimal[]; total: Decimal }[]; other: { values: Decimal[]; total: Decimal } } {
  const top = breakdown(flows, months, level, keep).items.map((x) => x.account)
  const series = trend(flows, months, top)
  const values = months.map((m, i) => {
    const rest = (flows.get(m)?.total ?? ZERO).minus(series.reduce((s, x) => s.plus(x.values[i]), ZERO))
    return rest.gt(0) ? rest : ZERO
  })
  return { series, other: { values, total: values.reduce((s, v) => s.plus(v), ZERO) } }
}

/** Sum of the flows over some months. */
export const sumFlows = (flows: Map<string, Flow>, months: string[]) => months.reduce((s, m) => s.plus(flows.get(m)?.total ?? ZERO), ZERO)

/** Change from `before` to `now` in %, when the base is positive. */
export function change(now: Decimal, before: Decimal): number | undefined {
  return before.gt(0) ? now.minus(before).div(before).times(100).toDecimalPlaces(0).toNumber() : undefined
}

export interface Totals {
  income: Decimal
  expenses: Decimal
  net: Decimal
  /** net / income in %, when there is an income */
  savingsRate?: number
  /** expenses per month on average */
  monthly: Decimal
}

export function totals(rows: CashFlowRow[]): Totals {
  const income = rows.reduce((s, r) => s.plus(r.income), ZERO)
  const expenses = rows.reduce((s, r) => s.plus(r.expenses), ZERO)
  const net = income.minus(expenses)
  return {
    income,
    expenses,
    net,
    savingsRate: income.gt(0) ? net.div(income).times(100).toDecimalPlaces(0).toNumber() : undefined,
    monthly: rows.length ? expenses.div(rows.length) : ZERO
  }
}
