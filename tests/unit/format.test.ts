import { describe, expect, it } from 'vitest'
import { Decimal } from '../../src/ledger/decimal'
import { currencyFlag, money, parseUserAmount } from '../../src/lib/format'

describe('format', () => {
  it('Swiss money format', () => {
    expect(money(new Decimal('1234.5'), 'CHF')).toBe("1'234.50 CHF")
    expect(money(new Decimal('-0.004'))).toBe('0.00')
    expect(money(new Decimal('-4200'), 'CHF', 0)).toBe("−4'200 CHF")
  })

  it('parses typed amounts', () => {
    expect(parseUserAmount("1'234,50")?.toString()).toBe('1234.5')
    expect(parseUserAmount('abc')).toBeUndefined()
  })

  it('currency flags', () => {
    expect(currencyFlag('CHF')).toBe('circle-flags:ch')
    expect(currencyFlag('EUR')).toBe('circle-flags:eu')
    expect(currencyFlag('COP')).toBe('circle-flags:co')
    expect(currencyFlag('X1')).toBe('material-symbols:toll-outline-rounded')
  })
})
