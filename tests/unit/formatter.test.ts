import { describe, expect, it } from 'vitest'
import { format } from '../../src/ledger/formatter'
import { recipesJournal } from './helpers'

describe('formatter round-trip', () => {
  const journal = recipesJournal()
  for (const tx of journal.transactions) {
    it(`format(parse(text)) === text: ${tx.payee} ${tx.note ?? ''}`, () => {
      expect(format(tx)).toBe(tx.src!.raw)
    })
  }
})
