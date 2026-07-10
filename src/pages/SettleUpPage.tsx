import { useState, useMemo } from 'react'
import { useParams, useNavigate } from 'react-router-dom'
import { useQuery, useMutation, useQueryClient } from '@tanstack/react-query'
import { useTranslation } from 'react-i18next'
import { supabase } from '@/lib/supabase'
import { calculateBalances, simplifyDebts } from '@/lib/settlement'
import { formatCurrency } from '@/lib/currency'
import { generateId } from '@/lib/utils'
import { Avatar } from '@/components/common/Avatar'
import type { Member, Deposit, ExpenseSplit, Settlement } from '@/types'

export function SettleUpPage() {
  const { tripId } = useParams<{ tripId: string }>()
  const navigate = useNavigate()
  const queryClient = useQueryClient()
  const { t } = useTranslation()
  const [settlingIndex, setSettlingIndex] = useState<number | null>(null)

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

  const { data: expenseSplits = [] } = useQuery({
    queryKey: ['expense_splits', tripId],
    queryFn: async () => {
      const { data, error } = await supabase
        .from('expense_splits')
        .select('*, expenses!inner(trip_id)')
        .eq('expenses.trip_id', tripId)
        .is('expenses.deleted_at', null)
      if (error) throw error
      return (data || []).map((s: any) => ({
        id: s.id, expense_id: s.expense_id, member_id: s.member_id, share_amount: Number(s.share_amount),
      })) as ExpenseSplit[]
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

  const settleMutation = useMutation({
    mutationFn: async (transfer: { from: Member; to: Member; amount: number }) => {
      const { error } = await supabase.from('settlements').insert({
        id: generateId(),
        trip_id: tripId,
        from_member_id: transfer.from.id,
        to_member_id: transfer.to.id,
        amount: transfer.amount,
        note: '',
      })
      if (error) throw new Error(error.message)
    },
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ['settlements', tripId] })
      queryClient.invalidateQueries({ queryKey: ['deposits', tripId] })
      queryClient.invalidateQueries({ queryKey: ['expenses', tripId] })
      queryClient.invalidateQueries({ queryKey: ['expense_splits', tripId] })
      setSettlingIndex(null)
    },
  })

  const balances = useMemo(
    () => calculateBalances(members, deposits, expenseSplits, settlements),
    [members, deposits, expenseSplits, settlements]
  )
  const transfers = useMemo(
    () => simplifyDebts(balances, members),
    [balances, members]
  )
  const baseCurrency = trip?.base_currency || 'VND'

  return (
    <div className="space-y-4">
      <div className="flex items-center gap-3">
        <button onClick={() => navigate(`/trip/${tripId}`)} className="text-indigo-600 dark:text-indigo-400">←</button>
        <h1 className="text-xl font-bold">{t('settle.title')}</h1>
      </div>

      {transfers.length === 0 ? (
        <div className="text-center py-12">
          {expenseSplits.length === 0 && deposits.length === 0 ? (
            <>
              <p className="text-4xl mb-4">📝</p>
              <p className="font-semibold text-slate-600 dark:text-slate-300">No transactions yet</p>
              <p className="text-sm text-slate-500 mt-1">Add expenses and deposits to see settlements</p>
            </>
          ) : (
            <>
              <p className="text-4xl mb-4">✅</p>
              <p className="font-semibold text-green-600">{t('settle.allSettled')}</p>
              <p className="text-sm text-slate-500 mt-1">{t('settle.allSettledHint')}</p>
            </>
          )}
        </div>
      ) : (
        <div className="space-y-3">
          <p className="text-sm text-slate-500">
            {t('settle.transfers', { count: transfers.length })}
          </p>
          {transfers.map((transfer, index) => (
            <div
              key={`${transfer.from.id}-${transfer.to.id}`}
              className="bg-white dark:bg-slate-800 rounded-xl p-4 shadow-sm border border-slate-200 dark:border-slate-700"
            >
              <div className="flex items-center justify-between mb-2">
                <div className="flex items-center gap-2">
                  <Avatar name={transfer.from.name} style={transfer.from.avatar_style} seed={transfer.from.avatar_seed} size={32} />
                  <span className="text-sm">→</span>
                  <Avatar name={transfer.to.name} style={transfer.to.avatar_style} seed={transfer.to.avatar_seed} size={32} />
                </div>
                <span className="font-bold">{formatCurrency(transfer.amount, baseCurrency)}</span>
              </div>
              <p className="text-sm text-slate-600 dark:text-slate-400">
                <span className="font-medium">{transfer.from.name}</span> {t('settle.pays')} <span className="font-medium">{transfer.to.name}</span>
              </p>
              <button
                onClick={() => {
                  setSettlingIndex(index)
                  settleMutation.mutate(transfer)
                }}
                disabled={settleMutation.isPending && settlingIndex === index}
                className="mt-3 w-full py-2 rounded-lg border border-green-500 text-green-600 text-sm font-medium hover:bg-green-50 dark:hover:bg-green-900/20 disabled:opacity-50 transition-colors"
              >
                {settleMutation.isPending && settlingIndex === index ? t('settle.marking') : t('settle.markSettled')}
              </button>
            </div>
          ))}
        </div>
      )}

      {/* Settlement History */}
      {settlements.length > 0 && (
        <div className="mt-6">
          <h2 className="font-semibold mb-2 text-slate-600 dark:text-slate-300">{t('settle.history')}</h2>
          <div className="space-y-2">
            {settlements.map((s) => {
              const from = members.find((m) => m.id === s.from_member_id)
              const to = members.find((m) => m.id === s.to_member_id)
              return (
                <div key={s.id} className="flex items-center justify-between py-2 text-sm border-b border-slate-100 dark:border-slate-700">
                  <span>{from?.name} → {to?.name}</span>
                  <span className="font-medium">{formatCurrency(Number(s.amount), baseCurrency)}</span>
                </div>
              )
            })}
          </div>
        </div>
      )}
    </div>
  )
}
