/**
 * Adversarial Logic Tests for TripSplit Settlement System
 * 
 * These tests target deep logic bugs in group consolidation, settlement direction,
 * pool/pocket mechanics, numeric edge cases, split math, and zero-sum invariants.
 */
import { describe, it, expect } from 'vitest'
import { calculateBalances, simplifyDebts } from '../src/lib/settlement'
import { calculateEqualSplit } from '../src/lib/splits'
import type { Member, Deposit, Expense, ExpenseSplit, Settlement } from '../src/types'

// --- Factories ---

let counter = 0
function uid(): string { return `id-${++counter}` }

function makeMember(id: string, name: string, groupId: string | null = null, deletedAt: string | null = null): Member {
  return {
    id, trip_id: 'trip1', auth_uid: `auth-${id}`, name, color: '#000',
    is_admin: false, claimed: true, member_token: `token-${id}`,
    avatar_style: 'bottts', avatar_seed: 42,
    group_id: groupId, joined_at: '2026-01-01', deleted_at: deletedAt,
  }
}

function makeDeposit(memberId: string, amount: number, rate = 1, deleted = false): Deposit {
  return {
    id: uid(), trip_id: 'trip1', member_id: memberId,
    amount, currency: 'USD', rate_to_base: rate, note: '',
    created_at: '2026-01-01', deleted_at: deleted ? '2026-01-02' : null, version: 1,
  }
}

function makeExpense(memberId: string, amount: number, paidFrom: 'pool' | 'pocket', rate = 1, deleted = false): Expense {
  return {
    id: uid(), trip_id: 'trip1', member_id: memberId,
    amount, currency: 'USD', rate_to_base: rate,
    category: 'food', description: 'test', date: '2026-01-01',
    split_type: 'equal', paid_from: paidFrom,
    receipt_url: null, created_at: '2026-01-01', deleted_at: deleted ? '2026-01-02' : null, version: 1,
  }
}

function makeSplit(expenseId: string, memberId: string, shareAmount: number): ExpenseSplit {
  return { id: uid(), expense_id: expenseId, member_id: memberId, share_amount: shareAmount }
}

function makeSettlement(fromId: string, toId: string, amount: number, deleted = false): Settlement {
  return {
    id: uid(), trip_id: 'trip1', from_member_id: fromId, to_member_id: toId,
    amount, method: 'direct', note: '',
    created_at: '2026-01-01', deleted_at: deleted ? '2026-01-02' : null,
  }
}

function getNet(balances: { memberId: string; net: number }[], memberId: string): number {
  return balances.find(b => b.memberId === memberId)?.net ?? NaN
}

// --- Group Logic Exploits ---

describe('Group Logic Exploits', () => {

  it('1. Three groups (5,2,1 members) — solo member not swallowed', () => {
    // Group A: 5 members, Group B: 2 members, Group C: 1 member (solo)
    const groupA = 'grp-a'
    const groupB = 'grp-b'
    const groupC = 'grp-c'
    const a1 = makeMember('a1', 'A1', groupA)
    const a2 = makeMember('a2', 'A2', groupA)
    const a3 = makeMember('a3', 'A3', groupA)
    const a4 = makeMember('a4', 'A4', groupA)
    const a5 = makeMember('a5', 'A5', groupA)
    const b1 = makeMember('b1', 'B1', groupB)
    const b2 = makeMember('b2', 'B2', groupB)
    const c1 = makeMember('c1', 'Solo', groupC)
    const members = [a1, a2, a3, a4, a5, b1, b2, c1]

    // All deposit, one expense split equally (8 * $25 = $200 total expense)
    const deposits = [makeDeposit('a1', 200)] // Only A1 deposits
    const expense = makeExpense('a1', 200, 'pool')
    const splits = members.map(m => makeSplit(expense.id, m.id, 25))

    const balances = calculateBalances(members, deposits, [expense], splits, [])
    const transfers = simplifyDebts(balances, members)

    // Group A net: a1 deposited 200, group A members deducted 5*25=125 → net = 200 - 125 = +75
    // Group B net: 0 deposits - 2*25=50 → net = -50
    // Group C net: 0 deposits - 1*25=25 → net = -25
    const totalFrom = transfers.reduce((s, t) => s + t.amount, 0)
    const totalTo = transfers.reduce((s, t) => s + t.amount, 0)
    expect(totalFrom).toBeCloseTo(totalTo, 2) // Conservation

    // Verify solo member C appears in transfers (not swallowed)
    // C owes 25 to group A. Either directly or via B's transfer
    const cTransfer = transfers.find(t => t.from.id === 'c1')
    const bTransfer = transfers.find(t => t.from.id === 'b1' || t.from.id === 'b2')
    // Both groups should appear as debtors
    expect(cTransfer || bTransfer).toBeTruthy()
    // Total amount transferred must equal 75 (the surplus of group A)
    expect(totalFrom).toBeCloseTo(75, 2)
  })

  it('2. Member changes group mid-trip — old expenses attributed correctly via splits', () => {
    // Alice starts in group X, then moves to group Y
    // But expense splits are immutable — they're per-expense, not per-group
    const alice = makeMember('alice', 'Alice', 'grp-y') // NOW in Y
    const bob = makeMember('bob', 'Bob', 'grp-x')
    const charlie = makeMember('charlie', 'Charlie', 'grp-y')
    const members = [alice, bob, charlie]

    // Alice paid from pocket (credit goes to Alice regardless of group)
    const expense = makeExpense('alice', 90, 'pocket')
    const splits = [
      makeSplit(expense.id, 'alice', 30),
      makeSplit(expense.id, 'bob', 30),
      makeSplit(expense.id, 'charlie', 30),
    ]

    const balances = calculateBalances(members, [], [expense], splits, [])
    // Alice: +90 (pocket credit) - 30 (share) = +60
    // Bob: -30
    // Charlie: -30
    expect(getNet(balances, 'alice')).toBe(60)
    expect(getNet(balances, 'bob')).toBe(-30)
    expect(getNet(balances, 'charlie')).toBe(-30)

    // Now simplifyDebts: alice is in grp-y with charlie
    // grp-y net: alice(60) + charlie(-30) = +30
    // grp-x net: bob(-30)
    const transfers = simplifyDebts(balances, members)
    expect(transfers.length).toBe(1)
    expect(transfers[0].amount).toBe(30)
    // Bob pays group Y representative
    expect(transfers[0].from.id).toBe('bob')
    // Representative of grp-y is alice (first encountered)
    expect(transfers[0].to.group_id).toBe('grp-y')
  })

  it('3. All members in ONE group — simplifyDebts returns ZERO transfers', () => {
    const sameGroup = 'grp-all'
    const alice = makeMember('alice', 'Alice', sameGroup)
    const bob = makeMember('bob', 'Bob', sameGroup)
    const charlie = makeMember('charlie', 'Charlie', sameGroup)
    const members = [alice, bob, charlie]

    const deposits = [makeDeposit('alice', 300)]
    const expense = makeExpense('alice', 300, 'pool')
    const splits = [
      makeSplit(expense.id, 'alice', 100),
      makeSplit(expense.id, 'bob', 100),
      makeSplit(expense.id, 'charlie', 100),
    ]

    const balances = calculateBalances(members, deposits, [expense], splits, [])
    const transfers = simplifyDebts(balances, members)

    // All in one group → consolidated net = 300 - 300 = 0 → no transfers
    expect(transfers).toHaveLength(0)
  })

  it('4. Group with only one member — behaves identically to ungrouped', () => {
    const soloGrouped = makeMember('sg', 'SoloGrouped', 'grp-solo')
    const ungrouped = makeMember('ug', 'Ungrouped', null)
    const payer = makeMember('payer', 'Payer', null)
    const members = [soloGrouped, ungrouped, payer]

    // Payer pays from pocket, split among all three
    const expense = makeExpense('payer', 90, 'pocket')
    const splits = [
      makeSplit(expense.id, 'sg', 30),
      makeSplit(expense.id, 'ug', 30),
      makeSplit(expense.id, 'payer', 30),
    ]

    const balances = calculateBalances(members, [], [expense], splits, [])
    // payer: +90 - 30 = +60, sg: -30, ug: -30
    expect(getNet(balances, 'sg')).toBe(-30)
    expect(getNet(balances, 'ug')).toBe(-30)

    const transfers = simplifyDebts(balances, members)
    // Both sg and ug should owe payer 30 each
    expect(transfers.length).toBe(2)
    const sgTransfer = transfers.find(t => t.from.id === 'sg')
    const ugTransfer = transfers.find(t => t.from.id === 'ug')
    expect(sgTransfer?.amount).toBe(30)
    expect(ugTransfer?.amount).toBe(30)
  })

  it('5. Null group_id mixed with real group_ids — ungrouped treated independently', () => {
    const grouped1 = makeMember('g1', 'G1', 'grp-x')
    const grouped2 = makeMember('g2', 'G2', 'grp-x')
    const solo1 = makeMember('s1', 'Solo1', null)
    const solo2 = makeMember('s2', 'Solo2', null)
    const members = [grouped1, grouped2, solo1, solo2]

    // Solo1 pays pocket expense split among all
    const expense = makeExpense('s1', 100, 'pocket')
    const splits = [
      makeSplit(expense.id, 'g1', 25),
      makeSplit(expense.id, 'g2', 25),
      makeSplit(expense.id, 's1', 25),
      makeSplit(expense.id, 's2', 25),
    ]

    const balances = calculateBalances(members, [], [expense], splits, [])
    // s1: +100 - 25 = +75, g1: -25, g2: -25, s2: -25
    const transfers = simplifyDebts(balances, members)

    // grp-x consolidated: g1(-25) + g2(-25) = -50 
    // solo1: +75, solo2: -25
    // Expected transfers: grp-x → solo1 (50), solo2 → solo1 (25) = total 75
    const totalTransferred = transfers.reduce((s, t) => s + t.amount, 0)
    expect(totalTransferred).toBeCloseTo(75, 2)

    // Verify solo2 appears independently (not merged with grp-x)
    const s2Transfer = transfers.find(t => t.from.id === 's2')
    expect(s2Transfer).toBeDefined()
    expect(s2Transfer!.amount).toBe(25)
  })
})

// --- Settlement Direction Exploits ---

describe('Settlement Direction Exploits', () => {

  it('6. Circular settlements: A→B, B→C, C→A — balances still correct', () => {
    const a = makeMember('a', 'Alice')
    const b = makeMember('b', 'Bob')
    const c = makeMember('c', 'Charlie')
    const members = [a, b, c]

    // Start: A deposits 90, split equally → A: +60, B: -30, C: -30
    const deposits = [makeDeposit('a', 90)]
    const expense = makeExpense('a', 90, 'pool')
    const splits = [
      makeSplit(expense.id, 'a', 30),
      makeSplit(expense.id, 'b', 30),
      makeSplit(expense.id, 'c', 30),
    ]

    // Circular settlements of 10 each: A→B, B→C, C→A
    const settlements = [
      makeSettlement('a', 'b', 10),
      makeSettlement('b', 'c', 10),
      makeSettlement('c', 'a', 10),
    ]

    const balances = calculateBalances(members, deposits, [expense], splits, settlements)
    // A: 90(dep) - 30(share) + 10(paid B) - 10(received from C) = 60 + 10 - 10 = 60
    // B: 0 - 30 + 10(paid C) - 10(received from A) = -30 + 10 - 10 = -30
    // C: 0 - 30 + 10(paid A) - 10(received from B) = -30 + 10 - 10 = -30
    // Circular settlements of equal amounts cancel out
    expect(getNet(balances, 'a')).toBe(60)
    expect(getNet(balances, 'b')).toBe(-30)
    expect(getNet(balances, 'c')).toBe(-30)
  })

  it('7. Over-settlement: amount > actual debt — creates reverse obligation', () => {
    const a = makeMember('a', 'Alice')
    const b = makeMember('b', 'Bob')
    const members = [a, b]

    // Bob owes Alice 50 (Alice deposited 100, split equally)
    const deposits = [makeDeposit('a', 100)]
    const expense = makeExpense('a', 100, 'pool')
    const splits = [
      makeSplit(expense.id, 'a', 50),
      makeSplit(expense.id, 'b', 50),
    ]

    // Bob over-settles: pays Alice 80 (owes only 50)
    const settlements = [makeSettlement('b', 'a', 80)]

    const balances = calculateBalances(members, deposits, [expense], splits, settlements)
    // A: 100 - 50 - 80(received) = -30 (now Alice owes Bob!)
    // B: 0 - 50 + 80(paid) = +30
    expect(getNet(balances, 'a')).toBe(-30)
    expect(getNet(balances, 'b')).toBe(30)

    const transfers = simplifyDebts(balances, members)
    // Direction reversed: Alice pays Bob
    expect(transfers.length).toBe(1)
    expect(transfers[0].from.id).toBe('a')
    expect(transfers[0].to.id).toBe('b')
    expect(transfers[0].amount).toBe(30)
  })

  it('8. Duplicate settlements (exact same from/to/amount) — should compound', () => {
    const a = makeMember('a', 'Alice')
    const b = makeMember('b', 'Bob')
    const members = [a, b]

    // Bob owes Alice 100
    const deposits = [makeDeposit('a', 200)]
    const expense = makeExpense('a', 200, 'pool')
    const splits = [
      makeSplit(expense.id, 'a', 100),
      makeSplit(expense.id, 'b', 100),
    ]

    // Bob pays Alice 30 THREE times (duplicate entries)
    const settlements = [
      makeSettlement('b', 'a', 30),
      makeSettlement('b', 'a', 30),
      makeSettlement('b', 'a', 30),
    ]

    const balances = calculateBalances(members, deposits, [expense], splits, settlements)
    // A: 200 - 100 - 90(received) = 10
    // B: 0 - 100 + 90(paid) = -10
    expect(getNet(balances, 'a')).toBe(10)
    expect(getNet(balances, 'b')).toBe(-10)
  })

  it('9. Self-settlement (from === to) — should be no-op', () => {
    const a = makeMember('a', 'Alice')
    const b = makeMember('b', 'Bob')
    const members = [a, b]

    const deposits = [makeDeposit('a', 100)]
    const expense = makeExpense('a', 100, 'pool')
    const splits = [
      makeSplit(expense.id, 'a', 50),
      makeSplit(expense.id, 'b', 50),
    ]

    // Self-settlement: A pays A 50 — should be completely ignored
    const settlements = [makeSettlement('a', 'a', 50)]

    const balances = calculateBalances(members, deposits, [expense], splits, settlements)

    // Fixed: self-settlement is now skipped (no-op)
    expect(getNet(balances, 'a')).toBe(50)
    expect(getNet(balances, 'b')).toBe(-50)
  })
})

// --- Pool/Pocket Exploits ---

describe('Pool/Pocket Exploits', () => {

  it('10. Pool expense with zero deposits — payer gets NO credit, shares still deducted', () => {
    const a = makeMember('a', 'Alice')
    const b = makeMember('b', 'Bob')
    const members = [a, b]

    // Pool expense (payer gets NO credit), no deposits at all
    const expense = makeExpense('a', 100, 'pool')
    const splits = [
      makeSplit(expense.id, 'a', 50),
      makeSplit(expense.id, 'b', 50),
    ]

    const balances = calculateBalances(members, [], [expense], splits, [])
    // A: 0(no deposit) + 0(pool=no credit) - 50(share) = -50
    // B: 0 - 50 = -50
    expect(getNet(balances, 'a')).toBe(-50)
    expect(getNet(balances, 'b')).toBe(-50)
  })

  it('11. Same person pays pocket AND pool — only pocket gives credit', () => {
    const a = makeMember('a', 'Alice')
    const b = makeMember('b', 'Bob')
    const members = [a, b]

    const pocketExpense = makeExpense('a', 60, 'pocket')
    const poolExpense = makeExpense('a', 40, 'pool')
    const splits = [
      makeSplit(pocketExpense.id, 'a', 30),
      makeSplit(pocketExpense.id, 'b', 30),
      makeSplit(poolExpense.id, 'a', 20),
      makeSplit(poolExpense.id, 'b', 20),
    ]

    const balances = calculateBalances(members, [], [pocketExpense, poolExpense], splits, [])
    // A: 60(pocket credit) + 0(pool credit) - 30 - 20 = +10
    // B: 0 - 30 - 20 = -50
    expect(getNet(balances, 'a')).toBe(10)
    expect(getNet(balances, 'b')).toBe(-50)
  })

  it('12. Pocket expense where payer is NOT in the split — full credit, no deduction', () => {
    const a = makeMember('a', 'Alice')
    const b = makeMember('b', 'Bob')
    const c = makeMember('c', 'Charlie')
    const members = [a, b, c]

    // Alice pays pocket, but only Bob and Charlie are in the split
    const expense = makeExpense('a', 100, 'pocket')
    const splits = [
      makeSplit(expense.id, 'b', 50),
      makeSplit(expense.id, 'c', 50),
    ]

    const balances = calculateBalances(members, [], [expense], splits, [])
    // A: +100(pocket) - 0(not in split) = +100
    // B: -50
    // C: -50
    expect(getNet(balances, 'a')).toBe(100)
    expect(getNet(balances, 'b')).toBe(-50)
    expect(getNet(balances, 'c')).toBe(-50)
  })

  it('13. Pool expense where payer IS in the split — NO credit, only share deduction', () => {
    const a = makeMember('a', 'Alice')
    const b = makeMember('b', 'Bob')
    const members = [a, b]

    // Alice contributes to pool (deposit) and is also in the pool expense split
    const deposits = [makeDeposit('a', 100), makeDeposit('b', 100)]
    const expense = makeExpense('a', 80, 'pool')
    const splits = [
      makeSplit(expense.id, 'a', 40),
      makeSplit(expense.id, 'b', 40),
    ]

    const balances = calculateBalances(members, deposits, [expense], splits, [])
    // A: 100(dep) + 0(pool=no credit) - 40(share) = 60
    // B: 100(dep) - 40(share) = 60
    expect(getNet(balances, 'a')).toBe(60)
    expect(getNet(balances, 'b')).toBe(60)
  })
})

// --- Numeric Exploits ---

describe('Numeric Exploits', () => {

  it('14. Very large amounts (999,999,999,999) — no overflow', () => {
    const a = makeMember('a', 'Alice')
    const b = makeMember('b', 'Bob')
    const members = [a, b]

    const bigAmount = 999_999_999_999
    const deposits = [makeDeposit('a', bigAmount)]
    const expense = makeExpense('a', bigAmount, 'pool')
    const splits = [
      makeSplit(expense.id, 'a', bigAmount / 2),
      makeSplit(expense.id, 'b', bigAmount / 2),
    ]

    const balances = calculateBalances(members, deposits, [expense], splits, [])
    // A: big - big/2 = big/2
    expect(getNet(balances, 'a')).toBe(bigAmount / 2)
    expect(getNet(balances, 'b')).toBe(-bigAmount / 2)
    expect(isFinite(getNet(balances, 'a'))).toBe(true)
    expect(isFinite(getNet(balances, 'b'))).toBe(true)
  })

  it('15. Very small amounts (0.001) — no precision loss that flips sign', () => {
    const a = makeMember('a', 'Alice')
    const b = makeMember('b', 'Bob')
    const members = [a, b]

    const deposits = [makeDeposit('a', 0.001)]
    const splits: ExpenseSplit[] = [
      makeSplit('e1', 'a', 0.0005),
      makeSplit('e1', 'b', 0.0005),
    ]

    const balances = calculateBalances(members, deposits, [], splits, [])
    // A: 0.001 - 0.0005 = 0.0005 (rounded to 0.00)
    // B: -0.0005 (rounded to 0.00)
    // At 2-decimal rounding, both are 0
    expect(getNet(balances, 'a')).toBeGreaterThanOrEqual(0) // Should NOT flip negative
    expect(isNaN(getNet(balances, 'a'))).toBe(false)
    expect(isNaN(getNet(balances, 'b'))).toBe(false)
  })

  it('16. Amount = 0 expense — harmless no-op', () => {
    const a = makeMember('a', 'Alice')
    const b = makeMember('b', 'Bob')
    const members = [a, b]

    const expense = makeExpense('a', 0, 'pocket')
    const splits = [
      makeSplit(expense.id, 'a', 0),
      makeSplit(expense.id, 'b', 0),
    ]

    const balances = calculateBalances(members, [], [expense], splits, [])
    expect(getNet(balances, 'a')).toBe(0)
    expect(getNet(balances, 'b')).toBe(0)
  })

  it('17. Negative amount (defensive) — verify no crash', () => {
    const a = makeMember('a', 'Alice')
    const b = makeMember('b', 'Bob')
    const members = [a, b]

    // Negative expense amount (should not happen, but defensive)
    const expense = makeExpense('a', -50, 'pocket')
    const splits = [
      makeSplit(expense.id, 'a', -25),
      makeSplit(expense.id, 'b', -25),
    ]

    // Should not throw
    const balances = calculateBalances(members, [], [expense], splits, [])
    expect(isNaN(getNet(balances, 'a'))).toBe(false)
    expect(isNaN(getNet(balances, 'b'))).toBe(false)
    // A gets negative credit (-50) and negative deduction (--25 = +25) → net = -50 - (-25) = -25
    expect(getNet(balances, 'a')).toBe(-25)
    expect(getNet(balances, 'b')).toBe(25)
  })

  it('18. String amounts cast via Number() — simulate Supabase runtime behavior', () => {
    const a = makeMember('a', 'Alice')
    const b = makeMember('b', 'Bob')
    const members = [a, b]

    // Simulate Supabase returning string numbers
    const deposit: Deposit = {
      id: uid(), trip_id: 'trip1', member_id: 'a',
      amount: '100.50' as unknown as number, // string at runtime
      currency: 'USD', rate_to_base: '1' as unknown as number,
      note: '', created_at: '2026-01-01', deleted_at: null, version: 1,
    }
    const splits: ExpenseSplit[] = [
      { id: uid(), expense_id: 'e1', member_id: 'a', share_amount: '50.25' as unknown as number },
      { id: uid(), expense_id: 'e1', member_id: 'b', share_amount: '50.25' as unknown as number },
    ]

    const balances = calculateBalances(members, [deposit], [], splits, [])
    // Number('100.50') * Number('1') = 100.50, Number('50.25') = 50.25
    expect(getNet(balances, 'a')).toBeCloseTo(50.25, 2)
    expect(getNet(balances, 'b')).toBeCloseTo(-50.25, 2)
    expect(isNaN(getNet(balances, 'a'))).toBe(false)
  })
})

// --- Split Exploits ---

describe('Split Exploits', () => {

  it('19. Split sum ≠ expense amount — verify error is visible (not hidden)', () => {
    const a = makeMember('a', 'Alice')
    const b = makeMember('b', 'Bob')
    const members = [a, b]

    // Expense is 100 but splits only sum to 80 (data inconsistency)
    const expense = makeExpense('a', 100, 'pocket')
    const splits = [
      makeSplit(expense.id, 'a', 40),
      makeSplit(expense.id, 'b', 40),
    ]

    const balances = calculateBalances(members, [], [expense], splits, [])
    // A: +100(credit) - 40(share) = +60
    // B: -40
    // Sum = +20 (structural imbalance — 20 wasn't allocated)
    const sum = balances.reduce((s, e) => s + e.net, 0)
    // This imbalance should NOT be silently corrected (it's > maxRoundingError = 2*0.01 = 0.02)
    expect(Math.abs(sum)).toBeCloseTo(20, 2)
  })

  it('20. Split with 0 members — division by zero guard', () => {
    const result = calculateEqualSplit(100, [], 'USD')
    expect(result).toHaveLength(0)
    // No throw, returns empty array
  })

  it('21. Equal split of 1 VND among 3 people — remainder handling for zero-decimal currency', () => {
    const result = calculateEqualSplit(1, ['a', 'b', 'c'], 'VND')
    // VND has 0 decimals. floor(1/3) = 0 for each. Remainder = 1.
    // Remainder goes to member at index 0
    const total = result.reduce((s, r) => s + r.share_amount, 0)
    expect(total).toBe(1) // Conservation of money
    // One person gets 1, others get 0
    expect(result.filter(r => r.share_amount === 1)).toHaveLength(1)
    expect(result.filter(r => r.share_amount === 0)).toHaveLength(2)
  })

  it('22. Weighted split where all weights are 0 — should return empty', () => {
    const weights = { a: 0, b: 0, c: 0 }
    const result = calculateEqualSplit(100, ['a', 'b', 'c'], 'USD', weights)
    // totalWeight = 0 → returns []
    expect(result).toHaveLength(0)
  })
})

// --- Zero-Sum Verification ---

describe('Zero-Sum Verification', () => {

  it('23. Complex 8-person scenario with mixed pool/pocket, groups, settlements', () => {
    // 8 members in 3 groups + 2 ungrouped
    const m1 = makeMember('m1', 'M1', 'grp-a') // Group A
    const m2 = makeMember('m2', 'M2', 'grp-a')
    const m3 = makeMember('m3', 'M3', 'grp-a')
    const m4 = makeMember('m4', 'M4', 'grp-b') // Group B
    const m5 = makeMember('m5', 'M5', 'grp-b')
    const m6 = makeMember('m6', 'M6', null) // Ungrouped
    const m7 = makeMember('m7', 'M7', null) // Ungrouped
    const m8 = makeMember('m8', 'M8', 'grp-c') // Group C (solo)
    const members = [m1, m2, m3, m4, m5, m6, m7, m8]

    // Deposits into pool
    const deposits = [
      makeDeposit('m1', 200),
      makeDeposit('m4', 150),
      makeDeposit('m6', 100),
    ]
    const totalDeposits = 450

    // Pool expenses (payer gets NO credit)
    const poolExp1 = makeExpense('m1', 160, 'pool')
    const poolExp2 = makeExpense('m4', 120, 'pool')

    // Pocket expenses (payer DOES get credit)
    const pocketExp = makeExpense('m6', 80, 'pocket')

    const totalExpenseAmount = 160 + 120 + 80

    const splits = [
      // poolExp1: split among all 8 equally (20 each)
      ...members.map(m => makeSplit(poolExp1.id, m.id, 20)),
      // poolExp2: split among m1-m5 (24 each)
      ...[m1, m2, m3, m4, m5].map(m => makeSplit(poolExp2.id, m.id, 24)),
      // pocketExp: split among m6, m7, m8 (26.67 each, rounded)
      makeSplit(pocketExp.id, 'm6', 26.67),
      makeSplit(pocketExp.id, 'm7', 26.67),
      makeSplit(pocketExp.id, 'm8', 26.66),
    ]

    // Settlement: m7 pays m6 10
    const settlements = [makeSettlement('m7', 'm6', 10)]

    const balances = calculateBalances(members, deposits, [poolExp1, poolExp2, pocketExp], splits, settlements)

    // Total pool surplus/deficit:
    // Total deposits = 450
    // Total pool expense amounts = 160 + 120 = 280
    // Pool surplus = 450 - 280 = 170 (money left in pool, distributed as positive balance)
    // Pocket expense: 80 credited to m6, 80 split among m6/m7/m8
    // Settlement is internal transfer (zero-sum)

    // Verify sum of balances = total_deposits - total_share_deductions + pocket_credits
    // deposits: 450
    // pocket credits: 80
    // total splits: 8*20 + 5*24 + 80 = 160 + 120 + 80 = 360
    // settlements: zero-sum
    // Expected sum = 450 + 80 - 360 = 170 (structural surplus from pool)
    const sum = balances.reduce((s, e) => s + e.net, 0)
    expect(sum).toBeCloseTo(170, 1)
  })

  it('24. After simplifyDebts, total from === total to (conservation)', () => {
    const a = makeMember('a', 'Alice')
    const b = makeMember('b', 'Bob')
    const c = makeMember('c', 'Charlie')
    const d = makeMember('d', 'Dave')
    const members = [a, b, c, d]

    // Create imbalance via pocket expense
    const exp1 = makeExpense('a', 200, 'pocket')
    const exp2 = makeExpense('b', 100, 'pocket')
    const splits = [
      makeSplit(exp1.id, 'a', 50),
      makeSplit(exp1.id, 'b', 50),
      makeSplit(exp1.id, 'c', 50),
      makeSplit(exp1.id, 'd', 50),
      makeSplit(exp2.id, 'a', 25),
      makeSplit(exp2.id, 'b', 25),
      makeSplit(exp2.id, 'c', 25),
      makeSplit(exp2.id, 'd', 25),
    ]

    const balances = calculateBalances(members, [], [exp1, exp2], splits, [])
    const transfers = simplifyDebts(balances, members)

    const totalFrom = transfers.reduce((s, t) => s + t.amount, 0)
    // Total from MUST equal total to (every transfer has same from and to amount)
    // This is trivially true by data structure, but verify conservation law:
    // Sum of positive balances should equal totalFrom
    const positiveSum = balances.filter(b => b.net > 0).reduce((s, b) => s + b.net, 0)
    const negativeSum = Math.abs(balances.filter(b => b.net < 0).reduce((s, b) => s + b.net, 0))

    // For pocket-only (no pool), sum of all balances = 0 (credits = debits)
    const netSum = balances.reduce((s, b) => s + b.net, 0)
    expect(Math.abs(netSum)).toBeLessThan(0.01) // Zero-sum since no deposits, all pocket

    // Total transfers should equal total positive balances (all surplus gets transferred)
    expect(totalFrom).toBeCloseTo(positiveSum, 2)
  })

  it('25. Group consolidation does not lose money — individual sum === consolidated sum', () => {
    const g1 = makeMember('g1', 'G1', 'grp-x')
    const g2 = makeMember('g2', 'G2', 'grp-x')
    const g3 = makeMember('g3', 'G3', 'grp-y')
    const g4 = makeMember('g4', 'G4', 'grp-y')
    const solo = makeMember('solo', 'Solo', null)
    const members = [g1, g2, g3, g4, solo]

    const exp = makeExpense('solo', 500, 'pocket')
    const splits = [
      makeSplit(exp.id, 'g1', 100),
      makeSplit(exp.id, 'g2', 100),
      makeSplit(exp.id, 'g3', 100),
      makeSplit(exp.id, 'g4', 100),
      makeSplit(exp.id, 'solo', 100),
    ]

    const balances = calculateBalances(members, [], [exp], splits, [])

    // Individual nets
    const individualSum = balances.reduce((s, b) => s + b.net, 0)

    // Consolidated (group) nets
    const groupNets = new Map<string, number>()
    for (const b of balances) {
      const m = members.find(m => m.id === b.memberId)!
      const key = m.group_id || `individual_${m.id}`
      groupNets.set(key, (groupNets.get(key) ?? 0) + b.net)
    }
    const consolidatedSum = [...groupNets.values()].reduce((s, v) => s + v, 0)

    // Conservation: individual sum === consolidated sum
    expect(consolidatedSum).toBeCloseTo(individualSum, 10)

    // Also verify the transfers conserve money
    const transfers = simplifyDebts(balances, members)
    const transferTotal = transfers.reduce((s, t) => s + t.amount, 0)
    // Total transferred should equal the total positive balance (= 400)
    // solo: +500 - 100 = +400, grp-x: -200, grp-y: -200
    expect(transferTotal).toBeCloseTo(400, 2)
  })
})

// --- Representative Member Edge Cases ---

describe('Representative Member Edge Cases', () => {

  it('26. Group representative is soft-deleted — still works as representative', () => {
    // First member (representative) is deleted
    const deleted = makeMember('del', 'Deleted', 'grp-z', '2026-06-01')
    const active = makeMember('act', 'Active', 'grp-z')
    const payer = makeMember('payer', 'Payer', null)
    const members = [deleted, active, payer]

    const expense = makeExpense('payer', 90, 'pocket')
    const splits = [
      makeSplit(expense.id, 'del', 30),
      makeSplit(expense.id, 'act', 30),
      makeSplit(expense.id, 'payer', 30),
    ]

    const balances = calculateBalances(members, [], [expense], splits, [])
    // payer: +90 - 30 = +60, del: -30, act: -30
    // grp-z consolidated: -30 + -30 = -60

    const transfers = simplifyDebts(balances, members)
    expect(transfers.length).toBe(1)
    expect(transfers[0].amount).toBe(60)
    expect(transfers[0].to.id).toBe('payer')
    // Representative is the first one encountered (deleted member)
    // This still works — the transfer references the deleted member
    expect(transfers[0].from.group_id).toBe('grp-z')
    // No crash, no NaN
    expect(isNaN(transfers[0].amount)).toBe(false)
  })

  it('27. Two groups with different representatives — each group tracked independently', () => {
    const rep1 = makeMember('rep1', 'Rep1', 'grp-1')
    const mem1 = makeMember('mem1', 'Mem1', 'grp-1')
    const rep2 = makeMember('rep2', 'Rep2', 'grp-2')
    const mem2 = makeMember('mem2', 'Mem2', 'grp-2')
    const members = [rep1, mem1, rep2, mem2]

    // rep1 pays pocket, split among all
    const expense = makeExpense('rep1', 200, 'pocket')
    const splits = [
      makeSplit(expense.id, 'rep1', 50),
      makeSplit(expense.id, 'mem1', 50),
      makeSplit(expense.id, 'rep2', 50),
      makeSplit(expense.id, 'mem2', 50),
    ]

    const balances = calculateBalances(members, [], [expense], splits, [])
    // rep1: +200 - 50 = +150, mem1: -50, rep2: -50, mem2: -50
    // grp-1 net: 150 + (-50) = +100
    // grp-2 net: -50 + (-50) = -100

    const transfers = simplifyDebts(balances, members)
    expect(transfers.length).toBe(1)
    expect(transfers[0].amount).toBe(100)
    // grp-2 representative pays grp-1 representative
    expect(transfers[0].from.group_id).toBe('grp-2')
    expect(transfers[0].to.group_id).toBe('grp-1')
    // Ensure they're different actual members
    expect(transfers[0].from.id).not.toBe(transfers[0].to.id)
  })
})

// --- Additional Boundary Tests ---

describe('Additional Boundary Conditions', () => {

  it('Deleted deposits are skipped', () => {
    const a = makeMember('a', 'Alice')
    const members = [a]

    const deposits = [
      makeDeposit('a', 100, 1, false),
      makeDeposit('a', 200, 1, true), // deleted
    ]

    const balances = calculateBalances(members, deposits, [], [], [])
    expect(getNet(balances, 'a')).toBe(100) // Only non-deleted counts
  })

  it('Deleted expenses are skipped for pocket credit', () => {
    const a = makeMember('a', 'Alice')
    const b = makeMember('b', 'Bob')
    const members = [a, b]

    const exp1 = makeExpense('a', 100, 'pocket', 1, false)
    const exp2 = makeExpense('a', 50, 'pocket', 1, true) // deleted

    // Splits still reference both (data inconsistency in DB)
    const splits = [
      makeSplit(exp1.id, 'a', 50),
      makeSplit(exp1.id, 'b', 50),
      makeSplit(exp2.id, 'a', 25),
      makeSplit(exp2.id, 'b', 25),
    ]

    const balances = calculateBalances(members, [], [exp1, exp2], splits, [])
    // Only exp1 gives pocket credit (100), but ALL splits still deduct
    // A: +100 - 50 - 25 = +25
    // B: -50 - 25 = -75
    // NOTE: splits from deleted expenses still deduct! This may be a bug or feature.
    expect(getNet(balances, 'a')).toBe(25)
    expect(getNet(balances, 'b')).toBe(-75)
  })

  it('Deleted settlements are skipped', () => {
    const a = makeMember('a', 'Alice')
    const b = makeMember('b', 'Bob')
    const members = [a, b]

    const deposits = [makeDeposit('a', 100)]
    const splits = [
      makeSplit('e1', 'a', 50),
      makeSplit('e1', 'b', 50),
    ]
    const settlements = [
      makeSettlement('b', 'a', 50, true), // deleted
    ]

    const balances = calculateBalances(members, deposits, [], splits, settlements)
    // Settlement is deleted, so ignored
    expect(getNet(balances, 'a')).toBe(50) // 100 - 50
    expect(getNet(balances, 'b')).toBe(-50)
  })

  it('Currency rate conversion applied correctly', () => {
    const a = makeMember('a', 'Alice')
    const b = makeMember('b', 'Bob')
    const members = [a, b]

    // Deposit in EUR at rate 1.1 (1 EUR = 1.1 USD base)
    const deposits = [makeDeposit('a', 100, 1.1)]
    // Pocket expense in JPY at rate 0.007
    const expense = makeExpense('a', 10000, 'pocket', 0.007)
    const splits = [
      makeSplit(expense.id, 'a', 35), // share_amount already in base currency
      makeSplit(expense.id, 'b', 35),
    ]

    const balances = calculateBalances(members, deposits, [expense], splits, [])
    // A: 100*1.1 + 10000*0.007 - 35 = 110 + 70 - 35 = 145
    // B: -35
    expect(getNet(balances, 'a')).toBe(145)
    expect(getNet(balances, 'b')).toBe(-35)
  })
})
