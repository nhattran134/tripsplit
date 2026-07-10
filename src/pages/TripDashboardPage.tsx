import { useParams, useNavigate } from 'react-router-dom'
import { useQuery } from '@tanstack/react-query'
import { supabase } from '@/lib/supabase'
import { calculateBalances } from '@/lib/settlement'
import { formatCurrency } from '@/lib/currency'
import type { Member, Deposit, Expense, ExpenseSplit, Settlement } from '@/types'

export function TripDashboardPage() {
  const { tripId } = useParams<{ tripId: string }>()
  const navigate = useNavigate()

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

  const { data: members = [] } = useQuery({
    queryKey: ['members', tripId],
    queryFn: async () => {
      const { data, error } = await supabase
        .from('members')
        .select('*')
        .eq('trip_id', tripId)
        .is('deleted_at', null)
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

  if (tripLoading) {
    return <div className="flex items-center justify-center py-12"><p className="text-slate-500">Loading...</p></div>
  }

  if (!trip) {
    return <div className="text-center py-12"><p className="text-red-500">Trip not found</p></div>
  }

  const totalDeposits = deposits.reduce((sum, d) => sum + Number(d.amount) * Number(d.rate_to_base), 0)
  const totalExpenses = expenses.reduce((sum, e) => sum + Number(e.amount) * Number(e.rate_to_base), 0)
  const poolBalance = totalDeposits - totalExpenses
  const balances = calculateBalances(members, deposits, expenseSplits, settlements)

  const inviteLink = `${window.location.origin}/t/${trip.invite_code}`

  return (
    <div className="space-y-6">
      {/* Header */}
      <div className="flex items-center justify-between">
        <div>
          <button onClick={() => navigate('/')} className="text-sm text-indigo-600 dark:text-indigo-400 mb-1">← Trips</button>
          <h1 className="text-xl font-bold">{trip.name}</h1>
        </div>
        <button
          onClick={() => navigate(`/trip/${tripId}/settings`)}
          className="text-slate-500 hover:text-slate-700 text-xl"
        >
          ⚙️
        </button>
      </div>

      {/* Pool Summary Cards */}
      <div className="grid grid-cols-3 gap-3">
        <div className="bg-green-50 dark:bg-green-900/20 rounded-xl p-3 text-center">
          <p className="text-xs text-green-600 dark:text-green-400 font-medium">Deposited</p>
          <p className="text-sm font-bold text-green-700 dark:text-green-300 mt-1">
            {formatCurrency(totalDeposits, trip.base_currency)}
          </p>
        </div>
        <div className="bg-red-50 dark:bg-red-900/20 rounded-xl p-3 text-center">
          <p className="text-xs text-red-600 dark:text-red-400 font-medium">Spent</p>
          <p className="text-sm font-bold text-red-700 dark:text-red-300 mt-1">
            {formatCurrency(totalExpenses, trip.base_currency)}
          </p>
        </div>
        <div className="bg-indigo-50 dark:bg-indigo-900/20 rounded-xl p-3 text-center">
          <p className="text-xs text-indigo-600 dark:text-indigo-400 font-medium">Pool</p>
          <p className="text-sm font-bold text-indigo-700 dark:text-indigo-300 mt-1">
            {formatCurrency(poolBalance, trip.base_currency)}
          </p>
        </div>
      </div>

      {/* Member Balances */}
      <div className="bg-white dark:bg-slate-800 rounded-xl p-4 shadow-sm border border-slate-200 dark:border-slate-700">
        <h2 className="font-semibold mb-3">Member Balances</h2>
        <div className="space-y-2">
          {members.map((member) => {
            const balance = balances.find((b) => b.memberId === member.id)
            const net = balance?.net ?? 0
            return (
              <div key={member.id} className="flex items-center justify-between py-1">
                <div className="flex items-center gap-2">
                  <div
                    className="w-8 h-8 rounded-full flex items-center justify-center text-white text-sm font-bold"
                    style={{ backgroundColor: member.color }}
                  >
                    {member.name.charAt(0).toUpperCase()}
                  </div>
                  <span className="font-medium text-sm">{member.name}</span>
                  {member.is_admin && <span className="text-xs bg-indigo-100 dark:bg-indigo-900 text-indigo-600 dark:text-indigo-400 px-1.5 py-0.5 rounded">Admin</span>}
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
        <h2 className="font-semibold mb-2">Invite Others</h2>
        <div className="flex gap-2">
          <input
            type="text"
            value={inviteLink}
            readOnly
            className="flex-1 px-3 py-2 rounded-lg border border-slate-300 dark:border-slate-600 bg-slate-50 dark:bg-slate-700 text-sm truncate"
          />
          <button
            onClick={() => navigator.clipboard.writeText(inviteLink)}
            className="px-3 py-2 bg-indigo-600 text-white rounded-lg text-sm font-medium hover:bg-indigo-700 transition-colors whitespace-nowrap"
          >
            Copy
          </button>
        </div>
      </div>

      {/* Recent Activity */}
      <div className="bg-white dark:bg-slate-800 rounded-xl p-4 shadow-sm border border-slate-200 dark:border-slate-700">
        <div className="flex items-center justify-between mb-3">
          <h2 className="font-semibold">Recent</h2>
          <button
            onClick={() => navigate(`/trip/${tripId}/history`)}
            className="text-sm text-indigo-600 dark:text-indigo-400"
          >
            See all
          </button>
        </div>
        {expenses.length === 0 && deposits.length === 0 ? (
          <p className="text-sm text-slate-500 text-center py-4">No transactions yet</p>
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
                      <span>{isExpense ? '💸' : '💰'}</span>
                      <div>
                        <p className="text-sm font-medium">
                          {isExpense ? (item as Expense).description || (item as Expense).category : 'Deposit'}
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
