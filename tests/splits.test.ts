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

  it('rotates remainder recipient based on remainderIndex', () => {
    const result0 = calculateEqualSplit(100, ['a', 'b', 'c'], 'USD', undefined, 0)
    expect(result0[0].share_amount).toBe(33.34)

    const result1 = calculateEqualSplit(100, ['a', 'b', 'c'], 'USD', undefined, 1)
    expect(result1[1].share_amount).toBe(33.34)
    expect(result1[0].share_amount).toBe(33.33)

    const result2 = calculateEqualSplit(100, ['a', 'b', 'c'], 'USD', undefined, 2)
    expect(result2[2].share_amount).toBe(33.34)
    expect(result2[0].share_amount).toBe(33.33)

    // Wraps around
    const result3 = calculateEqualSplit(100, ['a', 'b', 'c'], 'USD', undefined, 3)
    expect(result3[0].share_amount).toBe(33.34)
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

  it('splits by weight (couple = 0.5 each)', () => {
    const weights = { a: 0.5, b: 0.5, c: 1, d: 1 }
    const result = calculateEqualSplit(300, ['a', 'b', 'c', 'd'], 'USD', weights)
    // Total weight = 3, so: a=50, b=50, c=100, d=100
    expect(result.find(r => r.member_id === 'a')?.share_amount).toBe(50)
    expect(result.find(r => r.member_id === 'b')?.share_amount).toBe(50)
    expect(result.find(r => r.member_id === 'c')?.share_amount).toBe(100)
    expect(result.find(r => r.member_id === 'd')?.share_amount).toBe(100)
    expect(result.reduce((s, r) => s + r.share_amount, 0)).toBe(300)
  })

  it('defaults to equal weight when no weights provided', () => {
    const result = calculateEqualSplit(100, ['a', 'b', 'c', 'd'], 'USD')
    expect(result.map(r => r.share_amount)).toEqual([25, 25, 25, 25])
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
