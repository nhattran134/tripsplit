import { useEffect, useMemo } from 'react'
import { useParams, useNavigate } from 'react-router-dom'
import { useQuery } from '@tanstack/react-query'
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

  const totalDeposits = useMemo(
    () => deposits.reduce((sum, d) => sum + Number(d.amount) * Number(d.rate_to_base), 0),
    [deposits]
  )
  const totalPoolExpenses = useMemo(
    () => expenses.filter(e => e.paid_from === 'pool').reduce((sum, e) => sum + Number(e.amount) * Number(e.rate_to_base), 0),
    [expenses]
  )
  const totalAllExpenses = useMemo(
    () => expenses.reduce((sum, e) => sum + Number(e.amount) * Number(e.rate_to_base), 0),
    [expenses]
  )
  const poolBalance = totalDeposits - totalPoolExpenses
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
        <div className="bg-indigo-50 dark:bg-indigo-900/20 rounded-xl p-3 text-center">
          <p className="text-xs text-indigo-600 dark:text-indigo-400 font-medium">{t('dashboard.pool')}</p>
          <p className="text-sm font-bold text-indigo-700 dark:text-indigo-300 mt-1">
            {formatAmount(poolBalance, trip.base_currency)}
          </p>
        </div>
      </div>

      {/* Member Balances */}
      <div className="bg-white dark:bg-slate-800 rounded-xl p-4 shadow-sm border border-slate-200 dark:border-slate-700">
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
                  {member.auth_uid === currentAuthUid && <span className="text-xs bg-green-100 dark:bg-green-900 text-green-600 dark:text-green-400 px-1.5 py-0.5 rounded">You</span>}
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

      {/* Share Link */}
      <div className="bg-white dark:bg-slate-800 rounded-xl p-4 shadow-sm border border-slate-200 dark:border-slate-700">
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
                {copiedId === 'code' ? '✓ Copied' : trip.short_code}
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
      <div className="bg-white dark:bg-slate-800 rounded-xl p-4 shadow-sm border border-slate-200 dark:border-slate-700">
        <h2 className="font-semibold mb-2">Games</h2>
        <button
          onClick={() => navigate(`/trip/${tripId}/games/gomoku`)}
          className="w-full flex items-center gap-3 p-3 rounded-lg border border-slate-200 dark:border-slate-700 hover:border-indigo-300 transition-colors relative"
        >
          <span className="text-2xl">⚫⚪</span>
          <div className="text-left flex-1">
            <p className="font-medium text-sm">Gomoku</p>
            <p className="text-xs text-slate-500">5-in-a-row • Play with your group</p>
          </div>
          <ChallengeNotification tripId={tripId!} currentAuthUid={currentAuthUid} members={members} />
        </button>
      </div>

      {/* Recent Activity */}
      <div className="bg-white dark:bg-slate-800 rounded-xl p-4 shadow-sm border border-slate-200 dark:border-slate-700">
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
              .sort((a, b) => new Date(b.created_at).getTime() - new Date(a.created_at).getTime())
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
                      {isExpense ? '-' : '+'}{formatCurrency(Number(item.amount) * Number(item.rate_to_base), trip.base_currency)}
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
