import { Decimal, ZERO } from './decimal'
import { balancingAmount, checkAssertions } from './reports'
import type { Journal, Transaction } from './types'

export type IssueCode =
  | 'UNBALANCED'
  | 'MULTIPLE_IMPLICIT'
  | 'UNDECLARED_ACCOUNT'
  | 'UNDECLARED_COMMODITY'
  | 'NON_LEAF_ACCOUNT'
  | 'BAD_DATE'
  | 'BAD_PRECISION'
  | 'ZERO_AMOUNT'
  | 'ASSERTION_FAILED'
  | 'DUPLICATE_ID'
  | 'NO_POSTINGS'

export interface Issue {
  code: IssueCode
  message: string
  postingIndex?: number
}

export interface ValidateOptions {
  /** id of the transaction being edited (excluded from DUPLICATE_ID and replaced for assertions) */
  replacingId?: string
  /** transaction being replaced, matched by source range when it has no id */
  replacing?: Transaction
  /** maximum decimals allowed (default 2) */
  maxPrecision?: number
}

export function isValidDate(s: string): boolean {
  const m = /^(\d{4})-(\d{2})-(\d{2})$/.exec(s)
  if (!m) return false
  const [y, mo, d] = [Number(m[1]), Number(m[2]), Number(m[3])]
  if (mo < 1 || mo > 12 || d < 1) return false
  const days = new Date(Date.UTC(y, mo, 0)).getUTCDate()
  return d <= days
}

function decimals(q: Decimal): number {
  return q.decimalPlaces()
}

/** Pre-commit checks (validation layer 2, docs/03). Empty result = OK. */
export function validate(tx: Transaction, journal: Journal, opts: ValidateOptions = {}): Issue[] {
  const issues: Issue[] = []
  const maxP = opts.maxPrecision ?? 2

  if (!isValidDate(tx.date)) issues.push({ code: 'BAD_DATE', message: `invalid date "${tx.date}"` })
  if (tx.postings.length === 0) issues.push({ code: 'NO_POSTINGS', message: 'transaction has no postings' })

  const declared = new Set(journal.accounts.map((a) => a.name))
  const commodities = new Set(journal.commodities.map((c) => c.symbol))

  let implicit = 0
  tx.postings.forEach((p, i) => {
    if (!declared.has(p.account)) {
      issues.push({ code: 'UNDECLARED_ACCOUNT', message: `account "${p.account}" is not declared`, postingIndex: i })
    } else if ([...declared].some((n) => n.startsWith(p.account + ':'))) {
      issues.push({ code: 'NON_LEAF_ACCOUNT', message: `"${p.account}" has subaccounts; post to a leaf`, postingIndex: i })
    }
    const used = [p.amount?.commodity, p.amount?.cost?.commodity, p.assertion?.amount.commodity].filter(
      (c): c is string => c !== undefined
    )
    for (const c of new Set(used)) {
      if (!commodities.has(c)) {
        issues.push({ code: 'UNDECLARED_COMMODITY', message: `commodity "${c}" is not declared`, postingIndex: i })
      }
    }
    if (!p.amount) {
      implicit++
      return
    }
    const qs = [p.amount.qty, p.amount.cost?.qty, p.assertion?.amount.qty].filter((q): q is Decimal => !!q)
    if (qs.some((q) => decimals(q) > maxP)) {
      issues.push({ code: 'BAD_PRECISION', message: `more than ${maxP} decimals`, postingIndex: i })
    }
    if (p.amount.qty.isZero() && !p.assertion) {
      issues.push({ code: 'ZERO_AMOUNT', message: 'amount is zero', postingIndex: i })
    }
  })
  if (implicit > 1) {
    issues.push({ code: 'MULTIPLE_IMPLICIT', message: 'more than one posting without amount' })
  }

  if (implicit === 0) {
    const sums = new Map<string, Decimal>()
    for (const p of tx.postings) {
      if (!p.amount) continue
      const b = balancingAmount(p.amount)
      sums.set(b.commodity, (sums.get(b.commodity) ?? ZERO).plus(b.qty))
    }
    const off = [...sums].filter(([, q]) => !q.toDecimalPlaces(maxP).isZero())
    if (off.length) {
      issues.push({
        code: 'UNBALANCED',
        message: `does not balance: ${off.map(([c, q]) => `${q.toFixed()} ${c}`).join(', ')}`
      })
    }
  }

  const id = tx.id ?? tx.tags.id
  const replacingId = opts.replacingId ?? opts.replacing?.id
  if (id && id !== replacingId && journal.transactions.some((t) => (t.id ?? t.tags.id) === id)) {
    issues.push({ code: 'DUPLICATE_ID', message: `a transaction with id ${id} already exists` })
  }

  // recompute every assertion with the transaction in place (only if it is otherwise sound)
  if (!issues.some((x) => x.code === 'BAD_DATE' || x.code === 'MULTIPLE_IMPLICIT')) {
    const isReplaced = (t: Transaction) =>
      (replacingId && (t.id ?? t.tags.id) === replacingId) ||
      (opts.replacing?.src && t.src?.file === opts.replacing.src.file && t.src.startLine === opts.replacing.src.startLine)
    const before = new Set(checkAssertions(journal.transactions).map((f) => `${f.tx.src?.file}:${f.tx.src?.startLine}:${f.postingIndex}`))
    const candidate = { ...tx, index: Number.MAX_SAFE_INTEGER }
    const after = checkAssertions([...journal.transactions.filter((t) => !isReplaced(t)), candidate])
    for (const f of after) {
      const key = `${f.tx.src?.file}:${f.tx.src?.startLine}:${f.postingIndex}`
      if (f.tx !== candidate && before.has(key)) continue // was already failing, not our fault
      issues.push({
        code: 'ASSERTION_FAILED',
        message: f.tx === candidate ? f.message : `${f.message} (${f.tx.date} ${f.tx.payee ?? ''})`,
        postingIndex: f.tx === candidate ? f.postingIndex : undefined
      })
    }
  }
  return issues
}
