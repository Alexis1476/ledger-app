import { describe, expect, it } from 'vitest'
import { format } from '../../src/ledger/formatter'
import { Decimal } from '../../src/ledger/decimal'
import { convertible, declareAccount, extras, loanAccount, personKey, searchConvertible, settleExtra, settleInKind, toLoan } from '../../src/ledger/loans'
import { parseFile } from '../../src/ledger/parser'

const journal = parseFile(`
2026-08-13 * Nina Loan  ; import:6d8bd1833f
    expenses:people                               80173.00 COP
    assets:andes:checking                   -80173.00 COP

2026-09-01 * Nina | paid back
    income:people                                -30000.00 COP
    assets:andes:checking                    30000.00 COP

2026-09-02 * Eva
    assets:receivables:eva                            10.00 CHF
    assets:cash:chf                                  -10.00 CHF

2026-09-03 * Coop | split
    expenses:food                                     10.00 CHF
    expenses:people                                   10.00 CHF
    assets:cash:chf                                  -20.00 CHF
`)
const isPocket = (a: string) => a.startsWith('assets:') && !a.startsWith('assets:receivables:')

describe('loans', () => {
  it('accounts per kind and person keys', () => {
    expect(loanAccount('lent', 'nina')).toBe('assets:receivables:nina')
    expect(loanAccount('repaidToMe', 'nina')).toBe('assets:receivables:nina')
    expect(loanAccount('borrowed', 'ana')).toBe('liabilities:people:ana')
    expect(personKey('Nina Pérez')).toBe('nina-perez')
  })

  it('an imported loan (pocket ↔ one other account) can become a loan, with its direction', () => {
    const [lent, repaid, eva, split] = journal.transactions
    expect(convertible(lent, isPocket)).toMatchObject({ postingIndex: 0, direction: 'out' })
    expect(convertible(repaid, isPocket)).toMatchObject({ postingIndex: 0, direction: 'in' })
    expect(convertible(eva, isPocket)).toBeUndefined() // already a loan
    expect(convertible(split, isPocket)).toBeUndefined() // not a simple pocket ↔ account
  })

  it('search by payee / note, most recent first', () => {
    expect(searchConvertible(journal.transactions, 'nina', isPocket).map((c) => c.tx.date)).toEqual(['2026-09-01', '2026-08-13'])
    expect(searchConvertible(journal.transactions, 'nina loan', isPocket)).toHaveLength(1)
    expect(searchConvertible(journal.transactions, ' ', isPocket)).toEqual([])
  })

  it('moves only the non-pocket posting, amount and tags unchanged', () => {
    const c = convertible(journal.transactions[0], isPocket)!
    expect(format(toLoan(c, 'assets:receivables:nina'))).toBe(
      [
        '2026-08-13 * Nina Loan  ; import:6d8bd1833f',
        '    assets:receivables:nina                       80173.00 COP',
        '    assets:andes:checking                        -80173.00 COP'
      ].join('\n')
    )
  })

  it('declares a new person account next to the others of its kind', () => {
    const text = [
      'account assets:receivables:eva              ; type: A',
      '; money between two registers',
      'account assets:transit:to-reconcile         ; type: A',
      'account liabilities                         ; type: L',
      ''
    ].join('\n')
    const withNina = declareAccount(text, 'assets:receivables:nina')
    expect(withNina.split('\n')[1]).toBe('account assets:receivables:nina          ; type: A')
    const withAna = declareAccount(text, 'liabilities:people:ana')
    expect(withAna.split('\n')[4]).toBe('account liabilities:people:ana           ; type: L')
    expect(parseFile(withAna).accounts.map((a) => a.name)).toContain('liabilities:people:ana')
    // long names: still two spaces before the comment (hledger reads one space as part of the name)
    const long = declareAccount(text, 'assets:receivables:friend-desktop-75973').split('\n')[1]
    expect(long).toBe('account assets:receivables:friend-desktop-75973  ; type: A')
  })

describe('paid more than the loan', () => {
  const meta = { date: '2026-11-13', id: '01TEST', payee: 'Eva' }
  const lines = (as: 'gift' | 'loan', side: 'receivable' | 'debt') =>
    format(settleExtra('eva', { side, qty: new Decimal('41.01'), commodity: 'EUR' }, as, meta))
      .split('\n')
      .slice(1)
      .map((l) => l.trim().replace(/ {2,}/g, ' '))

  it('finds what was paid in excess, per currency', () => {
    const owesMe = new Map([
      ['EUR', new Decimal('-41.01')],
      ['COP', new Decimal('100000')]
    ])
    expect(extras(owesMe, new Map()).map((x) => [x.side, x.qty.toString(), x.commodity])).toEqual([['receivable', '41.01', 'EUR']])
    expect(extras(undefined, new Map([['CHF', new Decimal('-5')]])).map((x) => [x.side, x.qty.toString()])).toEqual([['debt', '5']])
    expect(extras(new Map([['EUR', new Decimal('8.99')]]))).toEqual([])
  })
  it('they paid too much: a gift I received, or a debt of mine', () => {
    expect(lines('gift', 'receivable')).toEqual(['assets:receivables:eva 41.01 EUR', 'income:transfers:gifts -41.01 EUR'])
    expect(lines('loan', 'receivable')).toEqual(['assets:receivables:eva 41.01 EUR', 'liabilities:people:eva -41.01 EUR'])
  })
  it('I paid too much: a gift I made, or a loan they owe me', () => {
    expect(lines('gift', 'debt')).toEqual(['liabilities:people:eva -41.01 EUR', 'expenses:transfers:gifts 41.01 EUR'])
    expect(lines('loan', 'debt')).toEqual(['liabilities:people:eva -41.01 EUR', 'assets:receivables:eva 41.01 EUR'])
  })
  it('is tagged like every entry of the app', () => {
    const tx = settleExtra('eva', { side: 'receivable', qty: new Decimal('41.01'), commodity: 'EUR' }, 'gift', meta)
    expect(format(tx).split('\n')[0]).toBe('2026-11-13 * Eva | Paid more than the loan: kept as a gift  ; via:app, id:01TEST')
  })
})

describe('a loan settled another way', () => {
  const meta = { date: '2026-11-13', id: '01KIND', payee: 'Nina', note: 'Spotify family, 1 year' }
  const amount = { qty: new Decimal('100000'), commodity: 'COP' }
  const body = (tx: ReturnType<typeof settleInKind>) =>
    format(tx)
      .split('\n')
      .slice(1)
      .map((l) => l.trim().replace(/ {2,}/g, ' '))

  it('they owed me: what I got is an expense, no pocket moves', () => {
    const tx = settleInKind('nina', 'receivable', amount, 'expenses:leisure:streaming', meta)
    expect(format(tx).split('\n')[0]).toBe('2026-11-13 * Nina | Spotify family, 1 year  ; via:app, id:01KIND')
    expect(body(tx)).toEqual(['expenses:leisure:streaming 100000.00 COP', 'assets:receivables:nina -100000.00 COP'])
  })
  it('I owed them: what I gave is an income', () => {
    const tx = settleInKind('ana', 'debt', amount, 'income:sales', { ...meta, note: ' ' })
    expect(tx.note).toBe('My debt settled another way')
    expect(body(tx)).toEqual(['liabilities:people:ana 100000.00 COP', 'income:sales -100000.00 COP'])
  })
})
})
