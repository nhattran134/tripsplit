import { describe, it, expect } from 'vitest'
import { calculateBalances, simplifyDebts } from '../src/lib/settlement'
import type { Member, Deposit, ExpenseSplit, Settlement } from '../src/types'

const makeMember = (id: string, name: string, isAdmin = false): Member => ({
  id, trip_id: 'trip1', auth_uid: `auth-${id}`, name, color: '#000',
  is_admin: isAdmin, joined_at: '2026-01-01', deleted_at: null,
})

const makeDeposit = (memberId: string, amount: number, rate = 1): Deposit => ({
  id: `dep-${memberId}-${amount}`, trip_id: 'trip1', member_id: memberId,
  amount, currency: 'USD', rate_to_base: rate, note: '',
  created_at: '2026-01-01', deleted_at: null, version: 1,
})

describe('calculateBalances', () => {
  it('returns zero balances when no transactions', () => {
    const members = [makeMember('a', 'Alice'), makeMember('b', 'Bob')]
    const result = calculateBalances(members, [], [], [])
    expect(result.every((e) => e.net === 0)).toBe(true)
  })

  it('handles deposits only', () => {
    const members = [makeMember('a', 'Alice'), makeMember('b', 'Bob')]
    const deposits = [makeDeposit('a', 100), makeDeposit('b', 50)]
    const result = calculateBalances(members, deposits, [], [])
    expect(result.find((e) => e.memberId === 'a')?.net).toBe(100)
    expect(result.find((e) => e.memberId === 'b')?.net).toBe(50)
  })

  it('correctly subtracts expense shares', () => {
    const members = [makeMember('a', 'Alice'), makeMember('b', 'Bob')]
    const deposits = [makeDeposit('a', 100), makeDeposit('b', 100)]
    const splits: ExpenseSplit[] = [
      { id: 's1', expense_id: 'e1', member_id: 'a', share_amount: 60 },
      { id: 's2', expense_id: 'e1', member_id: 'b', share_amount: 60 },
    ]
    const result = calculateBalances(members, deposits, splits, [])
    expect(result.find((e) => e.memberId === 'a')?.net).toBe(40)
    expect(result.find((e) => e.memberId === 'b')?.net).toBe(40)
  })

  it('guarantees zero-sum when rounding causes residual', () => {
    // This tests rounding residual (not structural imbalance)
    const members = [makeMember('a', 'A'), makeMember('b', 'B'), makeMember('c', 'C')]
    // Create a scenario where rounding causes tiny residual
    const deposits = [makeDeposit('a', 100)]
    const splits: ExpenseSplit[] = [
      { id: 's1', expense_id: 'e1', member_id: 'a', share_amount: 33.33 },
      { id: 's2', expense_id: 'e1', member_id: 'b', share_amount: 33.33 },
      { id: 's3', expense_id: 'e1', member_id: 'c', share_amount: 33.34 },
    ]
    const result = calculateBalances(members, deposits, splits, [])
    // Sum should be close to zero (structural: 100 - 100 = 0, with possible rounding residual)
    const sum = result.reduce((s, e) => s + e.net, 0)
    expect(Math.abs(sum)).toBeLessThan(0.01)
  })

  it('allows structural imbalance (deposits != expenses)', () => {
    const members = [makeMember('a', 'A'), makeMember('b', 'B')]
    const deposits = [makeDeposit('a', 100), makeDeposit('b', 50)]
    // No expenses - pool has money, sum should be 150
    const result = calculateBalances(members, deposits, [], [])
    const sum = result.reduce((s, e) => s + e.net, 0)
    expect(sum).toBe(150)
  })

  it('excludes soft-deleted deposits', () => {
    const members = [makeMember('a', 'Alice')]
    const deposits: Deposit[] = [{ ...makeDeposit('a', 100), deleted_at: '2026-01-02' }]
    const result = calculateBalances(members, deposits, [], [])
    expect(result[0].net).toBe(0)
  })

  it('accounts for existing settlements', () => {
    const members = [makeMember('a', 'Alice'), makeMember('b', 'Bob')]
    const deposits = [makeDeposit('a', 100)]
    const splits: ExpenseSplit[] = [
      { id: 's1', expense_id: 'e1', member_id: 'a', share_amount: 50 },
      { id: 's2', expense_id: 'e1', member_id: 'b', share_amount: 50 },
    ]
    const settlements: Settlement[] = [{
      id: 'set1', trip_id: 'trip1', from_member_id: 'b', to_member_id: 'a',
      amount: 30, note: '', created_at: '2026-01-02', deleted_at: null,
    }]
    const result = calculateBalances(members, deposits, splits, settlements)
    expect(result.find((e) => e.memberId === 'a')?.net).toBe(20)
    expect(result.find((e) => e.memberId === 'b')?.net).toBe(-20)
  })
})

describe('simplifyDebts', () => {
  it('returns empty when all balances are zero', () => {
    const members = [makeMember('a', 'A'), makeMember('b', 'B')]
    const balances = [{ memberId: 'a', net: 0 }, { memberId: 'b', net: 0 }]
    expect(simplifyDebts(balances, members)).toEqual([])
  })

  it('handles simple two-person debt', () => {
    const members = [makeMember('a', 'A'), makeMember('b', 'B')]
    const balances = [{ memberId: 'a', net: 50 }, { memberId: 'b', net: -50 }]
    const transfers = simplifyDebts(balances, members)
    expect(transfers).toHaveLength(1)
    expect(transfers[0].from.id).toBe('b')
    expect(transfers[0].to.id).toBe('a')
    expect(transfers[0].amount).toBe(50)
  })

  it('produces at most N-1 transfers', () => {
    const members = ['a', 'b', 'c', 'd'].map((id) => makeMember(id, id.toUpperCase()))
    const balances = [
      { memberId: 'a', net: 40 },
      { memberId: 'b', net: 10 },
      { memberId: 'c', net: -30 },
      { memberId: 'd', net: -20 },
    ]
    const transfers = simplifyDebts(balances, members)
    expect(transfers.length).toBeLessThanOrEqual(3)
    const totalTransferred = transfers.reduce((s, t) => s + t.amount, 0)
    expect(totalTransferred).toBe(50)
  })

  it('ignores balances below EPSILON', () => {
    const members = [makeMember('a', 'A'), makeMember('b', 'B')]
    const balances = [{ memberId: 'a', net: 0.004 }, { memberId: 'b', net: -0.004 }]
    expect(simplifyDebts(balances, members)).toEqual([])
  })
})
