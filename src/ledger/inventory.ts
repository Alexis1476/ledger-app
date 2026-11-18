import { valueAt } from './analytics'
import { Decimal, ZERO } from './decimal'
import type { PriceDB } from './reports'
import type { Transaction } from './types'

/**
 * Inventory: the things I own, from their purchase. The purchase stays a normal expense; its
 * header carries `item:<name>` (kept by the entry form).
 */

export interface Item {
  tx: Transaction
  name: string
  date: string
  /** what it cost, in the reference currency (expense postings at the purchase date) */
  cost: Decimal
}

/** Expense part of a transaction, in `ref` at its date. */
export function costOf(tx: Transaction, isExpense: (account: string) => boolean, ref: string, db: PriceDB): Decimal {
  let sum = ZERO
  for (const p of tx.postings) if (p.amount && isExpense(p.account)) sum = sum.plus(valueAt(p.amount, ref, tx.date, db) ?? ZERO)
  return sum.toDecimalPlaces(2)
}

export function items(transactions: Transaction[], isExpense: (account: string) => boolean, ref: string, db: PriceDB): Item[] {
  return transactions
    .filter((t) => t.tags.item !== undefined)
    .map((tx) => ({ tx, name: tx.tags.item || tx.payee || tx.note || '—', date: tx.date, cost: costOf(tx, isExpense, ref, db) }))
    .sort((a, b) => b.date.localeCompare(a.date) || a.name.localeCompare(b.name))
}

/** Purchases (expenses, not in the inventory yet) whose payee or note contains every typed word. */
export function searchPurchases(
  transactions: Transaction[],
  query: string,
  isExpense: (account: string) => boolean,
  ref: string,
  db: PriceDB,
  limit = 8
): { tx: Transaction; cost: Decimal }[] {
  const words = query.toLocaleLowerCase().split(/\s+/).filter(Boolean)
  if (!words.length) return []
  const out: { tx: Transaction; cost: Decimal }[] = []
  for (const tx of [...transactions].sort((a, b) => b.date.localeCompare(a.date))) {
    if (tx.tags.item !== undefined || tx.unsupported || !tx.postings.some((p) => p.amount?.qty.gt(0) && isExpense(p.account))) continue
    const hay = `${tx.payee ?? ''} ${tx.note ?? ''}`.toLocaleLowerCase()
    if (!words.every((w) => hay.includes(w))) continue
    out.push({ tx, cost: costOf(tx, isExpense, ref, db) })
    if (out.length >= limit) break
  }
  return out
}

/** Tag values end at a comma: keep names readable without one. */
const clean = (s: string) => s.replace(/,/g, ' ').replace(/\s+/g, ' ').trim()

export function setItem(tx: Transaction, name: string): Transaction {
  return { ...tx, tags: { ...tx.tags, item: clean(name) || clean(tx.payee ?? '') || 'Item' } }
}

/**
 * Back to a plain purchase. The tag also leaves the raw comment: when `item:` was the only tag,
 * the formatter falls back to that comment and would write the tag again.
 */
export function removeItem(tx: Transaction): Transaction {
  const tags = { ...tx.tags }
  delete tags.item
  const comment = tx.comment
    ?.split('\n')
    .map((l) => l.replace(/(^|,)\s*item:[^,]*/, '').replace(/^\s*,\s*/, '').trim())
    .filter(Boolean)
    .join('\n')
  return { ...tx, tags, comment: comment || undefined }
}
