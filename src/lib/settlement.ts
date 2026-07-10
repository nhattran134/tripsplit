import type { Member, Deposit, Expense, ExpenseSplit, Settlement, BalanceEntry, Transfer } from '@/types'

/**
 * Calculate net balance per member.
 * net > 0: member overpaid (is owed money / gets refund)
 * net < 0: member underpaid (owes money to pool)
 *
 * Formula: net = deposits + expenses_I_paid - my_share_of_all_expenses - settlements_received + settlements_paid
 */
export function calculateBalances(
  members: Member[],
  deposits: Deposit[],
  expenses: Expense[],
  expenseSplits: ExpenseSplit[],
  settlements: Settlement[]
): BalanceEntry[] {
  const balanceMap = new Map<string, number>()

  // Initialize all active members
  for (const member of members) {
    if (!member.deleted_at) {
      balanceMap.set(member.id, 0)
    }
  }

  // Add deposits (money put INTO the pool)
  for (const deposit of deposits) {
    if (deposit.deleted_at) continue
    const current = balanceMap.get(deposit.member_id) ?? 0
    balanceMap.set(deposit.member_id, current + deposit.amount * deposit.rate_to_base)
  }

  // Credit expense payers (they paid on behalf of the group)
  for (const expense of expenses) {
    if (expense.deleted_at) continue
    const current = balanceMap.get(expense.member_id) ?? 0
    balanceMap.set(expense.member_id, current + expense.amount * expense.rate_to_base)
  }

  // Subtract expense shares (money member BENEFITED from)
  for (const split of expenseSplits) {
    const current = balanceMap.get(split.member_id)
    if (current === undefined) continue
    balanceMap.set(split.member_id, current - split.share_amount)
  }

  // Account for settlements already made
  for (const settlement of settlements) {
    if (settlement.deleted_at) continue
    const fromBal = balanceMap.get(settlement.from_member_id) ?? 0
    const toBal = balanceMap.get(settlement.to_member_id) ?? 0
    // from_member paid to_member, so from's debt decreases, to's credit decreases
    balanceMap.set(settlement.from_member_id, fromBal + settlement.amount)
    balanceMap.set(settlement.to_member_id, toBal - settlement.amount)
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
 * Produces at most N-1 transfers (where N = members with non-zero balance).
 * Note: True minimum-transfer count is NP-hard. Greedy is near-optimal and O(n log n).
 */
export function simplifyDebts(balances: BalanceEntry[], members: Member[]): Transfer[] {
  const EPSILON = 0.005
  const transfers: Transfer[] = []

  const creditors = balances
    .filter((b) => b.net >= EPSILON)
    .map((b) => ({ ...b }))
    .sort((a, b) => b.net - a.net)

  const debtors = balances
    .filter((b) => b.net <= -EPSILON)
    .map((b) => ({ ...b, net: Math.abs(b.net) }))
    .sort((a, b) => b.net - a.net)

  const memberMap = new Map(members.map((m) => [m.id, m]))

  let i = 0
  let j = 0

  while (i < debtors.length && j < creditors.length) {
    const debtor = debtors[i]
    const creditor = creditors[j]
    const transferAmount = Math.round(Math.min(debtor.net, creditor.net) * 100) / 100

    if (transferAmount >= EPSILON) {
      const fromMember = memberMap.get(debtor.memberId)
      const toMember = memberMap.get(creditor.memberId)

      if (fromMember && toMember) {
        transfers.push({ from: fromMember, to: toMember, amount: transferAmount })
      }
    }

    debtor.net = Math.round((debtor.net - transferAmount) * 100) / 100
    creditor.net = Math.round((creditor.net - transferAmount) * 100) / 100

    if (debtor.net < EPSILON) i++
    if (creditor.net < EPSILON) j++
  }

  return transfers
}
