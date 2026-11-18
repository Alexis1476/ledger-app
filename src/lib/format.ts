import { Decimal } from '@/ledger/decimal'

/** Swiss display format: 1'234.50 (the journal file never uses separators). */
export function money(q: Decimal, commodity?: string, places = 2): string {
  const r = q.toDecimalPlaces(places)
  const neg = r.isNeg() && !r.isZero()
  const [int, frac] = r.abs().toFixed(places).split('.')
  const grouped = int.replace(/\B(?=(\d{3})+(?!\d))/g, "'")
  const s = `${neg ? '−' : ''}${grouped}${frac ? '.' + frac : ''}`
  return commodity ? `${s} ${commodity}` : s
}

export function signedClass(q: Decimal): string {
  if (q.isZero()) return 'text-muted'
  return q.isNeg() ? 'text-error' : 'text-success'
}

export function today(): string {
  const d = new Date()
  const p = (n: number) => String(n).padStart(2, '0')
  return `${d.getFullYear()}-${p(d.getMonth() + 1)}-${p(d.getDate())}`
}

export function monthLabel(ym: string): string {
  const [y, m] = ym.split('-').map(Number)
  return new Date(y, m - 1, 1).toLocaleDateString('en-GB', { month: 'long', year: 'numeric' })
}

export function dayLabel(date: string): string {
  const [y, m, d] = date.split('-').map(Number)
  return new Date(y, m - 1, d).toLocaleDateString('en-GB', { weekday: 'short', day: 'numeric', month: 'short' })
}

/** A date for people: "25 Nov", with the year only when it is not the current one ("25 Nov 2025"). */
export function shortDate(date: string, now = today()): string {
  const [y, m, d] = date.split('-').map(Number)
  if (!y || !m || !d) return date
  const sameYear = date.slice(0, 4) === now.slice(0, 4)
  return new Date(y, m - 1, d).toLocaleDateString('en-GB', { day: 'numeric', month: 'short', ...(sameYear ? {} : { year: 'numeric' }) })
}

/** Like money(), with an explicit "+" on what comes in (the sign is not carried by color alone). */
export function signedMoney(q: Decimal, commodity?: string, places = 2): string {
  const s = money(q, commodity, places)
  return q.toDecimalPlaces(places).isPos() && !q.toDecimalPlaces(places).isZero() ? `+${s}` : s
}

/** Parse a user-typed amount ("1'234,50", "12.3") into a Decimal, or undefined. */
export function parseUserAmount(s: string | number | undefined | null): Decimal | undefined {
  if (s === undefined || s === null) return undefined
  const t = String(s).trim().replace(/['\s]/g, '').replace(',', '.')
  if (!/^\d+(\.\d*)?$|^\.\d+$/.test(t)) return undefined
  return new Decimal(t)
}

/** Round SVG flag for a currency (Iconify circle-flags): CHF → ch, EUR → eu, COP → co… */
export function currencyFlag(code: string): string {
  const special: Record<string, string> = { EUR: 'eu', XAF: 'cm', XOF: 'sn', ANG: 'cw' }
  const cc = special[code] ?? code.slice(0, 2).toLowerCase()
  // explicit 'set:icon' form: the set name itself contains a dash
  return /^[a-z]{2}$/.test(cc) ? `circle-flags:${cc}` : 'material-symbols:toll-outline-rounded'
}
