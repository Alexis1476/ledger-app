import { describe, expect, it } from 'vitest'
import { cashFlow, type Flow } from '../../src/ledger/analytics'
import { Decimal } from '../../src/ledger/decimal'
import { breakdown, change, filterFlows, groupOf, periodMonths, previousMonths, seriesMonths, sumFlows, topSeries, totals, trend, within } from '../../src/ledger/insights'

const flow = (month: string, by: Record<string, string>): [string, Flow] => {
  const byAccount = new Map(Object.entries(by).map(([a, v]) => [a, new Decimal(v)]))
  return [month, { month, byAccount, total: [...byAccount.values()].reduce((s, v) => s.plus(v), new Decimal(0)) }]
}
const expenses = new Map([
  flow('2026-09', { 'expenses:food:groceries': '300', 'expenses:dining:restaurants': '120', 'expenses:housing:rent': '900' }),
  flow('2026-10', { 'expenses:food:groceries': '280', 'expenses:food:bakery': '20', 'expenses:housing:rent': '900', 'expenses:fees:bank': '-5' }),
  flow('2026-11', { 'expenses:food:groceries': '100', 'expenses:dining:restaurants': '60' })
])
const income = new Map([flow('2026-09', { 'income:work:salary': '4000' }), flow('2026-10', { 'income:work:salary': '4000' })])
const months = ['2026-09', '2026-10', '2026-11']

describe('periodMonths', () => {
  it('gives the months of each period, oldest first', () => {
    expect(periodMonths('month', '2026-11')).toEqual(['2026-11'])
    expect(periodMonths('3m', '2026-01')).toEqual(['2025-11', '2025-12', '2026-01'])
    expect(periodMonths('year', '2026-03')).toEqual(['2026-01', '2026-02', '2026-03'])
    expect(periodMonths('lastYear', '2026-03')).toHaveLength(12)
    expect(periodMonths('lastYear', '2026-03')[0]).toBe('2025-01')
    expect(periodMonths('lastYear', '2026-03')[11]).toBe('2025-12')
  })
  it('all time starts at the first transaction', () => {
    expect(periodMonths('all', '2026-02', '2025-11')).toEqual(['2025-11', '2025-12', '2026-01', '2026-02'])
    expect(periodMonths('all', '2026-02', '2026-02')).toEqual(['2026-02'])
    expect(periodMonths('all', '2026-02', '2027-01')).toEqual(['2026-02']) // a future-dated entry does not break it
  })
  it('a chart over time is widened when the period is too short', () => {
    expect(seriesMonths(['2026-11'])).toHaveLength(6)
    expect(seriesMonths(['2026-11'])[5]).toBe('2026-11')
    expect(seriesMonths(months)).toEqual(months)
  })
})

describe('breakdown', () => {
  it('sums by group, largest first, without what is negative', () => {
    const b = breakdown(expenses, months, 'group')
    expect(b.items.map((x) => [x.account, x.value.toString()])).toEqual([
      ['expenses:housing', '1800'],
      ['expenses:food', '700'],
      ['expenses:dining', '180']
    ])
    expect(b.total.toString()).toBe('2680')
    expect(b.other.toString()).toBe('0')
  })
  it('sums by category and folds the tail into "other"', () => {
    const b = breakdown(expenses, months, 'category', 2)
    expect(b.items.map((x) => x.account)).toEqual(['expenses:housing:rent', 'expenses:food:groceries'])
    expect(b.other.toString()).toBe('200') // restaurants 180 + bakery 20
    expect(b.total.toString()).toBe('2680')
  })
  it('only counts the months asked for', () => {
    expect(breakdown(expenses, ['2026-11'], 'group').total.toString()).toBe('160')
  })
})

describe('trend, filter, totals', () => {
  it('follows a group or a category month by month', () => {
    const [food, rent] = trend(expenses, months, ['expenses:food', 'expenses:housing:rent'])
    expect(food.values.map(String)).toEqual(['300', '300', '100'])
    expect(food.total.toString()).toBe('700')
    expect(rent.values.map(String)).toEqual(['900', '900', '0'])
  })
  it('within and groupOf follow the account tree', () => {
    expect(within('expenses:food:groceries', 'expenses:food')).toBe(true)
    expect(within('expenses:foodie', 'expenses:food')).toBe(false)
    expect(groupOf('expenses:food:groceries')).toBe('expenses:food')
    expect(groupOf('expenses:uncategorized')).toBe('expenses:uncategorized')
  })
  it('keeps only some categories and recomputes the totals', () => {
    const f = filterFlows(expenses, (a) => within(a, 'expenses:food'))
    expect(f.get('2026-10')!.total.toString()).toBe('300')
    expect([...f.get('2026-09')!.byAccount.keys()]).toEqual(['expenses:food:groceries'])
  })
  it('totals: net, savings rate and monthly average', () => {
    const t = totals(cashFlow(income, expenses, months))
    expect(t.income.toString()).toBe('8000')
    expect(t.expenses.toString()).toBe('2675')
    expect(t.net.toString()).toBe('5325')
    expect(t.savingsRate).toBe(67)
    expect(t.monthly.toDecimalPlaces(2).toString()).toBe('891.67')
    expect(totals(cashFlow(new Map(), expenses, months)).savingsRate).toBeUndefined()
  })

describe('spending over time', () => {
  it('splits each month between the largest groups and the rest', () => {
    const t = topSeries(expenses, months, 'group', 2)
    expect(t.series.map((x) => x.key)).toEqual(['expenses:housing', 'expenses:food'])
    expect(t.series[1].values.map(String)).toEqual(['300', '300', '100'])
    expect(t.other.values.map(String)).toEqual(['120', '0', '60']) // October: the −5 refund does not make a negative part
    expect(t.other.total.toString()).toBe('180')
  })
  it('compares with the months just before', () => {
    expect(previousMonths(['2026-01', '2026-02', '2026-03'])).toEqual(['2025-10', '2025-11', '2025-12'])
    expect(previousMonths(['2026-11'])).toEqual(['2026-10'])
    expect(sumFlows(expenses, ['2026-09', '2026-10']).toString()).toBe('2515')
    expect(change(new Decimal(160), new Decimal(1195))).toBe(-87)
    expect(change(new Decimal(160), new Decimal(0))).toBeUndefined()
  })
})
})
