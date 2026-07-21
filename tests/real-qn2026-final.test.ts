/**
 * Real QN2026 Trip Final Verification
 *
 * Verifies TripSplit's logic produces the same results as the user's manual spreadsheet.
 *
 * Trip facts:
 * - 4 members: Bý, Kiệt (group "Bý"), Nhat, embe Gau (group "Embe Gau")
 * - Bý deposited ₫5,000,000, Nhat deposited ₫5,000,000 (pool = ₫10M)
 * - 30 expenses ALL paid from pool, ALL split equally 4 ways
 * - Total spent: ₫8,427,000
 * - Pool surplus: ₫1,573,000
 * - Spreadsheet says: "Chuyển lại Bý: ₫787,000" (≈ ₫786,500 exact)
 */
import { describe, it, expect } from 'vitest'
import { calculateBalances, simplifyDebts } from '../src/lib/settlement'
import { calculateEqualSplit } from '../src/lib/splits'
import type { Member, Deposit, Expense, ExpenseSplit, Settlement } from '../src/types'

// =============================================================================
// Constants
// =============================================================================

const GROUP_BY = 'group-by'
const GROUP_EMBE = 'group-embe-gau'
const TRIP_ID = 'trip-qn2026'

const EXPENSE_AMOUNTS = [
  1500000, 100000, 52000, 76000, 165000, 62000, 222000, 156000, 32000, 40000,
  265000, 40000, 146000, 95000, 76000, 60000, 145000, 30000, 35000, 250000,
  1960000, 240000, 180000, 20000, 35000, 287000, 305000, 770000, 996000, 87000,
]

const TOTAL_SPENT = 8_427_000
const TOTAL_POOL = 10_000_000
const POOL_SURPLUS = 1_573_000
const PER_MEMBER_SHARE = 2_106_750

// =============================================================================
// Helpers
// =============================================================================

const makeMember = (id: string, name: string, groupId: string): Member => ({
  id,
  trip_id: TRIP_ID,
  auth_uid: `auth-${id}`,
  name,
  color: '#000',
  is_admin: id === 'by',
  claimed: true,
  member_token: `token-${id}`,
  avatar_style: 'adventurer',
  avatar_seed: 1,
  group_id: groupId,
  joined_at: '2026-07-10',
  deleted_at: null,
})

const makeDeposit = (memberId: string, amount: number): Deposit => ({
  id: `dep-${memberId}`,
  trip_id: TRIP_ID,
  member_id: memberId,
  amount,
  currency: 'VND',
  rate_to_base: 1,
  note: 'Pool deposit',
  created_at: '2026-07-10',
  deleted_at: null,
  version: 1,
})

let expenseSeq = 0
const makePoolExpense = (amount: number): Expense => ({
  id: `exp-qn-${++expenseSeq}`,
  trip_id: TRIP_ID,
  member_id: 'by', // doesn't matter for pool expenses
  amount,
  currency: 'VND',
  rate_to_base: 1,
  category: 'food',
  description: `QN expense ${expenseSeq}`,
  date: '2026-07-10',
  split_type: 'equal',
  paid_from: 'pool',
  receipt_url: null,
  created_at: '2026-07-10',
  deleted_at: null,
  version: 1,
})

const makeSplit = (expenseId: string, memberId: string, share: number): ExpenseSplit => ({
  id: `split-${expenseId}-${memberId}`,
  expense_id: expenseId,
  member_id: memberId,
  share_amount: share,
})

// =============================================================================
// Test Data
// =============================================================================

const members: Member[] = [
  makeMember('by', 'Bý', GROUP_BY),
  makeMember('kiet', 'Kiệt', GROUP_BY),
  makeMember('nhat', 'Nhat', GROUP_EMBE),
  makeMember('embe', 'embe Gau', GROUP_EMBE),
]

const deposits: Deposit[] = [
  makeDeposit('by', 5_000_000),
  makeDeposit('nhat', 5_000_000),
]

// Build 30 pool expenses with equal 4-way splits
const expenses: Expense[] = EXPENSE_AMOUNTS.map((amt) => makePoolExpense(amt))

const memberIds = ['by', 'kiet', 'nhat', 'embe']

const expenseSplits: ExpenseSplit[] = expenses.flatMap((exp) => {
  const splits = calculateEqualSplit(exp.amount, memberIds, 'VND')
  return splits.map((s) => makeSplit(exp.id, s.member_id, s.share_amount))
})

const noSettlements: Settlement[] = []

// =============================================================================
// Tests
// =============================================================================

describe('Real QN2026 Trip — Spreadsheet Verification', () => {
  it('1. Pool balance = 10M - 8,427,000 = ₫1,573,000', () => {
    const totalExpenseAmount = EXPENSE_AMOUNTS.reduce((sum, a) => sum + a, 0)
    expect(totalExpenseAmount).toBe(TOTAL_SPENT)
    expect(TOTAL_POOL - totalExpenseAmount).toBe(POOL_SURPLUS)
  })

  it('2. Per-member share ≈ ₫2,106,750 (sum of all splits per member)', () => {
    // Each member's total obligation (sum of their splits across all expenses)
    for (const memberId of memberIds) {
      const memberTotal = expenseSplits
        .filter((s) => s.member_id === memberId)
        .reduce((sum, s) => sum + s.share_amount, 0)
      expect(memberTotal).toBe(PER_MEMBER_SHARE)
    }

    // Also verify total splits = total spent
    const allSplitsSum = expenseSplits.reduce((sum, s) => sum + s.share_amount, 0)
    expect(allSplitsSum).toBe(TOTAL_SPENT)
  })

  it('3. calculateBalances: Bý=+2,893,250, Kiệt=-2,106,750, Nhat=+2,893,250, embe=-2,106,750', () => {
    const balances = calculateBalances(members, deposits, expenses, expenseSplits, noSettlements)

    const byBalance = balances.find((b) => b.memberId === 'by')!
    const kietBalance = balances.find((b) => b.memberId === 'kiet')!
    const nhatBalance = balances.find((b) => b.memberId === 'nhat')!
    const embeBalance = balances.find((b) => b.memberId === 'embe')!

    // Bý: deposited 5M, consumed 2,106,750 → net = +2,893,250
    expect(byBalance.net).toBe(2_893_250)
    // Kiệt: deposited 0, consumed 2,106,750 → net = -2,106,750
    expect(kietBalance.net).toBe(-2_106_750)
    // Nhat: deposited 5M, consumed 2,106,750 → net = +2,893,250
    expect(nhatBalance.net).toBe(2_893_250)
    // embe: deposited 0, consumed 2,106,750 → net = -2,106,750
    expect(embeBalance.net).toBe(-2_106_750)

    // Zero-sum check: sum of all balances = pool surplus
    const totalNet = balances.reduce((sum, b) => sum + b.net, 0)
    expect(totalNet).toBe(POOL_SURPLUS)
  })

  it('4. simplifyDebts with groups: both groups net +₫786,500 → 0 inter-group transfers', () => {
    const balances = calculateBalances(members, deposits, expenses, expenseSplits, noSettlements)
    const transfers = simplifyDebts(balances, members)

    // Group Bý: Bý(+2,893,250) + Kiệt(-2,106,750) = +786,500
    // Group Embe: Nhat(+2,893,250) + embe(-2,106,750) = +786,500
    // Both groups are net positive → no inter-group transfers needed
    expect(transfers).toHaveLength(0)
  })

  it('5. Refund: (5M/10M) × 1,573,000 = ₫786,500 each ≈ spreadsheet ₫787K', () => {
    // Each depositor's proportional refund from pool surplus
    const byDeposit = 5_000_000
    const nhatDeposit = 5_000_000
    const totalDeposits = byDeposit + nhatDeposit

    const byRefund = (byDeposit / totalDeposits) * POOL_SURPLUS
    const nhatRefund = (nhatDeposit / totalDeposits) * POOL_SURPLUS

    expect(byRefund).toBe(786_500)
    expect(nhatRefund).toBe(786_500)

    // Spreadsheet says "₫787,000" — within ₫500 rounding
    expect(Math.abs(byRefund - 787_000)).toBeLessThanOrEqual(500)
  })

  it('6. Intra-group: Kiệt → Bý: ₫2,106,750, embe → Nhat: ₫2,106,750', () => {
    // Within Group Bý: Kiệt owes 2,106,750 (their share) to Bý (who deposited)
    // Within Group Embe: embe owes 2,106,750 (their share) to Nhat (who deposited)
    // These are resolved privately, not via simplifyDebts (which produces 0 transfers)

    const balances = calculateBalances(members, deposits, expenses, expenseSplits, noSettlements)

    const kietBalance = balances.find((b) => b.memberId === 'kiet')!
    const embeBalance = balances.find((b) => b.memberId === 'embe')!

    // Each non-depositor owes exactly their share to their group's depositor
    expect(Math.abs(kietBalance.net)).toBe(PER_MEMBER_SHARE)
    expect(Math.abs(embeBalance.net)).toBe(PER_MEMBER_SHARE)

    // The debt direction: both negative (owe money)
    expect(kietBalance.net).toBeLessThan(0)
    expect(embeBalance.net).toBeLessThan(0)
  })

  it('7. Pocket-only balances: all 0 (no pocket expenses) → 0 settlements', () => {
    // Create pocket-only view: no deposits, no pool expenses
    // Only pocket expenses would create balances — but there are none
    const pocketExpenses = expenses.filter((e) => e.paid_from === 'pocket')
    expect(pocketExpenses).toHaveLength(0)

    // With no pocket expenses, pocket-only balances are all zero
    const pocketBalances = calculateBalances(members, [], pocketExpenses, [], noSettlements)
    for (const balance of pocketBalances) {
      expect(balance.net).toBe(0)
    }

    const pocketTransfers = simplifyDebts(pocketBalances, members)
    expect(pocketTransfers).toHaveLength(0)
  })

  it('8. Pool overdraft: neither group negative → no overdraft', () => {
    // Pool overdraft occurs when a group's aggregate balance is negative
    // after accounting for deposits. Here both groups are net positive.
    const balances = calculateBalances(members, deposits, expenses, expenseSplits, noSettlements)

    // Group Bý net = Bý + Kiệt = 2,893,250 + (-2,106,750) = 786,500
    const groupByNet = balances
      .filter((b) => members.find((m) => m.id === b.memberId)?.group_id === GROUP_BY)
      .reduce((sum, b) => sum + b.net, 0)

    // Group Embe net = Nhat + embe = 2,893,250 + (-2,106,750) = 786,500
    const groupEmbeNet = balances
      .filter((b) => members.find((m) => m.id === b.memberId)?.group_id === GROUP_EMBE)
      .reduce((sum, b) => sum + b.net, 0)

    expect(groupByNet).toBe(786_500)
    expect(groupEmbeNet).toBe(786_500)

    // Neither is negative → no pool overdraft
    expect(groupByNet).toBeGreaterThan(0)
    expect(groupEmbeNet).toBeGreaterThan(0)
  })

  it('9. Hypothetical pocket expense ₫500K by Nhat for all 4 → Bý group → Embe group: ₫250K', () => {
    // Add a pocket expense paid by Nhat, split equally 4 ways
    const pocketExp: Expense = {
      id: 'exp-pocket-hypothetical',
      trip_id: TRIP_ID,
      member_id: 'nhat',
      amount: 500_000,
      currency: 'VND',
      rate_to_base: 1,
      category: 'food',
      description: 'Hypothetical pocket dinner',
      date: '2026-07-11',
      split_type: 'equal',
      paid_from: 'pocket',
      receipt_url: null,
      created_at: '2026-07-11',
      deleted_at: null,
      version: 1,
    }

    // Split 500K equally 4 ways = 125K each
    const pocketSplits: ExpenseSplit[] = memberIds.map((memberId) =>
      makeSplit('exp-pocket-hypothetical', memberId, 125_000)
    )

    const allExpenses = [...expenses, pocketExp]
    const allSplits = [...expenseSplits, ...pocketSplits]

    const balances = calculateBalances(members, deposits, allExpenses, allSplits, noSettlements)

    // Nhat paid 500K from pocket, consumed 125K → pocket credit = 375K net addition
    // Bý consumed 125K more → balance drops by 125K
    // Kiệt consumed 125K more → balance drops by 125K
    // embe consumed 125K more → balance drops by 125K
    // Nhat: +5M (deposit) + 500K (pocket credit) - 2,106,750 (pool share) - 125K (pocket share) = +3,268,250
    const nhatBal = balances.find((b) => b.memberId === 'nhat')!
    expect(nhatBal.net).toBe(3_268_250)

    // Bý: +5M - 2,106,750 - 125K = +2,768,250
    const byBal = balances.find((b) => b.memberId === 'by')!
    expect(byBal.net).toBe(2_768_250)

    // Kiệt: 0 - 2,106,750 - 125K = -2,231,750
    const kietBal = balances.find((b) => b.memberId === 'kiet')!
    expect(kietBal.net).toBe(-2_231_750)

    // embe: 0 - 2,106,750 - 125K = -2,231,750
    const embeBal = balances.find((b) => b.memberId === 'embe')!
    expect(embeBal.net).toBe(-2_231_750)

    // Group Bý net: 2,768,250 + (-2,231,750) = 536,500
    // Group Embe net: 3,268,250 + (-2,231,750) = 1,036,500
    // Total surplus: 536,500 + 1,036,500 = 1,573,000 ✓ (pool surplus unchanged)

    // simplifyDebts consolidates by group:
    // Group Bý: +536,500, Group Embe: +1,036,500
    // Both positive → still 0 inter-group transfers!
    // Wait — that means both groups are still net creditors (surplus in pool).
    // The pocket expense increased Embe group's credit but reduced Bý group's credit.
    // No group has negative balance → 0 transfers.

    // Actually: let's reason about pocket-only settlement separately.
    // For a pocket expense by Nhat split 4 ways:
    //   Bý owes Nhat 125K, Kiệt owes Nhat 125K (inter-group: 250K from Bý group → Nhat)
    //   embe owes Nhat 125K (intra-group)
    // So inter-group transfer: Bý group → Embe group: ₫250K

    const transfers = simplifyDebts(balances, members)

    // Both groups net positive — but the question is whether debt simplification
    // sees an imbalance. With the pool surplus, both are positive.
    // The pocket expense shifts balance but both groups remain positive.
    // Since simplifyDebts only handles net-negative groups paying net-positive groups,
    // and both are positive, there should be 0 transfers.
    // However the user expects "Bý group → Embe group: ₫250K" from pocket settlement logic.

    // The correct interpretation: for POCKET-ONLY settlement (ignoring pool deposits),
    // only the pocket expense matters.
    const pocketOnlyBalances = calculateBalances(members, [], [pocketExp], pocketSplits, noSettlements)

    // Nhat: +500K (pocket credit) - 125K (split) = +375K
    // Bý: -125K, Kiệt: -125K, embe: -125K
    const pocketTransfers = simplifyDebts(pocketOnlyBalances, members)

    // Group Bý: -125K + -125K = -250K (debtor)
    // Group Embe: +375K + -125K = +250K (creditor)
    // Transfer: Group Bý representative → Group Embe representative: ₫250K
    expect(pocketTransfers).toHaveLength(1)
    expect(pocketTransfers[0].amount).toBe(250_000)

    // Direction: Bý group (debtor) pays Embe group (creditor)
    const fromGroup = members.find((m) => m.id === pocketTransfers[0].from.id)!.group_id
    const toGroup = members.find((m) => m.id === pocketTransfers[0].to.id)!.group_id
    expect(fromGroup).toBe(GROUP_BY)
    expect(toGroup).toBe(GROUP_EMBE)
  })

  it('10. After marking pocket settlement as settled → 0 transfers', () => {
    // Same setup as test 9
    const pocketExp: Expense = {
      id: 'exp-pocket-hypothetical-2',
      trip_id: TRIP_ID,
      member_id: 'nhat',
      amount: 500_000,
      currency: 'VND',
      rate_to_base: 1,
      category: 'food',
      description: 'Hypothetical pocket dinner',
      date: '2026-07-11',
      split_type: 'equal',
      paid_from: 'pocket',
      receipt_url: null,
      created_at: '2026-07-11',
      deleted_at: null,
      version: 1,
    }

    const pocketSplits: ExpenseSplit[] = memberIds.map((memberId) =>
      makeSplit('exp-pocket-hypothetical-2', memberId, 125_000)
    )

    // Pocket-only balances
    const pocketTransfers = simplifyDebts(
      calculateBalances(members, [], [pocketExp], pocketSplits, []),
      members
    )

    // Confirm there's a transfer to settle
    expect(pocketTransfers).toHaveLength(1)
    const transfer = pocketTransfers[0]

    // Mark it as settled: create a settlement record
    const settlement: Settlement = {
      id: 'settle-pocket-1',
      trip_id: TRIP_ID,
      from_member_id: transfer.from.id,
      to_member_id: transfer.to.id,
      amount: transfer.amount,
      method: 'direct',
      note: 'Settled pocket expense',
      created_at: '2026-07-12',
      deleted_at: null,
    }

    // After settlement, recalculate
    const postSettlementBalances = calculateBalances(
      members,
      [],
      [pocketExp],
      pocketSplits,
      [settlement]
    )

    const postTransfers = simplifyDebts(postSettlementBalances, members)

    // All settled → 0 remaining transfers
    expect(postTransfers).toHaveLength(0)
  })
})
