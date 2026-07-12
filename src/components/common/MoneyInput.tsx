import { useState, useCallback } from 'react'
import { getCurrencyDecimals } from '@/lib/currency'

interface MoneyInputProps {
  value: string
  onChange: (value: string) => void
  currency: string
  placeholder?: string
  className?: string
  autoFocus?: boolean
}

/**
 * Money input with live thousand separators.
 * Stores raw numeric string, displays formatted.
 * VND/JPY: no decimals, comma separator (1,500,000)
 * USD/EUR: 2 decimals, comma separator (1,500.00)
 */
export function MoneyInput({ value, onChange, currency, placeholder = '0', className = '', autoFocus }: MoneyInputProps) {
  const decimals = getCurrencyDecimals(currency)
  const [displayValue, setDisplayValue] = useState(() => formatDisplay(value, decimals))

  const handleChange = useCallback((e: React.ChangeEvent<HTMLInputElement>) => {
    const raw = e.target.value

    // Strip everything except digits and decimal point
    let cleaned = raw.replace(/[^0-9.]/g, '')

    // Only allow one decimal point
    const parts = cleaned.split('.')
    if (parts.length > 2) {
      cleaned = parts[0] + '.' + parts.slice(1).join('')
    }

    // Limit decimal places
    if (decimals === 0) {
      cleaned = cleaned.split('.')[0]
    } else if (parts.length === 2 && parts[1].length > decimals) {
      cleaned = parts[0] + '.' + parts[1].slice(0, decimals)
    }

    // Update raw value (for calculations)
    onChange(cleaned)

    // Format display with separators
    setDisplayValue(formatDisplay(cleaned, decimals))
  }, [onChange, decimals])

  // When currency changes, reformat
  const formatted = formatDisplay(value, decimals)
  if (formatted !== displayValue && document.activeElement !== document.querySelector(`[data-money-input="${currency}"]`)) {
    setDisplayValue(formatted)
  }

  return (
    <input
      type="text"
      inputMode="decimal"
      value={displayValue}
      onChange={handleChange}
      onFocus={() => setDisplayValue(formatDisplay(value, decimals))}
      onBlur={() => setDisplayValue(formatDisplay(value, decimals))}
      placeholder={placeholder}
      className={className}
      autoFocus={autoFocus}
      data-money-input={currency}
    />
  )
}

function formatDisplay(value: string, decimals: number): string {
  if (!value || value === '0') return ''

  const parts = value.split('.')
  const intPart = parts[0]
  const decPart = parts[1]

  // Add thousand separators to integer part
  const formatted = intPart.replace(/\B(?=(\d{3})+(?!\d))/g, ',')

  if (decimals === 0 || !decPart) {
    return decPart !== undefined ? formatted + '.' + decPart : formatted
  }

  return formatted + '.' + decPart
}
