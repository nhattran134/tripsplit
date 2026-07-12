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

  const [expandedItem, setExpandedItem] = useState<string | null>(null)

  type TimelineItem = {
    id: string
    type: 'expense' | 'deposit' | 'settlement'
    table: string
    date: string
    member: Member | undefined
    amount: number
    label: string
    sublabel?: string
    paid_from?: string
    receipt_url?: string | null
    currency?: string
    category?: string
    split_type?: string
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
      paid_from: e.paid_from,
      receipt_url: e.receipt_url,
      currency: e.currency,
      category: e.category,
      split_type: e.split_type,
    })) : []),
    ...(filter === 'all' || filter === 'deposit' ? deposits.map((d) => ({
      id: d.id,
      type: 'deposit' as const,
      table: 'deposits',
      date: d.created_at,
      member: members.find((m) => m.id === d.member_id),
      amount: Number(d.amount) * Number(d.rate_to_base),
      label: d.note || t('history.deposit'),
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
        sublabel: t('history.settlement'),
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
            <div key={item.id} className="border-b border-slate-100 dark:border-slate-700">
              <div
                className="flex items-center justify-between py-3 px-2 rounded-lg cursor-pointer"
                onClick={() => setExpandedItem(expandedItem === item.id ? null : item.id)}
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
                      onClick={(e) => {
                        e.stopPropagation()
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

              {/* Expanded detail */}
              {expandedItem === item.id && (
                <div className="px-2 pb-3 space-y-2 text-xs text-slate-600 dark:text-slate-400">
                  <div className="flex flex-wrap gap-2">
                    {item.type === 'expense' && item.paid_from && (
                      <span className={`px-2 py-0.5 rounded-full ${
                        item.paid_from === 'pool' ? 'bg-blue-100 text-blue-700 dark:bg-blue-900/30 dark:text-blue-300' : 'bg-purple-100 text-purple-700 dark:bg-purple-900/30 dark:text-purple-300'
                      }`}>
                        {item.paid_from === 'pool' ? t('history.pool') : t('history.pocket')}
                      </span>
                    )}
                    {item.category && (
                      <span className="px-2 py-0.5 rounded-full bg-slate-100 dark:bg-slate-700">{item.category}</span>
                    )}
                    {item.currency && item.currency !== baseCurrency && (
                      <span className="px-2 py-0.5 rounded-full bg-amber-100 text-amber-700 dark:bg-amber-900/30 dark:text-amber-300">{item.currency}</span>
                    )}
                    {item.split_type && (
                      <span className="px-2 py-0.5 rounded-full bg-slate-100 dark:bg-slate-700">{t('history.split')}: {item.split_type}</span>
                    )}
                  </div>
                  <p className="text-slate-500">
                    {item.member?.name && `${t('history.by')}: ${item.member.name}`} • {new Date(item.date).toLocaleString()}
                  </p>
                  {/* Receipt */}
                  {item.receipt_url && (
                    <a href={item.receipt_url} target="_blank" rel="noopener noreferrer" className="block">
                      <img src={item.receipt_url} alt={t('expense.receipt')} className="w-full max-h-48 object-cover rounded-lg border border-slate-200 dark:border-slate-700" />
                    </a>
                  )}
                </div>
              )}
            </div>
          ))}
        </div>
      )}
    </div>
  )
}
