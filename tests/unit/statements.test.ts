import { describe, expect, it } from 'vitest'
import { monthlyFlows } from '../../src/ledger/analytics'
import { parseFile } from '../../src/ledger/parser'
import { accountType, buildPriceDB, isAssetType } from '../../src/ledger/reports'
import { balanceSheet, cashFlowStatement, incomeStatement } from '../../src/ledger/statements'

const journal = parseFile(`
account assets:neo:chf        ; type: C
account assets:neo:eur        ; type: C
account assets:sam:neo:eur    ; type: C
account assets:receivables:eva ; type: A
account liabilities:people:bob ; type: L
account equity:opening        ; type: E
account income:salary         ; type: R
account income:family:sam     ; type: R
account expenses:food         ; type: X
account expenses:family:sam   ; type: X

P 2026-01-01 EUR 0.90 CHF
P 2026-02-28 EUR 0.95 CHF

2026-01-01 * Opening
    assets:neo:chf             1000.00 CHF
    equity:opening

2026-01-05 * Salary
    assets:neo:chf             3000.00 CHF
    income:salary

2026-01-10 * Sam
    assets:sam:neo:eur          500.00 EUR
    income:family:sam

2026-01-12 * Exchange
    assets:neo:eur              100.00 EUR
    assets:neo:chf              -90.00 CHF @@ 100.00 EUR

2026-02-03 * Coop
    expenses:food                50.00 CHF
    assets:neo:chf

2026-02-04 * For Sam
    expenses:family:sam          20.00 EUR
    assets:sam:neo:eur

2026-02-05 * Bob lends me
    assets:neo:chf              200.00 CHF
    liabilities:people:bob

2026-02-06 * Eva
    assets:receivables:eva       30.00 CHF
    assets:neo:chf
`)
const typeOf = (a: string) => accountType(a, journal.accounts)
const db = buildPriceDB(journal)

describe('financial statements', () => {
  it('balance sheet: assets = liabilities + equity + result + exchange differences', () => {
    const bs = balanceSheet(journal, typeOf, '2026-02-28', 'CHF', db)
    expect(bs.assets.byCommodity.get('CHF')!.toFixed(2)).toBe('4060.00') // 1000+3000−90−50+200−30 + Eva 30
    expect(bs.assets.byCommodity.get('EUR')!.toFixed(2)).toBe('580.00')
    // 4060 + 580 × 0.95
    expect(bs.assets.total.toFixed(2)).toBe('4611.00')
    expect(bs.liabilities.total.toFixed(2)).toBe('200.00')
    expect(bs.equity.total.toFixed(2)).toBe('1000.00')
    // income 3000 + 500 EUR, expenses 50 + 20 EUR (valued at 0.95 on the date)
    expect(bs.result.toFixed(2)).toBe('3406.00')
    // the 100 EUR bought for 90 CHF are worth 95 CHF now
    expect(bs.exchange.toFixed(2)).toBe('5.00')
    expect(bs.liabilities.total.plus(bs.equity.total).plus(bs.result).plus(bs.exchange).eq(bs.assets.total)).toBe(true)
  })

  it('tree rows: parents sum their children, depth from the section root', () => {
    const bs = balanceSheet(journal, typeOf, '2026-02-28', 'CHF', db)
    const neo = bs.assets.rows.find((r) => r.account === 'assets:neo')!
    expect(neo).toMatchObject({ depth: 0, leaf: false, name: 'neo' })
    const kids = bs.assets.rows.filter((r) => r.account.startsWith('assets:neo:'))
    expect(kids.every((r) => r.depth === 1 && r.leaf)).toBe(true)
    expect(kids.reduce((s, r) => s.plus(r.value), neo.value.minus(neo.value)).eq(neo.value)).toBe(true)
  })

  it('income statement for a period, each posting valued at its date', () => {
    const jan = incomeStatement(journal, typeOf, '2026-01-01', '2026-02-01', 'CHF', db)
    expect(jan.revenues.total.toFixed(2)).toBe('3450.00') // 3000 + 500 × 0.90
    expect(jan.expenses.total.toFixed(2)).toBe('0.00')
    const feb = incomeStatement(journal, typeOf, '2026-02-01', '2026-03-01', 'CHF', db)
    expect(feb.expenses.rows.map((r) => r.account)).toEqual(['expenses:food', 'expenses:family', 'expenses:family:sam'])
    expect(feb.result.toFixed(2)).toBe('-68.00') // −50 − 20 × 0.90 (last rate before 02-04)
  })

  it('cash flow: change of cash accounts', () => {
    const cf = cashFlowStatement(journal, typeOf, '2026-02-01', '2026-03-01', 'CHF', db)
    expect(cf.cash.byCommodity.get('CHF')!.toFixed(2)).toBe('120.00') // −50 + 200 − 30
    expect(cf.cash.byCommodity.get('EUR')!.toFixed(2)).toBe('-20.00')
  })

  it('stats can keep only the transactions touching my own pockets', () => {
    const kept = new Set(['assets:sam:neo:eur'])
    const mine = (tx: (typeof journal.transactions)[number]) =>
      tx.postings.some((p) => isAssetType(typeOf(p.account)) && !kept.has(p.account))
    const inc = monthlyFlows(journal, typeOf, 'R', 'CHF', db, mine)
    expect(inc.get('2026-01')!.byAccount.has('income:family:sam')).toBe(false)
    expect(inc.get('2026-01')!.total.toFixed(2)).toBe('3000.00')
    const exp = monthlyFlows(journal, typeOf, 'X', 'CHF', db, mine)
    expect([...exp.get('2026-02')!.byAccount.keys()]).toEqual(['expenses:food'])
  })
})
