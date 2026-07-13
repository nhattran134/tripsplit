import { useState, useMemo } from 'react'
import { useParams, useNavigate } from 'react-router-dom'
import { useQuery, useMutation, useQueryClient } from '@tanstack/react-query'
import { useTranslation } from 'react-i18next'
import { supabase } from '@/lib/supabase'
import { calculateBalances } from '@/lib/settlement'
import { formatCurrency } from '@/lib/currency'
import { generateId } from '@/lib/utils'
import { useCopy } from '@/hooks/useCopy'
import { Avatar, AvatarPicker } from '@/components/common/Avatar'
import type { Member, Deposit, Expense, ExpenseSplit, Settlement } from '@/types'

export function MembersPage() {
  const { tripId } = useParams<{ tripId: string }>()
  const navigate = useNavigate()
  const queryClient = useQueryClient()
  const { t } = useTranslation()
  const { copy, copiedId } = useCopy()
  const [showAdd, setShowAdd] = useState(false)
  const [editingAvatar, setEditingAvatar] = useState<string | null>(null)
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

  const { data: expenses = [] } = useQuery({
    queryKey: ['expenses', tripId],
    queryFn: async () => {
      const { data, error } = await supabase.from('expenses').select('*').eq('trip_id', tripId).is('deleted_at', null)
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

  const balances = calculateBalances(members, deposits, expenses, expenseSplits, settlements)
  const baseCurrency = trip?.base_currency || 'VND'

  const memberStats = members.map((member) => {
    const memberDeposits = deposits.filter((d) => d.member_id === member.id)
    const memberSplits = expenseSplits.filter((s) => s.member_id === member.id)
    const totalDeposited = memberDeposits.reduce((sum, d) => sum + Number(d.amount) * Number(d.rate_to_base), 0)
    const totalOwed = memberSplits.reduce((sum, s) => sum + Number(s.share_amount), 0)
    const balance = balances.find((b) => b.memberId === member.id)

    return { member, totalDeposited, totalOwed, net: balance?.net ?? 0 }
  })

  // Compute group-level balances
  const groupBalances = useMemo(() => {
    const map = new Map<string, { groupName: string; members: string[]; net: number }>()
    for (const stat of memberStats) {
      const groupKey = stat.member.group_id || `solo_${stat.member.id}`
      const existing = map.get(groupKey)
      if (existing) {
        existing.members.push(stat.member.name)
        existing.net += stat.net
      } else {
        // Find group name
        const groupName = stat.member.group_id
          ? (members.find(m => m.group_id === stat.member.group_id)?.name || groupKey)
          : stat.member.name
        map.set(groupKey, { groupName, members: [stat.member.name], net: stat.net })
      }
    }
    return map
  }, [memberStats, members])

  // Pool surplus: total deposits - total pool expenses
  const totalDeposits = deposits.reduce((sum, d) => sum + (Number(d.amount) || 0) * (Number(d.rate_to_base) || 1), 0)
  const totalPoolExpenses = expenses.filter(e => e.paid_from === 'pool').reduce((sum, e) => sum + (Number(e.amount) || 0) * (Number(e.rate_to_base) || 1), 0)
  const viaPoolSettled = settlements.filter(s => !s.deleted_at && s.method === 'via_pool').reduce((sum, s) => sum + (Number(s.amount) || 0), 0)
  const poolSurplus = totalDeposits - totalPoolExpenses - viaPoolSettled

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

  const updateAvatarMutation = useMutation({
    mutationFn: async ({ memberId, style, seed }: { memberId: string; style: string; seed: number }) => {
      const { error } = await supabase
        .from('members')
        .update({ avatar_style: style, avatar_seed: seed })
        .eq('id', memberId)
      if (error) throw new Error(error.message)
    },
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ['members', tripId] })
      setEditingAvatar(null)
    },
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
        <div className="glass-card rounded-xl p-4 space-y-3">
          <p className="font-medium text-sm">{t('members.addHint')}</p>
          <input
            type="text"
            value={newName}
            onChange={(e) => setNewName(e.target.value)}
            placeholder={t('members.memberName')}
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

      {/* Pool Surplus */}
      {poolSurplus > 0.01 && (
        <div className="bg-amber-50 dark:bg-amber-900/20 border border-amber-200 dark:border-amber-700 rounded-xl p-3 mb-3">
          <div className="flex items-center justify-between">
            <div>
              <p className="text-sm font-medium text-amber-800 dark:text-amber-200">💰 {t('members.poolSurplus')}</p>
              <p className="text-xs text-amber-600 dark:text-amber-400">{t('members.poolSurplusHint')}</p>
            </div>
            <span className="font-bold text-amber-700 dark:text-amber-300">{formatCurrency(poolSurplus, baseCurrency)}</span>
          </div>
          {/* Show who deposited (gets refund) */}
          <div className="mt-2 flex flex-wrap gap-1">
            {memberStats.filter(s => s.totalDeposited > 0).map(s => (
              <span key={s.member.id} className="text-xs bg-amber-100 dark:bg-amber-800 text-amber-700 dark:text-amber-300 px-2 py-0.5 rounded-full">
                {s.member.name}: {formatCurrency(s.totalDeposited, baseCurrency)}
              </span>
            ))}
          </div>
        </div>
      )}

      {/* Group Balances */}
      {groupBalances.size > 0 && [...groupBalances.values()].some(g => g.members.length > 1) && (
        <div className="bg-indigo-50 dark:bg-indigo-900/20 border border-indigo-200 dark:border-indigo-700 rounded-xl p-3 mb-3">
          <p className="text-sm font-medium text-indigo-800 dark:text-indigo-200 mb-2">👥 {t('members.groupBalances')}</p>
          <div className="space-y-1.5">
            {[...groupBalances.entries()].filter(([, g]) => g.members.length > 1).map(([key, g]) => (
              <div key={key} className="flex items-center justify-between text-sm">
                <span className="text-indigo-700 dark:text-indigo-300">
                  {g.members.join(' + ')}
                </span>
                <span className={`font-semibold ${Math.round(g.net) >= 0 ? 'text-green-600' : 'text-red-600'}`}>
                  {Math.round(g.net) >= 0 ? '+' : ''}{formatCurrency(Math.round(g.net * 100) / 100, baseCurrency)}
                </span>
              </div>
            ))}
          </div>
          <p className="text-[10px] text-indigo-500 dark:text-indigo-400 mt-1.5">{t('members.groupBalancesHint')}</p>
        </div>
      )}

      <div className="space-y-3">
        {memberStats.map(({ member, totalDeposited, totalOwed, net }) => (
          <div key={member.id} className="glass-card rounded-xl p-4">
            <div className="flex items-center gap-3 mb-3">
              <button
                onClick={() => member.auth_uid === currentAuthUid ? setEditingAvatar(editingAvatar === member.id ? null : member.id) : undefined}
                className={member.auth_uid === currentAuthUid ? 'relative' : ''}
              >
                <Avatar name={member.name} style={member.avatar_style} seed={member.avatar_seed} size={40} />
                {member.auth_uid === currentAuthUid && (
                  <span className="absolute -bottom-0.5 -right-0.5 w-4 h-4 bg-indigo-500 rounded-full flex items-center justify-center text-white text-[8px]">✎</span>
                )}
              </button>
              <div className="flex-1">
                <div className="flex items-center gap-1.5 flex-wrap">
                  <p className="font-semibold">{member.name}</p>
                  {member.auth_uid === currentAuthUid && <span className="text-xs bg-green-100 dark:bg-green-900 text-green-600 dark:text-green-400 px-1.5 py-0.5 rounded">{t('common.you')}</span>}
                  {member.is_admin && <span className="text-xs bg-indigo-100 dark:bg-indigo-900 text-indigo-600 dark:text-indigo-400 px-1.5 py-0.5 rounded">{t('common.admin')}</span>}
                  {trip?.budget_holder_id === member.id && <span className="text-xs bg-amber-100 dark:bg-amber-900 text-amber-600 dark:text-amber-400 px-1.5 py-0.5 rounded">💰 {t('members.budgetHolder')}</span>}
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

            {/* Avatar picker (for current user) */}
            {editingAvatar === member.id && (
              <div className="mb-3 p-3 bg-slate-50 dark:bg-slate-900 rounded-lg">
                <p className="text-xs font-medium text-slate-500 mb-2">{t('members.chooseAvatar')}</p>
                <AvatarPicker
                  name={member.name}
                  selected={member.avatar_style}
                  seed={member.avatar_seed}
                  onSelect={(style, seed) => updateAvatarMutation.mutate({ memberId: member.id, style, seed })}
                />
              </div>
            )}

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

      {/* Groups Management (admin only) */}
      {isAdmin && (
        <GroupsSection tripId={tripId!} members={members.filter(m => !m.deleted_at)} />
      )}
    </div>
  )
}

function GroupsSection({ tripId, members }: { tripId: string; members: Member[] }) {
  const queryClient = useQueryClient()
  const { t } = useTranslation()
  const [newGroupName, setNewGroupName] = useState('')
  const [showCreate, setShowCreate] = useState(false)

  const { data: groups = [] } = useQuery({
    queryKey: ['member-groups', tripId],
    queryFn: async () => {
      const { data, error } = await supabase.from('member_groups').select('*').eq('trip_id', tripId)
      if (error) throw error
      return data as { id: string; trip_id: string; name: string }[]
    },
  })

  const createGroupMutation = useMutation({
    mutationFn: async () => {
      if (!newGroupName.trim()) throw new Error('Enter a group name')
      const { error } = await supabase.from('member_groups').insert({ trip_id: tripId, name: newGroupName.trim() })
      if (error) throw new Error(error.message)
    },
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ['member-groups', tripId] })
      setNewGroupName('')
      setShowCreate(false)
    },
  })

  const assignMemberMutation = useMutation({
    mutationFn: async ({ memberId, groupId }: { memberId: string; groupId: string | null }) => {
      const { error } = await supabase.from('members').update({ group_id: groupId }).eq('id', memberId)
      if (error) throw new Error(error.message)
    },
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ['members', tripId] })
    },
  })

  const deleteGroupMutation = useMutation({
    mutationFn: async (groupId: string) => {
      // Unassign members first
      await supabase.from('members').update({ group_id: null }).eq('group_id', groupId)
      const { error } = await supabase.from('member_groups').delete().eq('id', groupId)
      if (error) throw new Error(error.message)
    },
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ['member-groups', tripId] })
      queryClient.invalidateQueries({ queryKey: ['members', tripId] })
    },
  })

  return (
    <div className="mt-6 space-y-3">
      <div className="flex items-center justify-between">
        <h2 className="font-semibold">{t('groups.title')}</h2>
        <button
          onClick={() => setShowCreate(!showCreate)}
          className="text-xs bg-indigo-600 text-white px-2.5 py-1 rounded-lg font-medium"
        >
          {t('groups.addGroup')}
        </button>
      </div>

      {showCreate && (
        <div className="flex gap-2">
          <input
            type="text"
            value={newGroupName}
            onChange={(e) => setNewGroupName(e.target.value)}
            placeholder={t('groups.placeholder')}
            className="flex-1 px-3 py-2 rounded-lg border border-slate-300 dark:border-slate-600 bg-transparent text-sm focus:ring-2 focus:ring-indigo-500 outline-none"
            autoFocus
          />
          <button
            onClick={() => createGroupMutation.mutate()}
            className="px-3 py-2 bg-indigo-600 text-white rounded-lg text-sm font-medium"
          >
            {t('groups.add')}
          </button>
        </div>
      )}

      {groups.length === 0 && !showCreate && (
        <p className="text-xs text-slate-500">{t('groups.noGroups')}</p>
      )}

      {groups.map((group) => {
        const groupMembers = members.filter(m => m.group_id === group.id)
        const unassigned = members.filter(m => !m.group_id)
        return (
          <div key={group.id} className="bg-white dark:bg-slate-800 rounded-xl p-3 border border-slate-200 dark:border-slate-700">
            <div className="flex items-center justify-between mb-2">
              <p className="font-medium text-sm">{group.name}</p>
              <button
                onClick={() => { if (confirm(`Delete group "${group.name}"?`)) deleteGroupMutation.mutate(group.id) }}
                className="text-xs text-red-500 hover:text-red-700"
              >
                {t('groups.delete')}
              </button>
            </div>
            {/* Members in this group */}
            <div className="flex flex-wrap gap-1 mb-2">
              {groupMembers.map((m) => (
                <span key={m.id} className="flex items-center gap-1 px-2 py-1 bg-indigo-50 dark:bg-indigo-900/30 rounded-full text-xs font-medium text-indigo-700 dark:text-indigo-300">
                  {m.name}
                  <button onClick={() => assignMemberMutation.mutate({ memberId: m.id, groupId: null })} className="text-indigo-400 hover:text-red-500">×</button>
                </span>
              ))}
              {groupMembers.length === 0 && <span className="text-xs text-slate-400">{t('groups.noMembers')}</span>}
            </div>
            {/* Add member to group */}
            {unassigned.length > 0 && (
              <select
                onChange={(e) => { if (e.target.value) assignMemberMutation.mutate({ memberId: e.target.value, groupId: group.id }); e.target.value = '' }}
                className="w-full px-2 py-1.5 rounded-lg border border-slate-200 dark:border-slate-700 bg-transparent text-xs"
                defaultValue=""
              >
                <option value="">{t('groups.addMember')}</option>
                {unassigned.map((m) => <option key={m.id} value={m.id}>{m.name}</option>)}
              </select>
            )}
          </div>
        )
      })}

      {/* Show ungrouped members */}
      {groups.length > 0 && (
        <div className="text-xs text-slate-500">
          {t('groups.ungrouped')}: {members.filter(m => !m.group_id).map(m => m.name).join(', ') || 'none'}
        </div>
      )}
    </div>
  )
}
