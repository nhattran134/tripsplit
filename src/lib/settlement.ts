import type { Member, Deposit, Expense, ExpenseSplit, Settlement, BalanceEntry, Transfer } from '@/types'

/**
 * Calculate net balance per member.
 * net > 0: member deposited more than their share (gets refund)
 * net < 0: member deposited less than their share (owes more)
 *
 * Two expense types:
 * - paid_from='pool': paid from shared deposits, payer gets no credit
 * - paid_from='pocket': paid from own money, payer gets credit (like Splitwise)
 */
export function calculateBalances(
  members: Member[],
  deposits: Deposit[],
  expenses: Expense[],
  expenseSplits: ExpenseSplit[],
  settlements: Settlement[]
): BalanceEntry[] {
  const balanceMap = new Map<string, number>()

  // Initialize ALL members (including soft-deleted) for accurate math
  // Deleted members still owe/are owed money from past transactions
  for (const member of members) {
    balanceMap.set(member.id, 0)
  }

  // Add deposits (money put INTO the pool)
  for (const deposit of deposits) {
    if (deposit.deleted_at) continue
    const current = balanceMap.get(deposit.member_id) ?? 0
    balanceMap.set(deposit.member_id, current + Number(deposit.amount) * Number(deposit.rate_to_base))
  }

  // Credit payers who paid from their own pocket (not from pool)
  for (const expense of expenses) {
    if (expense.deleted_at) continue
    if (expense.paid_from === 'pocket') {
      const current = balanceMap.get(expense.member_id) ?? 0
      balanceMap.set(expense.member_id, current + Number(expense.amount) * Number(expense.rate_to_base))
    }
  }

  // Subtract expense shares (money member BENEFITED from)
  for (const split of expenseSplits) {
    const current = balanceMap.get(split.member_id)
    if (current === undefined) continue
    balanceMap.set(split.member_id, current - Number(split.share_amount))
  }

  // Account for settlements already made
  for (const settlement of settlements) {
    if (settlement.deleted_at) continue
    // Self-settlement is a no-op (would corrupt balance due to stale read)
    if (settlement.from_member_id === settlement.to_member_id) continue
    const fromBal = balanceMap.get(settlement.from_member_id) ?? 0
    const toBal = balanceMap.get(settlement.to_member_id) ?? 0
    // from_member paid to_member, so from's debt decreases, to's credit decreases
    balanceMap.set(settlement.from_member_id, fromBal + Number(settlement.amount))
    balanceMap.set(settlement.to_member_id, toBal - Number(settlement.amount))
  }

  // Round each member's net
  const entries: BalanceEntry[] = Array.from(balanceMap.entries()).map(([memberId, net]) => ({
    memberId,
    net: Math.round(net * 100) / 100,
  }))

  // Force zero-sum ONLY if the residual is a rounding artifact (< 1 cent per member).
  // A structural imbalance (deposits != expenses) is valid and should not be adjusted.
  const sum = entries.reduce((s, e) => s + e.net, 0)
  const roundedSum = Math.round(sum * 100) / 100
  const maxRoundingError = entries.length * 0.01
  if (Math.abs(roundedSum) >= 0.01 && Math.abs(roundedSum) <= maxRoundingError) {
    const maxEntry = entries.reduce((max, e) =>
      Math.abs(e.net) > Math.abs(max.net) ? e : max
    )
    maxEntry.net = Math.round((maxEntry.net - roundedSum) * 100) / 100
  }

  return entries
}

/**
 * Pool Reimbursement: When someone pays from pocket and the pool has a surplus,
 * the pocket payer should be reimbursed from the pool surplus.
 * The depositor physically holds the pool money, so "reimburse from pool" = depositor → pocket_payer transfer.
 */
export function calculatePoolReimbursements(
  members: Member[],
  deposits: Deposit[],
  expenses: Expense[],
  expenseSplits: ExpenseSplit[],
  settlements: Settlement[]
): Transfer[] {
  const EPSILON = 0.005

  // Step 1: Calculate pool surplus (deposits - pool expenses only)
  // Don't subtract via_pool settlements here — they are the OUTPUT of this function,
  // not an input. Including them creates a feedback loop.
  const totalDeposits = deposits
    .filter(d => !d.deleted_at)
    .reduce((sum, d) => sum + Number(d.amount) * Number(d.rate_to_base), 0)

  const poolExpenseTotal = expenses
    .filter(e => !e.deleted_at && e.paid_from === 'pool')
    .reduce((sum, e) => sum + Number(e.amount) * Number(e.rate_to_base), 0)

  let poolSurplus = totalDeposits - poolExpenseTotal

  // Step 2: If no surplus, nothing to reimburse
  if (poolSurplus <= EPSILON) return []

  // Step 3: Get balances to know who's owed money
  const balances = calculateBalances(members, deposits, expenses, expenseSplits, settlements)

  // Step 4: Find pocket payers with positive net (they ARE owed money)
  const pocketCredits = new Map<string, number>()
  for (const expense of expenses) {
    if (expense.deleted_at) continue
    if (expense.paid_from === 'pocket') {
      const current = pocketCredits.get(expense.member_id) ?? 0
      pocketCredits.set(expense.member_id, current + Number(expense.amount) * Number(expense.rate_to_base))
    }
  }

  // Pocket payers who are owed money (net > 0)
  const pocketPayersOwed: { member: Member; reimbursable: number }[] = []
  for (const [memberId, _credit] of pocketCredits) {
    const balance = balances.find(b => b.memberId === memberId)
    if (!balance || balance.net <= EPSILON) continue

    const member = members.find(m => m.id === memberId)
    if (!member) continue

    pocketPayersOwed.push({ member, reimbursable: balance.net })
  }

  if (pocketPayersOwed.length === 0) return []

  // Sort by largest reimbursable first (deterministic)
  pocketPayersOwed.sort((a, b) => b.reimbursable - a.reimbursable)

  // Step 5: Determine depositors and their proportional share of surplus
  const depositorAmounts = new Map<string, number>()
  for (const deposit of deposits) {
    if (deposit.deleted_at) continue
    const current = depositorAmounts.get(deposit.member_id) ?? 0
    depositorAmounts.set(deposit.member_id, current + Number(deposit.amount) * Number(deposit.rate_to_base))
  }

  // Step 6: Allocate reimbursements, capped at pool surplus
  const transfers: Transfer[] = []
  let surplusRemaining = poolSurplus

  for (const { member: pocketPayer, reimbursable } of pocketPayersOwed) {
    if (surplusRemaining <= EPSILON) break

    const amount = Math.round(Math.min(reimbursable, surplusRemaining) * 100) / 100
    if (amount <= EPSILON) continue

    // Distribute FROM depositors proportionally (excluding the pocket payer themselves)
    const eligibleDepositors: { member: Member; depositAmount: number }[] = []
    let totalEligibleDeposits = 0

    for (const [depId, depAmount] of depositorAmounts) {
      if (depId === pocketPayer.id) continue // Don't reimburse yourself
      const depMember = members.find(m => m.id === depId)
      if (!depMember) continue
      eligibleDepositors.push({ member: depMember, depositAmount: depAmount })
      totalEligibleDeposits += depAmount
    }

    if (eligibleDepositors.length === 0 || totalEligibleDeposits <= EPSILON) continue

    // Proportional distribution from depositors
    let allocated = 0
    for (let i = 0; i < eligibleDepositors.length; i++) {
      const dep = eligibleDepositors[i]
      let share: number

      if (i === eligibleDepositors.length - 1) {
        // Last depositor gets remainder to avoid rounding errors
        share = Math.round((amount - allocated) * 100) / 100
      } else {
        share = Math.round((amount * dep.depositAmount / totalEligibleDeposits) * 100) / 100
      }

      if (share >= EPSILON) {
        transfers.push({ from: dep.member, to: pocketPayer, amount: share })
        allocated += share
      }
    }

    surplusRemaining = Math.round((surplusRemaining - amount) * 100) / 100
  }

  return transfers
}

/**
 * Greedy debt simplification.
 * Members in the same group are consolidated (no intra-group transfers).
 * Produces at most N-1 transfers (where N = groups/individuals with non-zero balance).
 */
export function simplifyDebts(balances: BalanceEntry[], members: Member[]): Transfer[] {
  const EPSILON = 0.005
  const transfers: Transfer[] = []

  // Consolidate balances by group
  // Members with same group_id merge into one balance (represented by first member)
  const groupMap = new Map<string, { representative: Member; net: number }>()
  
  for (const b of balances) {
    const member = members.find((m) => m.id === b.memberId)
    if (!member) continue
    
    const groupKey = member.group_id || `individual_${member.id}`
    const existing = groupMap.get(groupKey)
    
    if (existing) {
      existing.net += b.net
    } else {
      groupMap.set(groupKey, { representative: member, net: b.net })
    }
  }

  // Round consolidated balances
  const consolidated = [...groupMap.values()].map(g => ({
    ...g,
    net: Math.round(g.net * 100) / 100,
  }))

  const creditors = consolidated
    .filter((g) => g.net >= EPSILON)
    .map((g) => ({ ...g }))
    .sort((a, b) => b.net - a.net)

  const debtors = consolidated
    .filter((g) => g.net <= -EPSILON)
    .map((g) => ({ ...g, net: Math.abs(g.net) }))
    .sort((a, b) => b.net - a.net)

  let i = 0
  let j = 0

  while (i < debtors.length && j < creditors.length) {
    const debtor = debtors[i]
    const creditor = creditors[j]
    const transferAmount = Math.round(Math.min(debtor.net, creditor.net) * 100) / 100

    if (transferAmount >= EPSILON) {
      transfers.push({ from: debtor.representative, to: creditor.representative, amount: transferAmount })
    }

    debtor.net = Math.round((debtor.net - transferAmount) * 100) / 100
    creditor.net = Math.round((creditor.net - transferAmount) * 100) / 100

    if (debtor.net < EPSILON) i++
    if (creditor.net < EPSILON) j++
  }

  return transfers
}
