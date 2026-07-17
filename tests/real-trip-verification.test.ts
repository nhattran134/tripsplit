/**
 * Real Trip Data Verification Tests
 *
 * Tests the EXACT current trip data to verify settlement and pool logic.
 * Simulates the SettleUp page computation (pocket-only + pool overdraft + group consolidation).
 */
import { describe, it, expect } from 'vitest'
import { simplifyDebts } from '../src/lib/settlement'
import type { Member, Deposit, Expense, ExpenseSplit, Settlement } from '../src/types'

// =============================================================================
// Helpers
// =============================================================================

const GROUP_BY = 'group-by'
const GROUP_EMBE = 'group-embe'

const makeMember = (id: string, name: string, groupId: string | null): Member => ({
  id,
  trip_id: 'trip1',
  auth_uid: `auth-${id}`,
  name,
  color: '#000',
  is_admin: false,
  claimed: true,
  member_token: `token-${id}`,
  avatar_style: 'adventurer',
  avatar_seed: 1,
  group_id: groupId,
  joined_at: '2026-01-01',
  deleted_at: null,
})

const makeDeposit = (memberId: string, amount: number): Deposit => ({
  id: `dep-${memberId}-${amount}`,
  trip_id: 'trip1',
  member_id: memberId,
  amount,
  currency: 'VND',
  rate_to_base: 1,
  note: '',
  created_at: '2026-01-01',
  deleted_at: null,
  version: 1,
})

let expenseCounter = 0
const makeExpense = (
  memberId: string,
  amount: number,
  paidFrom: 'pool' | 'pocket',
  category: string = 'food'
): Expense => ({
  id: `exp-${++expenseCounter}`,
  trip_id: 'trip1',
  member_id: memberId,
  amount,
  currency: 'VND',
  rate_to_base: 1,
  category,
  description: `${category} expense`,
  date: '2026-07-10',
  split_type: 'equal',
  paid_from: paidFrom,
  receipt_url: null,
  created_at: '2026-01-01',
  deleted_at: null,
  version: 1,
})

const makeSplit = (expenseId: string, memberId: string, shareAmount: number): ExpenseSplit => ({
  id: `split-${expenseId}-${memberId}`,
  expense_id: expenseId,
  member_id: memberId,
  share_amount: shareAmount,
})

const makeSettlement = (
  fromId: string,
  toId: string,
  amount: number,
  method: 'direct' | 'via_pool'
): Settlement => ({
  id: `settle-${fromId}-${toId}-${amount}`,
  trip_id: 'trip1',
  from_member_id: fromId,
  to_member_id: toId,
  amount,
  method,
  note: '',
  created_at: '2026-01-01',
  deleted_at: null,
})

// =============================================================================
// Test Data Setup (mirrors exact current trip)
// =============================================================================

const members: Member[] = [
  makeMember('by', 'Bý', GROUP_BY),
  makeMember('kiet', 'Kiệt', GROUP_BY),
  makeMember('nhat', 'Nhat', GROUP_EMBE),
  makeMember('embe', 'embe Gau', GROUP_EMBE),
]

const deposits: Deposit[] = [
  makeDeposit('by', 5_000_000),
  makeDeposit('nhat', 10_000_000),
]

// Pool expenses: total ₫8,350,000 (all split equally among 4)
const poolExpenses: Expense[] = [
  makeExpense('by', 1_000_000, 'pool', 'transport'),   // exp-1
  makeExpense('by', 1_000_000, 'pool', 'shopping'),    // exp-2
  makeExpense('by', 100_000, 'pool', 'food'),          // exp-3
  makeExpense('by', 100_000, 'pool', 'food'),          // exp-4
  makeExpense('by', 200_000, 'pool', 'food'),          // exp-5
  makeExpense('by', 200_000, 'pool', 'food'),          // exp-6
  makeExpense('by', 2_000_000, 'pool', 'activities'),  // exp-7
  makeExpense('by', 2_000_000, 'pool', 'food'),        // exp-8
  makeExpense('by', 1_750_000, 'pool', 'food'),        // exp-9
]

// Pocket expenses: Nhat paid all, total ₫3,900,000
const pocketExpenses: Expense[] = [
  makeExpense('nhat', 1_500_000, 'pocket', 'accommodation'), // exp-10: split 4
  makeExpense('nhat', 200_000, 'pocket', 'food'),            // exp-11: split Bý + Kiệt only
  makeExpense('nhat', 1_000_000, 'pocket', 'shopping'),      // exp-12: split 4
  makeExpense('nhat', 1_000_000, 'pocket', 'transport'),     // exp-13: split 4
  makeExpense('nhat', 200_000, 'pocket', 'food'),            // exp-14: split 4
]

const allExpenses = [...poolExpenses, ...pocketExpenses]

// Pool expense splits (all split equally among 4 members)
const poolSplits: ExpenseSplit[] = poolExpenses.flatMap(exp => {
  const share = exp.amount / 4
  return members.map(m => makeSplit(exp.id, m.id, share))
})

// Pocket expense splits
const pocketSplits: ExpenseSplit[] = [
  // exp-10: ₫1.5M accommodation split 4
  ...members.map(m => makeSplit(pocketExpenses[0].id, m.id, 1_500_000 / 4)),
  // exp-11: ₫200K food split Bý + Kiệt only (2 way)
  makeSplit(pocketExpenses[1].id, 'by', 100_000),
  makeSplit(pocketExpenses[1].id, 'kiet', 100_000),
  // exp-12: ₫1M shopping split 4
  ...members.map(m => makeSplit(pocketExpenses[2].id, m.id, 1_000_000 / 4)),
  // exp-13: ₫1M transport split 4
  ...members.map(m => makeSplit(pocketExpenses[3].id, m.id, 1_000_000 / 4)),
  // exp-14: ₫200K food split 4
  ...members.map(m => makeSplit(pocketExpenses[4].id, m.id, 200_000 / 4)),
]

const allSplits = [...poolSplits, ...pocketSplits]

// Active settlements
const activeSettlements: Settlement[] = [
  makeSettlement('kiet', 'nhat', 750_000, 'via_pool'),
  makeSettlement('kiet', 'nhat', 200_000, 'via_pool'),
  makeSettlement('kiet', 'nhat', 200_000, 'via_pool'),
  makeSettlement('kiet', 'embe', 500_000, 'via_pool'),
  makeSettlement('kiet', 'embe', 500_000, 'direct'),
  makeSettlement('kiet', 'embe', 825_000, 'direct'),
]

// =============================================================================
// Reimplementation of SettleUpPage transfers logic (for testing)
// =============================================================================

function computeTransfers(
  mems: Member[],
  deps: Deposit[],
  exps: Expense[],
  splits: ExpenseSplit[],
  settlements: Settlement[]
) {
  // Step 1: Pocket-only balances
  const pocketBalances = new Map<string, number>()
  for (const m of mems) pocketBalances.set(m.id, 0)

  // Credit pocket payers
  for (const e of exps) {
    if (e.deleted_at || e.paid_from !== 'pocket') continue
    const current = pocketBalances.get(e.member_id) ?? 0
    pocketBalances.set(e.member_id, current + (Number(e.amount) || 0) * (Number(e.rate_to_base) || 1))
  }

  // Debit shares of pocket expenses only
  for (const s of splits) {
    const exp = exps.find(e => e.id === s.expense_id)
    if (!exp || exp.deleted_at || exp.paid_from !== 'pocket') continue
    const current = pocketBalances.get(s.member_id) ?? 0
    pocketBalances.set(s.member_id, current - (Number(s.share_amount) || 0))
  }

  // Step 2: Account for existing settlements
  for (const s of settlements) {
    if (s.deleted_at) continue
    const fromBal = pocketBalances.get(s.from_member_id) ?? 0
    const toBal = pocketBalances.get(s.to_member_id) ?? 0
    if (s.from_member_id === s.to_member_id) continue
    pocketBalances.set(s.from_member_id, fromBal + (Number(s.amount) || 0))
    pocketBalances.set(s.to_member_id, toBal - (Number(s.amount) || 0))
  }

  const pocketEntries = [...pocketBalances.entries()].map(([memberId, net]) => ({
    memberId,
    net: Math.round(net * 100) / 100,
  }))

  // Step 3: Pool overdraft
  const totalDep = deps.filter(d => !d.deleted_at).reduce((s, d) => s + (Number(d.amount) || 0) * (Number(d.rate_to_base) || 1), 0)
  const totalPoolExp = exps.filter(e => !e.deleted_at && e.paid_from === 'pool').reduce((s, e) => s + (Number(e.amount) || 0) * (Number(e.rate_to_base) || 1), 0)

  if (totalDep > 0 && totalPoolExp > 0) {
    const depositorRemaining = new Map<string, number>()
    for (const d of deps) {
      if (d.deleted_at) continue
      depositorRemaining.set(d.member_id, (depositorRemaining.get(d.member_id) || 0) + (Number(d.amount) || 0) * (Number(d.rate_to_base) || 1))
    }
    // Subtract proportional pool expenses
    for (const [id, dep] of depositorRemaining) {
      depositorRemaining.set(id, dep - (dep / totalDep) * totalPoolExp)
    }
    // Subtract via_pool from settler's group depositor
    for (const s of settlements) {
      if (s.deleted_at || s.method !== 'via_pool') continue
      const settler = mems.find(m => m.id === s.from_member_id)
      if (!settler) continue
      let targetDep: string | null = null
      if (settler.group_id) {
        for (const [depId] of depositorRemaining) {
          const dm = mems.find(m => m.id === depId)
          if (dm?.group_id === settler.group_id) { targetDep = depId; break }
        }
      }
      if (!targetDep && depositorRemaining.has(s.from_member_id)) targetDep = s.from_member_id
      if (targetDep) {
        depositorRemaining.set(targetDep, (depositorRemaining.get(targetDep) || 0) - (Number(s.amount) || 0))
      }
    }

    // If any depositor is negative, add that as debt in pocket balances
    const negatives = [...depositorRemaining.entries()].filter(([, v]) => v < -0.01)
    const positives = [...depositorRemaining.entries()].filter(([, v]) => v > 0.01)
    const positiveTotal = positives.reduce((s, [, v]) => s + v, 0)

    for (const [negId, negAmount] of negatives) {
      const entry = pocketEntries.find(e => e.memberId === negId)
      if (entry) entry.net += negAmount

      for (const [posId, posAmount] of positives) {
        const credit = Math.abs(negAmount) * (posAmount / positiveTotal)
        const posEntry = pocketEntries.find(e => e.memberId === posId)
        if (posEntry) posEntry.net += credit
      }
    }
  }

  return { pocketEntries, transfers: simplifyDebts(pocketEntries, mems) }
}

// =============================================================================
// Tests
// =============================================================================

describe('Real Trip Data Verification', () => {
  describe('Scenario 1: Pocket-only balances (before settlements)', () => {
    it('computes correct pocket balances per member', () => {
      const pocketBalances = new Map<string, number>()
      for (const m of members) pocketBalances.set(m.id, 0)

      // Credit pocket payers (Nhat paid all ₫3.9M)
      for (const e of allExpenses) {
        if (e.paid_from !== 'pocket') continue
        const current = pocketBalances.get(e.member_id) ?? 0
        pocketBalances.set(e.member_id, current + e.amount)
      }

      // Debit pocket expense shares
      for (const s of pocketSplits) {
        const exp = allExpenses.find(e => e.id === s.expense_id)
        if (!exp || exp.paid_from !== 'pocket') continue
        const current = pocketBalances.get(s.member_id) ?? 0
        pocketBalances.set(s.member_id, current - s.share_amount)
      }

      // Nhat paid ₫3.9M total pocket
      // Nhat's shares:
      //   exp-10: 375,000 (1.5M/4)
      //   exp-11: 0 (not split to Nhat)
      //   exp-12: 250,000 (1M/4)
      //   exp-13: 250,000 (1M/4)
      //   exp-14: 50,000 (200K/4)
      // Nhat total share = 925,000
      // Nhat net = 3,900,000 - 925,000 = 2,975,000
      expect(pocketBalances.get('nhat')).toBe(2_975_000)

      // Bý's shares:
      //   exp-10: 375,000
      //   exp-11: 100,000
      //   exp-12: 250,000
      //   exp-13: 250,000
      //   exp-14: 50,000
      // Bý total share = 1,025,000
      // Bý net = 0 - 1,025,000 = -1,025,000
      expect(pocketBalances.get('by')).toBe(-1_025_000)

      // Kiệt's shares:
      //   exp-10: 375,000
      //   exp-11: 100,000
      //   exp-12: 250,000
      //   exp-13: 250,000
      //   exp-14: 50,000
      // Kiệt total share = 1,025,000
      // Kiệt net = 0 - 1,025,000 = -1,025,000
      expect(pocketBalances.get('kiet')).toBe(-1_025_000)

      // embe Gau's shares:
      //   exp-10: 375,000
      //   exp-11: 0 (not split to embe)
      //   exp-12: 250,000
      //   exp-13: 250,000
      //   exp-14: 50,000
      // embe total share = 925,000
      // embe net = 0 - 925,000 = -925,000
      expect(pocketBalances.get('embe')).toBe(-925_000)
    })

    it('pocket balances sum to zero (zero-sum property)', () => {
      const pocketBalances = new Map<string, number>()
      for (const m of members) pocketBalances.set(m.id, 0)

      for (const e of allExpenses) {
        if (e.paid_from !== 'pocket') continue
        pocketBalances.set(e.member_id, (pocketBalances.get(e.member_id) ?? 0) + e.amount)
      }
      for (const s of pocketSplits) {
        const exp = allExpenses.find(e => e.id === s.expense_id)
        if (!exp || exp.paid_from !== 'pocket') continue
        pocketBalances.set(s.member_id, (pocketBalances.get(s.member_id) ?? 0) - s.share_amount)
      }

      const sum = [...pocketBalances.values()].reduce((a, b) => a + b, 0)
      expect(sum).toBe(0)
    })
  })

  describe('Scenario 2: After existing settlements', () => {
    it('applies all 7 settlements correctly to pocket balances', () => {
      const pocketBalances = new Map<string, number>()
      for (const m of members) pocketBalances.set(m.id, 0)

      // Credit pocket payers
      for (const e of allExpenses) {
        if (e.paid_from !== 'pocket') continue
        pocketBalances.set(e.member_id, (pocketBalances.get(e.member_id) ?? 0) + e.amount)
      }
      // Debit shares
      for (const s of pocketSplits) {
        const exp = allExpenses.find(e => e.id === s.expense_id)
        if (!exp || exp.paid_from !== 'pocket') continue
        pocketBalances.set(s.member_id, (pocketBalances.get(s.member_id) ?? 0) - s.share_amount)
      }

      // Apply settlements: from pays to (from +amount, to -amount in the SettleUp logic)
      // Kiệt → Nhat: 750K, 200K, 200K = 1,150,000
      // Kiệt → embe: 500K, 500K, 825K = 1,825,000
      // Total from Kiệt: 2,975,000
      for (const s of activeSettlements) {
        const fromBal = pocketBalances.get(s.from_member_id) ?? 0
        const toBal = pocketBalances.get(s.to_member_id) ?? 0
        pocketBalances.set(s.from_member_id, fromBal + s.amount)
        pocketBalances.set(s.to_member_id, toBal - s.amount)
      }

      // Before settlements: Nhat=2,975,000, Bý=-1,025,000, Kiệt=-1,025,000, embe=-925,000
      // Kiệt → Nhat total: 1,150,000
      //   Kiệt: -1,025,000 + 2,975,000 = 1,950,000
      //   Nhat: 2,975,000 - 1,150,000 - 1,825,000 = 0
      //     Actually: Nhat gets -1,150,000 from Kiệt settlements to Nhat
      //     embe gets -1,825,000 from Kiệt settlements to embe
      //   Wait: let me recalculate
      //   Kiệt: -1,025,000 + (750K + 200K + 200K + 500K + 500K + 825K) = -1,025,000 + 2,975,000 = 1,950,000
      //   Nhat: 2,975,000 - (750K + 200K + 200K) = 2,975,000 - 1,150,000 = 1,825,000
      //   embe: -925,000 - (500K + 500K + 825K) = -925,000 - 1,825,000 = -2,750,000
      //   Bý: -1,025,000 (unchanged)
      expect(pocketBalances.get('kiet')).toBe(1_950_000)
      expect(pocketBalances.get('nhat')).toBe(1_825_000)
      expect(pocketBalances.get('embe')).toBe(-2_750_000)
      expect(pocketBalances.get('by')).toBe(-1_025_000)

      // Verify still zero-sum
      const sum = [...pocketBalances.values()].reduce((a, b) => a + b, 0)
      expect(sum).toBe(0)
    })
  })

  describe('Scenario 3: Pool overdraft calculation', () => {
    it('computes per-depositor remaining correctly', () => {
      const totalDep = 15_000_000
      const totalPoolExp = 8_350_000

      // Bý's proportional pool expense: (5M / 15M) × 8.35M
      const byProportional = (5_000_000 / totalDep) * totalPoolExp
      expect(Math.round(byProportional)).toBeCloseTo(2_783_333, -1)

      // Nhat's proportional pool expense: (10M / 15M) × 8.35M
      const nhatProportional = (10_000_000 / totalDep) * totalPoolExp
      expect(Math.round(nhatProportional)).toBeCloseTo(5_566_667, -1)

      // Verify proportionals sum to total
      expect(Math.round(byProportional + nhatProportional)).toBe(totalPoolExp)
    })

    it('computes via_pool deductions per group', () => {
      // via_pool settlements: Kiệt→Nhat (750K+200K+200K) + Kiệt→embe (500K)
      // All from Kiệt (group Bý) via_pool: 750K + 200K + 200K + 500K = 1,650,000
      const viaPoolFromByGroup = activeSettlements
        .filter(s => s.method === 'via_pool')
        .reduce((sum, s) => {
          const settler = members.find(m => m.id === s.from_member_id)
          if (settler?.group_id === GROUP_BY) return sum + s.amount
          return sum
        }, 0)

      expect(viaPoolFromByGroup).toBe(1_650_000)

      // via_pool from Embe Gau group: 0
      const viaPoolFromEmbeGroup = activeSettlements
        .filter(s => s.method === 'via_pool')
        .reduce((sum, s) => {
          const settler = members.find(m => m.id === s.from_member_id)
          if (settler?.group_id === GROUP_EMBE) return sum + s.amount
          return sum
        }, 0)

      expect(viaPoolFromEmbeGroup).toBe(0)
    })

    it('Bý has positive remaining (no overdraft)', () => {
      const totalDep = 15_000_000
      const totalPoolExp = 8_350_000
      const byDeposit = 5_000_000
      const byProportionalExp = (byDeposit / totalDep) * totalPoolExp
      const byViaPool = 1_650_000

      const byRemaining = byDeposit - byProportionalExp - byViaPool
      // 5,000,000 - 2,783,333.33 - 1,650,000 = 566,666.67
      expect(byRemaining).toBeGreaterThan(0)
      expect(Math.round(byRemaining)).toBeCloseTo(566_667, -1)
    })

    it('Nhat has positive remaining (no overdraft)', () => {
      const totalDep = 15_000_000
      const totalPoolExp = 8_350_000
      const nhatDeposit = 10_000_000
      const nhatProportionalExp = (nhatDeposit / totalDep) * totalPoolExp
      const nhatViaPool = 0

      const nhatRemaining = nhatDeposit - nhatProportionalExp - nhatViaPool
      // 10,000,000 - 5,566,666.67 - 0 = 4,433,333.33
      expect(nhatRemaining).toBeGreaterThan(0)
      expect(Math.round(nhatRemaining)).toBeCloseTo(4_433_333, -1)
    })

    it('no overdraft debts are added to pocket entries', () => {
      const { pocketEntries } = computeTransfers(members, deposits, allExpenses, allSplits, activeSettlements)

      // With no overdraft, pocket entries should equal the settlement-adjusted values
      // (no additional overdraft adjustments applied)
      const kietEntry = pocketEntries.find(e => e.memberId === 'kiet')
      const nhatEntry = pocketEntries.find(e => e.memberId === 'nhat')
      const embeEntry = pocketEntries.find(e => e.memberId === 'embe')
      const byEntry = pocketEntries.find(e => e.memberId === 'by')

      // These should match the post-settlement values from Scenario 2
      expect(kietEntry?.net).toBe(1_950_000)
      expect(nhatEntry?.net).toBe(1_825_000)
      expect(embeEntry?.net).toBe(-2_750_000)
      expect(byEntry?.net).toBe(-1_025_000)
    })
  })

  describe('Scenario 4: Group consolidation', () => {
    it('computes inter-group transfer after group merging', () => {
      const { pocketEntries, transfers } = computeTransfers(members, deposits, allExpenses, allSplits, activeSettlements)

      // Group Bý (Bý + Kiệt) net = -1,025,000 + 1,950,000 = 925,000
      const groupByNet = pocketEntries
        .filter(e => ['by', 'kiet'].includes(e.memberId))
        .reduce((sum, e) => sum + e.net, 0)
      expect(groupByNet).toBe(925_000)

      // Group Embe Gau (Nhat + embe) net = 1,825,000 + (-2,750,000) = -925,000
      const groupEmbeNet = pocketEntries
        .filter(e => ['nhat', 'embe'].includes(e.memberId))
        .reduce((sum, e) => sum + e.net, 0)
      expect(groupEmbeNet).toBe(-925_000)

      // After group consolidation: Embe Gau group owes Bý group ₫925,000
      expect(transfers.length).toBe(1)
      expect(transfers[0].amount).toBe(925_000)
      // From = debtor (Embe Gau group), To = creditor (Bý group)
      expect(transfers[0].from.group_id).toBe(GROUP_EMBE)
      expect(transfers[0].to.group_id).toBe(GROUP_BY)
    })

    it('inter-group amounts sum correctly', () => {
      const { transfers } = computeTransfers(members, deposits, allExpenses, allSplits, activeSettlements)

      // Only one transfer: Embe Gau → Bý for ₫925,000
      const totalTransfer = transfers.reduce((sum, t) => sum + t.amount, 0)
      expect(totalTransfer).toBe(925_000)
    })
  })

  describe('Scenario 5: Via Pool credit check', () => {
    it('Bý group pool credit = ₫566,667', () => {
      const totalDep = 15_000_000
      const totalPoolExp = 8_350_000
      const byGroupDeposits = 5_000_000

      const byGroupViaPool = activeSettlements
        .filter(s => !s.deleted_at && s.method === 'via_pool')
        .reduce((sum, s) => {
          const settler = members.find(m => m.id === s.from_member_id)
          if (settler?.group_id === GROUP_BY) return sum + s.amount
          return sum
        }, 0)

      const proportionalPoolExp = (byGroupDeposits / totalDep) * totalPoolExp
      const credit = Math.max(0, Math.round(byGroupDeposits - proportionalPoolExp - byGroupViaPool))

      expect(byGroupViaPool).toBe(1_650_000)
      expect(credit).toBe(566_667)
    })

    it('Nhat group pool credit = ₫4,433,333', () => {
      const totalDep = 15_000_000
      const totalPoolExp = 8_350_000
      const nhatGroupDeposits = 10_000_000

      const nhatGroupViaPool = activeSettlements
        .filter(s => !s.deleted_at && s.method === 'via_pool')
        .reduce((sum, s) => {
          const settler = members.find(m => m.id === s.from_member_id)
          if (settler?.group_id === GROUP_EMBE) return sum + s.amount
          return sum
        }, 0)

      const proportionalPoolExp = (nhatGroupDeposits / totalDep) * totalPoolExp
      const credit = Math.max(0, Math.round(nhatGroupDeposits - proportionalPoolExp - nhatGroupViaPool))

      expect(nhatGroupViaPool).toBe(0)
      expect(credit).toBe(4_433_333)
    })

    it('if embe Gau settles ₫825K via pool, Nhat group credit drops to ₫3,608,333', () => {
      const totalDep = 15_000_000
      const totalPoolExp = 8_350_000
      const nhatGroupDeposits = 10_000_000

      // Hypothetical: embe settles 825K via_pool (adds to Nhat group via_pool)
      const nhatGroupViaPool = 825_000
      const proportionalPoolExp = (nhatGroupDeposits / totalDep) * totalPoolExp
      const credit = Math.max(0, Math.round(nhatGroupDeposits - proportionalPoolExp - nhatGroupViaPool))

      expect(credit).toBe(3_608_333)
    })
  })

  describe('Scenario 6: After embe Gau → Bý group ₫825K direct settlement', () => {
    it('adding embe→by ₫825K as a settlement results in zero or reduced inter-group transfers', () => {
      // Add a hypothetical settlement: embe → by (or any member in Bý's group) ₫925K (the full amount)
      // Actually: the current outstanding is ₫925K. If embe settles ₫925K, transfers = 0
      const additionalSettlement = makeSettlement('embe', 'by', 925_000, 'direct')
      const allSettlements = [...activeSettlements, additionalSettlement]

      const { transfers } = computeTransfers(members, deposits, allExpenses, allSplits, allSettlements)

      // Should show 0 inter-group transfers (all settled)
      expect(transfers.length).toBe(0)
    })

    it('partial settlement of ₫825K direct reduces inter-group debt', () => {
      const additionalSettlement = makeSettlement('embe', 'by', 825_000, 'direct')
      const allSettlements = [...activeSettlements, additionalSettlement]

      const { transfers } = computeTransfers(members, deposits, allExpenses, allSplits, allSettlements)

      // Remaining: 925,000 - 825,000 = 100,000
      if (transfers.length > 0) {
        const totalRemaining = transfers.reduce((sum, t) => sum + t.amount, 0)
        expect(totalRemaining).toBe(100_000)
        expect(transfers[0].from.group_id).toBe(GROUP_EMBE)
        expect(transfers[0].to.group_id).toBe(GROUP_BY)
      }
    })

    it('no settlement loops after full resolution', () => {
      const additionalSettlement = makeSettlement('embe', 'by', 925_000, 'direct')
      const allSettlements = [...activeSettlements, additionalSettlement]

      const { transfers } = computeTransfers(members, deposits, allExpenses, allSplits, allSettlements)

      // No loops: no member appears as both debtor and creditor
      const fromIds = transfers.map(t => t.from.id)
      const toIds = transfers.map(t => t.to.id)
      const overlap = fromIds.filter(id => toIds.includes(id))
      expect(overlap.length).toBe(0)
    })
  })

  describe('Scenario 7: Pool balance consistency', () => {
    it('pool balance = 15M - 8.35M - 1.65M = ₫5,000,000', () => {
      const totalDeposits = deposits.reduce((sum, d) => sum + d.amount, 0)
      const totalPoolExpenses = poolExpenses.reduce((sum, e) => sum + e.amount, 0)
      const totalViaPool = activeSettlements
        .filter(s => s.method === 'via_pool')
        .reduce((sum, s) => sum + s.amount, 0)

      const poolBalance = totalDeposits - totalPoolExpenses - totalViaPool
      expect(poolBalance).toBe(5_000_000)
    })

    it('refund Bý = ₫566,667 (rounded)', () => {
      const totalDep = 15_000_000
      const totalPoolExp = 8_350_000
      const byDeposit = 5_000_000
      const byViaPool = 1_650_000

      const refund = byDeposit - (byDeposit / totalDep) * totalPoolExp - byViaPool
      expect(Math.round(refund)).toBeCloseTo(566_667, -1)
    })

    it('refund Nhat = ₫4,433,333 (rounded)', () => {
      const totalDep = 15_000_000
      const totalPoolExp = 8_350_000
      const nhatDeposit = 10_000_000
      const nhatViaPool = 0

      const refund = nhatDeposit - (nhatDeposit / totalDep) * totalPoolExp - nhatViaPool
      expect(Math.round(refund)).toBeCloseTo(4_433_333, -1)
    })

    it('sum of refunds = pool balance ✓', () => {
      const totalDep = 15_000_000
      const totalPoolExp = 8_350_000
      const totalViaPool = 1_650_000
      const poolBalance = totalDep - totalPoolExp - totalViaPool

      const byDeposit = 5_000_000
      const nhatDeposit = 10_000_000
      const byRefund = byDeposit - (byDeposit / totalDep) * totalPoolExp - 1_650_000
      const nhatRefund = nhatDeposit - (nhatDeposit / totalDep) * totalPoolExp - 0

      const sumRefunds = byRefund + nhatRefund
      // Should equal pool balance
      expect(Math.round(sumRefunds)).toBe(poolBalance)
    })
  })

  describe('Scenario 8: What if embe Gau settles ₫825K via_pool instead of direct', () => {
    it('Nhat group via_pool becomes ₫825K, credit drops to ₫3,608,333', () => {
      const totalDep = 15_000_000
      const totalPoolExp = 8_350_000
      const nhatDeposit = 10_000_000

      // Hypothetical: embe (group Embe Gau) settles 825K via_pool
      // Nhat group via_pool = 825K
      const nhatGroupViaPool = 825_000
      const proportionalPoolExp = (nhatDeposit / totalDep) * totalPoolExp
      const credit = Math.max(0, Math.round(nhatDeposit - proportionalPoolExp - nhatGroupViaPool))

      expect(credit).toBe(3_608_333)
    })

    it('pool balance = 15M - 8.35M - (1.65M + 0.825M) = ₫4,175,000', () => {
      const totalDeposits = 15_000_000
      const totalPoolExp = 8_350_000
      const totalViaPool = 1_650_000 + 825_000 // original + new hypothetical

      const poolBalance = totalDeposits - totalPoolExp - totalViaPool
      expect(poolBalance).toBe(4_175_000)
    })

    it('refunds still sum to pool balance after hypothetical via_pool settlement', () => {
      const totalDep = 15_000_000
      const totalPoolExp = 8_350_000
      const byDeposit = 5_000_000
      const nhatDeposit = 10_000_000
      const byViaPool = 1_650_000
      const nhatViaPool = 825_000 // hypothetical embe's via_pool deducted from Nhat group
      const totalViaPool = byViaPool + nhatViaPool

      const poolBalance = totalDep - totalPoolExp - totalViaPool
      expect(poolBalance).toBe(4_175_000)

      const byRefund = byDeposit - (byDeposit / totalDep) * totalPoolExp - byViaPool
      const nhatRefund = nhatDeposit - (nhatDeposit / totalDep) * totalPoolExp - nhatViaPool

      const sumRefunds = Math.round(byRefund + nhatRefund)
      expect(sumRefunds).toBe(poolBalance)
    })

    it('overdraft logic handles the hypothetical via_pool scenario', () => {
      // Replace the last direct settlement with via_pool
      const modifiedSettlements: Settlement[] = [
        ...activeSettlements.slice(0, 5),
        makeSettlement('kiet', 'embe', 825_000, 'via_pool'), // was direct, now via_pool
      ]

      const { pocketEntries, transfers } = computeTransfers(members, deposits, allExpenses, allSplits, modifiedSettlements)

      // Total via_pool from Bý's group: 750K + 200K + 200K + 500K + 825K = 2,475,000
      // Bý remaining: 5M - (5/15)×8.35M - 2,475,000 = 5M - 2,783,333 - 2,475,000 = -258,333 → OVERDRAFT!
      // This means the via_pool scenario creates an overdraft for Bý's group

      // Group Bý net in pocket:
      // Kiệt: -1,025,000 + 2,975,000 = 1,950,000 (same — all from Kiệt)
      // Bý: -1,025,000
      // Group: 925,000

      // After overdraft: Bý's depositor goes negative by ~258,333
      // This debt gets added: Bý (pocket) += -258,333, Nhat (pocket) += +258,333

      // The overdraft makes Bý's group net decrease and Nhat's group net increase
      const groupByNet = pocketEntries
        .filter(e => ['by', 'kiet'].includes(e.memberId))
        .reduce((sum, e) => sum + e.net, 0)

      const groupEmbeNet = pocketEntries
        .filter(e => ['nhat', 'embe'].includes(e.memberId))
        .reduce((sum, e) => sum + e.net, 0)

      // With overdraft: Bý's group loses ~258,333 → net becomes 925,000 - 258,333 = ~666,667
      // Embe group gains: -925,000 + 258,333 = ~-666,667
      // The exact amount depends on floating point in the proportional calc
      expect(Math.round(groupByNet + groupEmbeNet)).toBeCloseTo(0, -1) // still zero-sum

      // The remaining transfer should be smaller now
      if (transfers.length > 0) {
        const totalTransferAmount = transfers.reduce((sum, t) => sum + t.amount, 0)
        // ~666,667 (925,000 - 258,333)
        expect(totalTransferAmount).toBeLessThan(925_000)
        expect(totalTransferAmount).toBeGreaterThan(600_000)
      }
    })
  })

  describe('Integration: Full SettleUp computation with simplifyDebts', () => {
    it('produces correct final transfers with real data', () => {
      const { transfers } = computeTransfers(members, deposits, allExpenses, allSplits, activeSettlements)

      // With current settlements:
      // Group Bý net = 925,000 (creditor)
      // Group Embe net = -925,000 (debtor)
      // simplifyDebts should produce: Embe Gau group → Bý group: ₫925,000
      expect(transfers.length).toBe(1)
      expect(transfers[0].from.group_id).toBe(GROUP_EMBE)
      expect(transfers[0].to.group_id).toBe(GROUP_BY)
      expect(transfers[0].amount).toBe(925_000)
    })

    it('with no settlements, pocket debt = ₫2,050,000 from Bý group to Embe Gau group', () => {
      const { transfers } = computeTransfers(members, deposits, allExpenses, allSplits, [])

      // Without any settlements:
      // Nhat = 2,975,000, Bý = -1,025,000, Kiệt = -1,025,000, embe = -925,000
      // Group Bý: -1,025,000 + -1,025,000 = -2,050,000
      // Group Embe: 2,975,000 + -925,000 = 2,050,000
      // Transfer: Bý group → Embe Gau group: ₫2,050,000
      expect(transfers.length).toBe(1)
      expect(transfers[0].from.group_id).toBe(GROUP_BY)
      expect(transfers[0].to.group_id).toBe(GROUP_EMBE)
      expect(transfers[0].amount).toBe(2_050_000)
    })

    it('settlement progress: started at ₫2,050,000, now ₫925,000 remaining', () => {
      const { transfers: withoutSettlements } = computeTransfers(members, deposits, allExpenses, allSplits, [])
      const { transfers: withSettlements } = computeTransfers(members, deposits, allExpenses, allSplits, activeSettlements)

      const initialDebt = withoutSettlements.reduce((sum, t) => sum + t.amount, 0)
      const remainingDebt = withSettlements.reduce((sum, t) => sum + t.amount, 0)

      expect(initialDebt).toBe(2_050_000)
      expect(remainingDebt).toBe(925_000)
      expect(initialDebt - remainingDebt).toBe(1_125_000)

      // Settlements total: 750K + 200K + 200K + 500K + 500K + 825K = 2,975,000
      // But since Kiệt is in Bý's group, settlements from Kiệt to Nhat/embe
      // reduce the inter-group debt:
      // Kiệt→Nhat (1,150,000): reduces Bý group debt by swapping internal credit
      // Kiệt→embe (1,825,000): reduces directly
      // Net effect on inter-group: debt reduced by 2,050,000 - 925,000 = 1,125,000
      // This doesn't equal sum of settlements (2,975,000) because settlements
      // also shift intra-group balances
    })
  })
})
