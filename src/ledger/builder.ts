import { Decimal, ZERO } from './decimal'
import type { Amount, Posting, Transaction, TxKind, TxStatus } from './types'

/**
 * Form input → Transaction. Generic: every posting goes to an account the user picked
 * (pockets, categories, people accounts). No hidden rules (docs/02).
 */
export interface BuildContext {
  feeAccount: string
  /** reference currency: conversions put the @@ cost on the leg NOT in this currency */
  refCurrency: string
}

export function makeContext(refCurrency = 'CHF', feeAccount = 'expenses:fees:bank'): BuildContext {
  return { refCurrency, feeAccount }
}

export const defaultContext: BuildContext = makeContext()

type Num = Decimal | string | number

export interface CommonInput {
  date: string
  payee?: string
  note?: string
  status?: TxStatus
  /** ULID; required for app-written transactions */
  id?: string
  /** extra tags (written after the standard ones) */
  tags?: Record<string, string>
}

/** One destination of an expense: a category, or a person account (e.g. "Max's money"). */
export interface Line {
  account: string
  amount: Num
}

export interface ExpenseInput extends CommonInput {
  amount: Num
  currency: string
  /** the pocket that pays */
  source: string
  /** currency of the source pocket when it differs from `currency` (recipe R13) */
  sourceCurrency?: string
  /** amount actually debited from the source in `sourceCurrency` */
  debited?: Num
  /** single destination (used when `lines` is empty) */
  category: string
  /** several destinations whose amounts add up to `amount` */
  lines?: Line[]
}

export interface IncomeInput extends CommonInput {
  amount: Num
  currency: string
  /** receiving pocket */
  account: string
  /** where it comes from: an income category or any other account (e.g. "Sam's money") */
  category: string
}

export interface TransferInput extends CommonInput {
  /** any account (pocket, person account…) */
  from: string
  to: string
  /** amount leaving `from` (without fee) */
  amount: Num
  currency: string
  /** amount arriving in `to` when currencies differ */
  toAmount?: Num
  toCurrency?: string
  /** bank fee in `currency`, taken from `from` */
  fee?: Num
}

export interface AssertionInput extends CommonInput {
  account: string
  balance: Num
  currency: string
}

export interface KindInputs {
  expense: ExpenseInput
  income: IncomeInput
  transfer: TransferInput
  assertion: AssertionInput
}

const d = (v: Num) => new Decimal(v)

function amt(qty: Num, commodity: string, cost?: { qty: Num; commodity: string }): Amount {
  const a: Amount = { qty: d(qty), commodity }
  if (cost) a.cost = { qty: d(cost.qty).abs(), commodity: cost.commodity, kind: 'total' }
  return a
}

function post(account: string, amount: Amount): Posting {
  return { account, amount, tags: {} }
}

function header(input: CommonInput): Omit<Transaction, 'postings'> {
  const tags: Record<string, string> = { via: 'app' }
  if (input.id) tags.id = input.id
  Object.assign(tags, input.tags ?? {})
  const tx: Omit<Transaction, 'postings'> = {
    date: input.date,
    status: input.status ?? '*',
    tags
  }
  if (input.id) tx.id = input.id
  if (input.payee?.trim()) tx.payee = input.payee.trim()
  if (input.note?.trim()) tx.note = input.note.trim()
  return tx
}

/**
 * Split `total` into `n` parts: floor to cents, then add 0.01 to the first parts
 * until the sum matches (docs/05).
 */
export function equalSplit(total: Num, n: number): Decimal[] {
  const t = d(total)
  const share = t.div(n).toDecimalPlaces(2, Decimal.ROUND_FLOOR)
  let left = t.minus(share.times(n)).div('0.01').round().toNumber()
  return Array.from({ length: n }, () => {
    if (left > 0) {
      left--
      return share.plus('0.01')
    }
    return share
  })
}

/** Split `total` proportionally to `weights` (2 decimals), remainder cents go to the first parts. */
export function proportionalSplit(total: Num, weights: Decimal[]): Decimal[] {
  const t = d(total)
  const sum = weights.reduce((a, b) => a.plus(b), ZERO)
  if (sum.isZero()) return weights.map(() => ZERO)
  const parts = weights.map((w) => t.times(w).div(sum).toDecimalPlaces(2, Decimal.ROUND_FLOOR))
  let left = t.minus(parts.reduce((a, b) => a.plus(b), ZERO)).div('0.01').round().toNumber()
  for (let i = 0; left > 0; i = (i + 1) % parts.length, left--) parts[i] = parts[i].plus('0.01')
  return parts
}

/** Expense: the pocket pays A; each line receives its share. */
function buildExpense(i: ExpenseInput, ctx: BuildContext): Transaction {
  const A = d(i.amount)
  const C = i.currency
  const lines = (i.lines?.length ? i.lines : [{ account: i.category, amount: A }]).map((l) => ({ account: l.account, q: d(l.amount) }))
  const foreign = !!i.sourceCurrency && i.sourceCurrency !== C
  const debited = foreign ? d(i.debited ?? NaN) : undefined
  // the @@ cost goes on the leg that is not in the reference currency (docs/02)
  const costOnSource = foreign && C === ctx.refCurrency
  // otherwise every line carries its share of the debited amount as @@ cost
  const costs = foreign && !costOnSource ? proportionalSplit(debited!, lines.map((l) => l.q)) : undefined
  const postings = lines.map((l, k) => post(l.account, amt(l.q, C, costs ? { qty: costs[k], commodity: i.sourceCurrency! } : undefined)))
  const src = !foreign
    ? amt(A.neg(), C)
    : costOnSource
      ? amt(debited!.neg(), i.sourceCurrency!, { qty: A, commodity: C })
      : amt(debited!.neg(), i.sourceCurrency!)
  postings.push(post(i.source, src))
  return { ...header(i), postings }
}

function buildIncome(i: IncomeInput): Transaction {
  const A = d(i.amount)
  return {
    ...header(i),
    postings: [post(i.account, amt(A, i.currency)), post(i.category, amt(A.neg(), i.currency))]
  }
}

/** Transfer between any two accounts, in the same or another currency (an exchange). */
function buildTransfer(i: TransferInput, ctx: BuildContext): Transaction {
  const A = d(i.amount)
  const C1 = i.currency
  const cross = !!i.toCurrency && i.toCurrency !== C1
  const C2 = cross ? i.toCurrency! : C1
  const B = cross ? d(i.toAmount ?? NaN) : A
  const fee = i.fee !== undefined && i.fee !== '' ? d(i.fee) : ZERO
  // the @@ cost goes on the leg that is not in the reference currency (docs/02)
  const costOnSource = cross && C2 === ctx.refCurrency

  const postings: Posting[] = []
  if (!cross) {
    postings.push(post(i.to, amt(B, C2)))
    if (!fee.isZero()) postings.push(post(ctx.feeAccount, amt(fee, C1)))
    postings.push(post(i.from, amt(A.plus(fee).neg(), C1)))
  } else if (!costOnSource) {
    postings.push(post(i.to, amt(B, C2, { qty: A, commodity: C1 })))
    if (!fee.isZero()) postings.push(post(ctx.feeAccount, amt(fee, C1)))
    postings.push(post(i.from, amt(A.plus(fee).neg(), C1)))
  } else {
    postings.push(post(i.to, amt(B, C2)))
    if (!fee.isZero()) postings.push(post(ctx.feeAccount, amt(fee, C1)))
    postings.push(post(i.from, amt(A.neg(), C1, { qty: B, commodity: C2 })))
    if (!fee.isZero()) postings.push(post(i.from, amt(fee.neg(), C1)))
  }
  return { ...header(i), postings }
}

function buildAssertion(i: AssertionInput): Transaction {
  return {
    ...header(i),
    postings: [
      {
        account: i.account,
        amount: amt(0, i.currency),
        assertion: { amount: amt(i.balance, i.currency), inclusive: false, total: false },
        tags: {}
      }
    ]
  }
}

export function build<K extends TxKind>(kind: K, input: KindInputs[K], ctx: BuildContext = defaultContext): Transaction {
  switch (kind) {
    case 'expense':
      return buildExpense(input as ExpenseInput, ctx)
    case 'income':
      return buildIncome(input as IncomeInput)
    case 'transfer':
      return buildTransfer(input as TransferInput, ctx)
    case 'assertion':
      return buildAssertion(input as AssertionInput)
    default:
      throw new Error(`unknown kind ${kind satisfies never}`)
  }
}
