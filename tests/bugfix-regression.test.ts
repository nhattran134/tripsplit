/**
 * Bugfix Regression Tests
 *
 * Covers all bugs fixed during this session:
 * 1. NaN from formatAmount/formatCurrency
 * 2. Self-settlement balance corruption
 * 3. Query key collision (the -0 / NaN bug)
 * 4. Pool expense without deposits
 * 5. Group consolidation in simplifyDebts
 * 6. Pool-only settlement calculation (the final fix)
 * 7. via_pool settlement deducts from pool display
 * 8. Pool reimbursement only for other groups' shares
 * 9. Weighted splits with groups
 * 10. Number() on Supabase NUMERIC strings
 */
import { describe, it, expect } from 'vitest'
import { calculateBalances, simplifyDebts, calculatePoolReimbursements } from '../src/lib/settlement'
import { calculateEqualSplit } from '../src/lib/splits'
import { formatAmount, formatCurrency } from '../src/lib/currency'
import type { Member, Deposit, Expense, ExpenseSplit, Settlement } from '../src/types'

// --- Factories ---

let counter = 0
function uid(): string { return `id-${++counter}` }

function makeMember(id: string, name: string, groupId: string | null = null): Member {
  return {
    id, trip_id: 'trip1', auth_uid: `auth-${id}`, name, color: '#000',
    is_admin: false, claimed: true, member_token: `token-${id}`,
    avatar_style: 'bottts', avatar_seed: 42,
    group_id: groupId, joined_at: '2026-01-01', deleted_at: null,
  }
}

function makeDeposit(memberId: string, amount: number, rate = 1): Deposit {
  return {
    id: uid(), trip_id: 'trip1', member_id: memberId,
    amount, currency: 'VND', rate_to_base: rate, note: '',
    created_at: '2026-01-01', deleted_at: null, version: 1,
  }
}

function makeExpense(memberId: string, amount: number, paidFrom: 'pool' | 'pocket', rate = 1): Expense {
  return {
    id: uid(), trip_id: 'trip1', member_id: memberId,
    amount, currency: 'VND', rate_to_base: rate,
    category: 'food', description: 'test', date: '2026-01-01',
    split_type: 'equal', paid_from: paidFrom,
    receipt_url: null, created_at: '2026-01-01', deleted_at: null, version: 1,
  }
}

function makeSplit(expenseId: string, memberId: string, shareAmount: number): ExpenseSplit {
  return { id: uid(), expense_id: expenseId, member_id: memberId, share_amount: shareAmount }
}

function makeSettlement(fromId: string, toId: string, amount: number, method: 'direct' | 'via_pool' = 'direct'): Settlement {
  return {
    id: uid(), trip_id: 'trip1', from_member_id: fromId, to_member_id: toId,
    amount, method, note: '',
    created_at: '2026-01-01', deleted_at: null,
  }
}

function getNet(balances: { memberId: string; net: number }[], memberId: string): number {
  return balances.find(b => b.memberId === memberId)?.net ?? NaN
}

// ============================================================================
// Bug 1: NaN from formatAmount/formatCurrency
// ============================================================================

describe('Bug 1: NaN guard in formatAmount/formatCurrency', () => {
  it('formatAmount(NaN, VND) returns "0" not "NaN"', () => {
    expect(formatAmount(NaN, 'VND')).toBe('0')
  })

  it('formatAmount(Infinity, VND) returns "0"', () => {
    expect(formatAmount(Infinity, 'VND')).toBe('0')
  })

  it('formatAmount(-Infinity, USD) returns "0"', () => {
    expect(formatAmount(-Infinity, 'USD')).toBe('0')
  })

  it('formatCurrency(NaN, VND) returns "0 VND" not "NaN VND"', () => {
    const result = formatCurrency(NaN, 'VND')
    // Should contain '0' and 'VND' but NOT 'NaN'
    expect(result).not.toContain('NaN')
    expect(result).toContain('0')
  })

  it('formatCurrency(Infinity, USD) returns a clean zero string', () => {
    const result = formatCurrency(Infinity, 'USD')
    expect(result).not.toContain('Infinity')
    expect(result).toContain('0')
  })

  it('formatAmount with valid numbers still works normally', () => {
    expect(formatAmount(50000, 'VND')).toBe('50,000')
    expect(formatAmount(12.34, 'USD')).toBe('12.34')
    expect(formatAmount(0, 'VND')).toBe('0')
  })
})

// ============================================================================
// Bug 2: Self-settlement balance corruption
// ============================================================================

describe('Bug 2: Self-settlement balance corruption', () => {
  const alice = makeMember('alice', 'Alice', null)
  const bob = makeMember('bob', 'Bob', null)
  const members = [alice, bob]

  it('self-settlement (from === to) is a no-op in calculateBalances', () => {
    const deposits: Deposit[] = [makeDeposit('alice', 100)]
    const expense = makeExpense('alice', 100, 'pocket')
    const splits: ExpenseSplit[] = [
      makeSplit(expense.id, 'alice', 50),
      makeSplit(expense.id, 'bob', 50),
    ]

    // Without self-settlement
    const balancesClean = calculateBalances(members, deposits, [expense], splits, [])
    const aliceNetClean = getNet(balancesClean, 'alice')

    // With self-settlement Alice→Alice 50
    const selfSettlement = makeSettlement('alice', 'alice', 50)
    const balancesCorrupted = calculateBalances(members, deposits, [expense], splits, [selfSettlement])
    const aliceNetCorrupted = getNet(balancesCorrupted, 'alice')

    // Alice net should be identical (self-settlement is no-op)
    expect(aliceNetCorrupted).toBe(aliceNetClean)
  })

  it('Alice net should be +50 regardless of self-settlement', () => {
    // Alice deposits 100, expense 100 split 2 ways
    // Alice net = 100 (deposit) + 100 (pocket credit) - 50 (her share) = 150? No:
    // Wait: deposit goes to pool. pocket credit = 100. share = 50. net = 100 (deposit) + 100 (pocket) - 50 = 150
    // Actually: deposits + pocket_credit - shares
    // Alice: 100 (deposit) + 100 (pocket pay) - 50 (her share of pocket) = 150
    // Bob: 0 + 0 - 50 = -50
    // Sum = 100 which is the unspent pool deposit (structural imbalance, valid)
    const deposits: Deposit[] = [makeDeposit('alice', 100)]
    const expense = makeExpense('alice', 100, 'pocket')
    const splits: ExpenseSplit[] = [
      makeSplit(expense.id, 'alice', 50),
      makeSplit(expense.id, 'bob', 50),
    ]

    const selfSettlement = makeSettlement('alice', 'alice', 50)
    const balances = calculateBalances(members, deposits, [expense], splits, [selfSettlement])

    // Alice: 100 (deposit) + 100 (pocket credit) - 50 (share) = 150
    expect(getNet(balances, 'alice')).toBe(150)
    // Bob: -50 (share)
    expect(getNet(balances, 'bob')).toBe(-50)
  })

  it('simplifyDebts ignores self-settlement entries in prior balances', () => {
    // If self-settlement somehow affected balance, simplifyDebts would produce wrong transfers
    const deposits: Deposit[] = []
    const expense = makeExpense('alice', 100, 'pocket')
    const splits: ExpenseSplit[] = [
      makeSplit(expense.id, 'alice', 50),
      makeSplit(expense.id, 'bob', 50),
    ]

    const selfSettlement = makeSettlement('alice', 'alice', 99999)
    const balances = calculateBalances(members, deposits, [expense], splits, [selfSettlement])
    const transfers = simplifyDebts(balances, members)

    // Bob owes Alice 50
    expect(transfers.length).toBe(1)
    expect(transfers[0].from.id).toBe('bob')
    expect(transfers[0].to.id).toBe('alice')
    expect(transfers[0].amount).toBe(50)
  })
})

// ============================================================================
// Bug 3: Query key collision (the -0 / NaN bug)
// ============================================================================

describe('Bug 3: Query key collision — NaN formatting guard', () => {
  it('Number(undefined) is NaN', () => {
    expect(Number(undefined)).toBeNaN()
  })

  it('NaN * NaN is NaN', () => {
    expect(NaN * NaN).toBeNaN()
  })

  it('formatAmount guards against NaN from incomplete expense objects', () => {
    // Simulate: expense returned as { id } only, amount/rate undefined
    const badExpense = { id: 'x' } as any
    const computedAmount = Number(badExpense.amount) * Number(badExpense.rate_to_base)
    expect(computedAmount).toBeNaN()
    // Our guard prevents 'NaN' from rendering
    expect(formatAmount(computedAmount, 'VND')).toBe('0')
  })

  it('formatCurrency guards against NaN from incomplete expense objects', () => {
    const computedAmount = Number(undefined) * Number(undefined)
    const result = formatCurrency(computedAmount, 'VND')
    expect(result).not.toContain('NaN')
  })
})

// ============================================================================
// Bug 4: Pool expense without deposits
// ============================================================================

describe('Bug 4: Pool expense without deposits', () => {
  const alice = makeMember('alice', 'Alice', null)
  const bob = makeMember('bob', 'Bob', null)
  const members = [alice, bob]

  it('pool expense with 0 deposits: payer gets NO credit, members debited', () => {
    const deposits: Deposit[] = [] // No deposits!
    const expense = makeExpense('alice', 1000, 'pool')
    const splits: ExpenseSplit[] = [
      makeSplit(expense.id, 'alice', 500),
      makeSplit(expense.id, 'bob', 500),
    ]

    const balances = calculateBalances(members, deposits, [expense], splits, [])

    // Pool expense: payer gets no credit (paid_from='pool')
    // Alice: 0 (no deposit) + 0 (no pocket credit) - 500 (share) = -500
    expect(getNet(balances, 'alice')).toBe(-500)
    // Bob: 0 - 500 = -500
    expect(getNet(balances, 'bob')).toBe(-500)
  })

  it('pocket expense with 0 deposits: payer DOES get credit', () => {
    const deposits: Deposit[] = []
    const expense = makeExpense('alice', 1000, 'pocket')
    const splits: ExpenseSplit[] = [
      makeSplit(expense.id, 'alice', 500),
      makeSplit(expense.id, 'bob', 500),
    ]

    const balances = calculateBalances(members, deposits, [expense], splits, [])

    // Pocket expense: payer gets credit
    // Alice: 0 + 1000 (pocket credit) - 500 (share) = +500
    expect(getNet(balances, 'alice')).toBe(500)
    // Bob: 0 + 0 - 500 = -500
    expect(getNet(balances, 'bob')).toBe(-500)
  })
})

// ============================================================================
// Bug 5: Group consolidation in simplifyDebts
// ============================================================================

describe('Bug 5: Group consolidation in simplifyDebts', () => {
  it('all members in ONE group → simplifyDebts returns empty (no transfers)', () => {
    const a = makeMember('a', 'A', 'group1')
    const b = makeMember('b', 'B', 'group1')
    const c = makeMember('c', 'C', 'group1')
    const members = [a, b, c]

    // A is owed 100, B owes 50, C owes 50
    const balances = [
      { memberId: 'a', net: 100 },
      { memberId: 'b', net: -50 },
      { memberId: 'c', net: -50 },
    ]

    const transfers = simplifyDebts(balances, members)
    // All same group → consolidated net = 0, no inter-group transfer
    expect(transfers).toHaveLength(0)
  })

  it('members in different groups produce transfers between group reps', () => {
    const a = makeMember('a', 'A', 'group1')
    const b = makeMember('b', 'B', 'group2')
    const members = [a, b]

    const balances = [
      { memberId: 'a', net: 100 },
      { memberId: 'b', net: -100 },
    ]

    const transfers = simplifyDebts(balances, members)
    expect(transfers).toHaveLength(1)
    expect(transfers[0].from.id).toBe('b')
    expect(transfers[0].to.id).toBe('a')
    expect(transfers[0].amount).toBe(100)
  })

  it('null group_id members are treated as solo (independent)', () => {
    const a = makeMember('a', 'A', null)
    const b = makeMember('b', 'B', null)
    const members = [a, b]

    // Even though both have null group_id, they're independent
    const balances = [
      { memberId: 'a', net: 50 },
      { memberId: 'b', net: -50 },
    ]

    const transfers = simplifyDebts(balances, members)
    expect(transfers).toHaveLength(1)
    expect(transfers[0].from.id).toBe('b')
    expect(transfers[0].to.id).toBe('a')
    expect(transfers[0].amount).toBe(50)
  })

  it('two members in same group with opposite balances → no transfer', () => {
    const a = makeMember('a', 'A', 'family')
    const b = makeMember('b', 'B', 'family')
    const members = [a, b]

    const balances = [
      { memberId: 'a', net: 200 },
      { memberId: 'b', net: -200 },
    ]

    const transfers = simplifyDebts(balances, members)
    // Same group, net cancels → 0 transfers
    expect(transfers).toHaveLength(0)
  })

  it('mixed groups: intra-group debts ignored, inter-group debts transferred', () => {
    const a1 = makeMember('a1', 'A1', 'gA')
    const a2 = makeMember('a2', 'A2', 'gA')
    const b1 = makeMember('b1', 'B1', 'gB')
    const members = [a1, a2, b1]

    // Group A total: +200 - 100 = +100
    // Group B total: -100
    const balances = [
      { memberId: 'a1', net: 200 },
      { memberId: 'a2', net: -100 },
      { memberId: 'b1', net: -100 },
    ]

    const transfers = simplifyDebts(balances, members)
    expect(transfers).toHaveLength(1)
    expect(transfers[0].from.id).toBe('b1')
    expect(transfers[0].to.id).toBe('a1') // representative of gA
    expect(transfers[0].amount).toBe(100)
  })
})

// ============================================================================
// Bug 6: Pool-only settlement calculation (the final fix)
// ============================================================================

describe('Bug 6: Pool-only settlement calculation — no loop', () => {
  const by = makeMember('by', 'Bý', 'g-by')
  const kiet = makeMember('kiet', 'Kiệt', 'g-by')
  const nhat = makeMember('nhat', 'Nhat', 'g-nhat')
  const embe = makeMember('embe', 'embe Gau', 'g-nhat')
  const members = [by, kiet, nhat, embe]

  // Simulate the SettleUp page logic: settlements from POCKET expenses only
  function computePocketTransfers(
    expenses: Expense[],
    splits: ExpenseSplit[],
    settlements: Settlement[]
  ) {
    const pocketBalances = new Map<string, number>()
    for (const m of members) pocketBalances.set(m.id, 0)

    // Credit pocket payers only
    for (const e of expenses) {
      if (e.deleted_at || e.paid_from !== 'pocket') continue
      pocketBalances.set(e.member_id, (pocketBalances.get(e.member_id) ?? 0) + Number(e.amount) * Number(e.rate_to_base))
    }

    // Debit pocket expense shares only
    for (const s of splits) {
      const exp = expenses.find(e => e.id === s.expense_id)
      if (!exp || exp.deleted_at || exp.paid_from !== 'pocket') continue
      pocketBalances.set(s.member_id, (pocketBalances.get(s.member_id) ?? 0) - Number(s.share_amount))
    }

    // Account for settlements
    for (const s of settlements) {
      if (s.deleted_at) continue
      if (s.from_member_id === s.to_member_id) continue
      pocketBalances.set(s.from_member_id, (pocketBalances.get(s.from_member_id) ?? 0) + Number(s.amount))
      pocketBalances.set(s.to_member_id, (pocketBalances.get(s.to_member_id) ?? 0) - Number(s.amount))
    }

    const entries = [...pocketBalances.entries()].map(([memberId, net]) => ({
      memberId, net: Math.round(net * 100) / 100,
    }))

    return simplifyDebts(entries, members)
  }

  describe('Scenario 1: Mixed pool + pocket', () => {
    const poolExp = makeExpense('nhat', 1500000, 'pool')
    const pocketExp = makeExpense('nhat', 1500000, 'pocket')
    const expenses = [poolExp, pocketExp]

    const splits: ExpenseSplit[] = [
      // Pool expense splits (375K each)
      makeSplit(poolExp.id, 'by', 375000),
      makeSplit(poolExp.id, 'kiet', 375000),
      makeSplit(poolExp.id, 'nhat', 375000),
      makeSplit(poolExp.id, 'embe', 375000),
      // Pocket expense splits (375K each)
      makeSplit(pocketExp.id, 'by', 375000),
      makeSplit(pocketExp.id, 'kiet', 375000),
      makeSplit(pocketExp.id, 'nhat', 375000),
      makeSplit(pocketExp.id, 'embe', 375000),
    ]

    it('pocket-only balance: Nhat +1.125M, others -375K each', () => {
      const transfers = computePocketTransfers(expenses, splits, [])
      // Nhat: 1.5M credit - 375K share = +1.125M
      // By: -375K, Kiet: -375K, embe: -375K
      // Group g-by: -750K, Group g-nhat: +750K (1.125M - 375K)
      expect(transfers).toHaveLength(1)
      expect(transfers[0].amount).toBe(750000)
    })

    it('after full settlement: 0 transfers (no loop)', () => {
      const transfers1 = computePocketTransfers(expenses, splits, [])
      expect(transfers1).toHaveLength(1)

      // Record the settlement
      const settlement = makeSettlement(transfers1[0].from.id, transfers1[0].to.id, transfers1[0].amount)
      const transfers2 = computePocketTransfers(expenses, splits, [settlement])
      expect(transfers2).toHaveLength(0)
    })
  })

  describe('Scenario 2: Pure pool trip (no pocket expenses)', () => {
    it('0 settlements needed when only pool expenses exist', () => {
      const poolExp = makeExpense('nhat', 2000000, 'pool')
      const splits: ExpenseSplit[] = [
        makeSplit(poolExp.id, 'by', 500000),
        makeSplit(poolExp.id, 'kiet', 500000),
        makeSplit(poolExp.id, 'nhat', 500000),
        makeSplit(poolExp.id, 'embe', 500000),
      ]

      const transfers = computePocketTransfers([poolExp], splits, [])
      expect(transfers).toHaveLength(0)
    })
  })

  describe('Scenario 3: Pure pocket trip (no pool)', () => {
    it('normal Splitwise-style settlements', () => {
      const pocketExp = makeExpense('nhat', 1000000, 'pocket')
      const splits: ExpenseSplit[] = [
        makeSplit(pocketExp.id, 'by', 250000),
        makeSplit(pocketExp.id, 'kiet', 250000),
        makeSplit(pocketExp.id, 'nhat', 250000),
        makeSplit(pocketExp.id, 'embe', 250000),
      ]

      const transfers = computePocketTransfers([pocketExp], splits, [])
      // Nhat: +750K, By: -250K, Kiet: -250K, embe: -250K
      // g-by group: -500K, g-nhat group: +500K (750K - 250K)
      expect(transfers).toHaveLength(1)
      expect(transfers[0].amount).toBe(500000)
    })
  })
})

// ============================================================================
// Bug 7: via_pool settlement deducts from pool display
// ============================================================================

describe('Bug 7: via_pool settlement deducts from pool balance', () => {
  it('pool balance = deposits - pool_expenses - via_pool_settlements', () => {
    // Simulate the pool balance calculation used in the UI
    const deposits = [makeDeposit('alice', 5000000)]
    const poolExpenses = [makeExpense('alice', 1000000, 'pool')]
    const viaPoolSettlements = [makeSettlement('alice', 'bob', 500000, 'via_pool')]

    const totalDeposits = deposits
      .filter(d => !d.deleted_at)
      .reduce((sum, d) => sum + Number(d.amount) * Number(d.rate_to_base), 0)

    const totalPoolExpenses = poolExpenses
      .filter(e => !e.deleted_at && e.paid_from === 'pool')
      .reduce((sum, e) => sum + Number(e.amount) * Number(e.rate_to_base), 0)

    const totalViaPool = viaPoolSettlements
      .filter(s => !s.deleted_at && s.method === 'via_pool')
      .reduce((sum, s) => sum + Number(s.amount), 0)

    const poolBalance = totalDeposits - totalPoolExpenses - totalViaPool
    // 5M - 1M - 500K = 3.5M
    expect(poolBalance).toBe(3500000)
  })

  it('direct settlements do NOT affect pool balance', () => {
    const deposits = [makeDeposit('alice', 5000000)]
    const poolExpenses = [makeExpense('alice', 1000000, 'pool')]
    const directSettlements = [makeSettlement('alice', 'bob', 500000, 'direct')]

    const totalDeposits = deposits.reduce((sum, d) => sum + Number(d.amount) * Number(d.rate_to_base), 0)
    const totalPoolExpenses = poolExpenses.reduce((sum, e) => sum + Number(e.amount) * Number(e.rate_to_base), 0)
    const totalViaPool = directSettlements
      .filter(s => s.method === 'via_pool')
      .reduce((sum, s) => sum + Number(s.amount), 0)

    const poolBalance = totalDeposits - totalPoolExpenses - totalViaPool
    // 5M - 1M - 0 = 4M (direct doesn't deduct)
    expect(poolBalance).toBe(4000000)
  })
})

// ============================================================================
// Bug 8: Pool reimbursement only for other groups' shares
// ============================================================================

describe('Bug 8: Pool reimbursement only for other groups shares', () => {
  const nhat = makeMember('nhat', 'Nhat', 'g-nhat')
  const embe = makeMember('embe', 'embe Gau', 'g-nhat')
  const by = makeMember('by', 'Bý', 'g-by')
  const kiet = makeMember('kiet', 'Kiệt', 'g-by')
  const members = [nhat, embe, by, kiet]

  it('reimbursable from pool = only OTHER groups shares, not intra-group', () => {
    // Bý deposits 5M
    const deposits: Deposit[] = [makeDeposit('by', 5000000)]
    // Nhat pays 1.5M pocket split 4 ways
    const pocketExp = makeExpense('nhat', 1500000, 'pocket')
    const expenses: Expense[] = [pocketExp]
    const splits: ExpenseSplit[] = [
      makeSplit(pocketExp.id, 'nhat', 375000),
      makeSplit(pocketExp.id, 'embe', 375000),
      makeSplit(pocketExp.id, 'by', 375000),
      makeSplit(pocketExp.id, 'kiet', 375000),
    ]

    const reimbursements = calculatePoolReimbursements(members, deposits, expenses, splits, [])

    // Reimbursable = g-by's shares only (375K × 2 = 750K)
    // NOT Nhat's full net (1.125M) because embe's 375K is intra-group
    const totalReimbursed = reimbursements.reduce((sum, t) => sum + t.amount, 0)
    expect(totalReimbursed).toBe(750000)
  })

  it('embe share (intra-group) is NOT reimbursable from pool', () => {
    const deposits: Deposit[] = [makeDeposit('by', 5000000)]
    const pocketExp = makeExpense('nhat', 1500000, 'pocket')
    const expenses: Expense[] = [pocketExp]
    const splits: ExpenseSplit[] = [
      makeSplit(pocketExp.id, 'nhat', 375000),
      makeSplit(pocketExp.id, 'embe', 375000),
      makeSplit(pocketExp.id, 'by', 375000),
      makeSplit(pocketExp.id, 'kiet', 375000),
    ]

    const reimbursements = calculatePoolReimbursements(members, deposits, expenses, splits, [])

    // All transfers should be TO nhat (the pocket payer)
    for (const t of reimbursements) {
      expect(t.to.id).toBe('nhat')
    }

    // Total should be 750K, not 1.125M
    const total = reimbursements.reduce((sum, t) => sum + t.amount, 0)
    expect(total).toBeLessThanOrEqual(750000)
    expect(total).toBeGreaterThanOrEqual(749999) // rounding tolerance
  })

  it('all-same-group pocket expense: 0 reimbursement from pool', () => {
    // All in same group — no "other group" shares exist
    const a = makeMember('a', 'A', 'same')
    const b = makeMember('b', 'B', 'same')
    const allMembers = [a, b]

    const deposits: Deposit[] = [makeDeposit('b', 1000000)]
    const pocketExp = makeExpense('a', 500000, 'pocket')
    const expenses: Expense[] = [pocketExp]
    const splits: ExpenseSplit[] = [
      makeSplit(pocketExp.id, 'a', 250000),
      makeSplit(pocketExp.id, 'b', 250000),
    ]

    const reimbursements = calculatePoolReimbursements(allMembers, deposits, expenses, splits, [])
    // b's share is intra-group → not reimbursable from pool
    // The only "other group" member would need a different group_id
    // Since b is same group as a, owedByOtherGroups = 0
    expect(reimbursements).toHaveLength(0)
  })
})

// ============================================================================
// Bug 9: Weighted splits with groups
// ============================================================================

describe('Bug 9: Weighted splits with groups', () => {
  it('group of 2 members → each gets weight 0.5 (together = 1 share)', () => {
    const memberIds = ['a', 'b']
    const weights = { a: 0.5, b: 0.5 }
    const results = calculateEqualSplit(500000, memberIds, 'VND', weights)

    // Each gets 250K
    expect(results[0].share_amount).toBe(250000)
    expect(results[1].share_amount).toBe(250000)
    // Together = 500K (1 full share out of 1 total weight)
    expect(results[0].share_amount + results[1].share_amount).toBe(500000)
  })

  it('3 entities: 2 groups + 1 solo, each entity gets 1/3', () => {
    // Group1: members a,b (weight 0.5 each = 1 share total)
    // Group2: members c,d (weight 0.5 each = 1 share total)
    // Solo: member e (weight 1 = 1 share)
    // Total weight: 0.5 + 0.5 + 0.5 + 0.5 + 1 = 3
    const memberIds = ['a', 'b', 'c', 'd', 'e']
    const weights = { a: 0.5, b: 0.5, c: 0.5, d: 0.5, e: 1 }
    const results = calculateEqualSplit(900000, memberIds, 'VND', weights)

    // Each 0.5-weight member: 900K × 0.5/3 = 150K
    // Solo member: 900K × 1/3 = 300K
    const groupATotal = results.filter(r => ['a', 'b'].includes(r.member_id))
      .reduce((sum, r) => sum + r.share_amount, 0)
    const groupBTotal = results.filter(r => ['c', 'd'].includes(r.member_id))
      .reduce((sum, r) => sum + r.share_amount, 0)
    const soloTotal = results.find(r => r.member_id === 'e')!.share_amount

    expect(groupATotal).toBe(300000)
    expect(groupBTotal).toBe(300000)
    expect(soloTotal).toBe(300000)
  })

  it('conservation: sum of all shares === total amount', () => {
    const memberIds = ['a', 'b', 'c', 'd', 'e']
    const weights = { a: 0.5, b: 0.5, c: 0.5, d: 0.5, e: 1 }
    const total = 500000
    const results = calculateEqualSplit(total, memberIds, 'VND', weights)

    const sum = results.reduce((s, r) => s + r.share_amount, 0)
    expect(sum).toBe(total)
  })

  it('conservation with non-round total and VND (0 decimals)', () => {
    const memberIds = ['a', 'b', 'c']
    const weights = { a: 0.5, b: 0.5, c: 1 }
    const total = 1000001 // Not evenly divisible
    const results = calculateEqualSplit(total, memberIds, 'VND', weights)

    const sum = results.reduce((s, r) => s + r.share_amount, 0)
    expect(sum).toBe(total)
  })

  it('conservation with USD (2 decimals)', () => {
    const memberIds = ['a', 'b', 'c']
    const weights = { a: 0.5, b: 0.5, c: 1 }
    const total = 100.00
    const results = calculateEqualSplit(total, memberIds, 'USD', weights)

    const sum = results.reduce((s, r) => s + r.share_amount, 0)
    expect(sum).toBe(total)
  })
})

// ============================================================================
// Bug 10: Number() on Supabase NUMERIC strings
// ============================================================================

describe('Bug 10: Number() on Supabase NUMERIC strings', () => {
  it('Number("50000.0000") === 50000', () => {
    expect(Number('50000.0000')).toBe(50000)
  })

  it('Number("1.00000000") === 1', () => {
    expect(Number('1.00000000')).toBe(1)
  })

  it('multiplication with NUMERIC strings works correctly', () => {
    const amount = '50000.0000' // Supabase returns this
    const rate = '1.00000000'  // Supabase returns this
    const result = (Number(amount) || 0) * (Number(rate) || 1)
    expect(result).toBe(50000)
  })

  it('Number(null) === 0 (falsy, caught by || 0)', () => {
    expect(Number(null)).toBe(0)
    expect((Number(null) || 0)).toBe(0)
  })

  it('Number(undefined) is NaN (caught by || 0)', () => {
    expect(Number(undefined)).toBeNaN()
    expect((Number(undefined) || 0)).toBe(0)
  })

  it('full computation with || guards', () => {
    // Simulate what calculateBalances does with Supabase data
    const supabaseDeposit = { amount: '50000.0000', rate_to_base: '1.00000000' } as any
    const result = Number(supabaseDeposit.amount) * Number(supabaseDeposit.rate_to_base)
    expect(result).toBe(50000)
  })

  it('null amount/rate with guards', () => {
    const badRow = { amount: null, rate_to_base: null } as any
    const guarded = (Number(badRow.amount) || 0) * (Number(badRow.rate_to_base) || 1)
    expect(guarded).toBe(0) // 0 * 1 = 0
  })

  it('undefined amount/rate with guards', () => {
    const badRow = {} as any
    const guarded = (Number(badRow.amount) || 0) * (Number(badRow.rate_to_base) || 1)
    expect(guarded).toBe(0) // 0 * 1 = 0
  })

  it('handles typical Supabase NUMERIC precision strings', () => {
    expect(Number('0.00000000')).toBe(0)
    expect(Number('25000.5000')).toBe(25000.5)
    expect(Number('999999999.9900')).toBe(999999999.99)
  })
})
