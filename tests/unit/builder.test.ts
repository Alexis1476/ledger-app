import { describe, expect, it } from 'vitest'
import { build, equalSplit, proportionalSplit } from '../../src/ledger/builder'
import { Decimal } from '../../src/ledger/decimal'
import { format } from '../../src/ledger/formatter'
import { balancingAmount } from '../../src/ledger/reports'
import type { Transaction } from '../../src/ledger/types'
import { recipesJournal } from './helpers'
import { recipes } from './recipes'

function balanced(tx: Transaction) {
  const m = new Map<string, Decimal>()
  for (const p of tx.postings) {
    const b = balancingAmount(p.amount!)
    m.set(b.commodity, (m.get(b.commodity) ?? new Decimal(0)).plus(b.qty))
  }
  return [...m.values()].every((q) => q.isZero())
}

describe('builder reproduces every app recipe of recipes.journal', () => {
  const journal = recipesJournal()
  const byId = new Map(journal.transactions.map((t) => [t.id, t]))
  for (const r of recipes) {
    it(r.name, () => {
      const fixture = byId.get(r.input.id)!
      const input =
        r.kind === 'assertion' ? { ...r.input, balance: fixture.postings[0].assertion!.amount.qty.toFixed(2) } : r.input
      const tx = build(r.kind, input as never)
      expect(format(tx)).toBe(fixture.src!.raw)
      expect(balanced(tx)).toBe(true)
    })
  }
})

describe('generic transfers', () => {
  it('any account to any account, nothing added', () => {
    const tx = build('transfer', { date: '2026-11-07', from: 'liabilities:people:sam', to: 'liabilities:people:max', amount: '50', currency: 'EUR' })
    expect(tx.postings.map((p) => `${p.account} ${p.amount!.qty}`)).toEqual(['liabilities:people:max 50', 'liabilities:people:sam -50'])
  })

  it('a fee is taken from the source', () => {
    const tx = build('transfer', { date: '2026-11-07', from: 'assets:bank:checking', to: 'assets:neo:chf', amount: '100', currency: 'CHF', fee: '1.50' })
    expect(tx.postings.map((p) => `${p.account} ${p.amount!.qty}`)).toEqual([
      'assets:neo:chf 100',
      'expenses:fees:bank 1.5',
      'assets:bank:checking -101.5'
    ])
  })
})

describe('splits', () => {
  it('equal split gives leftover cents to the first parts', () => {
    expect(equalSplit('10.00', 3).map((x) => x.toFixed(2))).toEqual(['3.34', '3.33', '3.33'])
    expect(equalSplit('24.30', 2).map((x) => x.toFixed(2))).toEqual(['12.15', '12.15'])
    expect(equalSplit('0.05', 3).map((x) => x.toFixed(2))).toEqual(['0.02', '0.02', '0.01'])
  })

  it('proportional split sums to the total', () => {
    const parts = proportionalSplit('38.10', [new Decimal(1), new Decimal(1), new Decimal(1)])
    expect(parts.map((x) => x.toFixed(2))).toEqual(['12.70', '12.70', '12.70'])
    const p2 = proportionalSplit('10.00', [new Decimal('33.33'), new Decimal('66.67')])
    expect(p2.reduce((a, b) => a.plus(b)).toFixed(2)).toBe('10.00')
  })

  it('foreign expense split across lines balances via costs', () => {
    const tx = build('expense', {
      date: '2026-11-09', payee: 'Taxi', id: 'X', amount: '30000', currency: 'COP',
      source: 'assets:neo:chf', sourceCurrency: 'CHF', debited: '6.17', category: '',
      lines: [
        { account: 'expenses:transport:taxi', amount: '15000' },
        { account: 'liabilities:people:max', amount: '15000' }
      ]
    })
    expect(format(tx)).toBe(
      [
        '2026-11-09 * Taxi  ; via:app, id:X',
        '    expenses:transport:taxi                       15000.00 COP @@ 3.09 CHF',
        '    liabilities:people:max                        15000.00 COP @@ 3.08 CHF',
        '    assets:neo:chf                                   -6.17 CHF'
      ].join('\n')
    )
    expect(balanced(tx)).toBe(true)
  })
})
