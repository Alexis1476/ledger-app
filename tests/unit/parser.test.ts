import { describe, expect, it } from 'vitest'
import { parseFile, parseJournal, parseTags, resolveInclude } from '../../src/ledger/parser'
import { costTotal } from '../../src/ledger/reports'
import { fixtureJson, hAmountStr, hq, recipesJournal, type HAmount } from './helpers'

interface HPosting {
  paccount: string
  pamount: HAmount[]
  pbalanceassertion: null | { baamount: HAmount; bainclusive: boolean; batotal: boolean }
  ptags: [string, string][]
}
interface HTxn {
  tdate: string
  tstatus: 'Cleared' | 'Pending' | 'Unmarked'
  tcode: string
  tdescription: string
  tcomment: string
  ttags: [string, string][]
  tpostings: HPosting[]
  tsourcepos: { sourceLine: number }[]
}

const statusMap = { Cleared: '*', Pending: '!', Unmarked: '' } as const

describe('parser golden test (recipes.journal vs hledger print -O json)', () => {
  const journal = recipesJournal()
  const expected = fixtureJson<HTxn[]>('recipes.print.json')
  const accountTags = new Map(journal.accounts.map((a) => [a.name, a.tags]))

  it('has no error diagnostics', () => {
    expect(journal.diagnostics.filter((d) => d.severity === 'error')).toEqual([])
  })

  it('parses the same number of transactions', () => {
    expect(journal.transactions).toHaveLength(expected.length)
  })

  expected.forEach((h, i) => {
    it(`transaction ${i + 1}: ${h.tdescription}`, () => {
      const tx = journal.transactions[i]
      expect(tx.date).toBe(h.tdate)
      expect(tx.status).toBe(statusMap[h.tstatus])
      expect(tx.code ?? '').toBe(h.tcode)
      expect([tx.payee, tx.note].filter(Boolean).join(' | ')).toBe(h.tdescription)
      expect((tx.comment ?? '').trim()).toBe(h.tcomment.trim())
      expect(Object.entries(tx.tags)).toEqual(h.ttags)
      expect(tx.src?.startLine).toBe(h.tsourcepos[0].sourceLine)
      expect(tx.src?.endLine).toBe(h.tsourcepos[1].sourceLine - 1)
      expect(tx.postings).toHaveLength(h.tpostings.length)
      h.tpostings.forEach((hp, j) => {
        const p = tx.postings[j]
        expect(p.account).toBe(hp.paccount)
        expect(p.amount).toBeDefined()
        const a = p.amount!
        let s = `${a.qty.toFixed()} ${a.commodity}`
        const ct = costTotal(a)
        if (ct) s += ` @@ ${ct.qty.toFixed()} ${ct.commodity}`
        expect(s).toBe(hAmountStr(hp.pamount[0]))
        if (hp.pbalanceassertion) {
          const ba = hp.pbalanceassertion
          expect(p.assertion?.amount.qty.eq(hq(ba.baamount))).toBe(true)
          expect(p.assertion?.amount.commodity).toBe(ba.baamount.acommodity)
          expect(p.assertion?.inclusive).toBe(ba.bainclusive)
          expect(p.assertion?.total).toBe(ba.batotal)
        } else {
          expect(p.assertion).toBeUndefined()
        }
        // posting tags = own tags + tags inherited from the account declaration
        const own = Object.entries(p.tags)
        const parts = p.account.split(':')
        const inherited = parts.flatMap((_, k) =>
          Object.entries(accountTags.get(parts.slice(0, k + 1).join(':')) ?? {})
        )
        const uniq = (xs: [string, string][]) => [...new Set(xs.map((x) => x.join('=')))].sort()
        expect(uniq([...own, ...inherited])).toEqual(uniq(hp.ptags))
      })
    })
  })
})

describe('parser details', () => {
  it('parses tags hledger style', () => {
    expect(parseTags('via:app, id:01X, holiday:, payment:card')).toEqual({
      via: 'app',
      id: '01X',
      holiday: '',
      payment: 'card'
    })
    expect(parseTags('type: C, currency: CHF, source: Neo, note: Neo CHF (before 2026-10-28)')).toEqual({
      type: 'C',
      currency: 'CHF',
      source: 'Neo',
      note: 'Neo CHF (before 2026-10-28)'
    })
    expect(parseTags('just a comment')).toEqual({})
    expect(parseTags('time:12:30, x:1')).toEqual({ time: '12:30', x: '1' })
  })

  it('accepts implicit amounts, left commodities, unicode accounts and comments', () => {
    const pf = parseFile(
      [
        '2026-01-05 ! (42) Café | croissant  ; travel:',
        '    ; second comment line, kind:test',
        '    expenses:santé:café  $-3.50  ; posting note',
        '    assets:cash:chf',
        ''
      ].join('\n'),
      'x.journal'
    )
    expect(pf.diagnostics).toEqual([])
    const tx = pf.transactions[0]
    expect(tx.status).toBe('!')
    expect(tx.code).toBe('42')
    expect(tx.payee).toBe('Café')
    expect(tx.note).toBe('croissant')
    expect(tx.tags).toEqual({ travel: '', kind: 'test' })
    expect(tx.postings[0].account).toBe('expenses:santé:café')
    expect(tx.postings[0].amount?.qty.toFixed()).toBe('-3.5')
    expect(tx.postings[0].amount?.commodity).toBe('$')
    expect(tx.postings[0].comment).toBe('posting note')
    expect(tx.postings[1].amount).toBeUndefined()
  })

  it('flags unsupported syntax without throwing', () => {
    const text = [
      '~ monthly',
      '    expenses:rent  1000.00 CHF',
      '    assets:bank:checking',
      '',
      '2026-01-01 virtual',
      '    (budget:food)  10.00 CHF',
      '',
      '2026-01-02 broken',
      '    expenses:food  12,34,x CHF',
      '    assets:cash',
      '',
      'alias a=b'
    ].join('\n')
    const pf = parseFile(text, 'u.journal')
    expect(pf.unsupported.map((u) => u.reason)).toEqual(['directive "alias"'])
    // a periodic transaction without a start date is a read-only schedule
    expect(pf.schedules).toHaveLength(1)
    expect(pf.schedules[0].period).toBe('monthly')
    expect(pf.schedules[0].rule).toBeUndefined()
    expect(pf.schedules[0].tx.postings).toHaveLength(2)
    expect(pf.transactions[0].unsupported).toBe(true)
    expect(pf.transactions[1].unsupported).toBe(true)
    expect(pf.diagnostics.some((d) => d.severity === 'error' && d.line === 9)).toBe(true)
  })

  it('account directive: the comment needs two spaces, like hledger', () => {
    const pf = parseFile('account assets:a  ; type: A\naccount assets:b ; type: A\n', 'a.journal')
    expect(pf.accounts.map((a) => [a.name, a.tags.type])).toEqual([
      ['assets:a', 'A'],
      ['assets:b ; type: A', undefined]
    ])
  })

  it('parses directives', () => {
    const text = [
      'commodity 1000.00 CHF',
      'commodity EUR',
      '  format 1000.00 EUR',
      'P 2026-11-01 EUR 0.93 CHF',
      'account assets:bank:checking   ; type: C, currency: CHF',
      'include journals/*.journal'
    ].join('\n')
    const pf = parseFile(text)
    expect(pf.commodities.map((c) => [c.symbol, c.precision])).toEqual([
      ['CHF', 2],
      ['EUR', 2]
    ])
    expect(pf.prices[0].commodity).toBe('EUR')
    expect(pf.prices[0].price.qty.toFixed()).toBe('0.93')
    expect(pf.accounts[0]).toMatchObject({ name: 'assets:bank:checking', tags: { type: 'C', currency: 'CHF' } })
    expect(pf.includes[0].path).toBe('journals/*.journal')
  })

  it('follows includes with globs, in order', () => {
    const files = {
      'main.journal': 'include accounts.journal\ninclude journals/*.journal\n',
      'accounts.journal': 'account assets:a\n',
      'journals/2026.journal': '2026-01-02 b\n    assets:a  1.00 CHF\n    assets:a  -1.00 CHF\n',
      'journals/2025.journal': '2025-01-02 a\n    assets:a  1.00 CHF\n    assets:a  -1.00 CHF\n'
    }
    const j = parseJournal(files)
    expect(j.files).toEqual(['main.journal', 'accounts.journal', 'journals/2025.journal', 'journals/2026.journal'])
    expect(j.transactions.map((t) => t.payee)).toEqual(['a', 'b'])
    expect(resolveInclude('journals/x.journal', '../prices.journal', [])).toEqual(['prices.journal'])
  })

  it('reports a missing include', () => {
    const j = parseJournal({ 'main.journal': 'include nope.journal\n' })
    expect(j.diagnostics[0]).toMatchObject({ severity: 'error', line: 1 })
  })
})
