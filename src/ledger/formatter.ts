import { fmtQty } from './decimal'
import { description } from './parser'
import type { Amount, Posting, Transaction } from './types'

/** Column where the last digit of every posting quantity ends. */
export const AMOUNT_COLUMN = 58

/** Header tag order: app tags first, then due, value-less tags, payment, the rest. */
export function orderedTags(tags: Record<string, string>): [string, string][] {
  const entries = Object.entries(tags)
  const rank = ([k, v]: [string, string]) => {
    if (k === 'via') return 0
    if (k === 'id') return 1
    if (k === 'due') return 2
    if (v === '') return 3
    if (k === 'payment') return 4
    return 5
  }
  return entries
    .map((e, i) => ({ e, i }))
    .sort((a, b) => rank(a.e) - rank(b.e) || a.i - b.i)
    .map((x) => x.e)
}

export function formatTags(tags: Record<string, string>): string {
  return orderedTags(tags)
    .map(([k, v]) => `${k}:${v}`)
    .join(', ')
}

export function formatAmount(a: Amount): string {
  let s = `${fmtQty(a.qty)} ${a.commodity}`
  if (a.cost) s += ` ${a.cost.kind === 'total' ? '@@' : '@'} ${fmtQty(a.cost.qty)} ${a.cost.commodity}`
  return s
}

export function formatPosting(p: Posting): string {
  const prefix = '    ' + (p.status ? `${p.status} ` : '') + p.account
  let line: string
  if (p.amount) {
    const qty = fmtQty(p.amount.qty)
    const gap = Math.max(2, AMOUNT_COLUMN - prefix.length - qty.length)
    line = prefix + ' '.repeat(gap) + formatAmount(p.amount)
  } else {
    line = prefix
  }
  if (p.assertion) {
    const a = p.assertion
    const op = '=' + (a.total ? '=' : '') + (a.inclusive ? '*' : '')
    line += ` ${op} ${fmtQty(a.amount.qty)} ${a.amount.commodity}`
  }
  const tagText = Object.keys(p.tags).length ? formatTags(p.tags) : ''
  const comment = tagText || p.comment
  if (comment) line += `  ; ${comment}`
  return line
}

/**
 * Transaction → journal text (no trailing newline). Deterministic: the header comment is
 * rebuilt from `tags`; free-text `comment` is only used when there are no tags.
 */
export function format(tx: Transaction): string {
  let header = tx.date
  if (tx.status) header += ` ${tx.status}`
  if (tx.code) header += ` (${tx.code})`
  const desc = description(tx)
  if (desc) header += ` ${desc}`
  const tagText = Object.keys(tx.tags).length ? formatTags(tx.tags) : ''
  const comment = tagText || (tx.comment && !tx.comment.includes('\n') ? tx.comment : '')
  if (comment) header += `  ; ${comment}`
  return [header, ...tx.postings.map(formatPosting)].join('\n')
}
