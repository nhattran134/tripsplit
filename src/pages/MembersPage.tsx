import { useParams, useNavigate } from 'react-router-dom'
import { useQuery } from '@tanstack/react-query'
import { supabase } from '@/lib/supabase'
import { calculateBalances } from '@/lib/settlement'
import { formatCurrency } from '@/lib/currency'
import type { Member, Deposit, ExpenseSplit, Settlement } from '@/types'

export function MembersPage() {
  const { tripId } = useParams<{ tripId: string }>()
  const navigate = useNavigate()

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

  const balances = calculateBalances(members, deposits, expenseSplits, settlements)
  const baseCurrency = trip?.base_currency || 'VND'

  const memberStats = members.map((member) => {
    const memberDeposits = deposits.filter((d) => d.member_id === member.id)
    const memberSplits = expenseSplits.filter((s) => s.member_id === member.id)
    const totalDeposited = memberDeposits.reduce((sum, d) => sum + Number(d.amount) * Number(d.rate_to_base), 0)
    const totalOwed = memberSplits.reduce((sum, s) => sum + Number(s.share_amount), 0)
    const balance = balances.find((b) => b.memberId === member.id)

    return { member, totalDeposited, totalOwed, net: balance?.net ?? 0 }
  })

  return (
    <div className="space-y-4">
      <div className="flex items-center gap-3">
        <button onClick={() => navigate(`/trip/${tripId}`)} className="text-indigo-600 dark:text-indigo-400">←</button>
        <h1 className="text-xl font-bold">Members ({members.length})</h1>
      </div>

      <div className="space-y-3">
        {memberStats.map(({ member, totalDeposited, totalOwed, net }) => (
          <div key={member.id} className="bg-white dark:bg-slate-800 rounded-xl p-4 shadow-sm border border-slate-200 dark:border-slate-700">
            <div className="flex items-center gap-3 mb-3">
              <div
                className="w-10 h-10 rounded-full flex items-center justify-center text-white font-bold"
                style={{ backgroundColor: member.color }}
              >
                {member.name.charAt(0).toUpperCase()}
              </div>
              <div className="flex-1">
                <p className="font-semibold">{member.name}</p>
                {member.is_admin && <span className="text-xs bg-indigo-100 dark:bg-indigo-900 text-indigo-600 dark:text-indigo-400 px-1.5 py-0.5 rounded">Admin</span>}
              </div>
              <span className={`font-bold ${net >= 0 ? 'text-green-600' : 'text-red-600'}`}>
                {net >= 0 ? '+' : ''}{formatCurrency(net, baseCurrency)}
              </span>
            </div>
            <div className="grid grid-cols-2 gap-2 text-sm">
              <div className="bg-green-50 dark:bg-green-900/20 rounded-lg p-2">
                <p className="text-xs text-green-600 dark:text-green-400">Deposited</p>
                <p className="font-semibold text-green-700 dark:text-green-300">{formatCurrency(totalDeposited, baseCurrency)}</p>
              </div>
              <div className="bg-red-50 dark:bg-red-900/20 rounded-lg p-2">
                <p className="text-xs text-red-600 dark:text-red-400">Their Share</p>
                <p className="font-semibold text-red-700 dark:text-red-300">{formatCurrency(totalOwed, baseCurrency)}</p>
              </div>
            </div>
          </div>
        ))}
      </div>
    </div>
  )
}
