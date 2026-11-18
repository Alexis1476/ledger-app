// Writes tests/fixtures/recipes.journal from tests/unit/recipes.ts: pnpm fixtures:recipes (then pnpm fixtures)
import { readFileSync, writeFileSync } from 'node:fs'
import { join } from 'node:path'
import { it } from 'vitest'
import { build } from '../../src/ledger/builder'
import { format } from '../../src/ledger/formatter'
import { parseJournal } from '../../src/ledger/parser'
import { balances } from '../../src/ledger/reports'
import { FIXTURES } from './helpers'
import { handWritten, recipes } from './recipes'

it.skipIf(import.meta.env.MODE !== 'gen-recipes')('generate recipes.journal', () => {
  const head = [
    '; recipes.journal — one example per transaction shape the app writes (docs/02-data-model.md),',
    '; plus imported / hand-written shapes the app only reads (H*).',
    '; Validated with: hledger -f recipes.journal check --strict ordereddates',
    '; The app formatter must reproduce these exact shapes (all amounts explicit).',
    '',
    'include commodities.journal',
    'include accounts.journal',
    ''
  ]
  // app recipes + hand-written shapes, in date order (stable)
  const entries = [
    ...recipes.filter((r) => r.kind !== 'assertion').map((r) => ({ date: r.input.date, name: r.name, text: format(build(r.kind, r.input as never)) })),
    ...handWritten.map((h) => ({ date: h.text.slice(0, 10), name: h.name, text: h.text }))
  ].sort((a, b) => (a.date < b.date ? -1 : a.date > b.date ? 1 : 0))
  const body = entries.flatMap((e) => [`; ${e.name}`, e.text, ''])
  // the statement assertion asserts the balance the entries above produce
  const files = {
    'recipes.journal': [...head, ...body].join('\n'),
    'accounts.journal': readFileSync(join(FIXTURES, 'accounts.journal'), 'utf8'),
    'commodities.journal': readFileSync(join(FIXTURES, 'commodities.journal'), 'utf8')
  }
  const r13 = recipes.find((r) => r.kind === 'assertion')!
  if (r13.kind !== 'assertion') throw new Error('no assertion recipe')
  const bal = balances(parseJournal(files, 'recipes.journal')).get(r13.input.account)!.byCommodity().get(r13.input.currency)!
  const assertion = format(build('assertion', { ...r13.input, balance: bal.toFixed(2) }))
  const out = [...head, ...body, `; ${r13.name}`, assertion, ''].join('\n')
  writeFileSync(join(FIXTURES, 'recipes.journal'), out)
})
