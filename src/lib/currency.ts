const ZERO_DECIMAL_CURRENCIES = new Set(['JPY', 'KRW', 'VND', 'IDR', 'CLP', 'ISK', 'UGX', 'GNF', 'RWF'])

export function getCurrencyDecimals(currency: string): number {
  return ZERO_DECIMAL_CURRENCIES.has(currency.toUpperCase()) ? 0 : 2
}

export function roundForCurrency(value: number, currency: string): number {
  const decimals = getCurrencyDecimals(currency)
  const factor = Math.pow(10, decimals)
  return Math.round(value * factor) / factor
}

export function formatCurrency(amount: number, currency: string): string {
  const decimals = getCurrencyDecimals(currency)
  try {
    return new Intl.NumberFormat(undefined, {
      style: 'currency',
      currency: currency,
      minimumFractionDigits: decimals,
      maximumFractionDigits: decimals,
    }).format(amount)
  } catch {
    return `${amount.toFixed(decimals)} ${currency}`
  }
}

/**
 * Fetch exchange rate.
 * rate_to_base means: 1 unit of fromCurrency = X units of baseCurrency
 * Uses frankfurter.app (free, no API key, CORS-friendly, ECB data).
 */
export async function fetchRate(fromCurrency: string, baseCurrency: string): Promise<number | null> {
  if (fromCurrency === baseCurrency) return 1

  try {
    const response = await fetch(
      `https://api.frankfurter.app/latest?from=${fromCurrency}&to=${baseCurrency}`
    )
    if (response.ok) {
      const data = await response.json()
      if (data?.rates?.[baseCurrency]) {
        return data.rates[baseCurrency]
      }
    }
  } catch {
    // Fallback silently
  }

  try {
    // Fallback: exchangerate.host
    const response = await fetch(
      `https://api.exchangerate.host/convert?from=${fromCurrency}&to=${baseCurrency}&amount=1`
    )
    const data = await response.json()
    if (data.success && data.result) {
      return data.result
    }
  } catch {
    // Both failed
  }

  return null
}

/**
 * Format amount without currency symbol (for displaying in base currency context)
 */
export function formatAmount(amount: number, currency: string): string {
  const decimals = getCurrencyDecimals(currency)
  return new Intl.NumberFormat(undefined, {
    minimumFractionDigits: decimals,
    maximumFractionDigits: decimals,
  }).format(amount)
}

export const COMMON_CURRENCIES = [
  'VND', 'USD', 'EUR', 'JPY', 'THB', 'SGD', 'KRW', 'AUD', 'GBP', 'MYR', 'PHP', 'IDR', 'TWD', 'CNY',
]
