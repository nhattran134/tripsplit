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

  let text = `📊 ${tripName}\n`
  text += `━━━━━━━━━━━━━━━━━━\n\n`

  text += `💰 Total deposited: ${formatAmount(totalDeposits, baseCurrency)} ${baseCurrency}\n`
  text += `💸 Total spent: ${formatAmount(totalExpenses, baseCurrency)} ${baseCurrency}\n`
  text += `📦 Pool remaining: ${formatAmount(totalDeposits - totalExpenses, baseCurrency)} ${baseCurrency}\n\n`

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
  const blob = new Blob([content], { type: mimeType })
  const url = URL.createObjectURL(blob)
  const a = document.createElement('a')
  a.href = url
  a.download = filename
  document.body.appendChild(a)
  a.click()
  document.body.removeChild(a)
  URL.revokeObjectURL(url)
}
