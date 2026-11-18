import { build, type BuildContext, type CommonInput, type ExpenseInput, type IncomeInput, type Line, type TransferInput } from './builder'
import { ZERO } from './decimal'
import type { Posting, Transaction } from './types'

export type FormInput =
  | { kind: 'expense'; input: ExpenseInput }
  | { kind: 'income'; input: IncomeInput }
  | { kind: 'transfer'; input: TransferInput }

/** Order-independent signature of the postings (account, quantity, commodity). */
function signature(postings: Posting[]): string {
  return postings
    .map((p) => `${p.account}|${p.amount?.qty.toFixed(2)}|${p.amount?.commodity}`)
    .sort()
    .join('\n')
}

function common(tx: Transaction): CommonInput {
  // every other tag is kept as it is (value-less ones too, e.g. an old `employer:`)
  const tags: Record<string, string> = {}
  for (const [k, v] of Object.entries(tx.tags)) {
    if (k === 'via' || k === 'id') continue
    tags[k] = v
  }
  return {
    date: tx.date,
    payee: tx.payee,
    note: tx.note,
    status: tx.status,
    id: tx.id ?? tx.tags.id,
    tags
  }
}

/**
 * Transaction → the form input that builds exactly the same postings, or undefined when the
 * form cannot represent it (it can then only be deleted, or edited in a text editor).
 * The form is chosen by shape only: a pocket pays → expense, money comes into a pocket from a
 * non-pocket → income, anything else → transfer. Every candidate is verified by rebuilding it.
 */
export function reverse(tx: Transaction, ctx: BuildContext, isPocket: (account: string) => boolean): FormInput | undefined {
  if (tx.unsupported || !tx.postings.length) return undefined
  if (tx.postings.some((p) => !p.amount || p.assertion || p.virtual)) return undefined
  const base = common(tx)
  const check = (c: FormInput | undefined): FormInput | undefined => {
    if (!c) return undefined
    try {
      return signature(tx.postings) === signature(build(c.kind, c.input as never, ctx).postings) ? c : undefined
    } catch {
      return undefined
    }
  }
  const pos = tx.postings.filter((p) => p.amount!.qty.isPos())
  const neg = tx.postings.filter((p) => p.amount!.qty.isNeg())

  // income: a non-pocket gives, one pocket receives
  if (tx.postings.length === 2 && pos.length === 1 && neg.length === 1 && isPocket(pos[0].account) && !isPocket(neg[0].account)) {
    const a = pos[0].amount!
    const r = check({ kind: 'income', input: { ...base, account: pos[0].account, category: neg[0].account, amount: a.qty.toString(), currency: a.commodity } })
    if (r) return r
  }

  // expense: one pocket pays, every other line receives (categories and/or people)
  if (neg.length === 1 && isPocket(neg[0].account) && pos.length >= 1 && pos.every((p) => !isPocket(p.account))) {
    const r = check(reverseExpense(base, neg[0], pos))
    if (r) return r
  }

  // transfer: everything else (pocket ↔ pocket, person ↔ person, with fee or exchange)
  return check(reverseTransfer(base, tx.postings, ctx))
}

function reverseExpense(base: CommonInput, source: Posting, lines: Posting[]): FormInput | undefined {
  const currencies = new Set(lines.map((p) => p.amount!.commodity))
  if (currencies.size !== 1) return undefined
  const C = [...currencies][0]
  const L: Line[] = lines.map((p) => ({ account: p.account, amount: p.amount!.qty }))
  const amount = L.reduce((s, x) => s.plus(x.amount), ZERO)
  const src = source.amount!
  const input: ExpenseInput = {
    ...base,
    amount: amount.toString(),
    currency: C,
    source: source.account,
    category: L.length === 1 ? L[0].account : '',
    lines: L.length === 1 ? undefined : L
  }
  if (src.commodity !== C) {
    input.sourceCurrency = src.commodity
    input.debited = src.qty.abs().toString()
  }
  return { kind: 'expense', input }
}

function reverseTransfer(base: CommonInput, postings: Posting[], ctx: BuildContext): FormInput | undefined {
  const feePost = postings.find((p) => p.account === ctx.feeAccount && p.amount!.qty.isPos())
  const rest = postings.filter((p) => p !== feePost)
  const to = rest.filter((p) => p.amount!.qty.isPos())
  const from = rest.filter((p) => p.amount!.qty.isNeg())
  if (to.length !== 1 || from.length < 1 || from.length > 2 || new Set(from.map((p) => p.account)).size !== 1) return undefined
  const fee = feePost ? feePost.amount!.qty : ZERO
  const C1 = from[0].amount!.commodity
  const total = from.reduce((s, p) => s.plus(p.amount!.qty.abs()), ZERO)
  const d = to[0].amount!
  const cross = d.commodity !== C1
  return {
    kind: 'transfer',
    input: {
      ...base,
      from: from[0].account,
      to: to[0].account,
      amount: total.minus(fee).toString(),
      currency: C1,
      ...(cross ? { toAmount: d.qty.toString(), toCurrency: d.commodity } : {}),
      fee: fee.isZero() ? undefined : fee.toString()
    }
  }
}
