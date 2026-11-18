import { describe, expect, it } from 'vitest'
import { Decimal } from '@/ledger/decimal'
import { shortDate, signedMoney } from '@/lib/format'

describe('shortDate', () => {
  it('leaves the year out for the current year', () => {
    expect(shortDate('2026-11-25', '2026-11-11')).toBe('25 Nov')
  })
  it('shows the year when it differs', () => {
    expect(shortDate('2025-10-09', '2026-11-11')).toBe('9 Oct 2025')
  })
  it('returns what it cannot read as is', () => {
    expect(shortDate('soon', '2026-11-11')).toBe('soon')
  })
})

describe('signedMoney', () => {
  it('puts a + on what comes in', () => {
    expect(signedMoney(new Decimal('100'), 'CHF')).toBe("+100.00 CHF")
  })
  it('keeps the minus and leaves zero unsigned', () => {
    expect(signedMoney(new Decimal('-1234.5'), 'CHF')).toBe("−1'234.50 CHF")
    expect(signedMoney(new Decimal('0'), 'CHF')).toBe('0.00 CHF')
  })
})
