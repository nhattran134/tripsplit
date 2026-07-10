import { describe, it, expect } from 'vitest'
import { getCurrencyDecimals, roundForCurrency, formatCurrency } from '../src/lib/currency'

describe('getCurrencyDecimals', () => {
  it('returns 0 for JPY', () => expect(getCurrencyDecimals('JPY')).toBe(0))
  it('returns 0 for VND', () => expect(getCurrencyDecimals('VND')).toBe(0))
  it('returns 0 for KRW', () => expect(getCurrencyDecimals('KRW')).toBe(0))
  it('returns 2 for USD', () => expect(getCurrencyDecimals('USD')).toBe(2))
  it('returns 2 for EUR', () => expect(getCurrencyDecimals('EUR')).toBe(2))
  it('is case insensitive', () => expect(getCurrencyDecimals('jpy')).toBe(0))
})

describe('roundForCurrency', () => {
  it('rounds USD to 2 decimals', () => expect(roundForCurrency(33.335, 'USD')).toBe(33.34))
  it('rounds JPY to 0 decimals', () => expect(roundForCurrency(333.6, 'JPY')).toBe(334))
  it('rounds VND to 0 decimals', () => expect(roundForCurrency(50000.4, 'VND')).toBe(50000))
})

describe('formatCurrency', () => {
  it('formats USD with 2 decimals', () => {
    const result = formatCurrency(100, 'USD')
    expect(result).toContain('100')
  })
  it('formats JPY with 0 decimals', () => {
    const result = formatCurrency(1000, 'JPY')
    expect(result).toContain('1,000')
    expect(result).not.toContain('.00')
  })
})
