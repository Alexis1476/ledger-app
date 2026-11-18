import { describe, expect, it } from 'vitest'
import { format } from '../../src/ledger/formatter'
import { items, removeItem, searchPurchases, setItem } from '../../src/ledger/inventory'
import { parseFile } from '../../src/ledger/parser'
import { buildPriceDB } from '../../src/ledger/reports'

const journal = parseFile(`
2025-10-31 * Camera store  ; import:abc, item:Compact camera
    expenses:photo                                   449.90 CHF
    assets:bank:checking                             -449.90 CHF

2026-01-06 * Amazon | E-reader
    expenses:shopping:electronics                    129.54 EUR @@ 120.00 CHF
    assets:bank:checking                             -120.00 CHF

2026-09-14 * Cámara compacta
    expenses:photo                                   999.00 CHF
    assets:bank:checking                             -999.00 CHF

2026-10-01 * Salary
    assets:bank:checking                             5000.00 CHF
    income:salary
`)
const db = buildPriceDB(journal)
const isExpense = (a: string) => a.startsWith('expenses:')

describe('inventory', () => {
  it('lists the purchases tagged item:, with what they cost', () => {
    const [camera] = items(journal.transactions, isExpense, 'CHF', db)
    expect(camera).toMatchObject({ name: 'Compact camera', date: '2025-10-31' })
    expect(camera.cost.toFixed(2)).toBe('449.90')
  })

  it('searches purchases by payee or note (every word), not those already in the inventory', () => {
    const r = (q: string) => searchPurchases(journal.transactions, q, isExpense, 'CHF', db).map((x) => `${x.tx.payee} ${x.cost.toFixed(2)}`)
    expect(r('reader')).toEqual(['Amazon 120.00'])
    expect(r('cámara')).toEqual(['Cámara compacta 999.00'])
    expect(r('camera')).toEqual([]) // already in
    expect(r('salary')).toEqual([]) // not an expense
    expect(r('  ')).toEqual([])
  })

  it('adds / renames / removes the item tag on the header only (the expense stays)', () => {
    const lens = journal.transactions.find((t) => t.payee === 'Cámara compacta')!
    const tagged = setItem(lens, 'Lens 35mm, black')
    expect(format(tagged).split('\n')[0]).toBe('2026-09-14 * Cámara compacta  ; item:Lens 35mm black')
    expect(format(removeItem(tagged))).toBe(format(lens))
    expect(setItem(lens, '').tags.item).toBe('Cámara compacta')
  })

  it('removes the tag from a purchase read from the journal, even when it is the only tag', () => {
    const only = parseFile(
      ['2026-11-01 * Coop  ; item:Thing', '    expenses:food                                      4.70 CHF', '    assets:bank:checking                               -4.70 CHF', ''].join('\n')
    ).transactions[0]
    expect(format(removeItem(only)).split('\n')[0]).toBe('2026-11-01 * Coop')
    const camera = journal.transactions.find((t) => t.tags.item === 'Compact camera')!
    expect(format(removeItem(camera)).split('\n')[0]).toBe('2025-10-31 * Camera store  ; import:abc')
  })
})
