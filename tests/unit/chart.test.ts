import { execFileSync } from 'node:child_process'
import { mkdirSync, mkdtempSync, rmSync, writeFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { dirname, join } from 'node:path'
import { describe, expect, it } from 'vitest'
import { accountLine, addCommodity, addDeclaration, pocketAccount, setupFiles, slug } from '../../src/ledger/chart'
import { parseJournal } from '../../src/ledger/parser'
import { validate } from '../../src/ledger/validate'

const hledger = process.env.HLEDGER ?? 'hledger'
const hasHledger = (() => {
  try {
    execFileSync(hledger, ['--version'], { stdio: 'pipe' })
    return true
  } catch {
    return false
  }
})()

const input = {
  referenceCurrency: 'chf',
  pockets: [
    { name: 'Bank checking', currency: 'CHF', balance: "1'250.50" },
    { name: 'Revolut EUR', currency: 'eur', balance: '80' },
    { name: 'Cash', currency: 'CHF' }
  ],
  date: '2026-11-10',
  openingId: '01OPEN0000000000000000000A'
}

describe('chart of accounts', () => {
  it('slugs and declaration lines (two spaces before the comment, even for long names)', () => {
    expect(slug('Revolut EUR')).toBe('revolut-eur')
    expect(pocketAccount('Banque Populaire Exemple')).toBe('assets:banque-populaire-exemple')
    expect(accountLine('assets:revolut-eur', { type: 'C', currency: 'EUR', label: 'Revolut, EUR' })).toBe(
      'account assets:revolut-eur                  ; type: C, currency: EUR, label: Revolut EUR'
    )
    expect(accountLine('assets:a-very-long-account-name-for-a-bank-pocket', { type: 'C' })).toContain('pocket  ; type: C')
  })

  it('adds a declaration next to its siblings, else its parent, else at the end', () => {
    const text = 'account assets:bank  ; type: C\naccount assets:cash  ; type: C\naccount expenses:food:groceries  ; type: X\naccount expenses:travel  ; type: X\n'
    expect(addDeclaration(text, 'assets:revolut', { type: 'C' }).split('\n')[2]).toMatch(/^account assets:revolut +; type: C$/)
    expect(addDeclaration(text, 'expenses:food:bars', { type: 'X' }).split('\n')[3]).toMatch(/^account expenses:food:bars +; type: X$/)
    expect(addDeclaration(text, 'income:salary', { type: 'R' }).trimEnd().split('\n').at(-1)).toMatch(/^account income:salary +; type: R$/)
  })

  it('adds a currency once', () => {
    const t = '; c\ncommodity 1000.00 CHF\n'
    expect(addCommodity(t, 'EUR')).toBe('; c\ncommodity 1000.00 CHF\ncommodity 1000.00 EUR\n')
    expect(addCommodity(t, 'CHF')).toBe(t)
  })

  it('starter files parse cleanly, with labels and opening balances', () => {
    const files = setupFiles(input)
    expect(Object.keys(files).sort()).toEqual([
      '.github/workflows/check.yml',
      '.github/workflows/rates.yml',
      'README.md',
      'accounts.journal',
      'app.config.json',
      'commodities.journal',
      'journals/2026.journal',
      'main.journal',
      'prices.journal'
    ])
    const j = parseJournal(files)
    expect(j.diagnostics.filter((d) => d.severity === 'error')).toEqual([])
    expect(j.accounts.find((a) => a.name === 'assets:revolut-eur')?.tags).toMatchObject({ type: 'C', currency: 'EUR', label: 'Revolut EUR' })
    expect(j.commodities.map((c) => c.symbol)).toEqual(['CHF', 'EUR'])
    const [opening] = j.transactions
    expect(validate(opening, j, { replacing: opening })).toEqual([])
    expect(opening.postings.map((p) => `${p.account} ${p.amount!.qty.toFixed(2)} ${p.amount!.commodity}`)).toEqual([
      'assets:bank-checking 1250.50 CHF',
      'assets:revolut-eur 80.00 EUR',
      'equity:opening -1250.50 CHF',
      'equity:opening -80.00 EUR'
    ])
    expect(JSON.parse(files['app.config.json']).referenceCurrency).toBe('CHF')
  })

  it.skipIf(!hasHledger)('a new repository passes hledger check --strict ordereddates', () => {
    const dir = mkdtempSync(join(tmpdir(), 'ledger-setup-'))
    for (const [path, text] of Object.entries(setupFiles(input))) {
      mkdirSync(dirname(join(dir, path)), { recursive: true })
      writeFileSync(join(dir, path), text)
    }
    execFileSync(hledger, ['-f', join(dir, 'main.journal'), 'check', '--strict', 'ordereddates'], { stdio: 'pipe' })
    const bal = execFileSync(hledger, ['-f', join(dir, 'main.journal'), 'bal', '-N', 'assets'], { encoding: 'utf8' })
    expect(bal).toContain('1250.50 CHF  assets:bank-checking')
    rmSync(dir, { recursive: true, force: true })
  })
})

describe('editing the chart', () => {
  const text = [
    'account expenses:food:groceries     ; type: X, label: Groceries',
    'account expenses:leisure:photo      ; type: X',
    '',
    '2026-01-02 * Camera store',
    '    expenses:leisure:photo                           999.00 CHF  ; item:Camera',
    '    assets:cash                                     -999.00 CHF',
    ''
  ].join('\n')

  it('moves an account everywhere, keeping the amount column and the tags', async () => {
    const { renameAccounts } = await import('../../src/ledger/chart')
    const r = renameAccounts(text, { 'expenses:leisure:photo': 'expenses:hobbies:photography' })
    expect(r.count).toBe(2)
    const lines = r.text.split('\n')
    expect(lines[1]).toMatch(/^account expenses:hobbies:photography {2,}; type: X$/)
    expect(lines[4]).toBe('    expenses:hobbies:photography                     999.00 CHF  ; item:Camera')
    expect(lines[4].indexOf('999.00')).toBe(text.split('\n')[4].indexOf('999.00'))
  })

  it('sets or removes declaration tags (label, archived)', async () => {
    const { setDeclarationTags, parseDeclTags } = await import('../../src/ledger/chart')
    const t = setDeclarationTags(text, 'expenses:food:groceries', { label: 'Supermarket', archived: 'yes' })
    expect(t.split('\n')[0]).toMatch(/; type: X, label: Supermarket, archived: yes$/)
    const back = setDeclarationTags(t, 'expenses:food:groceries', { archived: '' })
    expect(parseDeclTags(back.split('\n')[0].split(';')[1])).toEqual({ type: 'X', label: 'Supermarket' })
  })
})

describe('chart tree', () => {
  it('groups first, then categories; depth from the section root', async () => {
    const { chartTree } = await import('../../src/ledger/chart')
    const t = chartTree(['expenses:travel', 'expenses:food:groceries', 'expenses:transfers:family:sam', 'expenses:transfers:gifts', 'income:work:salary'], 'expenses')
    expect(t.map((n) => `${n.name}:${n.leaf}`)).toEqual(['food:false', 'transfers:false', 'travel:true'])
    const transfers = t[1]
    expect(transfers.children.map((n) => `${n.name}:${n.depth}:${n.leaf}`)).toEqual(['family:1:false', 'gifts:1:true'])
    expect(transfers.children[0].children[0]).toMatchObject({ account: 'expenses:transfers:family:sam', depth: 2, leaf: true })
  })
})
