import { describe, it, expect } from 'vitest'
import { exportText } from '../src/lib/export'
import type { Member, Deposit, Expense, ExpenseSplit, Settlement } from '../src/types'

const members: Member[] = [
  { id: 'a', trip_id: 't1', auth_uid: 'ua', name: 'Alice', color: '#000', is_admin: true, claimed: true, member_token: 'ABCD', joined_at: '2026-01-01', deleted_at: null },
  { id: 'b', trip_id: 't1', auth_uid: 'ub', name: 'Bob', color: '#111', is_admin: false, claimed: true, member_token: 'EFGH', joined_at: '2026-01-01', deleted_at: null },
]

const deposits: Deposit[] = [
  { id: 'd1', trip_id: 't1', member_id: 'a', amount: 100, currency: 'USD', rate_to_base: 1, note: 'Cash', created_at: '2026-01-01T00:00:00Z', deleted_at: null, version: 1 },
  { id: 'd2', trip_id: 't1', member_id: 'b', amount: 50, currency: 'USD', rate_to_base: 1, note: '', created_at: '2026-01-02T00:00:00Z', deleted_at: null, version: 1 },
]

const expenses: Expense[] = [
  { id: 'e1', trip_id: 't1', member_id: 'a', amount: 80, currency: 'USD', rate_to_base: 1, category: 'food', description: 'Dinner', date: '2026-01-01', split_type: 'equal', created_at: '2026-01-01T00:00:00Z', deleted_at: null, version: 1 },
]

const expenseSplits: ExpenseSplit[] = [
  { id: 's1', expense_id: 'e1', member_id: 'a', share_amount: 40 },
  { id: 's2', expense_id: 'e1', member_id: 'b', share_amount: 40 },
]

const settlements: Settlement[] = []

describe('exportText', () => {
  it('generates a formatted text summary', () => {
    const balances = [{ memberId: 'a', net: 60 }, { memberId: 'b', net: -10 }]
    const transfers = [{ from: members[1], to: members[0], amount: 10 }]

    const text = exportText({
      tripName: 'Test Trip',
      baseCurrency: 'USD',
      members,
      deposits,
      expenses,
      expenseSplits,
      settlements,
      balances,
      transfers,
    })

    expect(text).toContain('Test Trip')
    expect(text).toContain('150') // total deposited: 100 + 50
    expect(text).toContain('80') // total spent
    expect(text).toContain('Alice')
    expect(text).toContain('Bob')
    expect(text).toContain('→') // transfer arrow
  })

  it('handles empty trip', () => {
    const text = exportText({
      tripName: 'Empty',
      baseCurrency: 'VND',
      members: [],
      deposits: [],
      expenses: [],
      expenseSplits: [],
      settlements: [],
      balances: [],
      transfers: [],
    })

    expect(text).toContain('Empty')
    expect(text).toContain('0')
  })
})
