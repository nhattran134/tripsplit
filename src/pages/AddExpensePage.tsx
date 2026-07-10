import { useState } from 'react'
import { useParams, useNavigate } from 'react-router-dom'
import { useQuery, useMutation, useQueryClient } from '@tanstack/react-query'
import { useTranslation } from 'react-i18next'
import { supabase } from '@/lib/supabase'
import { calculateEqualSplit, validateCustomSplit } from '@/lib/splits'
import { formatCurrency, COMMON_CURRENCIES, fetchRate } from '@/lib/currency'
import { generateId } from '@/lib/utils'
import type { Member } from '@/types'

const CATEGORIES = [
  { value: 'food', label: '🍜 Food', emoji: '🍜' },
  { value: 'transport', label: '🚗 Transport', emoji: '🚗' },
  { value: 'accommodation', label: '🏨 Accommodation', emoji: '🏨' },
  { value: 'activities', label: '🎫 Activities', emoji: '🎫' },
  { value: 'shopping', label: '🛒 Shopping', emoji: '🛒' },
  { value: 'telecom', label: '📱 Telecom', emoji: '📱' },
  { value: 'medical', label: '⚕️ Medical', emoji: '⚕️' },
  { value: 'other', label: '📦 Other', emoji: '📦' },
]

export function AddExpensePage() {
  const { tripId } = useParams<{ tripId: string }>()
  const navigate = useNavigate()
  const queryClient = useQueryClient()
  const { t } = useTranslation()

  const [amount, setAmount] = useState('')
  const [currency, setCurrency] = useState('')
  const [rateToBase, setRateToBase] = useState('1')
  const [fetchingRate, setFetchingRate] = useState(false)
  const [category, setCategory] = useState('food')
  const [description, setDescription] = useState('')
  const [date, setDate] = useState(new Date().toISOString().split('T')[0])
  const [paidBy, setPaidBy] = useState('')
  const [splitType, setSplitType] = useState<'equal' | 'custom' | 'specific'>('equal')
  const [selectedMembers, setSelectedMembers] = useState<string[]>([])
  const [customAmounts, setCustomAmounts] = useState<Record<string, string>>({})
  const [error, setError] = useState('')

  const { data: trip } = useQuery({
    queryKey: ['trip', tripId],
    queryFn: async () => {
      const { data, error } = await supabase.from('trips').select('*').eq('id', tripId).single()
      if (error) throw error
      if (!currency) setCurrency(data.base_currency)
      return data
    },
  })

  const { data: members = [] } = useQuery({
    queryKey: ['members', tripId],
    queryFn: async () => {
      const { data, error } = await supabase
        .from('members').select('*').eq('trip_id', tripId).is('deleted_at', null)
      if (error) throw error
      if (!paidBy && data.length > 0) setPaidBy(data[0].id)
      if (selectedMembers.length === 0) setSelectedMembers(data.map((m: Member) => m.id))
      return data as Member[]
    },
  })

  const mutation = useMutation({
    mutationFn: async () => {
      const numAmount = parseFloat(amount)
      if (!numAmount || numAmount <= 0) throw new Error('Enter a valid amount')
      if (!paidBy) throw new Error('Select who paid')

      // For equal split, always use all members; for specific/custom, use selection
      const splitMembers = splitType === 'equal' ? members.map((m) => m.id) : selectedMembers
      if (splitMembers.length === 0) throw new Error('Select at least one member to split with')

      const numRate = parseFloat(rateToBase) || 1
      const baseAmount = numAmount * numRate
      const baseCurrency = trip?.base_currency || 'VND'

      let splits: { member_id: string; share_amount: number }[]
      if (splitType === 'equal' || splitType === 'specific') {
        splits = calculateEqualSplit(baseAmount, splitMembers, baseCurrency)
      } else {
        const parsed: Record<string, number> = {}
        for (const id of selectedMembers) {
          parsed[id] = parseFloat(customAmounts[id] || '0')
        }
        const validation = validateCustomSplit(parsed, baseAmount, baseCurrency)
        if (!validation.valid) {
          throw new Error(`Split amounts don't add up. Difference: ${validation.diff.toFixed(2)}`)
        }
        splits = selectedMembers.map((id) => ({ member_id: id, share_amount: parsed[id] || 0 }))
      }

      const expenseId = generateId()
      const { error: expError } = await supabase.from('expenses').insert({
        id: expenseId,
        trip_id: tripId,
        member_id: paidBy,
        amount: numAmount,
        currency: currency || baseCurrency,
        rate_to_base: numRate,
        category,
        description: description.trim(),
        date,
        split_type: splitType,
      })
      if (expError) throw new Error(expError.message)

      const splitRows = splits.map((s) => ({
        id: generateId(),
        expense_id: expenseId,
        member_id: s.member_id,
        share_amount: s.share_amount,
      }))
      const { error: splitError } = await supabase.from('expense_splits').insert(splitRows)
      if (splitError) throw new Error(splitError.message)
    },
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ['expenses', tripId] })
      queryClient.invalidateQueries({ queryKey: ['expense_splits', tripId] })
      navigate(`/trip/${tripId}`)
    },
    onError: (e) => setError(e instanceof Error ? e.message : 'Failed to add expense'),
  })

  const baseCurrency = trip?.base_currency || 'VND'
  const isSameCurrency = !currency || currency === baseCurrency

  const toggleMember = (id: string) => {
    setSelectedMembers((prev) =>
      prev.includes(id) ? prev.filter((m) => m !== id) : [...prev, id]
    )
  }

  return (
    <div className="space-y-4 pb-8">
      <div className="flex items-center gap-3">
        <button onClick={() => navigate(`/trip/${tripId}`)} className="text-indigo-600 dark:text-indigo-400">←</button>
        <h1 className="text-xl font-bold">{t('expense.title')}</h1>
      </div>

      {/* Amount + Currency */}
      <div className="flex gap-2">
        <div className="flex-1">
          <label className="text-sm font-medium text-slate-600 dark:text-slate-300">{t('expense.amount')}</label>
          <input
            type="number"
            inputMode="decimal"
            value={amount}
            onChange={(e) => setAmount(e.target.value)}
            placeholder="0.00"
            className="mt-1 w-full px-3 py-2 rounded-lg border border-slate-300 dark:border-slate-600 bg-transparent focus:ring-2 focus:ring-indigo-500 outline-none text-lg"
            autoFocus
          />
        </div>
        <div className="w-24">
          <label className="text-sm font-medium text-slate-600 dark:text-slate-300">{t('expense.currency')}</label>
          <select
            value={currency}
            onChange={async (e) => {
              const newCurrency = e.target.value
              setCurrency(newCurrency)
              const baseCurr = trip?.base_currency || 'VND'
              if (newCurrency !== baseCurr) {
                setFetchingRate(true)
                const rate = await fetchRate(newCurrency, baseCurr)
                if (rate) setRateToBase(rate.toString())
                setFetchingRate(false)
              } else {
                setRateToBase('1')
              }
            }}
            className="mt-1 w-full px-2 py-2 rounded-lg border border-slate-300 dark:border-slate-600 bg-transparent focus:ring-2 focus:ring-indigo-500 outline-none"
          >
            {COMMON_CURRENCIES.map((c) => <option key={c} value={c}>{c}</option>)}
          </select>
        </div>
      </div>

      {/* Exchange Rate (if different currency) */}
      {!isSameCurrency && (
        <div>
          <label className="text-sm font-medium text-slate-600 dark:text-slate-300">
            Rate (1 {currency} = ? {baseCurrency})
            {fetchingRate && <span className="ml-2 text-xs text-indigo-500 animate-pulse">fetching...</span>}
          </label>
          <input
            type="number"
            inputMode="decimal"
            value={rateToBase}
            onChange={(e) => setRateToBase(e.target.value)}
            className={`mt-1 w-full px-3 py-2 rounded-lg border bg-transparent focus:ring-2 focus:ring-indigo-500 outline-none transition-colors ${
              fetchingRate ? 'border-indigo-300 bg-indigo-50/50' : 'border-slate-300 dark:border-slate-600'
            }`}
          />
          {amount && <p className="text-xs text-slate-500 mt-1">= {formatCurrency(parseFloat(amount) * parseFloat(rateToBase || '1'), baseCurrency)}</p>}
        </div>
      )}

      {/* Category */}
      <div>
        <label className="text-sm font-medium text-slate-600 dark:text-slate-300">{t('expense.category')}</label>
        <div className="mt-1 grid grid-cols-4 gap-2">
          {CATEGORIES.map((cat) => (
            <button
              key={cat.value}
              onClick={() => setCategory(cat.value)}
              className={`p-2 rounded-lg border text-center text-sm ${
                category === cat.value
                  ? 'border-indigo-500 bg-indigo-50 dark:bg-indigo-900/30'
                  : 'border-slate-200 dark:border-slate-700'
              }`}
            >
              <span className="text-lg">{cat.emoji}</span>
              <p className="text-[10px] mt-0.5">{cat.value}</p>
            </button>
          ))}
        </div>
      </div>

      {/* Description + Date */}
      <div className="grid grid-cols-[1fr_auto] gap-2 items-end">
        <div>
          <label className="text-sm font-medium text-slate-600 dark:text-slate-300">{t('expense.description')}</label>
          <input
            type="text"
            value={description}
            onChange={(e) => setDescription(e.target.value)}
            placeholder={t('expense.descPlaceholder')}
            className="mt-1 w-full px-3 py-2 rounded-lg border border-slate-300 dark:border-slate-600 bg-transparent focus:ring-2 focus:ring-indigo-500 outline-none"
          />
        </div>
        <div>
          <label className="text-sm font-medium text-slate-600 dark:text-slate-300">{t('expense.date')}</label>
          <input
            type="date"
            value={date}
            onChange={(e) => setDate(e.target.value)}
            className="mt-1 w-full px-3 py-2 rounded-lg border border-slate-300 dark:border-slate-600 bg-transparent focus:ring-2 focus:ring-indigo-500 outline-none"
          />
        </div>
      </div>

      {/* Paid By */}
      <div>
        <label className="text-sm font-medium text-slate-600 dark:text-slate-300">{t('expense.paidBy')}</label>
        <div className="mt-1 flex flex-wrap gap-2">
          {members.map((m) => (
            <button
              key={m.id}
              onClick={() => setPaidBy(m.id)}
              className={`px-3 py-1.5 rounded-full text-sm font-medium border ${
                paidBy === m.id
                  ? 'border-indigo-500 bg-indigo-50 dark:bg-indigo-900/30 text-indigo-700 dark:text-indigo-300'
                  : 'border-slate-200 dark:border-slate-700 text-slate-600 dark:text-slate-400'
              }`}
            >
              {m.name}
            </button>
          ))}
        </div>
      </div>

      {/* Split Type */}
      <div>
        <label className="text-sm font-medium text-slate-600 dark:text-slate-300">{t('expense.split')}</label>
        <div className="mt-1 flex gap-2">
          {(['equal', 'specific', 'custom'] as const).map((type) => (
            <button
              key={type}
              onClick={() => setSplitType(type)}
              className={`flex-1 py-2 rounded-lg text-sm font-medium border ${
                splitType === type
                  ? 'border-indigo-500 bg-indigo-50 dark:bg-indigo-900/30'
                  : 'border-slate-200 dark:border-slate-700'
              }`}
            >
              {type === 'equal' ? t('expense.equal') : type === 'specific' ? t('expense.select') : t('expense.custom')}
            </button>
          ))}
        </div>
      </div>

      {/* Member Selection (for specific/custom) */}
      {(splitType === 'specific' || splitType === 'custom') && (
        <div>
          <label className="text-sm font-medium text-slate-600 dark:text-slate-300">{t('expense.splitAmong')}</label>
          <div className="mt-1 space-y-2">
            {members.map((m) => (
              <div key={m.id} className="flex items-center gap-2">
                <button
                  onClick={() => toggleMember(m.id)}
                  className={`w-6 h-6 rounded border flex items-center justify-center ${
                    selectedMembers.includes(m.id)
                      ? 'bg-indigo-600 border-indigo-600 text-white'
                      : 'border-slate-300 dark:border-slate-600'
                  }`}
                >
                  {selectedMembers.includes(m.id) && '✓'}
                </button>
                <span className="text-sm flex-1">{m.name}</span>
                {splitType === 'custom' && selectedMembers.includes(m.id) && (
                  <input
                    type="number"
                    inputMode="decimal"
                    value={customAmounts[m.id] || ''}
                    onChange={(e) => setCustomAmounts({ ...customAmounts, [m.id]: e.target.value })}
                    placeholder="0.00"
                    className="w-24 px-2 py-1 rounded border border-slate-300 dark:border-slate-600 bg-transparent text-sm text-right"
                  />
                )}
              </div>
            ))}
          </div>
          {splitType === 'custom' && amount && (
            <p className="text-xs text-slate-500 mt-2">
              {t('expense.totalInBase')}: {formatCurrency(parseFloat(amount) * parseFloat(rateToBase || '1'), baseCurrency)}
            </p>
          )}
        </div>
      )}

      {error && <p className="text-red-500 text-sm">{error}</p>}

      <button
        onClick={() => mutation.mutate()}
        disabled={mutation.isPending}
        className="w-full py-3 rounded-lg bg-indigo-600 text-white font-medium hover:bg-indigo-700 disabled:opacity-50 transition-colors"
      >
        {mutation.isPending ? t('expense.saving') : t('expense.addButton')}
      </button>
    </div>
  )
}
