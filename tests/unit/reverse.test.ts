import { describe, expect, it } from 'vitest'
import { build, defaultContext } from '../../src/ledger/builder'
import { format } from '../../src/ledger/formatter'
import { parseFile } from '../../src/ledger/parser'
import { reverse } from '../../src/ledger/reverse'
import { recipesJournal } from './helpers'
import { recipes } from './recipes'

const isPocket = (a: string) => a.startsWith('assets:') && !a.startsWith('assets:receivables:')

describe('reverse: transaction → form input', () => {
  const journal = recipesJournal()

  for (const r of recipes) {
    if (r.kind === 'assertion') continue
    it(`round-trips ${r.name}`, () => {
      const tx = journal.transactions.find((t) => t.id === r.input.id)!
      const back = reverse(tx, defaultContext, isPocket)
      // the form that opens may differ when two forms write the same lines (a pocket paying a
      // person is both an expense and a transfer); what must hold is the exact same text
      expect(back).toBeDefined()
      expect(format(build(back!.kind, back!.input as never, defaultContext))).toBe(tx.src!.raw)
    })
  }

  it("imported shapes with hidden rules (exchange of Sam's money with its debt conversion) are read-only", () => {
    const tx = journal.transactions.find((t) => t.payee === 'Neo' && !t.id)!
    expect(reverse(tx, defaultContext, isPocket)).toBeUndefined()
    const aldi = journal.transactions.find((t) => t.payee === 'Aldi' && !t.id)!
    expect(reverse(aldi, defaultContext, isPocket)?.kind).toBe('expense')
  })

  it('a gift from a person (no pocket) opens as a transfer', () => {
    const tx = journal.transactions.find((t) => t.payee === 'Max' && !t.id)!
    expect(reverse(tx, defaultContext, isPocket)).toMatchObject({
      kind: 'transfer',
      input: { from: 'income:gifts', to: 'liabilities:people:max', amount: '100', currency: 'EUR' }
    })
  })

  it('a pocket paying a person opens as an expense to that person', () => {
    const tx = journal.transactions.find((t) => t.note === 'Paying back')!
    expect(reverse(tx, defaultContext, isPocket)).toMatchObject({ kind: 'expense', input: { category: 'liabilities:people:sam' } })
  })

  it('reads imported transactions (no app tags) and keeps their tags', () => {
    const tx = parseFile(
      '2026-10-26 * Marketplace | Selling fees  ; import:e2f768363c, payment:web\n' +
        '    expenses:fees:marketplace                       12.40 CHF\n' +
        '    assets:bank:checking                            -12.40 CHF\n'
    ).transactions[0]
    const back = reverse(tx, defaultContext, isPocket)!
    expect(back.kind).toBe('expense')
    expect(back.input).toMatchObject({ amount: '12.4', category: 'expenses:fees:marketplace', tags: { import: 'e2f768363c', payment: 'web' } }) // an old payment: tag is kept like any other tag
  })

  it('a negative expense (refund booked on an expense account) is read as an income', () => {
    const tx = parseFile('2026-01-01 * Refund\n    expenses:misc:discrepancies  -5.00 CHF\n    assets:cash:chf  5.00 CHF\n').transactions[0]
    expect(reverse(tx, defaultContext, isPocket)).toMatchObject({ kind: 'income', input: { category: 'expenses:misc:discrepancies' } })
  })

  it('several categories become several lines', () => {
    const tx = parseFile(
      '2026-01-01 * Mixed\n    expenses:food:groceries  5.00 CHF\n    expenses:gifts  5.00 CHF\n    assets:cash:chf  -10.00 CHF\n'
    ).transactions[0]
    const back = reverse(tx, defaultContext, isPocket)!
    expect(back.kind).toBe('expense')
    expect((back.input as { lines: unknown[] }).lines).toHaveLength(2)
  })

  it('returns undefined for implicit amounts and assertions', () => {
    const implicit = parseFile('2026-01-01 * X\n    expenses:gifts  5.00 CHF\n    assets:cash:chf\n').transactions[0]
    expect(reverse(implicit, defaultContext, isPocket)).toBeUndefined()
    const assertion = journal.transactions.find((t) => t.payee === 'Statement Neo EUR')!
    expect(reverse(assertion, defaultContext, isPocket)).toBeUndefined()
  })
})
