import type { Flow } from './analytics'
import { Decimal, ZERO } from './decimal'
import { within } from './insights'

/**
 * Budgets: a monthly limit per expense category or group (`expenses:dining` counts all its
 * categories), in the reference currency. Pure: the limits come from app.config.json, the
 * spending from the monthly flows of analytics.ts.
 */

/** `ok` within the limit · `ahead` spending faster than the month goes by · `over` above the limit */
export type BudgetState = 'ok' | 'ahead' | 'over'

export interface BudgetLine {
  key: string
  /** the monthly limit times the number of months */
  limit: Decimal
  spent: Decimal
  /** what is left (negative when over) */
  left: Decimal
  /** spent ÷ limit, 0 when there is no limit */
  ratio: number
  state: BudgetState
}

/**
 * Where each budget stands over some months. `elapsed` is the share of the period gone by
 * (0–1): the spending is compared with it to say when it goes too fast.
 */
export function budgetStatus(flows: Map<string, Flow>, months: string[], budgets: Record<string, string>, elapsed = 1): BudgetLine[] {
  const n = months.length || 1
  return Object.entries(budgets)
    .map(([key, monthly]) => {
      const limit = new Decimal(monthly).times(n)
      let spent = ZERO
      for (const m of months) for (const [a, v] of flows.get(m)?.byAccount ?? []) if (within(a, key)) spent = spent.plus(v)
      const ratio = limit.gt(0) ? spent.div(limit).toNumber() : 0
      const state: BudgetState = spent.gt(limit) ? 'over' : ratio > Math.min(1, elapsed) + 0.1 ? 'ahead' : 'ok'
      return { key, limit, spent, left: limit.minus(spent), ratio, state }
    })
    .sort((a, b) => b.ratio - a.ratio)
}

/** Share of a month gone by on `date` (YYYY-MM-DD), counting that day. */
export function monthElapsed(date: string): number {
  const [y, m, d] = date.split('-').map(Number)
  const days = new Date(Date.UTC(y, m, 0)).getUTCDate()
  return d / days
}

/** app.config.json with the monthly budget of `key` set (an amount) or removed (undefined). */
export function withBudget(text: string | undefined, key: string, amount?: string): string {
  const cfg = JSON.parse(text?.trim() ? text : '{}') as Record<string, unknown>
  const budgets = { ...((cfg.budgets as Record<string, string> | undefined) ?? {}) }
  if (amount === undefined) delete budgets[key]
  else budgets[key] = new Decimal(amount).toFixed(2)
  cfg.budgets = budgets
  return `${JSON.stringify(cfg, null, 2)}\n`
}
