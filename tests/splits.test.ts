import { describe, it, expect } from 'vitest'
import { calculateEqualSplit, validateCustomSplit } from '../src/lib/splits'

describe('calculateEqualSplit', () => {
  it('splits evenly when divisible', () => {
    const result = calculateEqualSplit(100, ['a', 'b', 'c', 'd'], 'USD')
    expect(result.map((r) => r.share_amount)).toEqual([25, 25, 25, 25])
  })

  it('assigns remainder to first member (100/3)', () => {
    const result = calculateEqualSplit(100, ['a', 'b', 'c'], 'USD')
    expect(result[0].share_amount).toBe(33.34)
    expect(result[1].share_amount).toBe(33.33)
    expect(result[2].share_amount).toBe(33.33)
    const total = result.reduce((s, r) => s + r.share_amount, 0)
    expect(Math.round(total * 100) / 100).toBe(100)
  })

  it('handles JPY (zero decimals)', () => {
    const result = calculateEqualSplit(1000, ['a', 'b', 'c'], 'JPY')
    expect(result[0].share_amount).toBe(334)
    expect(result[1].share_amount).toBe(333)
    expect(result[2].share_amount).toBe(333)
    expect(result.reduce((s, r) => s + r.share_amount, 0)).toBe(1000)
  })

  it('returns empty for no members', () => {
    expect(calculateEqualSplit(100, [], 'USD')).toEqual([])
  })

  it('single member gets full amount', () => {
    const result = calculateEqualSplit(100, ['a'], 'USD')
    expect(result[0].share_amount).toBe(100)
  })
})

describe('validateCustomSplit', () => {
  it('valid when sum equals total', () => {
    expect(validateCustomSplit({ a: 60, b: 40 }, 100, 'USD').valid).toBe(true)
  })

  it('invalid when sum differs', () => {
    const result = validateCustomSplit({ a: 60, b: 30 }, 100, 'USD')
    expect(result.valid).toBe(false)
    expect(result.diff).toBe(-10)
  })

  it('allows 1-cent tolerance for USD', () => {
    expect(validateCustomSplit({ a: 33.33, b: 33.33, c: 33.33 }, 99.99, 'USD').valid).toBe(true)
  })
})
