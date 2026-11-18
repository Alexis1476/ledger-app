import { describe, expect, it } from 'vitest'
import { build } from '../../src/ledger/builder'
import { Decimal } from '../../src/ledger/decimal'
import { parseFile } from '../../src/ledger/parser'
import type { Transaction } from '../../src/ledger/types'
import { validate, type IssueCode } from '../../src/ledger/validate'
import { recipesJournal } from './helpers'

const journal = recipesJournal()

function good(): Transaction {
  return build('expense', {
    date: '2026-11-12', payee: 'Coop', id: '01NEW', amount: '10.50', currency: 'CHF',
    source: 'assets:bank:checking', category: 'expenses:food:groceries'
  })
}

const codes = (tx: Transaction, opts = {}) => validate(tx, journal, opts).map((i) => i.code)

function expectOnly(tx: Transaction, code: IssueCode) {
  expect([...new Set(codes(tx))]).toEqual([code])
}

describe('validate', () => {
  it('passes a well-formed transaction', () => {
    expect(codes(good())).toEqual([])
  })

  it('UNBALANCED', () => {
    const tx = good()
    tx.postings[0].amount!.qty = new Decimal('10.40')
    expectOnly(tx, 'UNBALANCED')
    // costs count for balancing
    const fx = build('transfer', {
      date: '2026-11-12', id: '01FX', from: 'assets:bank:prepaid', to: 'assets:andes:checking',
      amount: '10', currency: 'CHF', toAmount: '40000', toCurrency: 'COP'
    })
    expect(codes(fx)).toEqual([])
  })

  it('MULTIPLE_IMPLICIT', () => {
    const tx = good()
    delete tx.postings[0].amount
    expect(codes(tx)).toEqual([])
    delete tx.postings[1].amount
    expectOnly(tx, 'MULTIPLE_IMPLICIT')
  })

  it('UNDECLARED_ACCOUNT', () => {
    const tx = good()
    tx.postings[0].account = 'expenses:food:candy'
    expectOnly(tx, 'UNDECLARED_ACCOUNT')
  })

  it('NON_LEAF_ACCOUNT', () => {
    const tx = good()
    tx.postings[1].account = 'assets'
    expectOnly(tx, 'NON_LEAF_ACCOUNT')
  })

  it('UNDECLARED_COMMODITY', () => {
    const tx = good()
    tx.postings.forEach((p) => (p.amount!.commodity = 'GBP'))
    expectOnly(tx, 'UNDECLARED_COMMODITY')
  })

  it('BAD_DATE', () => {
    for (const date of ['2026-02-30', '2026-13-01', '26-01-01', '2026-1-1']) {
      const tx = good()
      tx.date = date
      expect(codes(tx)).toContain('BAD_DATE')
    }
    const leap = good()
    leap.date = '2028-02-29'
    expect(codes(leap)).toEqual([])
  })

  it('BAD_PRECISION', () => {
    const tx = good()
    tx.postings[0].amount!.qty = new Decimal('10.505')
    tx.postings[1].amount!.qty = new Decimal('-10.505')
    expectOnly(tx, 'BAD_PRECISION')
  })

  it('ZERO_AMOUNT (but not for assertions)', () => {
    const tx = good()
    tx.postings[0].amount!.qty = new Decimal(0)
    tx.postings[1].amount!.qty = new Decimal(0)
    expect(codes(tx)).toEqual(['ZERO_AMOUNT', 'ZERO_AMOUNT'])
    const a = build('assertion', { date: '2026-12-01', id: '01A', account: 'assets:neo:eur', balance: '4180.52', currency: 'EUR' })
    expect(codes(a)).toEqual([])
  })

  it('ASSERTION_FAILED: new assertion that does not hold', () => {
    const a = build('assertion', { date: '2026-12-01', id: '01A', account: 'assets:neo:eur', balance: '1.00', currency: 'EUR' })
    expectOnly(a, 'ASSERTION_FAILED')
  })

  it('ASSERTION_FAILED: new posting breaks a later assertion', () => {
    const tx = build('expense', {
      date: '2026-11-20', id: '01B', amount: '5', currency: 'EUR', source: 'assets:neo:eur', category: 'expenses:travel'
    })
    const issues = validate(tx, journal)
    expect(issues.map((i) => i.code)).toEqual(['ASSERTION_FAILED'])
    expect(issues[0].message).toContain('Statement Neo EUR')
    // after the statement date it is fine
    tx.date = '2026-12-01'
    expect(codes(tx)).toEqual([])
  })

  it('DUPLICATE_ID', () => {
    const tx = good()
    tx.id = tx.tags.id = '01JC0000000000000000000001'
    expectOnly(tx, 'DUPLICATE_ID')
    expect(codes(tx, { replacingId: '01JC0000000000000000000001' })).toEqual([])
  })

  it('edits do not count the replaced transaction twice', () => {
    const old = journal.transactions.find((t) => t.id === '01JC0000000000000000000008')!
    const edited = parseFile(old.src!.raw).transactions[0]
    edited.date = '2026-11-06'
    expect(validate(edited, journal, { replacing: old })).toEqual([])
  })
})
