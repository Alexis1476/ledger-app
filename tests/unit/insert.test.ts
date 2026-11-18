import { describe, expect, it } from 'vitest'
import { build } from '../../src/ledger/builder'
import { format } from '../../src/ledger/formatter'
import { deleteRange, ensureInclude, insertTransaction, isOrdered, moveTransaction, replaceRange, yearFile } from '../../src/ledger/insert'
import { parseFile } from '../../src/ledger/parser'

const tx = (date: string, payee: string) =>
  format(
    build('expense', {
      date, payee, id: payee, amount: '1', currency: 'CHF', source: 'assets:cash:chf', category: 'expenses:uncategorized'
    })
  )

const file = ['; 2026 — written by the app', '', tx('2026-01-10', 'A'), '', tx('2026-02-10', 'B'), '', tx('2026-03-10', 'C'), ''].join('\n')

const payees = (text: string) => parseFile(text).transactions.map((t) => t.payee)

describe('insertTransaction', () => {
  it('inserts in the middle', () => {
    const r = insertTransaction(file, tx('2026-02-15', 'X'), '2026-02-15')
    expect(payees(r.text)).toEqual(['A', 'B', 'X', 'C'])
    expect(isOrdered(r.text)).toBe(true)
    expect(r.text).not.toMatch(/\n\n\n/)
    const lines = r.text.split('\n')
    expect(lines[r.startLine - 1]).toMatch(/^2026-02-15/)
    expect(lines[r.endLine - 1]).toMatch(/assets:cash:chf/)
  })

  it('inserts at the start (before the first transaction, after the header comment)', () => {
    const r = insertTransaction(file, tx('2026-01-01', 'X'), '2026-01-01')
    expect(payees(r.text)).toEqual(['X', 'A', 'B', 'C'])
    expect(r.text.startsWith('; 2026 — written by the app\n\n2026-01-01')).toBe(true)
    expect(r.text).not.toMatch(/\n\n\n/)
  })

  it('inserts at the end', () => {
    const r = insertTransaction(file, tx('2026-12-31', 'X'), '2026-12-31')
    expect(payees(r.text)).toEqual(['A', 'B', 'C', 'X'])
    expect(r.text).toMatch(/assets:cash:chf +-1\.00 CHF\n$/)
    expect(r.text).not.toMatch(/\n\n\n/)
  })

  it('same date goes after existing entries of that date', () => {
    const r = insertTransaction(file, tx('2026-02-10', 'X'), '2026-02-10')
    expect(payees(r.text)).toEqual(['A', 'B', 'X', 'C'])
  })

  it('works on an empty file and a file without trailing newline', () => {
    const r = insertTransaction('', tx('2026-05-05', 'X'), '2026-05-05')
    expect(r.text).toBe(tx('2026-05-05', 'X') + '\n')
    expect(r.startLine).toBe(1)
    const r2 = insertTransaction(tx('2026-01-01', 'A'), tx('2026-05-05', 'X'), '2026-05-05')
    expect(payees(r2.text)).toEqual(['A', 'X'])
    expect(r2.text).toContain('-1.00 CHF\n\n2026-05-05')
  })
})

describe('replace / delete / move', () => {
  const b = parseFile(file).transactions[1].src!

  it('replaces a line range', () => {
    const r = replaceRange(file, b.startLine, b.endLine, tx('2026-02-10', 'B2'))
    expect(payees(r.text)).toEqual(['A', 'B2', 'C'])
    expect(r.startLine).toBe(b.startLine)
  })

  it('deletes a line range without leaving double blank lines', () => {
    const t = deleteRange(file, b.startLine, b.endLine)
    expect(payees(t)).toEqual(['A', 'C'])
    expect(t).not.toMatch(/\n\n\n/)
    const last = parseFile(file).transactions[2].src!
    const t2 = deleteRange(file, last.startLine, last.endLine)
    expect(payees(t2)).toEqual(['A', 'B'])
    expect(t2.endsWith('-1.00 CHF\n')).toBe(true)
  })

  it('moves a transaction when its date changes', () => {
    const r = moveTransaction(file, b.startLine, b.endLine, tx('2026-04-01', 'B'), '2026-04-01')
    expect(payees(r.text)).toEqual(['A', 'C', 'B'])
    expect(isOrdered(r.text)).toBe(true)
  })
})

describe('helpers', () => {
  it('yearFile', () => {
    expect(yearFile('2026-11-02')).toBe('journals/2026.journal')
  })

  it('ensureInclude adds the line once, after the last include', () => {
    const main = '; main\ninclude a.journal\ninclude b.journal\n; future\n'
    const out = ensureInclude(main, 'journals/2026.journal')
    expect(out).toBe('; main\ninclude a.journal\ninclude b.journal\ninclude journals/2026.journal\n; future\n')
    expect(ensureInclude(out, 'journals/2026.journal')).toBe(out)
  })
})
