import { useState } from 'react'
import { useParams, useNavigate } from 'react-router-dom'
import { useQuery, useMutation, useQueryClient } from '@tanstack/react-query'
import { useTranslation } from 'react-i18next'
import { ArrowLeft, Receipt, Wallet, Handshake, Undo2 } from 'lucide-react'
import { supabase } from '@/lib/supabase'
import { formatAmount } from '@/lib/currency'
import type { Member, Deposit, Expense, Settlement } from '@/types'

export function HistoryPage() {
  const { tripId } = useParams<{ tripId: string }>()
  const navigate = useNavigate()
  const queryClient = useQueryClient()
  const { t } = useTranslation()
  const [filter, setFilter] = useState<'all' | 'expense' | 'deposit' | 'settlement'>('all')

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

  const { data: settlements = [] } = useQuery({
    queryKey: ['settlements', tripId],
    queryFn: async () => {
      const { data, error } = await supabase.from('settlements').select('*').eq('trip_id', tripId).is('deleted_at', null)
      if (error) throw error
      return data as Settlement[]
    },
  })

  // Check if current user is admin
  const { data: currentSession } = useQuery({
    queryKey: ['session'],
    queryFn: async () => {
      const { data } = await supabase.auth.getSession()
      return data.session
    },
  })
  const currentAuthUid = currentSession?.user?.id
  const isAdmin = members.some((m) => m.auth_uid === currentAuthUid && m.is_admin)

  const undoMutation = useMutation({
    mutationFn: async ({ table, id }: { table: string; id: string }) => {
      const { error } = await supabase
        .from(table)
        .update({ deleted_at: new Date().toISOString() })
        .eq('id', id)
      if (error) throw new Error(error.message)
    },
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ['expenses', tripId] })
      queryClient.invalidateQueries({ queryKey: ['expense_splits', tripId] })
      queryClient.invalidateQueries({ queryKey: ['deposits', tripId] })
      queryClient.invalidateQueries({ queryKey: ['settlements', tripId] })
    },
  })

  const baseCurrency = trip?.base_currency || 'VND'

  type TimelineItem = {
    id: string
    type: 'expense' | 'deposit' | 'settlement'
    table: string
    date: string
    member: Member | undefined
    amount: number
    label: string
    sublabel?: string
  }

  const timeline: TimelineItem[] = [
    ...(filter === 'all' || filter === 'expense' ? expenses.map((e) => ({
      id: e.id,
      type: 'expense' as const,
      table: 'expenses',
      date: e.created_at,
      member: members.find((m) => m.id === e.member_id),
      amount: Number(e.amount) * Number(e.rate_to_base),
      label: e.description || e.category,
    })) : []),
    ...(filter === 'all' || filter === 'deposit' ? deposits.map((d) => ({
      id: d.id,
      type: 'deposit' as const,
      table: 'deposits',
      date: d.created_at,
      member: members.find((m) => m.id === d.member_id),
      amount: Number(d.amount) * Number(d.rate_to_base),
      label: d.note || 'Deposit',
    })) : []),
    ...(filter === 'all' || filter === 'settlement' ? settlements.map((s) => {
      const from = members.find((m) => m.id === s.from_member_id)
      const to = members.find((m) => m.id === s.to_member_id)
      return {
        id: s.id,
        type: 'settlement' as const,
        table: 'settlements',
        date: s.created_at,
        member: from,
        amount: Number(s.amount),
        label: `${from?.name || '?'} → ${to?.name || '?'}`,
        sublabel: 'Settlement',
      }
    }) : []),
  ].sort((a, b) => new Date(b.date).getTime() - new Date(a.date).getTime())

  const getIcon = (type: string) => {
    if (type === 'expense') return <Receipt size={18} className="text-red-500" />
    if (type === 'deposit') return <Wallet size={18} className="text-green-500" />
    return <Handshake size={18} className="text-blue-500" />
  }

  const getColor = (type: string) => {
    if (type === 'expense') return 'text-red-600'
    if (type === 'deposit') return 'text-green-600'
    return 'text-blue-600'
  }

  return (
    <div className="space-y-4">
      <div className="flex items-center gap-3">
        <button onClick={() => navigate(`/trip/${tripId}`)} className="text-indigo-600 dark:text-indigo-400">
          <ArrowLeft size={20} />
        </button>
        <h1 className="text-xl font-bold">{t('history.title')}</h1>
      </div>

      {/* Filter */}
      <div className="flex gap-2 flex-wrap">
        {(['all', 'expense', 'deposit', 'settlement'] as const).map((f) => (
          <button
            key={f}
            onClick={() => setFilter(f)}
            className={`px-3 py-1.5 rounded-full text-sm font-medium border ${
              filter === f
                ? 'border-indigo-500 bg-indigo-50 dark:bg-indigo-900/30'
                : 'border-slate-200 dark:border-slate-700'
            }`}
          >
            {f === 'all' ? t('history.all') : f === 'expense' ? t('history.expenses') : f === 'deposit' ? t('history.deposits') : t('history.settlements')}
          </button>
        ))}
      </div>

      {/* Timeline */}
      {timeline.length === 0 ? (
        <p className="text-center text-slate-500 py-8">{t('history.noTransactions')}</p>
      ) : (
        <div className="space-y-2">
          {timeline.map((item) => (
            <div
              key={item.id}
              className="flex items-center justify-between py-3 px-2 border-b border-slate-100 dark:border-slate-700 rounded-lg"
            >
              <div className="flex items-center gap-3 flex-1 min-w-0">
                <span>{getIcon(item.type)}</span>
                <div className="min-w-0">
                  <p className="text-sm font-medium truncate">{item.label}</p>
                  <p className="text-xs text-slate-500">
                    {item.sublabel || item.member?.name} • {new Date(item.date).toLocaleDateString()}
                  </p>
                </div>
              </div>
              <div className="flex items-center gap-2 shrink-0">
                <span className={`text-sm font-semibold ${getColor(item.type)}`}>
                  {item.type === 'expense' ? '-' : item.type === 'deposit' ? '+' : ''}{formatAmount(item.amount, baseCurrency)}
                </span>
                {isAdmin && (
                  <button
                    onClick={() => {
                      if (confirm(`Undo this ${item.type}?`)) {
                        undoMutation.mutate({ table: item.table, id: item.id })
                      }
                    }}
                    disabled={undoMutation.isPending}
                    className="text-red-500 hover:text-red-700 p-1 rounded border border-red-200 hover:bg-red-50 dark:hover:bg-red-900/20 transition-colors"
                  >
                    <Undo2 size={14} />
                  </button>
                )}
              </div>
            </div>
          ))}
        </div>
      )}
    </div>
  )
}
