import { useState } from 'react'
import { useParams, useNavigate } from 'react-router-dom'
import { useQuery } from '@tanstack/react-query'
import { supabase } from '@/lib/supabase'
import { formatCurrency } from '@/lib/currency'
import type { Member, Deposit, Expense } from '@/types'

export function HistoryPage() {
  const { tripId } = useParams<{ tripId: string }>()
  const navigate = useNavigate()
  const [filter, setFilter] = useState<'all' | 'expense' | 'deposit'>('all')

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

  const { data: expenses = [] } = useQuery({
    queryKey: ['expenses', tripId],
    queryFn: async () => {
      const { data, error } = await supabase.from('expenses').select('*').eq('trip_id', tripId).is('deleted_at', null)
      if (error) throw error
      return data as Expense[]
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

  const baseCurrency = trip?.base_currency || 'VND'

  type TimelineItem = { id: string; type: 'expense' | 'deposit'; date: string; member: Member | undefined; amount: number; label: string }

  const timeline: TimelineItem[] = [
    ...(filter !== 'deposit' ? expenses.map((e) => ({
      id: e.id,
      type: 'expense' as const,
      date: e.created_at,
      member: members.find((m) => m.id === e.member_id),
      amount: Number(e.amount) * Number(e.rate_to_base),
      label: e.description || e.category,
    })) : []),
    ...(filter !== 'expense' ? deposits.map((d) => ({
      id: d.id,
      type: 'deposit' as const,
      date: d.created_at,
      member: members.find((m) => m.id === d.member_id),
      amount: Number(d.amount) * Number(d.rate_to_base),
      label: d.note || 'Deposit',
    })) : []),
  ].sort((a, b) => new Date(b.date).getTime() - new Date(a.date).getTime())

  return (
    <div className="space-y-4">
      <div className="flex items-center gap-3">
        <button onClick={() => navigate(`/trip/${tripId}`)} className="text-indigo-600 dark:text-indigo-400">←</button>
        <h1 className="text-xl font-bold">History</h1>
      </div>

      {/* Filter */}
      <div className="flex gap-2">
        {(['all', 'expense', 'deposit'] as const).map((f) => (
          <button
            key={f}
            onClick={() => setFilter(f)}
            className={`px-3 py-1.5 rounded-full text-sm font-medium border ${
              filter === f
                ? 'border-indigo-500 bg-indigo-50 dark:bg-indigo-900/30'
                : 'border-slate-200 dark:border-slate-700'
            }`}
          >
            {f === 'all' ? 'All' : f === 'expense' ? '💸 Expenses' : '💰 Deposits'}
          </button>
        ))}
      </div>

      {/* Timeline */}
      {timeline.length === 0 ? (
        <p className="text-center text-slate-500 py-8">No transactions yet</p>
      ) : (
        <div className="space-y-2">
          {timeline.map((item) => (
            <div
              key={item.id}
              className="flex items-center justify-between py-3 border-b border-slate-100 dark:border-slate-700"
            >
              <div className="flex items-center gap-3">
                <span className="text-lg">{item.type === 'expense' ? '💸' : '💰'}</span>
                <div>
                  <p className="text-sm font-medium">{item.label}</p>
                  <p className="text-xs text-slate-500">{item.member?.name} • {new Date(item.date).toLocaleDateString()}</p>
                </div>
              </div>
              <span className={`text-sm font-semibold ${item.type === 'expense' ? 'text-red-600' : 'text-green-600'}`}>
                {item.type === 'expense' ? '-' : '+'}{formatCurrency(item.amount, baseCurrency)}
              </span>
            </div>
          ))}
        </div>
      )}
    </div>
  )
}
