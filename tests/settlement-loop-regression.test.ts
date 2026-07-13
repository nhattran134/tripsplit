/**
 * Regression test: Settlement loop prevention
 * 
 * Scenario that caused the loop:
 * - Bý deposits 5M into pool
 * - Pool expense 1.472M split 4 ways
 * - Nhat pays 1.5M from pocket split 4 ways
 * - After marking a settlement, new settlements kept appearing in a loop
 * 
 * Fix: Settlements are computed from POCKET expenses only.
 * Pool is self-contained (depositors funded it, done).
 */
import { simplifyDebts, calculateBalances } from '../src/lib/settlement'
import { describe, it, expect } from 'vitest'
import type { Member, Deposit, Expense, ExpenseSplit, Settlement } from '../src/types'

const m = (id: string, name: string, gid: string): Member => ({
  id, name, group_id: gid, trip_id: 't', color: '', is_admin: false, claimed: true,
  avatar_style: '', avatar_seed: 0, member_token: '', auth_uid: '', created_at: '', deleted_at: null
})

describe('Settlement loop regression', () => {
  const by = m('by', 'Bý', 'g-by')
  const kiet = m('kiet', 'Kiệt', 'g-by')
  const nhat = m('nhat', 'Nhat', 'g-embe')
  const embe = m('embe', 'embe Gau', 'g-embe')
  const members = [by, kiet, nhat, embe]

  const deposits: Deposit[] = [
    { id: 'd1', trip_id: 't', member_id: 'by', amount: 5000000, currency: 'VND', rate_to_base: 1, note: '', created_at: '', deleted_at: null, version: 1 }
  ]

  const poolExp: Expense = { id: 'e1', trip_id: 't', member_id: 'nhat', amount: 1472000, currency: 'VND', rate_to_base: 1, category: 'accommodation', description: '', date: '', split_type: 'equal', paid_from: 'pool', receipt_url: null, created_at: '', deleted_at: null, version: 1 }
  const pocketExp: Expense = { id: 'e2', trip_id: 't', member_id: 'nhat', amount: 1500000, currency: 'VND', rate_to_base: 1, category: 'accommodation', description: '', date: '', split_type: 'equal', paid_from: 'pocket', receipt_url: null, created_at: '', deleted_at: null, version: 1 }
  const expenses = [poolExp, pocketExp]

  const splits: ExpenseSplit[] = [
    // Pool expense splits (368K each)
    { id: 's1', expense_id: 'e1', member_id: 'by', share_amount: 368000 },
    { id: 's2', expense_id: 'e1', member_id: 'kiet', share_amount: 368000 },
    { id: 's3', expense_id: 'e1', member_id: 'nhat', share_amount: 368000 },
    { id: 's4', expense_id: 'e1', member_id: 'embe', share_amount: 368000 },
    // Pocket expense splits (375K each)
    { id: 's5', expense_id: 'e2', member_id: 'by', share_amount: 375000 },
    { id: 's6', expense_id: 'e2', member_id: 'kiet', share_amount: 375000 },
    { id: 's7', expense_id: 'e2', member_id: 'nhat', share_amount: 375000 },
    { id: 's8', expense_id: 'e2', member_id: 'embe', share_amount: 375000 },
  ]

  // Simulate the SettleUp page logic: pocket-only balances
  function computePocketTransfers(settlements: Settlement[]) {
    const pocketBalances = new Map<string, number>()
    for (const m of members) pocketBalances.set(m.id, 0)

    // Credit pocket payers
    for (const e of expenses) {
      if (e.deleted_at || e.paid_from !== 'pocket') continue
      pocketBalances.set(e.member_id, (pocketBalances.get(e.member_id) ?? 0) + e.amount * e.rate_to_base)
    }

    // Debit pocket expense shares only
    for (const s of splits) {
      const exp = expenses.find(e => e.id === s.expense_id)
      if (!exp || exp.deleted_at || exp.paid_from !== 'pocket') continue
      pocketBalances.set(s.member_id, (pocketBalances.get(s.member_id) ?? 0) - s.share_amount)
    }

    // Account for settlements
    for (const s of settlements) {
      if (s.deleted_at) continue
      if (s.from_member_id === s.to_member_id) continue
      pocketBalances.set(s.from_member_id, (pocketBalances.get(s.from_member_id) ?? 0) + s.amount)
      pocketBalances.set(s.to_member_id, (pocketBalances.get(s.to_member_id) ?? 0) - s.amount)
    }

    const entries = [...pocketBalances.entries()].map(([memberId, net]) => ({
      memberId, net: Math.round(net * 100) / 100
    }))

    return simplifyDebts(entries, members)
  }

  it('should show Bý group → Nhat group: 750K with no settlements', () => {
    const transfers = computePocketTransfers([])
    expect(transfers.length).toBe(1)
    // Bý's group representative → Nhat's group representative
    expect(transfers[0].amount).toBe(750000)
  })

  it('should show nothing after settlement of 750K is recorded', () => {
    const settlements: Settlement[] = [{
      id: 'set1', trip_id: 't', from_member_id: 'by', to_member_id: 'nhat',
      amount: 750000, method: 'direct', note: '', created_at: '', deleted_at: null
    }]
    const transfers = computePocketTransfers(settlements)
    expect(transfers.length).toBe(0)
  })

  it('NO LOOP: after 1st settlement, no new settlements appear', () => {
    // Simulate the loop scenario: mark settlement, recompute, check no new transfers
    let settlements: Settlement[] = []

    // Round 1: compute transfers
    const round1 = computePocketTransfers(settlements)
    expect(round1.length).toBe(1)
    expect(round1[0].amount).toBe(750000)

    // Mark it as settled
    settlements.push({
      id: 'set1', trip_id: 't', from_member_id: round1[0].from.id, to_member_id: round1[0].to.id,
      amount: round1[0].amount, method: 'direct', note: '', created_at: '', deleted_at: null
    })

    // Round 2: recompute — should be empty
    const round2 = computePocketTransfers(settlements)
    expect(round2.length).toBe(0)
  })

  it('NO LOOP: even with via_pool settlement, no new transfers appear', () => {
    let settlements: Settlement[] = []

    const round1 = computePocketTransfers(settlements)
    expect(round1.length).toBe(1)

    // Mark as via_pool
    settlements.push({
      id: 'set1', trip_id: 't', from_member_id: round1[0].from.id, to_member_id: round1[0].to.id,
      amount: round1[0].amount, method: 'via_pool', note: '', created_at: '', deleted_at: null
    })

    // Round 2: no loop
    const round2 = computePocketTransfers(settlements)
    expect(round2.length).toBe(0)
  })

  it('NO LOOP: partial settlement does not create oscillation', () => {
    let settlements: Settlement[] = []

    // Pay 375K (half)
    settlements.push({
      id: 'set1', trip_id: 't', from_member_id: 'by', to_member_id: 'nhat',
      amount: 375000, method: 'direct', note: '', created_at: '', deleted_at: null
    })

    const round2 = computePocketTransfers(settlements)
    // Should show remaining 375K, not a loop
    expect(round2.length).toBe(1)
    expect(round2[0].amount).toBe(375000)

    // Pay remaining
    settlements.push({
      id: 'set2', trip_id: 't', from_member_id: round2[0].from.id, to_member_id: round2[0].to.id,
      amount: round2[0].amount, method: 'direct', note: '', created_at: '', deleted_at: null
    })

    // Done
    const round3 = computePocketTransfers(settlements)
    expect(round3.length).toBe(0)
  })

  it('pool deposits and expenses do NOT affect pocket settlements', () => {
    // Even with huge pool surplus, pocket settlement is independent
    const transfers = computePocketTransfers([])
    // Only pocket expense drives the settlement (750K)
    // Pool's 5M deposit and 1.472M expense are irrelevant
    expect(transfers[0].amount).toBe(750000)
  })

  it('calculateBalances still works correctly for display purposes', () => {
    // Verify the raw balances (used for member display, not settlements)
    const balances = calculateBalances(members, deposits, expenses, splits, [])
    const byBal = balances.find(b => b.memberId === 'by')!.net
    const nhatBal = balances.find(b => b.memberId === 'nhat')!.net

    // Bý: 5M deposit - 368K pool share - 375K pocket share = +4,257,000
    expect(byBal).toBe(4257000)
    // Nhat: 0 deposit + 1.5M pocket credit - 368K pool share - 375K pocket share = +757,000
    expect(nhatBal).toBe(757000)
  })
})
