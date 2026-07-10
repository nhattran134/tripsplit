import { useState } from 'react'
import { useParams, useNavigate } from 'react-router-dom'
import { useQuery, useMutation, useQueryClient } from '@tanstack/react-query'
import { useTranslation } from 'react-i18next'
import { supabase } from '@/lib/supabase'
import { calculateBalances } from '@/lib/settlement'
import { formatCurrency } from '@/lib/currency'
import { generateId } from '@/lib/utils'
import { useCopy } from '@/hooks/useCopy'
import { Avatar } from '@/components/common/Avatar'
import type { Member, Deposit, ExpenseSplit, Settlement } from '@/types'

export function MembersPage() {
  const { tripId } = useParams<{ tripId: string }>()
  const navigate = useNavigate()
  const queryClient = useQueryClient()
  const { t } = useTranslation()
  const { copy, copiedId } = useCopy()
  const [showAdd, setShowAdd] = useState(false)
  const [newName, setNewName] = useState('')
  const [addError, setAddError] = useState('')

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

  const addMemberMutation = useMutation({
    mutationFn: async () => {
      if (!newName.trim()) throw new Error('Enter a name')
      const colors = ['#6366f1', '#ec4899', '#f59e0b', '#10b981', '#3b82f6', '#8b5cf6', '#ef4444', '#14b8a6']
      const color = colors[Math.floor(Math.random() * colors.length)]
      const placeholderUid = crypto.randomUUID()
      // Generate a 4-char PIN for the member
      const chars = 'ABCDEFGHJKLMNPQRSTUVWXYZ23456789'
      let memberToken = ''
      for (let i = 0; i < 4; i++) memberToken += chars[Math.floor(Math.random() * chars.length)]

      const { error } = await supabase.from('members').insert({
        id: generateId(),
        trip_id: tripId,
        auth_uid: placeholderUid,
        name: newName.trim(),
        color,
        member_token: memberToken,
        claimed: false,
      })
      if (error) {
        if (error.message.includes('idx_members_unique_name_per_trip') || error.message.includes('duplicate')) {
          throw new Error('This name already exists in the trip.')
        }
        throw new Error(error.message)
      }
    },
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ['members', tripId] })
      setNewName('')
      setShowAdd(false)
      setAddError('')
    },
    onError: (e) => setAddError(e instanceof Error ? e.message : 'Failed to add member'),
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
  const currentMember = members.find((m) => m.auth_uid === currentAuthUid)
  const isAdmin = currentMember?.is_admin ?? false

  const removeMemberMutation = useMutation({
    mutationFn: async (memberId: string) => {
      const { error } = await supabase
        .from('members')
        .update({ deleted_at: new Date().toISOString() })
        .eq('id', memberId)
      if (error) throw new Error(error.message)
    },
    onSuccess: () => queryClient.invalidateQueries({ queryKey: ['members', tripId] }),
  })

  const toggleAdminMutation = useMutation({
    mutationFn: async ({ memberId, makeAdmin }: { memberId: string; makeAdmin: boolean }) => {
      const { error } = await supabase
        .from('members')
        .update({ is_admin: makeAdmin })
        .eq('id', memberId)
      if (error) throw new Error(error.message)
    },
    onSuccess: () => queryClient.invalidateQueries({ queryKey: ['members', tripId] }),
  })

  return (
    <div className="space-y-4">
      <div className="flex items-center justify-between">
        <div className="flex items-center gap-3">
          <button onClick={() => navigate(`/trip/${tripId}`)} className="text-indigo-600 dark:text-indigo-400">←</button>
          <h1 className="text-xl font-bold">{t('members.title')} ({members.length})</h1>
        </div>
        <button
          onClick={() => setShowAdd(true)}
          className="bg-indigo-600 text-white px-3 py-1.5 rounded-lg text-sm font-medium hover:bg-indigo-700 transition-colors"
        >
          {t('members.add')}
        </button>
      </div>

      {/* Add Member Modal */}
      {showAdd && (
        <div className="bg-white dark:bg-slate-800 rounded-xl p-4 shadow-sm border border-slate-200 dark:border-slate-700 space-y-3">
          <p className="font-medium text-sm">{t('members.addHint')}</p>
          <input
            type="text"
            value={newName}
            onChange={(e) => setNewName(e.target.value)}
            placeholder="Member name"
            className="w-full px-3 py-2 rounded-lg border border-slate-300 dark:border-slate-600 bg-transparent focus:ring-2 focus:ring-indigo-500 outline-none"
            autoFocus
          />
          {addError && <p className="text-red-500 text-sm">{addError}</p>}
          <div className="flex gap-2">
            <button onClick={() => { setShowAdd(false); setAddError('') }} className="flex-1 py-2 rounded-lg border border-slate-300 dark:border-slate-600 text-sm font-medium">{t('members.cancel')}</button>
            <button
              onClick={() => addMemberMutation.mutate()}
              disabled={addMemberMutation.isPending}
              className="flex-1 py-2 rounded-lg bg-indigo-600 text-white text-sm font-medium disabled:opacity-50"
            >
              {addMemberMutation.isPending ? t('members.adding') : t('members.add')}
            </button>
          </div>
        </div>
      )}

      <div className="space-y-3">
        {memberStats.map(({ member, totalDeposited, totalOwed, net }) => (
          <div key={member.id} className="bg-white dark:bg-slate-800 rounded-xl p-4 shadow-sm border border-slate-200 dark:border-slate-700">
            <div className="flex items-center gap-3 mb-3">
              <Avatar name={member.name} size={40} />
              <div className="flex-1">
                <div className="flex items-center gap-1.5 flex-wrap">
                  <p className="font-semibold">{member.name}</p>
                  {member.auth_uid === currentAuthUid && <span className="text-xs bg-green-100 dark:bg-green-900 text-green-600 dark:text-green-400 px-1.5 py-0.5 rounded">You</span>}
                  {member.is_admin && <span className="text-xs bg-indigo-100 dark:bg-indigo-900 text-indigo-600 dark:text-indigo-400 px-1.5 py-0.5 rounded">{t('common.admin')}</span>}
                  {!member.claimed && <span className="text-xs bg-amber-100 dark:bg-amber-900 text-amber-600 dark:text-amber-400 px-1.5 py-0.5 rounded">{t('members.unclaimed')}</span>}
                </div>
                {/* Show token - visible to all trip members */}
                <p className="text-[10px] font-mono bg-slate-100 dark:bg-slate-700 px-1.5 py-0.5 rounded text-slate-500 mt-0.5 inline-block">
                  PIN: <span className="font-bold text-slate-700 dark:text-slate-200">{member.member_token || '...'}</span>
                </p>
              </div>
              <span className={`font-bold ${net >= 0 ? 'text-green-600' : 'text-red-600'}`}>
                {net >= 0 ? '+' : ''}{formatCurrency(net, baseCurrency)}
              </span>
            </div>
            <div className="grid grid-cols-2 gap-2 text-sm">
              <div className="bg-green-50 dark:bg-green-900/20 rounded-lg p-2">
                <p className="text-xs text-green-600 dark:text-green-400">{t('members.deposited')}</p>
                <p className="font-semibold text-green-700 dark:text-green-300">{formatCurrency(totalDeposited, baseCurrency)}</p>
              </div>
              <div className="bg-red-50 dark:bg-red-900/20 rounded-lg p-2">
                <p className="text-xs text-red-600 dark:text-red-400">{t('members.theirShare')}</p>
                <p className="font-semibold text-red-700 dark:text-red-300">{formatCurrency(totalOwed, baseCurrency)}</p>
              </div>
            </div>
            {/* Admin actions */}
            {isAdmin && member.id !== currentMember?.id && (
              <div className="space-y-2 mt-3 pt-3 border-t border-slate-100 dark:border-slate-700">
                {/* Personal invite link for unclaimed members */}
                {!member.claimed && (
                  <button
                    onClick={() => {
                      const link = `${window.location.origin}/t/${trip?.invite_code}?claim=${member.id}`
                      copy(link, `link-${member.id}`)
                    }}
                    className={`w-full py-1.5 rounded-lg border text-xs font-medium transition-all duration-200 ${
                      copiedId === `link-${member.id}`
                        ? 'border-green-400 bg-green-50 dark:bg-green-900/30 text-green-600 scale-[1.02]'
                        : 'border-indigo-300 text-indigo-600 hover:bg-indigo-50 dark:hover:bg-indigo-900/20'
                    }`}
                  >
                    {copiedId === `link-${member.id}` ? '✓ Copied!' : t('members.copyLink')}
                  </button>
                )}
                <div className="flex gap-2">
                  <button
                    onClick={() => toggleAdminMutation.mutate({ memberId: member.id, makeAdmin: !member.is_admin })}
                    disabled={toggleAdminMutation.isPending}
                    className="flex-1 py-1.5 rounded-lg border border-slate-300 dark:border-slate-600 text-xs font-medium hover:bg-slate-50 dark:hover:bg-slate-700 transition-colors"
                  >
                    {member.is_admin ? t('members.removeAdmin') : t('members.makeAdmin')}
                  </button>
                  <button
                    onClick={() => { if (confirm(`Remove ${member.name}?`)) removeMemberMutation.mutate(member.id) }}
                    disabled={removeMemberMutation.isPending}
                    className="py-1.5 px-3 rounded-lg border border-red-300 text-red-600 text-xs font-medium hover:bg-red-50 dark:hover:bg-red-900/20 transition-colors"
                  >
                    {t('members.remove')}
                  </button>
                </div>
              </div>
            )}
          </div>
        ))}
      </div>
    </div>
  )
}
