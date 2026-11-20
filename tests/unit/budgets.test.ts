import { describe, expect, it } from 'vitest'
import type { Flow } from '../../src/ledger/analytics'
import { budgetStatus, monthElapsed, withBudget } from '../../src/ledger/budgets'
import { Decimal } from '../../src/ledger/decimal'

const flow = (month: string, by: Record<string, string>): [string, Flow] => {
  const byAccount = new Map(Object.entries(by).map(([a, v]) => [a, new Decimal(v)]))
  return [month, { month, byAccount, total: [...byAccount.values()].reduce((s, v) => s.plus(v), new Decimal(0)) }]
}
const flows = new Map([
  flow('2026-10', { 'expenses:dining:restaurants': '150', 'expenses:dining:bars': '20', 'expenses:food:groceries': '400' }),
  flow('2026-11', { 'expenses:dining:restaurants': '90', 'expenses:food:groceries': '520', 'expenses:leisure:sport': '35' })
])

describe('budgets', () => {
  it('a group counts all its categories; the fullest first', () => {
    const lines = budgetStatus(flows, ['2026-10'], { 'expenses:dining': '200', 'expenses:food:groceries': '500' })
    expect(lines.map((l) => [l.key, l.spent.toString(), l.left.toString(), l.state])).toEqual([
      ['expenses:dining', '170', '30', 'ok'],
      ['expenses:food:groceries', '400', '100', 'ok']
    ])
    expect(lines[0].ratio).toBeCloseTo(0.85)
  })

  it('over the limit, or spending faster than the month goes by', () => {
    const half = budgetStatus(flows, ['2026-11'], { 'expenses:food:groceries': '500', 'expenses:dining': '200', 'expenses:leisure': '100' }, 0.5)
    const state = Object.fromEntries(half.map((l) => [l.key, l.state]))
    expect(state).toEqual({ 'expenses:food:groceries': 'over', 'expenses:dining': 'ok', 'expenses:leisure': 'ok' })
    expect(budgetStatus(flows, ['2026-11'], { 'expenses:dining': '120' }, 0.5)[0].state).toBe('ahead') // 75% spent at 50% of the month
  })

  it('several months multiply the limit', () => {
    const [l] = budgetStatus(flows, ['2026-10', '2026-11'], { 'expenses:dining': '150' })
    expect(l.limit.toString()).toBe('300')
    expect(l.spent.toString()).toBe('260')
  })

  it('share of the month gone by', () => {
    expect(monthElapsed('2026-11-15')).toBe(0.5)
    expect(monthElapsed('2026-02-28')).toBe(1)
  })

  it('writes and removes a budget in app.config.json, other keys untouched', () => {
    const text = '{\n  "version": 1,\n  "referenceCurrency": "CHF"\n}\n'
    const set = withBudget(text, 'expenses:dining', '200')
    expect(JSON.parse(set)).toEqual({ version: 1, referenceCurrency: 'CHF', budgets: { 'expenses:dining': '200.00' } })
    expect(set.endsWith('}\n')).toBe(true)
    expect(JSON.parse(withBudget(set, 'expenses:dining')).budgets).toEqual({})
  })
})
