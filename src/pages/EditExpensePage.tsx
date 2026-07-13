import { useState, useRef, useMemo, useEffect } from 'react'
import { useParams, useNavigate } from 'react-router-dom'
import { useQuery, useMutation, useQueryClient } from '@tanstack/react-query'
import { useTranslation } from 'react-i18next'
import { supabase } from '@/lib/supabase'
import { calculateEqualSplit, validateCustomSplit } from '@/lib/splits'
import { formatCurrency, COMMON_CURRENCIES, fetchRate } from '@/lib/currency'
import { generateId } from '@/lib/utils'
import { MoneyInput } from '@/components/common/MoneyInput'
import type { Member, Expense } from '@/types'

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

export function EditExpensePage() {
  const { tripId, expenseId } = useParams<{ tripId: string; expenseId: string }>()
  const navigate = useNavigate()
  const queryClient = useQueryClient()
  const { t } = useTranslation()

  const [amount, setAmount] = useState('')
  const [currency, setCurrency] = useState('')
  const [rateToBase, setRateToBase] = useState('1')
  const [fetchingRate, setFetchingRate] = useState(false)
  const [category, setCategory] = useState('food')
  const [description, setDescription] = useState('')
  const [date, setDate] = useState('')
  const [paidBy, setPaidBy] = useState('')
  const [paidFrom, setPaidFrom] = useState<'pool' | 'pocket'>('pocket')
  const [splitType, setSplitType] = useState<'equal' | 'custom' | 'specific'>('equal')
  const [selectedMembers, setSelectedMembers] = useState<string[]>([])
  const [customAmounts, setCustomAmounts] = useState<Record<string, string>>({})
  const [error, setError] = useState('')
  const [loaded, setLoaded] = useState(false)
  const submittingRef = useRef(false)

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
      const { data, error } = await supabase
        .from('members').select('*').eq('trip_id', tripId).is('deleted_at', null)
      if (error) throw error
      return data as Member[]
    },
  })

  const { data: expense } = useQuery({
    queryKey: ['expense-detail', expenseId],
    queryFn: async () => {
      const { data, error } = await supabase.from('expenses').select('*').eq('id', expenseId).single()
      if (error) throw error
      return data as Expense
    },
  })

  const { data: existingSplits = [] } = useQuery({
    queryKey: ['expense-splits-detail', expenseId],
    queryFn: async () => {
      const { data, error } = await supabase.from('expense_splits').select('*').eq('expense_id', expenseId)
      if (error) throw error
      return data as { id: string; expense_id: string; member_id: string; share_amount: number }[]
    },
  })

  const { data: expenses = [] } = useQuery({
    queryKey: ['expenses-count', tripId],
    queryFn: async () => {
      const { data, error } = await supabase
        .from('expenses').select('id').eq('trip_id', tripId).is('deleted_at', null)
      if (error) throw error
      return data
    },
  })

  const { data: memberGroups = [] } = useQuery({
    queryKey: ['member-groups', tripId],
    queryFn: async () => {
      const { data, error } = await supabase.from('member_groups').select('*').eq('trip_id', tripId)
      if (error) throw error
      return data as { id: string; trip_id: string; name: string }[]
    },
  })

  // Pre-fill form with existing expense data
  useEffect(() => {
    if (expense && existingSplits.length >= 0 && !loaded) {
      setAmount(String(expense.amount))
      setCurrency(expense.currency)
      setRateToBase(String(expense.rate_to_base))
      setCategory(expense.category || 'food')
      setDescription(expense.description || '')
      setDate(expense.date || '')
      setPaidBy(expense.member_id)
      setPaidFrom(expense.paid_from || 'pocket')
      setSplitType(expense.split_type || 'equal')
      if (existingSplits.length > 0) {
        setSelectedMembers(existingSplits.map(s => s.member_id))
        if (expense.split_type === 'custom') {
          const amounts: Record<string, string> = {}
          for (const s of existingSplits) {
            amounts[s.member_id] = String(s.share_amount)
          }
          setCustomAmounts(amounts)
        }
      } else {
        setSelectedMembers(members.map(m => m.id))
      }
      setLoaded(true)
    }
  }, [expense, existingSplits, members, loaded])

  const groupWeights = useMemo(() => {
    if (memberGroups.length === 0) return undefined
    const weights: Record<string, number> = {}
    let hasGroupedMembers = false
    for (const member of members) {
      if (member.group_id) {
        const groupSize = members.filter(m => m.group_id === member.group_id).length
        weights[member.id] = 1 / groupSize
        hasGroupedMembers = true
      } else {
        weights[member.id] = 1
      }
    }
    return hasGroupedMembers ? weights : undefined
  }, [members, memberGroups])

  const mutation = useMutation({
    mutationFn: async () => {
      if (submittingRef.current) return
      submittingRef.current = true

      const numAmount = parseFloat(amount)
      if (!numAmount || numAmount <= 0) throw new Error('Enter a valid amount')
      if (!paidBy && paidFrom === 'pocket') throw new Error('Select who paid')

      const splitMembers = splitType === 'equal' ? members.map(m => m.id) : selectedMembers
      if (splitMembers.length === 0) throw new Error('Select at least one member to split with')

      const numRate = parseFloat(rateToBase) || 1
      const baseAmount = numAmount * numRate
      const baseCurrency = trip?.base_currency || 'VND'

      let splits: { member_id: string; share_amount: number }[]
      if (splitType === 'equal' || splitType === 'specific') {
        splits = calculateEqualSplit(baseAmount, splitMembers, baseCurrency, groupWeights, expenses.length)
      } else {
        const parsed: Record<string, number> = {}
        for (const id of selectedMembers) {
          parsed[id] = parseFloat(customAmounts[id] || '0')
        }
        const validation = validateCustomSplit(parsed, baseAmount, baseCurrency)
        if (!validation.valid) {
          throw new Error(`Split amounts don't add up. Difference: ${validation.diff.toFixed(2)}`)
        }
        splits = selectedMembers.map(id => ({ member_id: id, share_amount: parsed[id] || 0 }))
      }

      // Update expense record
      const { error: expError } = await supabase.from('expenses').update({
        member_id: paidBy,
        amount: numAmount,
        currency: currency || baseCurrency,
        rate_to_base: numRate,
        category,
        description: description.trim(),
        date,
        split_type: splitType,
        paid_from: paidFrom,
      }).eq('id', expenseId)
      if (expError) throw new Error(expError.message)

      // Delete old splits
      const { error: delError } = await supabase.from('expense_splits').delete().eq('expense_id', expenseId)
      if (delError) throw new Error(delError.message)

      // Insert new splits
      const splitRows = splits.map(s => ({
        id: generateId(),
        expense_id: expenseId,
        member_id: s.member_id,
        share_amount: s.share_amount,
      }))
      const { error: splitError } = await supabase.from('expense_splits').insert(splitRows)
      if (splitError) throw new Error(splitError.message)
    },
    onSuccess: () => {
      submittingRef.current = false
      queryClient.removeQueries({ queryKey: ['expenses', tripId] })
      queryClient.removeQueries({ queryKey: ['expense_splits', tripId] })
      queryClient.removeQueries({ queryKey: ['recent-expenses', tripId] })
      queryClient.removeQueries({ queryKey: ['expenses-count', tripId] })
      navigate(`/trip/${tripId}/history`)
    },
    onError: (e) => {
      submittingRef.current = false
      setError(e instanceof Error ? e.message : 'Failed to update expense')
    },
  })

  const baseCurrency = trip?.base_currency || 'VND'
  const isSameCurrency = !currency || currency === baseCurrency

  const toggleMember = (id: string) => {
    setSelectedMembers(prev =>
      prev.includes(id) ? prev.filter(m => m !== id) : [...prev, id]
    )
  }

  return (
    <div className="space-y-4 pb-8">
      <div className="flex items-center gap-3">
        <button onClick={() => navigate(`/trip/${tripId}/history`)} className="text-indigo-600 dark:text-indigo-400">←</button>
        <h1 className="text-xl font-bold">{t('expense.edit')}</h1>
      </div>

      {/* Amount + Currency */}
      <div className="flex gap-2">
        <div className="flex-1">
          <label className="text-sm font-medium text-slate-600 dark:text-slate-300">{t('expense.amount')}</label>
          <MoneyInput
            value={amount}
            onChange={setAmount}
            currency={currency || baseCurrency}
            placeholder="0"
            className="mt-1 w-full px-3 py-2 rounded-lg border border-slate-300 dark:border-slate-600 bg-transparent focus:ring-2 focus:ring-indigo-500 outline-none text-lg"
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
            {COMMON_CURRENCIES.map(c => <option key={c} value={c}>{c}</option>)}
          </select>
        </div>
      </div>

      {/* Exchange Rate */}
      {!isSameCurrency && (
        <div>
          <label className="text-sm font-medium text-slate-600 dark:text-slate-300">
            {t('expense.rateLabel', { from: currency, to: baseCurrency })}
            {fetchingRate && <span className="ml-2 text-xs text-indigo-500 animate-pulse">{t('expense.fetching')}</span>}
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
          {CATEGORIES.map(cat => (
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
      {paidFrom === 'pocket' && (
        <div>
          <label className="text-sm font-medium text-slate-600 dark:text-slate-300">{t('expense.paidBy')}</label>
          <div className="mt-1 flex flex-wrap gap-2">
            {members.map(m => (
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
      )}

      {/* Paid From */}
      <div>
        <label className="text-sm font-medium text-slate-600 dark:text-slate-300">{t('expense.paidFrom')}</label>
        <div className="mt-1 flex gap-2">
          <button
            onClick={() => setPaidFrom('pool')}
            className={`flex-1 py-2 rounded-lg text-sm font-medium border ${
              paidFrom === 'pool'
                ? 'border-indigo-500 bg-indigo-50 dark:bg-indigo-900/30'
                : 'border-slate-200 dark:border-slate-700'
            }`}
          >
            {t('expense.poolOption')}
          </button>
          <button
            onClick={() => setPaidFrom('pocket')}
            className={`flex-1 py-2 rounded-lg text-sm font-medium border ${
              paidFrom === 'pocket'
                ? 'border-indigo-500 bg-indigo-50 dark:bg-indigo-900/30'
                : 'border-slate-200 dark:border-slate-700'
            }`}
          >
            {t('expense.pocketOption')}
          </button>
        </div>
      </div>

      {/* Split Type */}
      <div>
        <label className="text-sm font-medium text-slate-600 dark:text-slate-300">{t('expense.split')}</label>
        <div className="mt-1 flex gap-2">
          {(['equal', 'specific', 'custom'] as const).map(type => (
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
            {members.map(m => (
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
        disabled={mutation.isPending || submittingRef.current}
        className="w-full py-3 rounded-lg bg-indigo-600 text-white font-medium hover:bg-indigo-700 disabled:opacity-50 transition-colors"
      >
        {mutation.isPending ? t('expense.saving') : t('expense.edit')}
      </button>
    </div>
  )
}
