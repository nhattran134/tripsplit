import { useState } from 'react'
import { useParams, useNavigate } from 'react-router-dom'
import { useQuery, useMutation, useQueryClient } from '@tanstack/react-query'
import { useTranslation } from 'react-i18next'
import { ArrowLeft, RefreshCw, Globe, Download, Share2, FileSpreadsheet } from 'lucide-react'
import { supabase } from '@/lib/supabase'
import { COMMON_CURRENCIES, fetchRate } from '@/lib/currency'
import { calculateBalances, simplifyDebts } from '@/lib/settlement'
import { exportCSV, exportTextToClipboard } from '@/lib/export'
import { useCopy } from '@/hooks/useCopy'
import type { Member, Deposit, Expense, ExpenseSplit, Settlement } from '@/types'

export function SettingsPage() {
  const { t } = useTranslation()
  const { tripId } = useParams<{ tripId: string }>()
  const navigate = useNavigate()
  const queryClient = useQueryClient()

  const [fetchingRate, setFetchingRate] = useState(false)
  const [rateFrom, setRateFrom] = useState('')
  const [rateResult, setRateResult] = useState<string | null>(null)
  const { copy, copiedId } = useCopy()

  const { data: trip } = useQuery({
    queryKey: ['trip', tripId],
    queryFn: async () => {
      const { data, error } = await supabase.from('trips').select('*').eq('id', tripId).single()
      if (error) throw error
      return data
    },
  })

  const { data: members = [] } = useQuery({
    queryKey: ['members', tripId],
    queryFn: async () => {
      const { data, error } = await supabase.from('members').select('*').eq('trip_id', tripId).is('deleted_at', null)
      if (error) throw error
      return data as Member[]
    },
  })

  const { data: deposits = [] } = useQuery({
    queryKey: ['deposits', tripId],
    queryFn: async () => {
      const { data, error } = await supabase.from('deposits').select('*').eq('trip_id', tripId).is('deleted_at', null)
      if (error) throw error
      return data as Deposit[]
    },
  })

  const { data: expenses = [] } = useQuery({
    queryKey: ['expenses', tripId],
    queryFn: async () => {
      const { data, error } = await supabase.from('expenses').select('*').eq('trip_id', tripId).is('deleted_at', null)
      if (error) throw error
      return data as Expense[]
    },
  })

  const { data: expenseSplits = [] } = useQuery({
    queryKey: ['expense_splits', tripId],
    queryFn: async () => {
      const { data, error } = await supabase.from('expense_splits').select('*, expenses!inner(trip_id)').eq('expenses.trip_id', tripId).is('expenses.deleted_at', null)
      if (error) throw error
      return (data || []).map((s: any) => ({ id: s.id, expense_id: s.expense_id, member_id: s.member_id, share_amount: Number(s.share_amount) })) as ExpenseSplit[]
    },
  })

  const { data: settlements = [] } = useQuery({
    queryKey: ['settlements', tripId],
    queryFn: async () => {
      const { data, error } = await supabase.from('settlements').select('*').eq('trip_id', tripId).is('deleted_at', null)
      if (error) throw error
      return data as Settlement[]
    },
  })

  const updateCurrencyMutation = useMutation({
    mutationFn: async (newCurrency: string) => {
      const { error } = await supabase
        .from('trips')
        .update({ base_currency: newCurrency })
        .eq('id', tripId)
      if (error) throw new Error(error.message)
    },
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ['trip', tripId] })
    },
  })

  const handleFetchRate = async () => {
    if (!rateFrom || !trip) return
    setFetchingRate(true)
    setRateResult(null)
    const rate = await fetchRate(rateFrom, trip.base_currency)
    if (rate) {
      setRateResult(`1 ${rateFrom} = ${rate.toFixed(4)} ${trip.base_currency}`)
    } else {
      setRateResult('Could not fetch rate. Try again later.')
    }
    setFetchingRate(false)
  }

  const inviteLink = trip ? `${window.location.origin}/t/${trip.invite_code}` : ''

  return (
    <div className="space-y-4">
      <div className="flex items-center gap-3">
        <button onClick={() => navigate(`/trip/${tripId}`)} className="text-indigo-600 dark:text-indigo-400">
          <ArrowLeft size={20} />
        </button>
        <h1 className="text-xl font-bold">{t('settings.title')}</h1>
      </div>

      {trip && (
        <div className="space-y-4">
          {/* Trip Info */}
          <div className="bg-white dark:bg-slate-800 rounded-xl p-4 shadow-sm border border-slate-200 dark:border-slate-700 space-y-3">
            <div>
              <p className="text-sm text-slate-500">{t('settings.tripName')}</p>
              <p className="font-medium">{trip.name}</p>
            </div>
            <div>
              <p className="text-sm text-slate-500">{t('settings.inviteLink')}</p>
              <p className="font-mono text-xs break-all text-slate-600 dark:text-slate-400">{inviteLink}</p>
            </div>
            {trip.short_code && (
              <div>
                <p className="text-sm text-slate-500">{t('dashboard.tripCode')}</p>
                <p className="font-mono font-bold text-lg text-indigo-600">{trip.short_code}</p>
              </div>
            )}
          </div>

          {/* Base Currency Setting */}
          <div className="bg-white dark:bg-slate-800 rounded-xl p-4 shadow-sm border border-slate-200 dark:border-slate-700 space-y-3">
            <div className="flex items-center gap-2">
              <Globe size={16} className="text-slate-500" />
              <p className="font-semibold text-sm">{t('settings.baseCurrency')}</p>
            </div>
            <select
              value={trip.base_currency}
              onChange={(e) => updateCurrencyMutation.mutate(e.target.value)}
              className="w-full px-3 py-2 rounded-lg border border-slate-300 dark:border-slate-600 bg-transparent focus:ring-2 focus:ring-indigo-500 outline-none"
            >
              {COMMON_CURRENCIES.map((c) => <option key={c} value={c}>{c}</option>)}
            </select>
            <p className="text-xs text-slate-400">All amounts shown without currency symbol are in {trip.base_currency}</p>
          </div>

          {/* Exchange Rate Lookup */}
          <div className="bg-white dark:bg-slate-800 rounded-xl p-4 shadow-sm border border-slate-200 dark:border-slate-700 space-y-3">
            <div className="flex items-center gap-2">
              <RefreshCw size={16} className="text-slate-500" />
              <p className="font-semibold text-sm">Exchange Rate</p>
            </div>
            <div className="flex gap-2">
              <select
                value={rateFrom}
                onChange={(e) => setRateFrom(e.target.value)}
                className="flex-1 px-3 py-2 rounded-lg border border-slate-300 dark:border-slate-600 bg-transparent focus:ring-2 focus:ring-indigo-500 outline-none"
              >
                <option value="">From...</option>
                {COMMON_CURRENCIES.filter((c) => c !== trip.base_currency).map((c) => (
                  <option key={c} value={c}>{c}</option>
                ))}
              </select>
              <button
                onClick={handleFetchRate}
                disabled={!rateFrom || fetchingRate}
                className="px-4 py-2 bg-indigo-600 text-white rounded-lg text-sm font-medium hover:bg-indigo-700 disabled:opacity-50 transition-colors"
              >
                {fetchingRate ? '...' : 'Get Rate'}
              </button>
            </div>
            {rateResult && (
              <p className="text-sm font-medium text-indigo-600 dark:text-indigo-400 bg-indigo-50 dark:bg-indigo-900/20 px-3 py-2 rounded-lg">
                {rateResult}
              </p>
            )}
            <p className="text-xs text-slate-400">Mid-market rate (ECB data). Use this when entering expenses in foreign currencies.</p>
          </div>

          {/* Export */}
          <div className="bg-white dark:bg-slate-800 rounded-xl p-4 shadow-sm border border-slate-200 dark:border-slate-700 space-y-3">
            <div className="flex items-center gap-2">
              <Download size={16} className="text-slate-500" />
              <p className="font-semibold text-sm">Export</p>
            </div>
            <div className="flex gap-2">
              <button
                onClick={() => {
                  if (!trip) return
                  const balances = calculateBalances(members, deposits, expenseSplits, settlements)
                  const transfers = simplifyDebts(balances, members)
                  exportCSV({ tripName: trip.name, baseCurrency: trip.base_currency, members, deposits, expenses, expenseSplits, settlements, balances, transfers })
                }}
                className="flex-1 flex items-center justify-center gap-2 py-2.5 rounded-lg border border-slate-300 dark:border-slate-600 text-sm font-medium hover:bg-slate-50 dark:hover:bg-slate-700 transition-colors"
              >
                <FileSpreadsheet size={16} />
                CSV / Excel
              </button>
              <button
                onClick={() => {
                  if (!trip) return
                  const balances = calculateBalances(members, deposits, expenseSplits, settlements)
                  const transfers = simplifyDebts(balances, members)
                  exportTextToClipboard({ tripName: trip.name, baseCurrency: trip.base_currency, members, deposits, expenses, expenseSplits, settlements, balances, transfers })
                  copy('exported', 'text-export')
                }}
                className={`flex-1 flex items-center justify-center gap-2 py-2.5 rounded-lg border text-sm font-medium transition-all duration-200 ${
                  copiedId === 'text-export'
                    ? 'border-green-400 bg-green-50 dark:bg-green-900/30 text-green-600'
                    : 'border-slate-300 dark:border-slate-600 hover:bg-slate-50 dark:hover:bg-slate-700'
                }`}
              >
                <Share2 size={16} />
                {copiedId === 'text-export' ? '✓ Copied!' : 'Share Text'}
              </button>
            </div>
            <p className="text-xs text-slate-400">CSV downloads a file. Share Text copies a summary to clipboard for messaging apps.</p>
          </div>

          {/* Language */}
          <div className="bg-white dark:bg-slate-800 rounded-xl p-4 shadow-sm border border-slate-200 dark:border-slate-700">
            <p className="font-semibold text-sm mb-2">{t('settings.language')}</p>
            <div className="flex gap-2">
              <button
                onClick={() => { import('i18next').then(i18n => { i18n.default.changeLanguage('en'); localStorage.setItem('tripsplit-lang', 'en') }) }}
                className="flex-1 py-2 rounded-lg border border-slate-300 dark:border-slate-600 text-sm font-medium hover:bg-slate-50 dark:hover:bg-slate-700"
              >
                🇬🇧 English
              </button>
              <button
                onClick={() => { import('i18next').then(i18n => { i18n.default.changeLanguage('vi'); localStorage.setItem('tripsplit-lang', 'vi') }) }}
                className="flex-1 py-2 rounded-lg border border-slate-300 dark:border-slate-600 text-sm font-medium hover:bg-slate-50 dark:hover:bg-slate-700"
              >
                🇻🇳 Tiếng Việt
              </button>
            </div>
          </div>
        </div>
      )}
    </div>
  )
}
