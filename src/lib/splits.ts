import { getCurrencyDecimals } from './currency'

export interface SplitResult {
  member_id: string
  share_amount: number
}

/**
 * Calculate equal (or weighted) split with remainder handling.
 * Remainder is assigned to the first member to ensure sum === baseAmount exactly.
 * If weights are provided, each member's share is proportional to their weight.
 */
export function calculateEqualSplit(
  baseAmount: number,
  memberIds: string[],
  baseCurrency: string,
  weights?: Record<string, number> // optional: member_id -> weight (default 1)
): SplitResult[] {
  if (memberIds.length === 0) return []

  const decimals = getCurrencyDecimals(baseCurrency)
  const factor = Math.pow(10, decimals)

  // Calculate total weight
  const totalWeight = memberIds.reduce((sum, id) => sum + (weights?.[id] ?? 1), 0)
  if (totalWeight === 0) return []

  // Calculate weighted shares
  const results: SplitResult[] = memberIds.map((memberId) => {
    const weight = weights?.[memberId] ?? 1
    const share = Math.floor((baseAmount * weight / totalWeight) * factor) / factor
    return { member_id: memberId, share_amount: share }
  })

  // Handle remainder - assign to first member
  const totalAllocated = results.reduce((sum, r) => sum + r.share_amount, 0)
  const remainder = Math.round((baseAmount - totalAllocated) * factor) / factor
  if (results.length > 0 && remainder > 0) {
    results[0].share_amount = Math.round((results[0].share_amount + remainder) * factor) / factor
  }

  return results
}

/**
 * Validate custom split: sum must equal total within tolerance.
 */
export function validateCustomSplit(
  amounts: Record<string, number>,
  total: number,
  baseCurrency: string
): { valid: boolean; diff: number } {
  const sum = Object.values(amounts).reduce((s, v) => s + v, 0)
  const tolerance = Math.pow(10, -getCurrencyDecimals(baseCurrency))
  const diff = Math.round((sum - total) * 100) / 100
  return { valid: Math.abs(diff) <= tolerance, diff }
}

/**
 * Create custom split entries.
 */
export function calculateCustomSplit(
  amounts: Record<string, number>,
  memberIds: string[]
): SplitResult[] {
  return memberIds.map((memberId) => ({
    member_id: memberId,
    share_amount: amounts[memberId] || 0,
  }))
}
