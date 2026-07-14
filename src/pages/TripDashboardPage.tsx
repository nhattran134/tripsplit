import { useEffect, useMemo } from 'react'
import { useParams, useNavigate } from 'react-router-dom'
import { useQuery, useQueryClient } from '@tanstack/react-query'
import { useTranslation } from 'react-i18next'
import { ArrowLeft, Settings, Receipt, Wallet } from 'lucide-react'
import { supabase } from '@/lib/supabase'
import { Avatar } from '@/components/common/Avatar'
import { useAppStore } from '@/lib/store'
import { calculateBalances } from '@/lib/settlement'
import { formatCurrency, formatAmount } from '@/lib/currency'
import { useCopy } from '@/hooks/useCopy'
import type { Member, Deposit, Expense, ExpenseSplit, Settlement } from '@/types'

function ChallengeNotification({ tripId, currentAuthUid, members }: { tripId: string; currentAuthUid: string | undefined; members: Member[] }) {
  const myMember = members.find(m => m.auth_uid === currentAuthUid)
  const { data: count = 0 } = useQuery({
    queryKey: ['challenge-count', tripId, myMember?.id],
    enabled: !!myMember,
    refetchInterval: 5000,
    queryFn: async () => {
      const { data } = await supabase.from('gomoku_challenges')
        .select('id')
        .eq('trip_id', tripId)
        .eq('to_member_id', myMember!.id)
        .eq('status', 'pending')
      return data?.length || 0
    },
  })

  if (!count) return null
  return (
    <span className="absolute -top-1 -right-1 w-5 h-5 bg-red-500 text-white text-[10px] font-bold rounded-full flex items-center justify-center animate-bounce">
      {count}
    </span>
  )
}

export function TripDashboardPage() {
  const { tripId } = useParams<{ tripId: string }>()
  const navigate = useNavigate()
  const queryClient = useQueryClient()
  const { myTrips, addTrip } = useAppStore()
  const { copy, copiedId } = useCopy()
  const { t } = useTranslation()

  const { data: trip, isLoading: tripLoading } = useQuery({
    queryKey: ['trip', tripId],
    queryFn: async () => {
      const { data, error } = await supabase
        .from('trips')
        .select('*')
        .eq('id', tripId)
        .single()
      if (error) throw error
      return data
    },
  })

  // Auto-register trip to local store if member visits directly
  useEffect(() => {
    if (trip && !myTrips.some((t) => t.id === trip.id)) {
      addTrip({ id: trip.id, name: trip.name, invite_code: trip.invite_code, joined_at: new Date().toISOString() })
    }
  }, [trip, myTrips, addTrip])

  const { data: members = [] } = useQuery({
    queryKey: ['members', tripId],
    queryFn: async () => {
      const { data, error } = await supabase
        .from('members')
        .select('*')
        .eq('trip_id', tripId)
        
      if (error) throw error
      return data as Member[]
    },
  })

  const { data: deposits = [] } = useQuery({
    queryKey: ['deposits', tripId],
    queryFn: async () => {
      const { data, error } = await supabase
        .from('deposits')
        .select('*')
        .eq('trip_id', tripId)
        .is('deleted_at', null)
      if (error) throw error
      return data as Deposit[]
    },
  })

  const { data: expenses = [] } = useQuery({
    queryKey: ['expenses', tripId],
    queryFn: async () => {
      const { data, error } = await supabase
        .from('expenses')
        .select('*')
        .eq('trip_id', tripId)
        .is('deleted_at', null)
      if (error) throw error
      return data as Expense[]
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
        id: s.id,
        expense_id: s.expense_id,
        member_id: s.member_id,
        share_amount: Number(s.share_amount),
      })) as ExpenseSplit[]
    },
  })

  const { data: settlements = [] } = useQuery({
    queryKey: ['settlements', tripId],
    queryFn: async () => {
      const { data, error } = await supabase
        .from('settlements')
        .select('*')
        .eq('trip_id', tripId)
        .is('deleted_at', null)
      if (error) throw error
      return data as Settlement[]
    },
  })

  // Current user identification
  const { data: currentSession } = useQuery({
    queryKey: ['session'],
    queryFn: async () => {
      const { data } = await supabase.auth.getSession()
      return data.session
    },
  })
  const currentAuthUid = currentSession?.user?.id

  // Real-time sync: invalidate queries when data changes from OTHER devices
  useEffect(() => {
    if (!tripId) return
    const channel = supabase.channel(`trip-${tripId}`)
      .on('postgres_changes', { event: '*', schema: 'public', table: 'expenses', filter: `trip_id=eq.${tripId}` }, () => {
        // Only invalidate — don't refetch. Data will refresh on next navigation.
        queryClient.invalidateQueries({ queryKey: ['expenses', tripId], refetchType: 'none' })
        queryClient.invalidateQueries({ queryKey: ['expense_splits', tripId], refetchType: 'none' })
      })
      .on('postgres_changes', { event: '*', schema: 'public', table: 'deposits', filter: `trip_id=eq.${tripId}` }, () => {
        queryClient.invalidateQueries({ queryKey: ['deposits', tripId], refetchType: 'none' })
      })
      .on('postgres_changes', { event: '*', schema: 'public', table: 'settlements', filter: `trip_id=eq.${tripId}` }, () => {
        queryClient.invalidateQueries({ queryKey: ['settlements', tripId], refetchType: 'none' })
      })
      .subscribe()

    return () => { supabase.removeChannel(channel) }
  }, [tripId, queryClient])
  const totalDeposits = useMemo(
    () => deposits.reduce((sum, d) => sum + (Number(d.amount) || 0) * (Number(d.rate_to_base) || 1), 0),
    [deposits]
  )
  const totalPoolExpenses = useMemo(
    () => expenses.filter(e => e.paid_from === 'pool').reduce((sum, e) => sum + (Number(e.amount) || 0) * (Number(e.rate_to_base) || 1), 0),
    [expenses]
  )
  const totalAllExpenses = useMemo(
    () => expenses.reduce((sum, e) => sum + (Number(e.amount) || 0) * (Number(e.rate_to_base) || 1), 0),
    [expenses]
  )
  const viaPoolSettled = settlements.filter(s => !s.deleted_at && s.method === 'via_pool').reduce((sum, s) => sum + (Number(s.amount) || 0), 0)
  const poolBalance = totalDeposits - totalPoolExpenses - viaPoolSettled
  const balances = useMemo(
    () => calculateBalances(members, deposits, expenses, expenseSplits, settlements),
    [members, deposits, expenses, expenseSplits, settlements]
  )

  if (tripLoading) {
    return <div className="flex items-center justify-center py-12"><p className="text-slate-500">{t('common.loading')}</p></div>
  }

  if (!trip) {
    return <div className="text-center py-12"><p className="text-red-500">{t('common.notFound')}</p></div>
  }

  // If user is not a member of this trip, redirect to join
  const isMember = members.some(m => m.auth_uid === currentAuthUid)
  if (currentAuthUid && members.length > 0 && !isMember) {
    return (
      <div className="text-center py-12 space-y-4">
        <p className="text-4xl">🔒</p>
        <p className="font-semibold text-slate-600 dark:text-slate-300">{t('common.notMember')}</p>
        <button onClick={() => navigate(`/t/${trip.invite_code}`)} className="px-4 py-2 rounded-lg bg-indigo-600 text-white text-sm font-medium">
          {t('common.joinTrip')}
        </button>
      </div>
    )
  }

  const inviteLink = `${window.location.origin}/t/${trip.invite_code}`

  return (
    <div className="space-y-6">
      {/* Header */}
      <div className="flex items-center justify-between">
        <div>
          <button onClick={() => navigate('/')} className="text-sm text-indigo-600 dark:text-indigo-400 mb-1 flex items-center gap-1"><ArrowLeft size={14} /> {t('common.trips')}</button>
          <h1 className="text-xl font-bold">{trip.name}</h1>
        </div>
        <button
          onClick={() => navigate(`/trip/${tripId}/settings`)}
          className="text-slate-500 hover:text-slate-700"
        >
          <Settings size={22} />
        </button>
      </div>

      {/* Pool Summary Cards */}
      <div className="grid grid-cols-3 gap-3">
        <div className="bg-green-50 dark:bg-green-900/20 rounded-xl p-3 text-center">
          <p className="text-xs text-green-600 dark:text-green-400 font-medium">{t('dashboard.deposited')}</p>
          <p className="text-sm font-bold text-green-700 dark:text-green-300 mt-1">
            {formatAmount(totalDeposits, trip.base_currency)}
          </p>
        </div>
        <div className="bg-red-50 dark:bg-red-900/20 rounded-xl p-3 text-center">
          <p className="text-xs text-red-600 dark:text-red-400 font-medium">{t('dashboard.spent')}</p>
          <p className="text-sm font-bold text-red-700 dark:text-red-300 mt-1">
            {formatAmount(totalAllExpenses, trip.base_currency)}
          </p>
        </div>
        <div className={`rounded-xl p-3 text-center ${poolBalance < 0 ? 'bg-red-50 dark:bg-red-900/20' : 'bg-indigo-50 dark:bg-indigo-900/20'}`}>
          <p className={`text-xs font-medium ${poolBalance < 0 ? 'text-red-600 dark:text-red-400' : 'text-indigo-600 dark:text-indigo-400'}`}>{t('dashboard.pool')}</p>
          <p className={`text-sm font-bold mt-1 ${poolBalance < 0 ? 'text-red-700 dark:text-red-300' : 'text-indigo-700 dark:text-indigo-300'}`}>
            {poolBalance < 0 ? '-' : ''}{formatAmount(Math.abs(poolBalance), trip.base_currency)}
          </p>
        </div>
      </div>

      {/* Pool Share Breakdown */}
      {poolBalance > 0 && totalDeposits > 0 && (
        <div className="glass-card rounded-xl p-4">
          <h2 className="font-semibold mb-1 text-sm">{t('dashboard.poolShare')}</h2>
          <p className="text-[10px] text-slate-500 mb-3">{t('dashboard.poolShareHint')}</p>
          <div className="space-y-2">
            {(() => {
              // Group members by group_id
              const groupMap = new Map<string, { name: string; deposited: number; spent: number; viaPool: number }>()
              const activeMembers = members.filter(m => !m.deleted_at)
              
              for (const m of activeMembers) {
                const key = m.group_id || `solo_${m.id}`
                const existing = groupMap.get(key)
                const memberDeposits = deposits.filter(d => d.member_id === m.id)
                  .reduce((sum, d) => sum + (Number(d.amount) || 0) * (Number(d.rate_to_base) || 1), 0)
                const memberPoolShares = expenseSplits
                  .filter(s => s.member_id === m.id && expenses.find(e => e.id === s.expense_id && e.paid_from === 'pool'))
                  .reduce((sum, s) => sum + (Number(s.share_amount) || 0), 0)
                // via_pool settlements where this member is the payer (from) = pool money leaving from this group
                const memberViaPool = settlements.filter(s => !s.deleted_at && s.method === 'via_pool' && s.from_member_id === m.id)
                  .reduce((sum, s) => sum + (Number(s.amount) || 0), 0)
                
                if (existing) {
                  existing.deposited += memberDeposits
                  existing.spent += memberPoolShares + memberViaPool
                  existing.viaPool += memberViaPool
                } else {
                  const groupMembers = m.group_id 
                    ? activeMembers.filter(om => om.group_id === m.group_id).map(om => om.name)
                    : [m.name]
                  groupMap.set(key, { name: groupMembers.join(' & '), deposited: memberDeposits, spent: memberPoolShares + memberViaPool, viaPool: memberViaPool })
                }
              }

              return [...groupMap.values()]
                .filter(g => g.deposited > 0)
                .map(g => {
                  // Pool expenses deducted proportionally
                  const poolExpShare = totalDeposits > 0 ? (g.deposited / totalDeposits) * totalPoolExpenses : 0
                  // Via_pool from this group deducted directly from their deposit
                  const groupViaPool = g.viaPool || 0
                  const remaining = Math.round(g.deposited - poolExpShare - groupViaPool)
                  return { ...g, remaining }
                })
                .sort((a, b) => b.remaining - a.remaining)
                .map((g) => (
                  <div key={g.name} className="flex items-center justify-between text-sm">
                    <div>
                      <span className="font-medium">{g.name}</span>
                      <span className="text-[10px] text-slate-400 ml-1.5">
                        {t('dashboard.poolDeposited')}: {formatAmount(g.deposited, trip.base_currency)}
                      </span>
                    </div>
                    <div className="text-right">
                      <span className={`font-semibold ${g.remaining > 0 ? 'text-indigo-600' : 'text-slate-400'}`}>
                        {formatAmount(g.remaining, trip.base_currency)}
                      </span>
                      <span className="text-[10px] text-slate-400 ml-1">{t('dashboard.poolLeft')}</span>
                    </div>
                  </div>
                ))
            })()}
          </div>
        </div>
      )}

      {/* Member Balances */}
      <div className="glass-card rounded-xl p-4">
        <h2 className="font-semibold mb-3">{t('dashboard.memberBalances')}</h2>
        <div className="space-y-2">
          {members.filter(m => !m.deleted_at).map((member) => {
            const balance = balances.find((b) => b.memberId === member.id)
            const net = balance?.net ?? 0
            return (
              <div key={member.id} className="flex items-center justify-between py-1">
                <div className="flex items-center gap-2">
                  <Avatar name={member.name} style={member.avatar_style} seed={member.avatar_seed} size={32} />
                  <span className="font-medium text-sm">{member.name}</span>
                  {member.auth_uid === currentAuthUid && <span className="text-xs bg-green-100 dark:bg-green-900 text-green-600 dark:text-green-400 px-1.5 py-0.5 rounded">{t('common.you')}</span>}
                  {member.is_admin && <span className="text-xs bg-indigo-100 dark:bg-indigo-900 text-indigo-600 dark:text-indigo-400 px-1.5 py-0.5 rounded">{t('common.admin')}</span>}
                </div>
                <span className={`text-sm font-semibold ${net >= 0 ? 'text-green-600' : 'text-red-600'}`}>
                  {net >= 0 ? '+' : ''}{formatCurrency(net, trip.base_currency)}
                </span>
              </div>
            )
          })}
        </div>
      </div>

      {/* Spending by Category */}
      {expenses.length > 0 && (() => {
        const CATEGORY_COLORS: Record<string, string> = {
          food: '#f59e0b', transport: '#3b82f6', accommodation: '#8b5cf6',
          entertainment: '#ec4899', shopping: '#10b981', activities: '#ec4899',
          telecom: '#6366f1', medical: '#ef4444', other: '#6b7280'
        }
        const categoryTotals = new Map<string, number>()
        for (const exp of expenses) {
          const cat = exp.category || 'other'
          const base = (Number(exp.amount) || 0) * (Number(exp.rate_to_base) || 1)
          categoryTotals.set(cat, (categoryTotals.get(cat) || 0) + base)
        }
        const sorted = [...categoryTotals.entries()].sort((a, b) => b[1] - a[1])
        const maxAmount = sorted[0]?.[1] || 1

        return (
          <div className="glass-card rounded-xl p-4">
            <h2 className="font-semibold mb-3">{t('dashboard.spendingByCategory')}</h2>
            <div className="space-y-2.5">
              {sorted.map(([cat, amount]) => {
                const pct = Math.round((amount / totalAllExpenses) * 100)
                const barWidth = Math.round((amount / maxAmount) * 100)
                const color = CATEGORY_COLORS[cat] || '#6b7280'
                const catKey = `category.${cat}` as const
                return (
                  <div key={cat}>
                    <div className="flex items-center justify-between text-sm mb-0.5">
                      <span className="font-medium text-slate-700 dark:text-slate-300">{t(catKey as any) !== catKey ? t(catKey as any) : cat}</span>
                      <span className="text-slate-500">{formatCurrency(amount, trip.base_currency)} ({pct}%)</span>
                    </div>
                    <div className="w-full h-3 bg-slate-100 dark:bg-slate-700 rounded-full overflow-hidden">
                      <div
                        className="h-full rounded-full transition-all duration-500"
                        style={{ width: `${barWidth}%`, backgroundColor: color }}
                      />
                    </div>
                  </div>
                )
              })}
            </div>
          </div>
        )
      })()}

      {/* Share Link */}
      <div className="glass-card rounded-xl p-4">
        <h2 className="font-semibold mb-3">{t('dashboard.inviteOthers')}</h2>

        {/* Short Code - prominent */}
        {trip.short_code && (
          <div className="mb-3 text-center">
            <p className="text-xs text-slate-500 mb-1">{t('dashboard.tripCode')}</p>
            <button
              onClick={() => copy(trip.short_code, 'code')}
              className={`inline-block px-4 py-2 rounded-lg transition-all duration-200 ${
                copiedId === 'code'
                  ? 'bg-green-100 dark:bg-green-900/30 scale-105'
                  : 'bg-slate-100 dark:bg-slate-700'
              }`}
            >
              <span className={`text-2xl font-mono font-bold tracking-widest transition-colors ${
                copiedId === 'code'
                  ? 'text-green-600 dark:text-green-400'
                  : 'text-indigo-600 dark:text-indigo-400'
              }`}>
                {copiedId === 'code' ? t('dashboard.copied') : trip.short_code}
              </span>
            </button>
            <p className="text-[10px] text-slate-400 mt-1">{t('dashboard.tapToCopy')}</p>
          </div>
        )}

        {/* Full link */}
        <div className="flex gap-2">
          <input
            type="text"
            value={inviteLink}
            readOnly
            className="flex-1 px-3 py-2 rounded-lg border border-slate-300 dark:border-slate-600 bg-slate-50 dark:bg-slate-700 text-xs truncate"
          />
          <button
            onClick={() => copy(inviteLink, 'link')}
            className={`px-3 py-2 rounded-lg text-sm font-medium transition-all duration-200 whitespace-nowrap ${
              copiedId === 'link'
                ? 'bg-green-500 text-white scale-105'
                : 'bg-indigo-600 text-white hover:bg-indigo-700'
            }`}
          >
            {copiedId === 'link' ? '✓' : t('dashboard.copy')}
          </button>
        </div>
      </div>

      {/* Games */}
      <div className="glass-card rounded-xl p-4">
        <h2 className="font-semibold mb-2">{t('dashboard.games')}</h2>
        <button
          onClick={() => navigate(`/trip/${tripId}/games/gomoku`)}
          className="w-full flex items-center gap-3 p-3 rounded-lg border border-slate-200 dark:border-slate-700 hover:border-indigo-300 transition-colors relative"
        >
          <span className="text-2xl">⚫⚪</span>
          <div className="text-left flex-1">
            <p className="font-medium text-sm">{t('dashboard.gomoku')}</p>
            <p className="text-xs text-slate-500">{t('dashboard.gomokuDesc')}</p>
          </div>
          <ChallengeNotification tripId={tripId!} currentAuthUid={currentAuthUid} members={members} />
        </button>
      </div>

      {/* Recent Activity */}
      <div className="glass-card rounded-xl p-4">
        <div className="flex items-center justify-between mb-3">
          <h2 className="font-semibold">{t('dashboard.recent')}</h2>
          <button
            onClick={() => navigate(`/trip/${tripId}/history`)}
            className="text-sm text-indigo-600 dark:text-indigo-400"
          >
            {t('dashboard.seeAll')}
          </button>
        </div>
        {expenses.length === 0 && deposits.length === 0 ? (
          <p className="text-sm text-slate-500 text-center py-4">{t('dashboard.noTransactions')}</p>
        ) : (
          <div className="space-y-2">
            {[...expenses, ...deposits]
              .sort((a, b) => new Date(b.created_at || 0).getTime() - new Date(a.created_at || 0).getTime())
              .slice(0, 5)
              .map((item) => {
                const isExpense = 'category' in item
                const member = members.find((m) => m.id === item.member_id)
                return (
                  <div key={item.id} className="flex items-center justify-between py-1">
                    <div className="flex items-center gap-2">
                      <span>{isExpense ? <Receipt size={16} className="text-red-500" /> : <Wallet size={16} className="text-green-500" />}</span>
                      <div>
                        <p className="text-sm font-medium">
                          {isExpense ? (item as Expense).description || (item as Expense).category : t('dashboard.deposit')}
                        </p>
                        <p className="text-xs text-slate-500">{member?.name}</p>
                      </div>
                    </div>
                    <span className={`text-sm font-semibold ${isExpense ? 'text-red-600' : 'text-green-600'}`}>
                      {isExpense ? '-' : '+'}{formatCurrency((Number(item.amount) || 0) * (Number(item.rate_to_base) || 1), trip.base_currency)}
                    </span>
                  </div>
                )
              })}
          </div>
        )}
      </div>
    </div>
  )
}
