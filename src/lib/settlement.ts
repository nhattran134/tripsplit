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
