import { useState } from 'react'
import { useParams, useNavigate } from 'react-router-dom'
import { useQuery, useMutation, useQueryClient } from '@tanstack/react-query'
import { supabase } from '@/lib/supabase'
import { formatCurrency, COMMON_CURRENCIES } from '@/lib/currency'
import { generateId } from '@/lib/utils'
import type { Member } from '@/types'

export function AddDepositPage() {
  const { tripId } = useParams<{ tripId: string }>()
  const navigate = useNavigate()
  const queryClient = useQueryClient()

  const [amount, setAmount] = useState('')
  const [currency, setCurrency] = useState('')
  const [rateToBase, setRateToBase] = useState('1')
  const [memberId, setMemberId] = useState('')
  const [note, setNote] = useState('')
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
      if (!memberId && data.length > 0) setMemberId(data[0].id)
      return data as Member[]
    },
  })

  const mutation = useMutation({
    mutationFn: async () => {
      const numAmount = parseFloat(amount)
      if (!numAmount || numAmount <= 0) throw new Error('Enter a valid amount')
      if (!memberId) throw new Error('Select who deposited')

      const numRate = parseFloat(rateToBase) || 1

      const { error } = await supabase.from('deposits').insert({
        id: generateId(),
        trip_id: tripId,
        member_id: memberId,
        amount: numAmount,
        currency: currency || trip?.base_currency || 'VND',
        rate_to_base: numRate,
        note: note.trim(),
      })
      if (error) throw new Error(error.message)
    },
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ['deposits', tripId] })
      navigate(`/trip/${tripId}`)
    },
    onError: (e) => setError(e instanceof Error ? e.message : 'Failed to add deposit'),
  })

  const baseCurrency = trip?.base_currency || 'VND'
  const isSameCurrency = currency === baseCurrency

  return (
    <div className="space-y-4 pb-8">
      <div className="flex items-center gap-3">
        <button onClick={() => navigate(`/trip/${tripId}`)} className="text-indigo-600 dark:text-indigo-400">←</button>
        <h1 className="text-xl font-bold">Add Deposit</h1>
      </div>

      {/* Who deposited */}
      <div>
        <label className="text-sm font-medium text-slate-600 dark:text-slate-300">Who deposited?</label>
        <div className="mt-1 flex flex-wrap gap-2">
          {members.map((m) => (
            <button
              key={m.id}
              onClick={() => setMemberId(m.id)}
              className={`px-3 py-1.5 rounded-full text-sm font-medium border ${
                memberId === m.id
                  ? 'border-indigo-500 bg-indigo-50 dark:bg-indigo-900/30 text-indigo-700 dark:text-indigo-300'
                  : 'border-slate-200 dark:border-slate-700 text-slate-600 dark:text-slate-400'
              }`}
            >
              {m.name}
            </button>
          ))}
        </div>
      </div>

      {/* Amount + Currency */}
      <div className="flex gap-2">
        <div className="flex-1">
          <label className="text-sm font-medium text-slate-600 dark:text-slate-300">Amount</label>
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
          <label className="text-sm font-medium text-slate-600 dark:text-slate-300">Currency</label>
          <select
            value={currency}
            onChange={(e) => setCurrency(e.target.value)}
            className="mt-1 w-full px-2 py-2 rounded-lg border border-slate-300 dark:border-slate-600 bg-transparent focus:ring-2 focus:ring-indigo-500 outline-none"
          >
            {COMMON_CURRENCIES.map((c) => <option key={c} value={c}>{c}</option>)}
          </select>
        </div>
      </div>

      {/* Exchange Rate */}
      {!isSameCurrency && (
        <div>
          <label className="text-sm font-medium text-slate-600 dark:text-slate-300">
            Rate (1 {currency} = ? {baseCurrency})
          </label>
          <input
            type="number"
            inputMode="decimal"
            value={rateToBase}
            onChange={(e) => setRateToBase(e.target.value)}
            className="mt-1 w-full px-3 py-2 rounded-lg border border-slate-300 dark:border-slate-600 bg-transparent focus:ring-2 focus:ring-indigo-500 outline-none"
          />
          {amount && <p className="text-xs text-slate-500 mt-1">= {formatCurrency(parseFloat(amount) * parseFloat(rateToBase || '1'), baseCurrency)}</p>}
        </div>
      )}

      {/* Note */}
      <div>
        <label className="text-sm font-medium text-slate-600 dark:text-slate-300">Note (optional)</label>
        <input
          type="text"
          value={note}
          onChange={(e) => setNote(e.target.value)}
          placeholder="Bank transfer, cash..."
          className="mt-1 w-full px-3 py-2 rounded-lg border border-slate-300 dark:border-slate-600 bg-transparent focus:ring-2 focus:ring-indigo-500 outline-none"
        />
      </div>

      {error && <p className="text-red-500 text-sm">{error}</p>}

      <button
        onClick={() => mutation.mutate()}
        disabled={mutation.isPending}
        className="w-full py-3 rounded-lg bg-green-600 text-white font-medium hover:bg-green-700 disabled:opacity-50 transition-colors"
      >
        {mutation.isPending ? 'Saving...' : 'Add Deposit'}
      </button>
    </div>
  )
}
