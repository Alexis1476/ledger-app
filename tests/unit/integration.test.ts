/**
 * Local-only integration tests (skipped in CI unless configured):
 *   LEDGER_DATA_DIR=../ledger-data HLEDGER=hledger pnpm test
 * 1. Parses the real ledger-data checkout and compares balances with `hledger bal -O json`.
 * 2. Writes one transaction of every kind into a temp copy and runs `hledger check --strict ordereddates`.
 */
import { execFileSync } from 'node:child_process'
import { cpSync, mkdtempSync, readFileSync, rmSync, writeFileSync, existsSync, mkdirSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { afterAll, describe, expect, it } from 'vitest'
import { build } from '../../src/ledger/builder'
import { format } from '../../src/ledger/formatter'
import { ensureInclude, insertTransaction, yearFile } from '../../src/ledger/insert'
import { parseJournal } from '../../src/ledger/parser'
import { formatSchedule, occurrences, parseRule } from '../../src/ledger/periodic'
import { renameAccounts } from '../../src/ledger/chart'
import { accountType, balances, buildPriceDB, checkAssertions } from '../../src/ledger/reports'
import { balanceSheet, incomeStatement } from '../../src/ledger/statements'
import { validate } from '../../src/ledger/validate'
import { hAmountStr, hq, readJournalDir, type HAmount } from './helpers'

const dataDir = process.env.LEDGER_DATA_DIR
const hledger = process.env.HLEDGER ?? 'hledger'

function hledgerAvailable(): boolean {
  try {
    execFileSync(hledger, ['--version'], { stdio: 'pipe' })
    return true
  } catch {
    return false
  }
}

const enabled = !!dataDir && existsSync(join(dataDir, 'main.journal')) && hledgerAvailable()

describe.skipIf(!enabled)('integration with real ledger-data', () => {
  const files = enabled ? readJournalDir(dataDir!) : {}
  const journal = parseJournal(files)
  const tmp = mkdtempSync(join(tmpdir(), 'ledger-it-'))
  afterAll(() => rmSync(tmp, { recursive: true, force: true }))

  it('parses without errors and its assertions pass', () => {
    expect(journal.diagnostics.filter((d) => d.severity === 'error')).toEqual([])
    expect(checkAssertions(journal.transactions).map((f) => f.message)).toEqual([])
  })

  it('balances equal hledger bal -O json', () => {
    const out = execFileSync(hledger, ['-f', join(dataDir!, 'main.journal'), 'bal', '-O', 'json'], { encoding: 'utf8' })
    const [rows] = JSON.parse(out) as [[string, string, number, HAmount[]][]]
    const bals = balances(journal)
    for (const [account, , , amounts] of rows) {
      const exp = amounts.filter((a) => !hq(a).isZero()).map(hAmountStr).sort()
      const got = (bals.get(account)?.nonZeroLines() ?? [])
        .map((l) => `${l.qty.toFixed()} ${l.commodity}` + (l.cost ? ` @@ ${l.cost.qty.toFixed()} ${l.cost.commodity}` : ''))
        .sort()
      expect(got, account).toEqual(exp)
    }
    const nonZero = [...bals].filter(([, m]) => m.nonZeroLines().length).map(([a]) => a).sort()
    expect(nonZero).toEqual(rows.map((r) => r[0]).sort())
  })

  it('statements match hledger bs / is per currency (no valuation)', () => {
    const typeOf = (a: string) => accountType(a, journal.accounts)
    const db = buildPriceDB(journal)
    /** hledger bal <query> -N -O json → total per commodity (costs ignored) */
    const totals = (args: string[]) => {
      const out = execFileSync(hledger, ['-f', join(dataDir!, 'main.journal'), 'bal', ...args, '-O', 'json'], { encoding: 'utf8' })
      const [rows] = JSON.parse(out) as [[string, string, number, HAmount[]][]]
      const sum = new Map<string, ReturnType<typeof hq>>()
      for (const [, , , amounts] of rows) for (const a of amounts) sum.set(a.acommodity, sum.has(a.acommodity) ? sum.get(a.acommodity)!.plus(hq(a)) : hq(a))
      return new Map([...sum].filter(([, q]) => !q.toDecimalPlaces(2).isZero()).map(([c, q]) => [c, q.toFixed(2)]))
    }
    const ours = (m: Map<string, { toFixed: (n: number) => string }>, sign = 1) =>
      new Map([...m].filter(([, q]) => q.toFixed(2) !== '0.00' && q.toFixed(2) !== '-0.00').map(([c, q]) => [c, (sign < 0 ? '-' : '') + q.toFixed(2)].map(String) as [string, string]))
    const norm = (m: Map<string, string>) => new Map([...m].map(([c, v]) => [c, v.replace(/^--/, '').replace(/^-0\.00$/, '0.00')]))
    const bs = balanceSheet(journal, typeOf, '2026-12-31', 'CHF', db)
    expect(ours(bs.assets.byCommodity)).toEqual(totals(['type:A', '-e', '2027-01-01']))
    expect(norm(ours(bs.liabilities.byCommodity, -1))).toEqual(totals(['type:L', '-e', '2027-01-01']))
    const is = incomeStatement(journal, typeOf, '2025-01-01', '2026-01-01', 'CHF', db)
    expect(ours(is.expenses.byCommodity)).toEqual(totals(['type:X', '-b', '2025-01-01', '-e', '2026-01-01']))
    expect(norm(ours(is.revenues.byCommodity, -1))).toEqual(totals(['type:R', '-b', '2025-01-01', '-e', '2026-01-01']))
  })

  it('a schedule written by the app passes hledger check and forecasts the same dates', () => {
    const dir = mkdtempSync(join(tmpdir(), 'ledger-sched-'))
    cpSync(dataDir!, dir, { recursive: true, filter: (src) => !src.includes('.git') })
    const rules = ['monthly from 2026-01-31 to 2026-07-01', 'every 2 weeks from 2026-11-10', 'quarterly from 2026-12-31']
    const blocks = rules.map((r, k) => {
      const tx = build('expense', { date: '2026-01-01', payee: `Sched ${k}`, id: `01SCHED00000000000000000${k}`, amount: '25.50', currency: 'CHF', source: 'assets:bank:checking', category: 'expenses:housing:rent' })
      return formatSchedule(parseRule(r)!, tx)
    })
    writeFileSync(join(dir, 'journals', 'scheduled.journal'), `; test\n\n${blocks.join('\n\n')}\n`)
    const main = readFileSync(join(dir, 'main.journal'), 'utf8')
    writeFileSync(join(dir, 'main.journal'), ensureInclude(main, 'journals/scheduled.journal'))
    execFileSync(hledger, ['-f', join(dir, 'main.journal'), 'check', '--strict', 'ordereddates'], { stdio: 'pipe' })
    const j = parseJournal(readJournalDir(dir))
    expect(j.schedules.map((x) => x.tx.payee)).toEqual(['Sched 0', 'Sched 1', 'Sched 2'])
    const out = execFileSync(hledger, ['-f', join(dir, 'main.journal'), 'print', '-I', '--forecast=2026-01-01..2027-07-01', 'desc:Sched'], { encoding: 'utf8' })
    for (const [k, r] of rules.entries()) {
      const theirs = [...out.matchAll(new RegExp(`^(\\d{4}-\\d{2}-\\d{2}) Sched ${k}`, 'gm'))].map((m) => m[1])
      expect(occurrences(parseRule(r)!, '2026-01-01', '2027-07-01'), r).toEqual(theirs)
    }
    rmSync(dir, { recursive: true, force: true })
  })

  it('moving a category everywhere keeps hledger happy and the totals unchanged', () => {
    const dir = mkdtempSync(join(tmpdir(), 'ledger-move-'))
    cpSync(dataDir!, dir, { recursive: true, filter: (src) => !src.includes('.git') })
    const total = (d: string) => execFileSync(hledger, ['-f', join(d, 'main.journal'), 'bal', '-N', '-1', '-M', 'expenses', '-O', 'csv'], { encoding: 'utf8' })
    const before = total(dir)
    const map = { 'expenses:food:groceries': 'expenses:food:supermarket' }
    let lines = 0
    for (const path of parseJournal(readJournalDir(dir)).files) {
      const r = renameAccounts(readFileSync(join(dir, path), 'utf8'), map)
      if (r.count) writeFileSync(join(dir, path), r.text)
      lines += r.count
    }
    expect(lines).toBeGreaterThan(200)
    execFileSync(hledger, ['-f', join(dir, 'main.journal'), 'check', '--strict', 'ordereddates'], { stdio: 'pipe' })
    expect(total(dir)).toBe(before)
    rmSync(dir, { recursive: true, force: true })
  })

  it('every kind written by the app passes hledger check --strict ordereddates', () => {
    cpSync(dataDir!, tmp, { recursive: true, filter: (src) => !src.includes('.git') })
    const today = '2026-12-15'
    const txs = [
      build('expense', { date: today, payee: 'Coop', note: 'test', id: '01IT0000000000000000000001', amount: '12.40', currency: 'CHF', source: 'assets:bank:checking', category: 'expenses:food:groceries', tags: { travel: '', payment: 'card' } }),
      build('expense', { date: today, payee: 'Migros', id: '01IT0000000000000000000002', amount: '24.30', currency: 'CHF', source: 'assets:sam:neo:chf', category: '', lines: [{ account: 'expenses:transfers:family:max', amount: '12.15' }, { account: 'expenses:food:groceries', amount: '12.15' }] }),
      build('expense', { date: today, payee: 'Taxi', id: '01IT0000000000000000000003', amount: '30000', currency: 'COP', source: 'assets:neo:chf', sourceCurrency: 'CHF', debited: '6.17', category: '', lines: [{ account: 'expenses:transport:taxi', amount: '15000' }, { account: 'expenses:transfers:family:max', amount: '15000' }] }),
      build('income', { date: today, payee: 'Employer', id: '01IT0000000000000000000004', account: 'assets:neo:chf', category: 'income:work:salary', amount: '100', currency: 'CHF' }),
      build('transfer', { date: today, id: '01IT0000000000000000000005', payee: 'Top-up', from: 'assets:bank:checking', to: 'assets:andes:checking', amount: '10', currency: 'CHF', toAmount: '40000', toCurrency: 'COP' }),
      build('transfer', { date: today, id: '01IT0000000000000000000006', payee: 'Neo', from: 'assets:neo:chf', to: 'assets:neo:eur', amount: '93.64', currency: 'CHF', toAmount: '100', toCurrency: 'EUR', fee: '0.95' }),
      build('transfer', { date: today, id: '01IT0000000000000000000007', payee: 'Neo', from: 'assets:neo:eur', to: 'assets:sam:neo:chf', amount: '100', currency: 'EUR', toAmount: '93.10', toCurrency: 'CHF' }),
      build('income', { date: today, id: '01IT0000000000000000000008', payee: 'Sam', account: 'assets:sam:neo:eur', category: 'income:transfers:family:sam', amount: '50', currency: 'EUR' }),
      build('expense', { date: today, id: '01IT0000000000000000000009', payee: 'Max', source: 'assets:max:cash:eur', category: 'expenses:transfers:family:max', amount: '5', currency: 'EUR' }),
      build('transfer', { date: today, id: '01IT0000000000000000000010', payee: 'Sam', from: 'assets:sam:cash:eur', to: 'assets:max:cash:eur', amount: '1', currency: 'EUR' }),
      build('transfer', { date: today, id: '01IT0000000000000000000011', payee: 'Sam', from: 'assets:neo:chf', to: 'assets:sam:neo:chf', amount: '20', currency: 'CHF' }),
      build('expense', { date: today, id: '01IT0000000000000000000012', payee: 'Eva', source: 'assets:cash:chf', category: 'assets:receivables:eva', amount: '10', currency: 'CHF', tags: { due: '2027-01-31' } }),
      build('income', { date: today, id: '01IT0000000000000000000013', payee: 'Eva', account: 'assets:cash:chf', category: 'assets:receivables:eva', amount: '5', currency: 'CHF' })
    ]
    let files2 = readJournalDir(tmp)
    for (const tx of txs) {
      const j = parseJournal(files2)
      expect(validate(tx, j).map((i) => i.message), tx.payee).toEqual([])
      const target = yearFile(tx.date)
      const cur = files2[target] ?? ''
      const { text } = insertTransaction(cur, format(tx), tx.date)
      const targetPath = join(tmp, target)
      mkdirSync(join(tmp, 'journals'), { recursive: true })
      writeFileSync(targetPath, text)
      writeFileSync(join(tmp, 'main.journal'), ensureInclude(readFileSync(join(tmp, 'main.journal'), 'utf8'), target))
      files2 = readJournalDir(tmp)
    }
    let err = ''
    try {
      execFileSync(hledger, ['-f', join(tmp, 'main.journal'), 'check', '--strict', 'ordereddates'], { stdio: 'pipe' })
    } catch (e) {
      err = String((e as { stderr?: Buffer }).stderr ?? e)
    }
    expect(err).toBe('')
  })
})
