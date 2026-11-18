import Decimal from 'decimal.js'

// High precision so currency conversions (e.g. COP → CHF) match hledger's results.
Decimal.set({ precision: 40, rounding: Decimal.ROUND_HALF_UP })

export { Decimal }

export const ZERO = new Decimal(0)

export function dec(v: Decimal.Value): Decimal {
  return new Decimal(v)
}

/** Fixed 2-decimal string as written in journals, never "-0.00". */
export function fmtQty(q: Decimal, places = 2): string {
  const r = q.toDecimalPlaces(places)
  return (r.isZero() ? r.abs() : r).toFixed(places)
}
