import { describe, expect, it } from 'vitest'
import { cashFlow, lastMonths, monthEnd, monthlyFlows, netWorthSeries, topAccounts, valueAt } from '../../src/ledger/analytics'
import { Decimal } from '../../src/ledger/decimal'
import { parseFile } from '../../src/ledger/parser'
import { accountType, buildPriceDB } from '../../src/ledger/reports'
import { recipesJournal } from './helpers'

const journal = recipesJournal()
const db = buildPriceDB(journal)
const typeOf = (a: string) => accountType(a, journal.accounts)

describe('analytics', () => {
  it('values a foreign amount with its own CHF cost, else the market rate', () => {
    const fx = journal.transactions.find((t) => t.payee === 'Restaurant')!.postings[0].amount!
    expect(valueAt(fx, 'CHF', '2026-11-09', db)!.toFixed(2)).toBe('38.10') // the @@ cost, not a market rate
    const eur = { qty: new Decimal(100), commodity: 'EUR' }
    expect(valueAt(eur, 'CHF', '2026-11-06', db)!.toFixed(2)).toBe('92.35') // last rate of the day (the EUR → CHF exchange, H2)
    // before the first known rate: the first rate after the date
    expect(valueAt(eur, 'CHF', '2020-01-01', db)!.toFixed(2)).toBe('92.35')
  })

  it('monthly expenses and income in CHF', () => {
    const exp = monthlyFlows(journal, typeOf, 'X', 'CHF', db)
    const inc = monthlyFlows(journal, typeOf, 'R', 'CHF', db)
    const nov = exp.get('2026-11')!
    // groceries 84.35 + 13.15, restaurants 21.15, bank fee 0.95, travel 38.10
    expect(nov.byAccount.get('expenses:food:groceries')!.toFixed(2)).toBe('97.50')
    expect(nov.byAccount.get('expenses:travel')!.toFixed(2)).toBe('38.10')
    expect(nov.total.toFixed(2)).toBe('157.70')
    // salary 4329.50 + gift 100 EUR at the Nov rate (0.9235)
    expect(inc.get('2026-11')!.total.toFixed(2)).toBe('4421.85')
    const rows = cashFlow(inc, exp, ['2026-10', '2026-11'])
    expect(rows.map((r) => [r.month, r.net.toFixed(2)])).toEqual([
      ['2026-10', '0.00'],
      ['2026-11', '4264.15']
    ])
    expect(topAccounts(exp, ['2026-11'])[0].account).toBe('expenses:food:groceries')
  })

  it('net worth at month ends: money I owe people is excluded', () => {
    const inNW = (a: string) => a.startsWith('assets:') || a.startsWith('liabilities:')
    const pts = netWorthSeries(journal, inNW, ['2026-10', '2026-11'], 'CHF', db)
    expect(pts[0].value.toFixed(2)).toBe('0.00')
    expect(pts[1].missing).toEqual([])
    // a deposit from an owner does not change my net worth
    const j = parseFile(
      '2026-01-01 * a\n    assets:cash:chf  100.00 CHF\n    liabilities:people:sam  -100.00 CHF\n'
    )
    expect(netWorthSeries(j, inNW, ['2026-01'], 'CHF', db)[0].value.toFixed(2)).toBe('0.00')
  })

  it('month helpers', () => {
    expect(lastMonths('2026-02', 3)).toEqual(['2025-12', '2026-01', '2026-02'])
    expect(monthEnd('2028-02')).toBe('2028-02-29')
  })
})
