import { readFileSync, readdirSync, statSync } from 'node:fs'
import { join, relative, sep } from 'node:path'
import { Decimal } from '../../src/ledger/decimal'
import { parseJournal } from '../../src/ledger/parser'

export const FIXTURES = join(__dirname, '..', 'fixtures')

export function fixtureText(name: string): string {
  return readFileSync(join(FIXTURES, name), 'utf8')
}

export function fixtureJson<T = unknown>(name: string): T {
  return JSON.parse(fixtureText(name)) as T
}

export function recipesFiles(): Record<string, string> {
  return {
    'recipes.journal': fixtureText('recipes.journal'),
    'accounts.journal': fixtureText('accounts.journal'),
    'commodities.journal': fixtureText('commodities.journal')
  }
}

export function recipesJournal() {
  return parseJournal(recipesFiles(), 'recipes.journal')
}

/** Read every *.journal file under a directory, keyed by forward-slash relative path. */
export function readJournalDir(dir: string): Record<string, string> {
  const out: Record<string, string> = {}
  const walk = (d: string) => {
    for (const name of readdirSync(d)) {
      if (name.startsWith('.') || name === 'node_modules') continue
      const p = join(d, name)
      if (statSync(p).isDirectory()) walk(p)
      else if (name.endsWith('.journal')) out[relative(dir, p).split(sep).join('/')] = readFileSync(p, 'utf8')
    }
  }
  walk(dir)
  return out
}

export interface HAmount {
  acommodity: string
  aquantity: { decimalMantissa: number; decimalPlaces: number }
  acost: null | { tag: 'TotalCost' | 'UnitCost'; contents: HAmount }
}

export function hq(a: HAmount): Decimal {
  return new Decimal(a.aquantity.decimalMantissa).div(new Decimal(10).pow(a.aquantity.decimalPlaces))
}

/** Normalised string for an hledger JSON amount, e.g. "-740 EUR @@ -683.39 CHF". */
export function hAmountStr(a: HAmount): string {
  let s = `${hq(a).toFixed()} ${a.acommodity}`
  if (a.acost) s += ` ${a.acost.tag === 'TotalCost' ? '@@' : '@'} ${hq(a.acost.contents).toFixed()} ${a.acost.contents.acommodity}`
  return s
}
