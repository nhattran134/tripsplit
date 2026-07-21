import type { Member, Deposit, Expense, ExpenseSplit, Settlement, BalanceEntry } from '@/types'
import { formatAmount, getCurrencyDecimals } from './currency'

interface ExportData {
  tripName: string
  baseCurrency: string
  members: Member[]
  deposits: Deposit[]
  expenses: Expense[]
  expenseSplits: ExpenseSplit[]
  settlements: Settlement[]
  balances: BalanceEntry[]
  transfers: { from: Member; to: Member; amount: number }[]
}

/**
 * Export as CSV (compatible with Excel/Google Sheets)
 */
export function exportCSV(data: ExportData): void {
  const { tripName, baseCurrency, members, deposits, expenses, expenseSplits, settlements, balances } = data

  const memberMap = new Map(members.map((m) => [m.id, m.name]))
  const lines: string[] = []

  // Header
  lines.push(`Trip: ${tripName}`)
  lines.push(`Currency: ${baseCurrency}`)
  lines.push(`Exported: ${new Date().toLocaleDateString()}`)
  lines.push('')

  // Expenses
  lines.push('--- EXPENSES ---')
  lines.push('Date,Description,Category,Paid By,Amount,Split Among')
  for (const exp of expenses) {
    const splits = expenseSplits.filter((s) => s.expense_id === exp.id)
    const splitNames = splits.map((s) => memberMap.get(s.member_id) || '?').join('; ')
    const baseAmount = Number(exp.amount) * Number(exp.rate_to_base)
    lines.push(`${exp.date},"${exp.description || exp.category}",${exp.category},${memberMap.get(exp.member_id) || '?'},${baseAmount.toFixed(getCurrencyDecimals(baseCurrency))},"${splitNames}"`)
  }
  lines.push('')

  // Deposits
  lines.push('--- DEPOSITS ---')
  lines.push('Date,Member,Amount,Note')
  for (const dep of deposits) {
    const baseAmount = Number(dep.amount) * Number(dep.rate_to_base)
    lines.push(`${dep.created_at.split('T')[0]},${memberMap.get(dep.member_id) || '?'},${baseAmount.toFixed(getCurrencyDecimals(baseCurrency))},"${dep.note || ''}"`)
  }
  lines.push('')

  // Settlements
  if (settlements.length > 0) {
    lines.push('--- SETTLEMENTS ---')
    lines.push('Date,From,To,Amount')
    for (const s of settlements) {
      lines.push(`${s.created_at.split('T')[0]},${memberMap.get(s.from_member_id) || '?'},${memberMap.get(s.to_member_id) || '?'},${Number(s.amount).toFixed(getCurrencyDecimals(baseCurrency))}`)
    }
    lines.push('')
  }

  // Summary
  lines.push('--- BALANCE SUMMARY ---')
  lines.push('Member,Net Balance')
  for (const b of balances) {
    const name = memberMap.get(b.memberId) || '?'
    lines.push(`${name},${b.net.toFixed(getCurrencyDecimals(baseCurrency))}`)
  }
  lines.push('')

  // Final Calculations
  const totalDeposits = deposits.reduce((s, d) => s + Number(d.amount) * Number(d.rate_to_base), 0)
  const totalExpenses = expenses.reduce((s, e) => s + Number(e.amount) * Number(e.rate_to_base), 0)
  const totalPoolExpenses = expenses.filter(e => e.paid_from === 'pool').reduce((s, e) => s + Number(e.amount) * Number(e.rate_to_base), 0)
  const totalPocketExpenses = expenses.filter(e => e.paid_from === 'pocket').reduce((s, e) => s + Number(e.amount) * Number(e.rate_to_base), 0)
  const viaPoolSettlements = settlements.filter(s => s.method === 'via_pool').reduce((s, st) => s + Number(st.amount), 0)
  const poolBalance = totalDeposits - totalPoolExpenses - viaPoolSettlements
  const decimals = getCurrencyDecimals(baseCurrency)

  lines.push('--- FINAL CALCULATIONS ---')
  lines.push(`Total Deposited,${totalDeposits.toFixed(decimals)}`)
  lines.push(`Total Expenses,${totalExpenses.toFixed(decimals)}`)
  lines.push(`  Pool Expenses,${totalPoolExpenses.toFixed(decimals)}`)
  lines.push(`  Pocket Expenses,${totalPocketExpenses.toFixed(decimals)}`)
  lines.push(`Via Pool Settlements,${viaPoolSettlements.toFixed(decimals)}`)
  lines.push(`Pool Balance (Remaining),${poolBalance.toFixed(decimals)}`)
  lines.push('')

  // Per-member share of expenses
  lines.push('--- PER MEMBER SHARE ---')
  lines.push('Member,Deposited,Expense Share,Pocket Paid,Net')
  for (const m of members) {
    const deposited = deposits.filter(d => d.member_id === m.id).reduce((s, d) => s + Number(d.amount) * Number(d.rate_to_base), 0)
    const share = expenseSplits.filter(s => s.member_id === m.id).reduce((s, sp) => s + Number(sp.share_amount), 0)
    const pocketPaid = expenses.filter(e => e.paid_from === 'pocket' && e.member_id === m.id).reduce((s, e) => s + Number(e.amount) * Number(e.rate_to_base), 0)
    const balance = balances.find(b => b.memberId === m.id)
    lines.push(`${m.name},${deposited.toFixed(decimals)},${share.toFixed(decimals)},${pocketPaid.toFixed(decimals)},${(balance?.net ?? 0).toFixed(decimals)}`)
  }
  lines.push('')

  // Refunds (pool surplus per depositor)
  if (poolBalance > 0) {
    lines.push('--- POOL REFUND ---')
    lines.push('Member,Refund Amount')
    const depositorTotals = new Map<string, number>()
    for (const d of deposits) {
      depositorTotals.set(d.member_id, (depositorTotals.get(d.member_id) || 0) + Number(d.amount) * Number(d.rate_to_base))
    }
    for (const [memberId, deposited] of depositorTotals) {
      const refund = (deposited / totalDeposits) * poolBalance
      lines.push(`${memberMap.get(memberId) || '?'},${refund.toFixed(decimals)}`)
    }
    lines.push('')
  }

  // Outstanding transfers
  if (data.transfers.length > 0) {
    lines.push('--- OUTSTANDING SETTLEMENTS ---')
    lines.push('From,To,Amount')
    for (const t of data.transfers) {
      lines.push(`${t.from.name},${t.to.name},${t.amount.toFixed(decimals)}`)
    }
    lines.push('')
  }

  const csv = lines.join('\n')
  downloadFile(csv, `${tripName.replace(/\s+/g, '_')}_export.csv`, 'text/csv')
}

/**
 * Export as shareable text summary (for messaging apps)
 */
export function exportText(data: ExportData): string {
  const { tripName, baseCurrency, members, deposits, expenses, balances, transfers } = data
  const memberMap = new Map(members.map((m) => [m.id, m.name]))

  const totalDeposits = deposits.reduce((s, d) => s + Number(d.amount) * Number(d.rate_to_base), 0)
  const totalExpenses = expenses.reduce((s, e) => s + Number(e.amount) * Number(e.rate_to_base), 0)
  const totalPoolExpenses = expenses.filter(e => e.paid_from === 'pool').reduce((s, e) => s + Number(e.amount) * Number(e.rate_to_base), 0)
  const poolRemaining = totalDeposits - totalPoolExpenses

  let text = `📊 ${tripName}\n`
  text += `━━━━━━━━━━━━━━━━━━\n\n`

  text += `💰 Total deposited: ${formatAmount(totalDeposits, baseCurrency)} ${baseCurrency}\n`
  text += `💸 Total spent: ${formatAmount(totalExpenses, baseCurrency)} ${baseCurrency}\n`
  text += `📦 Pool remaining: ${formatAmount(poolRemaining, baseCurrency)} ${baseCurrency}\n\n`

  text += `👥 Balances:\n`
  for (const b of balances) {
    const name = memberMap.get(b.memberId) || '?'
    const sign = b.net >= 0 ? '+' : ''
    text += `  ${name}: ${sign}${formatAmount(b.net, baseCurrency)}\n`
  }

  if (transfers.length > 0) {
    text += `\n🤝 To settle:\n`
    for (const t of transfers) {
      text += `  ${t.from.name} → ${t.to.name}: ${formatAmount(t.amount, baseCurrency)}\n`
    }
  }

  text += `\n━━━━━━━━━━━━━━━━━━\n`
  text += `Exported ${new Date().toLocaleDateString()}`

  return text
}

/**
 * Copy text to clipboard and return it
 */
export function exportTextToClipboard(data: ExportData): string {
  const text = exportText(data)
  navigator.clipboard.writeText(text)
  return text
}

function downloadFile(content: string, filename: string, mimeType: string): void {
  // Add UTF-8 BOM for Excel compatibility with Vietnamese characters
  const BOM = '\uFEFF'
  const blob = new Blob([BOM + content], { type: `${mimeType};charset=utf-8` })
  const url = URL.createObjectURL(blob)
  const a = document.createElement('a')
  a.href = url
  a.download = filename
  document.body.appendChild(a)
  a.click()
  document.body.removeChild(a)
  URL.revokeObjectURL(url)
}
