import { getCurrencyDecimals } from './currency'

export interface SplitResult {
  member_id: string
  share_amount: number
}

/**
 * Calculate equal split with remainder handling.
 * Remainder is assigned to the first member to ensure sum === baseAmount exactly.
 */
export function calculateEqualSplit(
  baseAmount: number,
  memberIds: string[],
  baseCurrency: string
): SplitResult[] {
  if (memberIds.length === 0) return []

  const decimals = getCurrencyDecimals(baseCurrency)
  const factor = Math.pow(10, decimals)
  const count = memberIds.length

  // Floor division to avoid over-allocation
  const perPerson = Math.floor(baseAmount * factor / count) / factor
  const totalAllocated = Math.round(perPerson * count * factor) / factor
  const remainder = Math.round((baseAmount - totalAllocated) * factor) / factor

  return memberIds.map((memberId, index) => ({
    member_id: memberId,
    share_amount: index === 0 ? Math.round((perPerson + remainder) * factor) / factor : perPerson,
  }))
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
