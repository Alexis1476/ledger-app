import type { Schedule } from './periodic'

import type { Decimal } from './decimal'

export type Commodity = 'CHF' | 'EUR' | 'USD' | 'COP' | (string & {})

export interface Cost {
  /** Quantity as written (always positive in app-written text). */
  qty: Decimal
  commodity: Commodity
  /** `@` = unit cost, `@@` = total cost */
  kind: 'unit' | 'total'
}

export interface Amount {
  qty: Decimal
  commodity: Commodity
  cost?: Cost
}

export interface Assertion {
  amount: Amount
  /** `=*` / `==*`: include subaccounts */
  inclusive: boolean
  /** `==` / `==*`: all other commodities must be zero */
  total: boolean
}

export interface Posting {
  account: string
  /** undefined = implicit (parser only; the app always writes it) */
  amount?: Amount
  assertion?: Assertion
  status?: '' | '!' | '*'
  comment?: string
  tags: Record<string, string>
  /** `(acc)` or `[acc]`: kept but flagged unsupported */
  virtual?: 'round' | 'square'
}

export type TxStatus = '' | '!' | '*'

export interface SourceRange {
  file: string
  /** 1-based, inclusive */
  startLine: number
  /** 1-based, inclusive */
  endLine: number
  raw: string
}

export interface Transaction {
  /** from tag id: (ULID) */
  id?: string
  date: string
  date2?: string
  status: TxStatus
  code?: string
  payee?: string
  note?: string
  postings: Posting[]
  /** value '' for label tags like `holiday:` */
  tags: Record<string, string>
  /** full header + continuation comment text (without leading `;`), joined by \n */
  comment?: string
  src?: SourceRange
  /** parse order across the whole journal (0-based) */
  index?: number
  /** contains syntax the app does not rewrite (virtual postings, lots, …) */
  unsupported?: boolean
}

export interface AccountDecl {
  name: string
  tags: Record<string, string>
  comment?: string
  src?: SourceRange
}

export interface CommodityDecl {
  symbol: Commodity
  /** sample format from the directive, e.g. `1000.00 CHF` */
  format?: string
  precision?: number
  src?: SourceRange
}

export interface PriceDecl {
  date: string
  commodity: Commodity
  price: Amount
  src?: SourceRange
}

export interface IncludeDecl {
  path: string
  src?: SourceRange
}

export interface Diagnostic {
  file: string
  line: number
  message: string
  severity: 'error' | 'warning'
}

export interface UnsupportedBlock extends SourceRange {
  reason: string
}

export interface ParsedFile {
  file: string
  transactions: Transaction[]
  accounts: AccountDecl[]
  commodities: CommodityDecl[]
  prices: PriceDecl[]
  includes: IncludeDecl[]
  /** periodic transactions (`~ …`): scheduled payments, not part of the balances */
  schedules: Schedule[]
  unsupported: UnsupportedBlock[]
  diagnostics: Diagnostic[]
}

export interface Journal {
  /** files in include order (entry first) */
  files: string[]
  transactions: Transaction[]
  accounts: AccountDecl[]
  commodities: CommodityDecl[]
  prices: PriceDecl[]
  includes: IncludeDecl[]
  schedules: Schedule[]
  unsupported: UnsupportedBlock[]
  diagnostics: Diagnostic[]
}

export type TxKind = 'expense' | 'income' | 'transfer' | 'assertion'
