import { format } from './formatter'
import type { SourceRange, Transaction } from './types'

/**
 * Scheduled payments = hledger periodic transactions (`~ monthly from 2026-12-15  Rent`), the
 * same blocks `hledger --forecast` reads. Dates follow hledger: anchored on the start date, the
 * day clipped to the month end (31 Jan → 28 Feb → 31 Mar), the end date excluded.
 */

export type Unit = 'day' | 'week' | 'month' | 'year'

export interface Rule {
  unit: Unit
  every: number
  /** first occurrence, YYYY-MM-DD */
  from: string
  /** exclusive end, YYYY-MM-DD */
  to?: string
}

export interface Schedule {
  id?: string
  /** period expression as written */
  period: string
  /** undefined when the expression is outside what the app understands (read-only) */
  rule?: Rule
  /** description, postings and tags; `date` = rule.from */
  tx: Transaction
  src?: SourceRange
}

const DATE = String.raw`(\d{4})[-/.](\d{1,2})[-/.](\d{1,2})`
const pad = (n: number) => String(n).padStart(2, '0')
const iso = (y: number, m: number, d: number) => `${y}-${pad(m)}-${pad(d)}`
const normDate = (s: string) => {
  const m = new RegExp(`^${DATE}$`).exec(s)
  return m ? iso(Number(m[1]), Number(m[2]), Number(m[3])) : undefined
}

const NAMED: Record<string, [Unit, number]> = {
  daily: ['day', 1],
  weekly: ['week', 1],
  biweekly: ['week', 2],
  fortnightly: ['week', 2],
  monthly: ['month', 1],
  bimonthly: ['month', 2],
  quarterly: ['month', 3],
  yearly: ['year', 1],
  annually: ['year', 1]
}
const UNITS: Record<string, [Unit, number]> = {
  day: ['day', 1],
  week: ['week', 1],
  month: ['month', 1],
  quarter: ['month', 3],
  year: ['year', 1]
}

/** Parses the subset the app writes and edits: an interval, `from DATE`, optional `to DATE`. */
export function parseRule(expr: string): Rule | undefined {
  const s = expr.trim().toLowerCase().replace(/\s+/g, ' ')
  const m = new RegExp(
    String.raw`^(?:(daily|weekly|biweekly|fortnightly|monthly|bimonthly|quarterly|yearly|annually)|every (?:(\d+) )?(day|week|month|quarter|year)s?) from (${DATE.replace(/\(/g, '(?:')})(?: (?:to|until) (${DATE.replace(/\(/g, '(?:')}))?$`
  ).exec(s)
  if (!m) return undefined
  let unit: Unit
  let every: number
  if (m[1]) [unit, every] = NAMED[m[1]]
  else {
    const [u, k] = UNITS[m[3]]
    unit = u
    every = k * (m[2] ? Number(m[2]) : 1)
  }
  if (every < 1) return undefined
  const from = normDate(m[4])
  const to = m[5] ? normDate(m[5]) : undefined
  if (!from || (m[5] && !to)) return undefined
  return to ? { unit, every, from, to } : { unit, every, from }
}

/** Canonical expression: `monthly from 2026-12-15`, `every 2 weeks from … to …`. */
export function formatRule(r: Rule): string {
  let head: string
  if (r.every === 1) head = { day: 'daily', week: 'weekly', month: 'monthly', year: 'yearly' }[r.unit]
  else if (r.unit === 'month' && r.every === 3) head = 'quarterly'
  else head = `every ${r.every} ${r.unit}s`
  return `${head} from ${r.from}${r.to ? ` to ${r.to}` : ''}`
}

/** Human text: "Monthly", "Every 2 weeks", "Quarterly". */
export function describeRule(r: Rule): string {
  const f = formatRule({ ...r, to: undefined }).replace(/ from .*$/, '')
  return f[0].toUpperCase() + f.slice(1)
}

function daysInMonth(y: number, m: number) {
  return new Date(Date.UTC(y, m, 0)).getUTCDate()
}

/** The k-th occurrence (k = 0 is `from`). */
export function nthOccurrence(r: Rule, k: number): string {
  const [y, m, d] = r.from.split('-').map(Number)
  if (r.unit === 'day' || r.unit === 'week') {
    const t = new Date(Date.UTC(y, m - 1, d))
    t.setUTCDate(t.getUTCDate() + k * r.every * (r.unit === 'week' ? 7 : 1))
    return t.toISOString().slice(0, 10)
  }
  const months = k * r.every * (r.unit === 'year' ? 12 : 1)
  const total = y * 12 + (m - 1) + months
  const yy = Math.floor(total / 12)
  const mm = (total % 12) + 1
  return iso(yy, mm, Math.min(d, daysInMonth(yy, mm)))
}

/** Occurrences in [begin, end) (and before the rule's own end). */
export function occurrences(r: Rule, begin: string, end: string, max = 5000): string[] {
  const out: string[] = []
  const stop = r.to && r.to < end ? r.to : end
  for (let k = 0; k < max; k++) {
    const d = nthOccurrence(r, k)
    if (d >= stop) break
    if (d >= begin) out.push(d)
  }
  return out
}

/** Schedule → journal text: `~ <rule>  <description>  ; tags` + the postings. */
export function formatSchedule(rule: Rule, tx: Transaction): string {
  const lines = format({ ...tx, date: rule.from, status: '', code: undefined }).split('\n')
  const rest = lines[0].slice(rule.from.length).trimStart()
  lines[0] = `~ ${formatRule(rule)}${rest ? `  ${rest}` : ''}`
  return lines.join('\n')
}

export interface Due {
  date: string
  /** before today */
  overdue: boolean
}

export interface ScheduleState {
  /** occurrences from the start (or the last 12) up to today + horizon, not recorded nor skipped */
  due: Due[]
  /** next occurrence on or after today, not recorded nor skipped */
  next?: string
  /** last recorded occurrence */
  last?: string
  ended: boolean
}

/** Occurrences already handled: recorded (tags schedule:<id>, planned:<date>) or skipped. */
export function scheduleState(s: Schedule, transactions: Transaction[], today: string, horizonDays = 30): ScheduleState {
  if (!s.rule) return { due: [], ended: false }
  const recorded = new Set<string>()
  for (const t of transactions) if (s.id && t.tags.schedule === s.id) recorded.add(t.tags.planned || t.date)
  const skipped = new Set((s.tx.tags.skip ?? '').split(/\s+/).filter(Boolean))
  const handled = (d: string) => recorded.has(d) || skipped.has(d)
  const h = new Date(today + 'T00:00:00Z')
  h.setUTCDate(h.getUTCDate() + horizonDays + 1)
  const horizon = h.toISOString().slice(0, 10)
  const due = occurrences(s.rule, s.rule.from, horizon)
    .filter((d) => !handled(d))
    .map((date) => ({ date, overdue: date < today }))
  const overdue = due.filter((d) => d.overdue).slice(-12)
  const later = due.filter((d) => !d.overdue)
  const far = new Date(today + 'T00:00:00Z')
  far.setUTCFullYear(far.getUTCFullYear() + 3)
  const next = occurrences(s.rule, today, far.toISOString().slice(0, 10)).find((d) => !handled(d))
  const last = [...recorded].sort().at(-1)
  return { due: [...overdue, ...later], next, last, ended: !!s.rule.to && !next }
}
