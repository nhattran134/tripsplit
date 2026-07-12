import { useState, useRef, useMemo } from 'react'
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
  const [paidFrom, setPaidFrom] = useState<'pool' | 'pocket'>('pocket')
  const [splitType, setSplitType] = useState<'equal' | 'custom' | 'specific'>('equal')
  const [selectedMembers, setSelectedMembers] = useState<string[]>([])
  const [customAmounts, setCustomAmounts] = useState<Record<string, string>>({})
  const [error, setError] = useState('')
  const [receiptFile, setReceiptFile] = useState<File | null>(null)
  const submittingRef = useRef(false)

  const { data: trip } = useQuery({
    queryKey: ['trip', tripId],
    queryFn: async () => {
      const { data, error } = await supabase.from('trips').select('*').eq('id', tripId).single()
      if (error) throw error
      if (!currency) setCurrency(data.base_currency)
      return data
    },
  })

  const { data: currentSession } = useQuery({
    queryKey: ['session'],
    queryFn: async () => {
      const { data } = await supabase.auth.getSession()
      return data.session
    },
  })
  const currentAuthUid = currentSession?.user?.id

  const { data: members = [] } = useQuery({
    queryKey: ['members', tripId],
    queryFn: async () => {
      const { data, error } = await supabase
        .from('members').select('*').eq('trip_id', tripId).is('deleted_at', null)
      if (error) throw error
      if (!paidBy && data.length > 0) {
        const myMember = data.find((m: Member) => m.auth_uid === currentAuthUid)
        setPaidBy(myMember?.id || data[0].id)
      }
      if (selectedMembers.length === 0) setSelectedMembers(data.map((m: Member) => m.id))
      return data as Member[]
    },
  })

  const { data: deposits = [] } = useQuery({
    queryKey: ['deposits', tripId],
    queryFn: async () => {
      const { data, error } = await supabase.from('deposits').select('amount, rate_to_base').eq('trip_id', tripId).is('deleted_at', null)
      if (error) throw error
      return data || []
    },
  })

  const poolTotal = deposits.reduce((sum, d) => sum + (Number(d.amount) || 0) * (Number(d.rate_to_base) || 1), 0)
  const hasPool = poolTotal > 0

  const { data: expenses = [] } = useQuery({
    queryKey: ['expenses', tripId],
    queryFn: async () => {
      const { data, error } = await supabase
        .from('expenses').select('id').eq('trip_id', tripId).is('deleted_at', null)
      if (error) throw error
      return data
    },
  })

  // Feature 3: Query member groups for weighted split
  const { data: memberGroups = [] } = useQuery({
    queryKey: ['member-groups', tripId],
    queryFn: async () => {
      const { data, error } = await supabase.from('member_groups').select('*').eq('trip_id', tripId)
      if (error) throw error
      return data as { id: string; trip_id: string; name: string }[]
    },
  })

  // Feature 6: Query last 5 expenses for repeat functionality
  const { data: recentExpenses = [] } = useQuery({
    queryKey: ['recent-expenses', tripId],
    queryFn: async () => {
      const { data, error } = await supabase
        .from('expenses')
        .select('*, expense_splits(member_id)')
        .eq('trip_id', tripId)
        .is('deleted_at', null)
        .order('created_at', { ascending: false })
        .limit(5)
      if (error) throw error
      return data as (Expense & { expense_splits: { member_id: string }[] })[]
    },
  })

  // Feature 3: Compute weights based on group membership
  const groupWeights = useMemo(() => {
    if (memberGroups.length === 0) return undefined
    const weights: Record<string, number> = {}
    let hasGroupedMembers = false
    for (const member of members) {
      if (member.group_id) {
        // Count members in same group
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
      // For pool expenses, use current user as record-keeper (not first member in array)
      const myMember = members.find(m => m.auth_uid === currentAuthUid)
      const actualPayer = paidBy || myMember?.id || members[0]?.id
      if (!actualPayer) throw new Error('No members found')

      // For equal split, always use all members; for specific/custom, use selection
      const splitMembers = splitType === 'equal' ? members.map((m) => m.id) : selectedMembers
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
        splits = selectedMembers.map((id) => ({ member_id: id, share_amount: parsed[id] || 0 }))
      }

      const expenseId = generateId()
      const { error: expError } = await supabase.from('expenses').insert({
        id: expenseId,
        trip_id: tripId,
        member_id: actualPayer,
        amount: numAmount,
        currency: currency || baseCurrency,
        rate_to_base: numRate,
        category,
        description: description.trim(),
        date,
        split_type: splitType,
        paid_from: paidFrom,
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

      // Upload receipt photo if provided
      if (receiptFile) {
        const ext = receiptFile.name.split('.').pop() || 'jpg'
        const path = `receipts/${tripId}/${expenseId}.${ext}`
        await supabase.storage.from('receipts').upload(path, receiptFile)
        const { data: urlData } = supabase.storage.from('receipts').getPublicUrl(path)
        await supabase.from('expenses').update({ receipt_url: urlData.publicUrl }).eq('id', expenseId)
      }
    },
    onSuccess: () => {
      submittingRef.current = false
      queryClient.invalidateQueries({ queryKey: ['expenses', tripId] })
      queryClient.invalidateQueries({ queryKey: ['expense_splits', tripId] })
      navigate(`/trip/${tripId}`)
    },
    onError: (e) => {
      submittingRef.current = false
      setError(e instanceof Error ? e.message : 'Failed to add expense')
    },
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

      {/* Feature 6: Recent expenses for quick repeat */}
      {recentExpenses.length > 0 && (
        <div>
          <p className="text-xs text-slate-500 mb-1.5">{t('expense.recent')} <span className="text-slate-400">— {t('expense.repeatHint')}</span></p>
          <div className="flex flex-wrap gap-1.5">
            {recentExpenses.map((exp) => (
              <button
                key={exp.id}
                onClick={() => {
                  setAmount(String(exp.amount))
                  setCategory(exp.category || 'food')
                  setDescription(exp.description || '')
                  setPaidFrom(exp.paid_from || 'pocket')
                  if (exp.member_id) setPaidBy(exp.member_id)
                  if (exp.expense_splits?.length) {
                    setSelectedMembers(exp.expense_splits.map((s: { member_id: string }) => s.member_id))
                  }
                  setSplitType(exp.split_type || 'equal')
                  if (exp.currency && exp.currency !== baseCurrency) {
                    setCurrency(exp.currency)
                    setRateToBase(String(exp.rate_to_base))
                  }
                }}
                className="px-2.5 py-1 rounded-full text-xs font-medium border border-slate-200 dark:border-slate-700 bg-slate-50 dark:bg-slate-800 hover:border-indigo-400 hover:bg-indigo-50 dark:hover:bg-indigo-900/20 transition-colors truncate max-w-[150px]"
              >
                {exp.description || exp.category} • {formatCurrency(Number(exp.amount) * Number(exp.rate_to_base), baseCurrency)}
              </button>
            ))}
          </div>
        </div>
      )}

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
          {!fetchingRate && rateToBase === '1' && currency !== '' && (
            <p className="text-xs text-amber-500 mt-1">{t('expense.rateWarning')}</p>
          )}
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

      {/* Receipt photo (optional) */}
      <div>
        <label className="text-sm font-medium text-slate-600 dark:text-slate-300">{t('expense.receipt')}</label>
        <input
          type="file"
          accept="image/*"
          capture="environment"
          onChange={(e) => {
            const file = e.target.files?.[0]
            if (!file) return
            setReceiptFile(file)
          }}
          className="mt-1 w-full text-sm text-slate-500 file:mr-2 file:py-1 file:px-3 file:rounded-lg file:border-0 file:text-sm file:font-medium file:bg-indigo-50 file:text-indigo-700 dark:file:bg-indigo-900/30 dark:file:text-indigo-300"
        />
      </div>

      {/* Paid By - only relevant for pocket expenses */}
      {paidFrom === 'pocket' && (
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
      )}

      {/* Paid From */}
      {hasPool ? (
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
        <p className="text-[10px] text-slate-400 mt-1">
          {paidFrom === 'pool' ? t('expense.paidFromPool') : t('expense.paidFromPocket')}
        </p>
      </div>
      ) : (
      <div className="px-3 py-2 rounded-lg bg-slate-100 dark:bg-slate-700 text-xs text-slate-500">
        👛 {t('expense.noPoolHint')}
      </div>
      )}

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
        {splitType === 'equal' && groupWeights && (
          <p className="text-xs text-indigo-600 dark:text-indigo-400 mt-1.5 flex items-center gap-1">
            👥 {t('expense.weightedSplit')}
          </p>
        )}
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
        disabled={mutation.isPending || submittingRef.current}
        className="w-full py-3 rounded-lg bg-indigo-600 text-white font-medium hover:bg-indigo-700 disabled:opacity-50 transition-colors"
      >
        {mutation.isPending ? t('expense.saving') : t('expense.addButton')}
      </button>
    </div>
  )
}
