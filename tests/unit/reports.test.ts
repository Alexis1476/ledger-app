import { describe, expect, it } from 'vitest'
import { Decimal } from '../../src/ledger/decimal'
import { parseFile } from '../../src/ledger/parser'
import { balances, buildPriceDB, checkAssertions, postingAmounts, register, valueIn } from '../../src/ledger/reports'
import { fixtureJson, hAmountStr, hq, recipesJournal, type HAmount } from './helpers'

type HRow = [string, string, number, HAmount[]]
type HBal = [HRow[], HAmount[]]

function lineStr(l: { commodity: string; qty: Decimal; cost?: { commodity: string; qty: Decimal } }) {
  let s = `${l.qty.toFixed()} ${l.commodity}`
  if (l.cost) s += ` @@ ${l.cost.qty.toFixed()} ${l.cost.commodity}`
  return s
}

describe('balances golden test', () => {
  const journal = recipesJournal()

  it('equals recipes.bal.json', () => {
    const [rows] = fixtureJson<HBal>('recipes.bal.json')
    const bals = balances(journal)
    const actual = new Map([...bals].filter(([, m]) => m.nonZeroLines().length > 0))
    expect([...actual.keys()].sort()).toEqual(rows.map((r) => r[0]).sort())
    for (const [account, , , amounts] of rows) {
      const exp = amounts.filter((a) => !hq(a).isZero()).map(hAmountStr).sort()
      const got = actual.get(account)!.nonZeroLines().map(lineStr).sort()
      expect(got, account).toEqual(exp)
    }
  })

  it('CHF valuation equals recipes.bal-chf.json', () => {
    const [rows, total] = fixtureJson<HBal>('recipes.bal-chf.json')
    const db = buildPriceDB(journal)
    const bals = balances(journal)
    let sum = new Decimal(0)
    for (const [account, , , amounts] of rows) {
      const v = valueIn(bals.get(account)!, 'CHF', '2026-12-31', db)
      expect(v.missing.size, account).toBe(0)
      const exp = hq(amounts[0])
      expect(v.total.minus(exp).abs().lt('1e-8'), `${account}: ${v.total} vs ${exp}`).toBe(true)
      sum = sum.plus(v.total)
    }
    expect(sum.minus(hq(total[0])).abs().lt('1e-8')).toBe(true)
  })

  it('balance assertions of the fixture pass', () => {
    expect(checkAssertions(journal.transactions)).toEqual([])
  })
})

describe('reports details', () => {
  const pf = parseFile(
    [
      '2026-01-01 open',
      '    assets:a          100.00 CHF',
      '    equity:opening',
      '',
      '2026-01-02 fx',
      '    assets:b          50.00 EUR @@ 47.00 CHF',
      '    assets:a',
      '',
      '2026-01-03 check',
      '    assets:a          0.00 CHF = 53.00 CHF',
      '    assets            0.00 CHF =* 53.00 CHF',
      ''
    ].join('\n')
  )

  it('infers implicit amounts through costs', () => {
    const amounts = postingAmounts(pf.transactions[1])
    expect(amounts[1].map((a) => `${a.qty.toFixed()} ${a.commodity}`)).toEqual(['-47 CHF'])
  })

  it('detects failing assertions', () => {
    expect(checkAssertions(pf.transactions)).toEqual([])
    const bad = parseFile('2026-01-04 x\n    assets:a  0.00 CHF = 1.00 CHF\n').transactions[0]
    bad.index = 99
    const f = checkAssertions([...pf.transactions, bad])
    expect(f).toHaveLength(1)
    expect(f[0].actual.toFixed()).toBe('53')
  })

  it('register keeps a running balance', () => {
    const rows = register(pf, 'assets:a')
    expect(rows.map((r) => r.balance.get('CHF')?.toFixed())).toEqual(['100', '53', '53'])
  })

  it('uses reverse prices and one intermediate commodity', () => {
    const j = parseFile('P 2026-01-01 CHF 1.07 EUR\nP 2026-01-01 COP 0.0002 CHF\n')
    const db = buildPriceDB({ prices: j.prices, transactions: [] })
    expect(db.rate('EUR', 'CHF', '2026-02-01')!.toFixed(6)).toBe('0.934579')
    expect(db.rate('COP', 'EUR', '2026-02-01')!.toFixed(6)).toBe('0.000214')
    expect(db.rate('EUR', 'CHF', '2025-12-31')).toBeUndefined()
  })
})
