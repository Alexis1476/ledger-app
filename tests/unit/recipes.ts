import type { KindInputs } from '../../src/ledger/builder'
import type { TxKind } from '../../src/ledger/types'

/** Inputs of every app-written recipe in tests/fixtures/recipes.journal (docs/02). */
export type Recipe = { [K in TxKind]: { name: string; kind: K; input: KindInputs[K] } }[TxKind]

export const id = (n: number) => `01JC00000000000000000000${String(n).padStart(2, '0')}`

export const recipes: Recipe[] = [
  {
    name: 'R1 expense · a pocket pays a category',
    kind: 'expense',
    input: {
      date: '2026-11-02', payee: 'Migros', note: 'Weekly groceries', id: id(1),
      amount: '84.35', currency: 'CHF', source: 'assets:bank:checking', category: 'expenses:food:groceries'
    }
  },
  {
    name: 'R2 expense · paid for a person (what I owe Max goes down)',
    kind: 'expense',
    input: {
      date: '2026-11-03', payee: 'easyJet', note: 'Flight Paris - Geneva (for Max)', id: id(2),
      amount: '79.48', currency: 'EUR', source: 'assets:neo:eur', category: 'liabilities:people:max'
    }
  },
  {
    name: 'R3 expense · split between a category and people (Max: I owe him less, Eva: owes me)',
    kind: 'expense',
    input: {
      date: '2026-11-04', payee: 'Bistro', note: 'Dinner for 4', id: id(3),
      amount: '84.60', currency: 'CHF', source: 'assets:bank:checking', category: '',
      lines: [
        { account: 'expenses:food:restaurants', amount: '21.15' },
        { account: 'liabilities:people:max', amount: '42.30' },
        { account: 'assets:receivables:eva', amount: '21.15' }
      ]
    }
  },
  {
    name: 'R4 income · from a person (Sam leaves money with me: what I owe her goes up)',
    kind: 'income',
    input: {
      date: '2026-11-05', payee: 'Sam', note: 'Deposit', id: id(4),
      account: 'assets:neo:eur', category: 'liabilities:people:sam', amount: '4500', currency: 'EUR'
    }
  },
  {
    name: 'R5 transfer · exchange between two pockets, with a fee',
    kind: 'transfer',
    input: {
      date: '2026-11-06', payee: 'Neo', note: 'Exchange CHF → EUR', id: id(5),
      from: 'assets:neo:chf', amount: '468.20', currency: 'CHF', to: 'assets:neo:eur', toAmount: '500', toCurrency: 'EUR', fee: '0.95'
    }
  },
  {
    name: "R6 transfer · pocket to pocket (into Sam's Neo pocket)",
    kind: 'transfer',
    input: {
      date: '2026-11-07', payee: 'Neo', note: "Into Sam's pocket", id: id(6),
      from: 'assets:neo:chf', to: 'assets:sam:neo:chf', amount: '200', currency: 'CHF'
    }
  },
  {
    name: 'R7 transfer · pocket to a person (paying Sam back: the money leaves me, what I owe her goes down)',
    kind: 'transfer',
    input: {
      date: '2026-11-07', payee: 'Sam', note: 'Paying back', id: id(7),
      from: 'assets:bank:checking', to: 'liabilities:people:sam', amount: '200', currency: 'CHF'
    }
  },
  {
    name: 'R8 expense · lend to a third party (Lucas owes me)',
    kind: 'expense',
    input: {
      date: '2026-11-08', payee: 'Lucas', note: 'Loan for the concert', id: id(8), tags: { due: '2026-12-15' },
      amount: '80', currency: 'CHF', source: 'assets:bank:checking', category: 'assets:receivables:lucas'
    }
  },
  {
    name: 'R9 income · the third party repays part of it',
    kind: 'income',
    input: {
      date: '2026-11-09', payee: 'Lucas', note: 'Repays part of the loan', id: id(9),
      account: 'assets:bank:checking', category: 'assets:receivables:lucas', amount: '50', currency: 'CHF'
    }
  },
  {
    name: 'R10 expense · in a foreign currency, debited in CHF',
    kind: 'expense',
    input: {
      date: '2026-11-09', payee: 'Restaurant', note: 'Dinner in Córdoba', id: id(10), tags: { holiday: '', payment: 'card' },
      amount: '185000', currency: 'COP', source: 'assets:neo:chf', sourceCurrency: 'CHF', debited: '38.10', category: 'expenses:travel'
    }
  },
  {
    name: 'R11 transfer · between pockets across currencies',
    kind: 'transfer',
    input: {
      date: '2026-11-10', payee: 'Transfer Bank Prepaid → Andes', id: id(11),
      from: 'assets:bank:prepaid', amount: '111.89', currency: 'CHF', to: 'assets:andes:checking', toAmount: '419574.15', toCurrency: 'COP'
    }
  },
  {
    name: 'R12 income · salary',
    kind: 'income',
    input: {
      date: '2026-11-25', payee: 'Employer', note: 'Salary November', id: id(12),
      account: 'assets:neo:chf', category: 'income:salary', amount: '4329.50', currency: 'CHF'
    }
  },
  {
    name: 'R13 monthly balance assertion (copied from the bank statement)',
    kind: 'assertion',
    // balance filled in by the generator from the entries above
    input: { date: '2026-11-30', payee: 'Statement Neo EUR', id: id(13), account: 'assets:neo:eur', balance: '0', currency: 'EUR' }
  }
]

/**
 * Shapes the app no longer writes but that exist in an imported history or are
 * written by hand. They stay valid hledger; the app reads them and can only delete them.
 */
export const handWritten = [
  {
    name: "H1 imported · groceries paid from Sam's pocket (owners/loan pair merged away)",
    text: [
      '2026-11-02 * Aldi',
      '    expenses:food:groceries                          13.15 CHF',
      '    assets:sam:neo:chf                              -13.15 CHF'
    ].join('\n')
  },
  {
    name: "H2 imported · exchange of Sam's money (EUR → CHF), converting what I owe her too",
    text: [
      "2026-11-06 * Neo | Exchange EUR → CHF (Sam's money)",
      '    assets:sam:neo:chf                              683.39 CHF',
      '    assets:neo:eur                                 -740.00 EUR @@ 683.39 CHF',
      '    liabilities:people:sam                          740.00 EUR @@ 683.39 CHF',
      '    liabilities:people:sam                         -683.39 CHF'
    ].join('\n')
  },
  {
    name: 'H3 hand-written · Max gives me part of what I owe him (no physical move)',
    text: [
      '2026-11-08 * Max | Keeping 100 EUR as a gift',
      '    liabilities:people:max                          100.00 EUR',
      '    income:gifts                                   -100.00 EUR'
    ].join('\n')
  }
]
