import { mkdirSync, writeFileSync } from 'node:fs'
import { dirname, join } from 'node:path'
import { accountLine, STARTER_CATEGORIES } from '../../src/ledger/chart'

/**
 * A made-up ledger for the end-to-end tests: about fourteen months of ordinary life, dated
 * relative to `today` so that "this month" and "the last 6 months" always have data.
 *
 * Nothing in it is real. It has what the tests need: a bank with several pockets, a second bank
 * with CHF and EUR, cash, money kept for two people (Sam with a "to put back" reminder, Max),
 * an open loan (Ana) and a settled one (Leo), supermarket purchases (Migros, Coop), spending in
 * Food (groceries only) and in several Leisure categories, and two scheduled payments.
 */

type Line = [account: string, amount: string]
interface Tx {
  date: string
  head: string
  lines: Line[]
}

const iso = (d: Date) => d.toISOString().slice(0, 10)
const day = (y: number, m: number, d: number) => iso(new Date(Date.UTC(y, m, d)))

/** a stable pseudo-random generator: the same ledger for the same day */
function prng(seed: number) {
  let s = seed >>> 0
  return () => {
    s = (s * 1664525 + 1013904223) >>> 0
    return s / 2 ** 32
  }
}

const POCKETS: [account: string, currency: string, label: string][] = [
  ['assets:bank:checking', 'CHF', 'Bank Checking'],
  ['assets:bank:savings', 'CHF', 'Bank Savings'],
  ['assets:bank:card', 'CHF', 'Bank Card'],
  ['assets:neo:chf', 'CHF', 'Neo CHF'],
  ['assets:neo:eur', 'EUR', 'Neo EUR'],
  ['assets:cash:chf', 'CHF', 'Cash CHF'],
  ['assets:cash:eur', 'EUR', 'Cash EUR'],
  // money kept for people (a label in the books only)
  ['assets:sam:neo:chf', 'CHF', 'Sam · Neo CHF'],
  ['assets:sam:neo:eur', 'EUR', 'Sam · Neo EUR'],
  ['assets:sam:cash:eur', 'EUR', 'Sam · Cash EUR'],
  ['assets:max:cash:eur', 'EUR', 'Max · Cash EUR']
]

function accountsJournal(): string {
  const income = STARTER_CATEGORIES.filter(([a]) => a.startsWith('income:'))
  const expenses = STARTER_CATEGORIES.filter(([a]) => a.startsWith('expenses:'))
  return [
    '; accounts.journal — sample chart of accounts for the end-to-end tests (made-up data)',
    '',
    accountLine('assets', { type: 'A' }),
    ...POCKETS.map(([a, currency]) => accountLine(a, { type: 'C', currency })),
    accountLine('assets:receivables:ana', { type: 'A' }),
    accountLine('assets:receivables:leo', { type: 'A' }),
    '',
    accountLine('liabilities', { type: 'L' }),
    '',
    accountLine('equity:opening', { type: 'E', label: 'Opening balances' }),
    accountLine('equity:conversion', { type: 'E', label: 'Currency conversion' }),
    accountLine('equity:adjustments', { type: 'E', label: 'Adjustments' }),
    '',
    ...income.map(([a, label]) => accountLine(a, { type: 'R', label })),
    accountLine('income:transfers:family:sam', { type: 'R' }),
    accountLine('income:transfers:family:max', { type: 'R' }),
    '',
    ...expenses.map(([a, label]) => accountLine(a, { type: 'X', label })),
    accountLine('expenses:transfers:family:sam', { type: 'X' }),
    accountLine('expenses:transfers:family:max', { type: 'X' }),
    ''
  ].join('\n')
}

function config(reminderSince: string) {
  const accounts: Record<string, Record<string, string | number>> = {
    'assets:bank': { label: 'Bank' },
    'assets:neo': { label: 'Neo' },
    'assets:cash': { label: 'Cash' },
    'assets:sam': { label: 'Sam' },
    'assets:max': { label: 'Max' }
  }
  POCKETS.forEach(([a, , label], i) => (accounts[a] = { label, order: i }))
  return {
    version: 1,
    referenceCurrency: 'CHF',
    people: {
      sam: {
        label: 'Sam',
        color: '#a855f7',
        pockets: ['assets:sam:neo:chf', 'assets:sam:neo:eur', 'assets:sam:cash:eur'],
        toReturn: { amount: '500.00', currency: 'CHF', since: reminderSince, note: "Sam's CHF I used, to put back into the pockets" }
      },
      max: { label: 'Max', color: '#0ea5e9', pockets: ['assets:max:cash:eur'] },
      ana: { label: 'Ana', color: '#f97316' },
      leo: { label: 'Leo', color: '#14b8a6' }
    },
    accounts,
    categories: {},
    templates: [{ name: 'Rent', kind: 'expense', account: 'assets:bank:checking', category: 'expenses:housing:rent', payee: 'Landlord', amount: '1200.00', currency: 'CHF' }],
    favorites: {
      categories: ['expenses:food:groceries', 'expenses:dining:restaurants', 'expenses:transport:public', 'expenses:leisure:going-out', 'expenses:shopping:clothes', 'expenses:insurance:health']
    }
  }
}

/** a posting line: the amount right-aligned like the app writes it (column 58) */
function posting([account, amount]: Line): string {
  if (!amount) return `    ${account}`
  const left = `    ${account}`
  return left + ' '.repeat(Math.max(2, 58 - left.length - amount.length)) + amount
}
const money = (n: number) => n.toFixed(2)

export function writeSampleLedger(dir: string, today = new Date()) {
  const rnd = prng(Number(iso(today).replace(/-/g, '')))
  const pick = <T>(xs: T[]) => xs[Math.floor(rnd() * xs.length)]
  const amount = (min: number, max: number) => min + Math.round(rnd() * (max - min) * 20) / 20
  const todayIso = iso(today)
  const txs: Tx[] = []
  const add = (date: string, head: string, ...lines: Line[]) => {
    if (date < todayIso) txs.push({ date, head, lines })
  }
  const spend = (date: string, payee: string, category: string, n: number, from = 'assets:bank:checking', cur = 'CHF') =>
    add(date, payee, [category, `${money(n)} ${cur}`], [from, `-${money(n)} ${cur}`])

  const y0 = today.getUTCFullYear()
  const m0 = today.getUTCMonth()
  const first = new Date(Date.UTC(y0, m0 - 13, 1))
  const start = iso(first)
  add(
    start,
    'Opening balance',
    ['assets:bank:checking', '3200.00 CHF'],
    ['assets:bank:savings', '8000.00 CHF'],
    ['assets:neo:chf', '400.00 CHF'],
    ['assets:neo:eur', '250.00 EUR'],
    ['assets:cash:chf', '150.00 CHF'],
    ['assets:cash:eur', '60.00 EUR'],
    ['assets:sam:neo:chf', '1500.00 CHF'],
    ['assets:sam:neo:eur', '900.00 EUR'],
    ['assets:sam:cash:eur', '300.00 EUR'],
    ['assets:max:cash:eur', '800.00 EUR'],
    ['equity:opening', '']
  )

  for (let k = 13; k >= 0; k--) {
    const y = new Date(Date.UTC(y0, m0 - k, 1)).getUTCFullYear()
    const m = new Date(Date.UTC(y0, m0 - k, 1)).getUTCMonth()
    const d = (n: number) => day(y, m, n)
    add(d(1), 'Landlord | Rent', ['expenses:housing:rent', '1200.00 CHF'], ['assets:bank:checking', '-1200.00 CHF'])
    add(d(25), 'Employer | Salary', ['assets:bank:checking', '5200.00 CHF'], ['income:work:salary', '-5200.00 CHF'])
    spend(d(3), 'Health insurer', 'expenses:insurance:health', 342.6)
    spend(d(5), 'Phone company', 'expenses:communication:mobile', 29.9, 'assets:neo:chf')
    spend(d(6), 'Power company', 'expenses:housing:utilities', amount(60, 110))
    for (const n of [2, 9, 16, 23]) spend(d(n), pick(['Migros', 'Coop']), 'expenses:food:groceries', amount(25, 120), pick(['assets:bank:card', 'assets:bank:checking', 'assets:cash:chf']))
    spend(d(12), ['Pizzeria', 'Bistro', 'Thai Garden'][k % 3], 'expenses:dining:restaurants', amount(30, 85), 'assets:bank:card')
    spend(d(19), 'Café', 'expenses:dining:bars', amount(6, 18), 'assets:cash:chf')
    spend(d(8), 'Streaming service', 'expenses:leisure:streaming', 14.9, 'assets:neo:chf')
    spend(d(14), 'Cinema', 'expenses:leisure:going-out', amount(18, 45), 'assets:bank:card')
    spend(d(20), 'Climbing gym', 'expenses:leisure:sport', 35, 'assets:neo:chf')
    spend(d(4), 'Transit pass', 'expenses:transport:public', 85, 'assets:bank:card')
    add(d(26), 'Transfer | Bank → Neo', ['assets:neo:chf', '300.00 CHF'], ['assets:bank:checking', '-300.00 CHF'])
    add(d(28), 'Card bill', ['assets:bank:card', '420.00 CHF'], ['assets:bank:checking', '-420.00 CHF'])
    add(d(11), 'ATM | Cash', ['assets:cash:chf', '100.00 CHF'], ['assets:bank:checking', '-100.00 CHF'])
    add(d(27), 'Transfer | Savings', ['assets:bank:savings', '500.00 CHF'], ['assets:bank:checking', '-500.00 CHF'])
    if (k % 3 === 0) {
      add(d(10), 'Exchange', ['assets:neo:eur', '200.00 EUR'], ['assets:neo:chf', '-188.40 CHF'], ['equity:conversion', ''])
      spend(d(11), 'Bookshop', 'expenses:shopping:other', amount(15, 40), 'assets:neo:eur', 'EUR')
      spend(d(17), 'Bakery', 'expenses:food:groceries', amount(4, 12), 'assets:cash:eur', 'EUR')
    }
    if (k % 4 === 1) spend(d(13), 'Electronics store', 'expenses:shopping:electronics', amount(60, 400), 'assets:bank:card')
    if (k % 5 === 2) spend(d(15), 'Clothes shop', 'expenses:shopping:clothes', amount(40, 150), 'assets:bank:card')
    // money kept for Sam and Max
    add(d(7), 'Sam | Deposit', ['assets:sam:neo:eur', '300.00 EUR'], ['income:transfers:family:sam', '-300.00 EUR'])
    if (k % 2 === 0) spend(d(21), 'Pharmacy | for Sam', 'expenses:transfers:family:sam', amount(20, 60), 'assets:sam:cash:eur', 'EUR')
    if (k % 3 === 1) add(d(18), 'Max | Deposit', ['assets:max:cash:eur', '150.00 EUR'], ['income:transfers:family:max', '-150.00 EUR'])
  }

  // loans: Ana still owes 70, Leo paid back everything
  const ago = (months: number, n: number) => day(y0, m0 - months, n)
  add(ago(3, 9), 'Ana | Lent', ['assets:receivables:ana', '120.00 CHF'], ['assets:bank:checking', '-120.00 CHF'])
  add(ago(1, 9), 'Ana | Paid back', ['assets:bank:checking', '50.00 CHF'], ['assets:receivables:ana', '-50.00 CHF'])
  add(ago(6, 3), 'Leo | Lent', ['assets:receivables:leo', '60.00 EUR'], ['assets:neo:eur', '-60.00 EUR'])
  add(ago(5, 3), 'Leo | Paid back', ['assets:neo:eur', '60.00 EUR'], ['assets:receivables:leo', '-60.00 EUR'])
  // Sam's CHF used, part of it put back
  const since = ago(2, 1)
  add(ago(2, 2), 'Sam | CHF I used', ['assets:neo:chf', '500.00 CHF'], ['assets:sam:neo:chf', '-500.00 CHF'])

  txs.sort((a, b) => a.date.localeCompare(b.date))
  const years = [...new Set(txs.map((t) => t.date.slice(0, 4)))]
  const file = (path: string, text: string) => {
    mkdirSync(dirname(join(dir, path)), { recursive: true })
    writeFileSync(join(dir, path), text)
  }
  for (const y of years) {
    const body = txs.filter((t) => t.date.startsWith(y)).map((t) => [`${t.date} * ${t.head}`, ...t.lines.map(posting)].join('\n'))
    file(`journals/${y}.journal`, `; journals/${y}.journal — sample data\n\n${body.join('\n\n')}\n`)
  }

  // exchange rates: one per month, in CHF
  const prices: string[] = []
  for (let k = 14; k >= 0; k--) {
    const p = day(y0, m0 - k, 1)
    prices.push(`P ${p} EUR 0.94 CHF`, `P ${p} USD 0.88 CHF`, `P ${p} COP 0.00021 CHF`)
  }

  // scheduled payments (hledger periodic transactions), the next ones still to come
  const nextMonth = (n: number) => day(y0, today.getUTCDate() < n ? m0 : m0 + 1, n)
  const scheduled = [
    '; scheduled.journal — sample scheduled payments',
    '',
    `~ monthly from ${nextMonth(25)}  Employer | Salary`,
    posting(['assets:bank:checking', '5200.00 CHF']),
    posting(['income:work:salary', '-5200.00 CHF']),
    '',
    `~ monthly from ${nextMonth(5)}  Phone company`,
    posting(['expenses:communication:mobile', '29.90 CHF']),
    posting(['assets:neo:chf', '-29.90 CHF']),
    ''
  ].join('\n')

  file('main.journal', ['; main.journal — sample ledger for the end-to-end tests', 'include commodities.journal', 'include accounts.journal', 'include prices.journal', ...years.map((y) => `include journals/${y}.journal`), 'include journals/scheduled.journal', ''].join('\n'))
  file('commodities.journal', ['commodity 1000.00 CHF', 'commodity 1000.00 EUR', 'commodity 1000.00 USD', 'commodity 1000.00 COP', ''].join('\n'))
  file('accounts.journal', accountsJournal())
  file('prices.journal', `${prices.join('\n')}\n`)
  file('journals/scheduled.journal', scheduled)
  file('app.config.json', `${JSON.stringify(config(since), null, 2)}\n`)
  file('lists/shopping.md', '# Shopping list\n\n- [ ] Milk\n- [ ] Bread\n')
  file('README.md', '# Sample ledger\n\nMade-up data for the end-to-end tests.\n')
}
