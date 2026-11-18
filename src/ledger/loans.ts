import type { Decimal } from './decimal'
import type { Transaction } from './types'

/**
 * Loans: what someone owes me (assets:receivables:<who>, actif) and what I owe someone
 * (liabilities:people:<who>, passif). A loan is a normal transaction between one of my pockets
 * and the person's account; an existing transaction becomes a loan by moving its non-pocket
 * posting (e.g. expenses:transfers:people) to that account, amount unchanged.
 */

export const RECEIVABLE = 'assets:receivables:'
export const DEBT = 'liabilities:people:'

/** lent / they repaid me → receivable; borrowed / I repaid → debt */
export type LoanKind = 'lent' | 'repaidToMe' | 'borrowed' | 'repaidByMe'

export const KIND_LABEL: Record<LoanKind, string> = {
  lent: 'I lent',
  repaidToMe: 'They repaid me',
  borrowed: 'I borrowed',
  repaidByMe: 'I repaid'
}

/** money leaving my pocket: lent / I repaid; coming in: they repaid me / borrowed */
export const KINDS_BY_DIRECTION: Record<'out' | 'in', LoanKind[]> = {
  out: ['lent', 'repaidByMe'],
  in: ['repaidToMe', 'borrowed']
}

export function loanAccount(kind: LoanKind, who: string): string {
  return (kind === 'lent' || kind === 'repaidToMe' ? RECEIVABLE : DEBT) + who
}

/** "Nina Pérez" → "nina-perez" */
export function personKey(name: string): string {
  return name
    .normalize('NFD')
    .replace(/[̀-ͯ]/g, '')
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, '-')
    .replace(/^-+|-+$/g, '')
}

export interface Convertible {
  tx: Transaction
  /** the posting that moves to the person's account */
  postingIndex: number
  /** money left my pocket (out) or came in (in) */
  direction: 'out' | 'in'
}

/**
 * A transaction between one of my pockets and one other account (not already a person's):
 * the shape an imported loan has (expenses:transfers:people / income:transfers:people).
 */
export function convertible(tx: Transaction, isPocket: (account: string) => boolean): Convertible | undefined {
  if (tx.unsupported || tx.postings.length !== 2 || tx.postings.some((p) => !p.amount)) return undefined
  const k = tx.postings.findIndex((p) => !isPocket(p.account))
  if (k < 0 || !isPocket(tx.postings[1 - k].account)) return undefined
  const other = tx.postings[k].account
  if (other.startsWith(RECEIVABLE) || other.startsWith(DEBT)) return undefined
  return { tx, postingIndex: k, direction: tx.postings[1 - k].amount!.qty.isNeg() ? 'out' : 'in' }
}

/** Transactions whose payee / note contains every typed word, most recent first. */
export function searchConvertible(transactions: Transaction[], query: string, isPocket: (account: string) => boolean, limit = 8): Convertible[] {
  const words = query.toLocaleLowerCase().split(/\s+/).filter(Boolean)
  if (!words.length) return []
  const out: Convertible[] = []
  for (const tx of [...transactions].sort((a, b) => b.date.localeCompare(a.date))) {
    const hay = `${tx.payee ?? ''} ${tx.note ?? ''}`.toLocaleLowerCase()
    if (!words.every((w) => hay.includes(w))) continue
    const c = convertible(tx, isPocket)
    if (c) out.push(c)
    if (out.length >= limit) break
  }
  return out
}

/** The transaction with its non-pocket posting moved to the person's account. */
export function toLoan(c: Convertible, account: string): Transaction {
  return { ...c.tx, postings: c.tx.postings.map((p, i) => (i === c.postingIndex ? { ...p, account } : p)) }
}

export const GIFT_RECEIVED = 'income:transfers:gifts'
export const GIFT_GIVEN = 'expenses:transfers:gifts'

/** Someone paid back more than the loan ('receivable'), or I did ('debt'): the part beyond it. */
export interface Extra {
  side: 'receivable' | 'debt'
  /** positive */
  qty: Decimal
  commodity: string
}

/**
 * What was paid beyond a loan, per currency. `owesMe` is the receivable (positive = they owe me),
 * `owed` my debt (positive = I owe them): a negative amount is money paid in excess.
 */
export function extras(owesMe?: Map<string, Decimal>, owed?: Map<string, Decimal>): Extra[] {
  const out: Extra[] = []
  for (const [commodity, q] of owesMe ?? []) if (q.isNeg()) out.push({ side: 'receivable', qty: q.neg(), commodity })
  for (const [commodity, q] of owed ?? []) if (q.isNeg()) out.push({ side: 'debt', qty: q.neg(), commodity })
  return out
}

/** what the extra is: a gift (kept by who received it), or a loan the other way round */
export type ExtraAs = 'gift' | 'loan'

/**
 * The entry that says what an extra payment was. It brings the overpaid account back to zero:
 * - they paid too much → a gift I received, or a debt of mine to them;
 * - I paid too much → a gift I made, or a loan they now owe me.
 */
export function settleExtra(who: string, x: Extra, as: ExtraAs, meta: { date: string; id: string; payee: string }): Transaction {
  const mine = x.side === 'receivable'
  const from = (mine ? RECEIVABLE : DEBT) + who
  const to = as === 'gift' ? (mine ? GIFT_RECEIVED : GIFT_GIVEN) : (mine ? DEBT : RECEIVABLE) + who
  // they paid too much: the receivable goes back up to 0 (debit), the gift or my debt is credited;
  // I paid too much: my debt goes back down to 0 (credit), the gift or their debt is debited
  const sign = mine ? 1 : -1
  const note = as === 'gift' ? (mine ? 'Paid more than the loan: kept as a gift' : 'Paid more than my debt: left as a gift') : mine ? 'Paid more than the loan: I owe the difference' : 'Paid more than my debt: they owe the difference'
  return {
    date: meta.date,
    status: '*',
    payee: meta.payee,
    note,
    id: meta.id,
    tags: { via: 'app', id: meta.id },
    postings: [
      { account: from, amount: { qty: x.qty.times(sign), commodity: x.commodity }, tags: {} },
      { account: to, amount: { qty: x.qty.times(-sign), commodity: x.commodity }, tags: {} }
    ]
  }
}

/**
 * A loan settled with something else than money (a service, a thing): no pocket moves.
 * - they owed me ('receivable'): what I got is an expense, their debt goes down;
 * - I owed them ('debt'): what I gave is an income, my debt goes down.
 */
export function settleInKind(
  who: string,
  side: 'receivable' | 'debt',
  amount: { qty: Decimal; commodity: string },
  category: string,
  meta: { date: string; id: string; payee: string; note?: string }
): Transaction {
  const mine = side === 'receivable'
  const person = (mine ? RECEIVABLE : DEBT) + who
  const q = amount.qty.abs()
  return {
    date: meta.date,
    status: '*',
    payee: meta.payee,
    note: meta.note?.trim() || (mine ? 'Loan settled another way' : 'My debt settled another way'),
    id: meta.id,
    tags: { via: 'app', id: meta.id },
    postings: mine
      ? [
          { account: category, amount: { qty: q, commodity: amount.commodity }, tags: {} },
          { account: person, amount: { qty: q.neg(), commodity: amount.commodity }, tags: {} }
        ]
      : [
          { account: person, amount: { qty: q, commodity: amount.commodity }, tags: {} },
          { account: category, amount: { qty: q.neg(), commodity: amount.commodity }, tags: {} }
        ]
  }
}

/**
 * accounts.journal with `account <name>  ; type: A|L` added after the last declaration of the
 * same kind (receivables / people debts), else after the parent's group, else at the end.
 */
export function declareAccount(text: string, account: string): string {
  const lines = text.replace(/\r\n?/g, '\n').split('\n')
  const type = account.startsWith(DEBT) ? 'L' : 'A'
  // the comment needs at least two spaces after the name (one space would belong to the name)
  const decl = `account ${account}${' '.repeat(Math.max(2, 33 - account.length))}; type: ${type}`
  const prefix = account.startsWith(DEBT) ? `account ${DEBT}` : `account ${RECEIVABLE}`
  let at = -1
  lines.forEach((l, i) => {
    if (l.startsWith(prefix)) at = i
  })
  if (at < 0) {
    const parent = account.startsWith(DEBT) ? 'account liabilities ' : 'account assets:transit'
    at = lines.findIndex((l) => l.startsWith(parent))
  }
  if (at < 0) return `${text.replace(/\n*$/, '')}\n${decl}\n`
  lines.splice(at + 1, 0, decl)
  return lines.join('\n')
}
