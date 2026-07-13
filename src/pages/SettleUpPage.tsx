import { useState, useMemo, useRef } from 'react'
import { useParams, useNavigate } from 'react-router-dom'
import { useQuery, useMutation, useQueryClient } from '@tanstack/react-query'
import { useTranslation } from 'react-i18next'
import { supabase } from '@/lib/supabase'
import { calculateBalances, simplifyDebts, calculatePoolReimbursements } from '@/lib/settlement'
import { formatCurrency } from '@/lib/currency'
import { generateId } from '@/lib/utils'
import { Avatar } from '@/components/common/Avatar'
import { showToast } from '@/components/common/Toast'
import type { Member, Deposit, Expense, ExpenseSplit, Settlement } from '@/types'

export function SettleUpPage() {
  const { tripId } = useParams<{ tripId: string }>()
  const navigate = useNavigate()
  const queryClient = useQueryClient()
  const { t } = useTranslation()
  const [settlingIndex, setSettlingIndex] = useState<number | null>(null)
  const [settleMethods, setSettleMethods] = useState<Record<number, 'direct' | 'via_pool'>>({})
  const [settleAmounts, setSettleAmounts] = useState<Record<number, string>>({})
  const [showIntraGroup, setShowIntraGroup] = useState(false)
  const submittingRef = useRef(false)

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

  const { data: groups = [] } = useQuery({
    queryKey: ['member-groups', tripId],
    queryFn: async () => {
      const { data, error } = await supabase.from('member_groups').select('*').eq('trip_id', tripId)
      if (error) throw error
      return data as { id: string; name: string }[]
    },
  })

  const settleMutation = useMutation({
    mutationFn: async (params: { from: Member; to: Member; amount: number; method: 'direct' | 'via_pool' }) => {
      if (submittingRef.current) return
      submittingRef.current = true
      const { error } = await supabase.from('settlements').insert({
        id: generateId(),
        trip_id: tripId,
        from_member_id: params.from.id,
        to_member_id: params.to.id,
        amount: params.amount,
        method: params.method,
        note: '',
      })
      if (error) throw new Error(error.message)
    },
    onSuccess: () => {
      submittingRef.current = false
      queryClient.invalidateQueries({ queryKey: ['settlements', tripId] })
      queryClient.invalidateQueries({ queryKey: ['deposits', tripId] })
      queryClient.invalidateQueries({ queryKey: ['expenses', tripId] })
      queryClient.invalidateQueries({ queryKey: ['expense_splits', tripId] })
      setSettlingIndex(null)
      showToast(t('settle.settled'))
    },
    onError: () => {
      submittingRef.current = false
    },
  })

  const balances = useMemo(
    () => calculateBalances(members, deposits, expenses, expenseSplits, settlements),
    [members, deposits, expenses, expenseSplits, settlements]
  )

  const transfers = useMemo(
    () => {
      // Get normal inter-group transfers
      const interGroup = simplifyDebts(balances, members)
      // Get pool reimbursements (pocket payers reimbursed from depositors)
      const poolReimb = calculatePoolReimbursements(members, deposits, expenses, expenseSplits, settlements)
      // Combine: pool reimbursements + normal settlements (deduplicate if same from→to)
      const combined = [...poolReimb]
      for (const t of interGroup) {
        // Check if already covered by pool reimbursement
        const existing = combined.find(c => c.from.id === t.from.id && c.to.id === t.to.id)
        if (existing) {
          existing.amount = Math.round((existing.amount + t.amount) * 100) / 100
        } else {
          combined.push(t)
        }
      }
      return combined.filter(t => t.amount > 0.005)
    },
    [balances, members, deposits, expenses, expenseSplits, settlements]
  )


  // Compute intra-group settlements (debts between members of the same group)
  const intraGroupTransfers = useMemo(() => {
    const EPSILON = 0.005
    const groups = new Map<string, Member[]>()
    for (const m of members) {
      if (!m.group_id) continue
      const list = groups.get(m.group_id) || []
      list.push(m)
      groups.set(m.group_id, list)
    }

    const result: { groupName: string; transfers: { from: Member; to: Member; amount: number }[] }[] = []

    for (const [, groupMembers] of groups) {
      if (groupMembers.length < 2) continue

      // Get individual balances for this group's members
      const groupBalances = groupMembers.map(m => {
        const b = balances.find(bal => bal.memberId === m.id)
        return { member: m, net: b?.net ?? 0 }
      })

      // Run greedy within this group
      const creditors = groupBalances.filter(b => b.net >= EPSILON).map(b => ({ ...b })).sort((a, b) => b.net - a.net)
      const debtors = groupBalances.filter(b => b.net <= -EPSILON).map(b => ({ ...b, net: Math.abs(b.net) })).sort((a, b) => b.net - a.net)

      const groupTransfers: { from: Member; to: Member; amount: number }[] = []
      let i = 0, j = 0
      while (i < debtors.length && j < creditors.length) {
        const amount = Math.round(Math.min(debtors[i].net, creditors[j].net) * 100) / 100
        if (amount >= EPSILON) {
          groupTransfers.push({ from: debtors[i].member, to: creditors[j].member, amount })
        }
        debtors[i].net = Math.round((debtors[i].net - amount) * 100) / 100
        creditors[j].net = Math.round((creditors[j].net - amount) * 100) / 100
        if (debtors[i].net < EPSILON) i++
        if (creditors[j].net < EPSILON) j++
      }

      if (groupTransfers.length > 0) {
        result.push({ groupName: groupMembers.map(m => m.name).join(' & '), transfers: groupTransfers })
      }
    }
    return result
  }, [balances, members])

  const hasIntraGroupDebts = intraGroupTransfers.length > 0
  const baseCurrency = trip?.base_currency || 'VND'
  const poolBalance = deposits.reduce((s, d) => s + (Number(d.amount) || 0) * (Number(d.rate_to_base) || 1), 0)
    - expenses.filter(e => e.paid_from === 'pool').reduce((s, e) => s + (Number(e.amount) || 0) * (Number(e.rate_to_base) || 1), 0)

  // Pool surplus calculation for refund
  const poolSurplus = useMemo(() => {
    const totalDeposits = deposits.reduce((sum, d) => sum + Number(d.amount) * Number(d.rate_to_base), 0)
    const totalPoolExpenses = expenses.filter(e => e.paid_from === 'pool').reduce((sum, e) => sum + Number(e.amount) * Number(e.rate_to_base), 0)
    return totalDeposits - totalPoolExpenses
  }, [deposits, expenses])

  const depositorRefunds = useMemo(() => {
    if (poolSurplus <= 0.01) return []
    const totalDeposits = deposits.reduce((sum, d) => sum + Number(d.amount) * Number(d.rate_to_base), 0)
    if (totalDeposits === 0) return []

    const depositorTotals = new Map<string, number>()
    for (const d of deposits) {
      const memberId = d.member_id
      const base = Number(d.amount) * Number(d.rate_to_base)
      depositorTotals.set(memberId, (depositorTotals.get(memberId) || 0) + base)
    }

    return [...depositorTotals.entries()].map(([memberId, deposited]) => {
      const member = members.find(m => m.id === memberId)
      const refund = (deposited / totalDeposits) * poolSurplus
      return { member, refund }
    }).filter(r => r.refund > 0.01)
  }, [poolSurplus, deposits, members])

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
              <p className="font-semibold text-slate-600 dark:text-slate-300">{t('settle.noTransactions')}</p>
              <p className="text-sm text-slate-500 mt-1">{t('settle.noTransactionsHint')}</p>
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
          {transfers.map((transfer, index) => {
            const method = settleMethods[index] || 'direct'
            const editedAmount = settleAmounts[index]
            const displayAmount = editedAmount !== undefined ? parseFloat(editedAmount) || 0 : transfer.amount

            return (
              <div
                key={`${transfer.from.id}-${transfer.to.id}`}
                className="bg-white dark:bg-slate-800 rounded-xl p-4 shadow-sm border border-slate-200 dark:border-slate-700"
              >
                <div className="flex items-center justify-between mb-2">
                  <div className="flex items-center gap-2">
                    {(() => {
                      const fromGroup = transfer.from.group_id
                        ? members.filter(m => m.group_id === transfer.from.group_id && !m.deleted_at)
                        : [transfer.from]
                      const toGroup = transfer.to.group_id
                        ? members.filter(m => m.group_id === transfer.to.group_id && !m.deleted_at)
                        : [transfer.to]
                      const fromGroupName = transfer.from.group_id
                        ? groups.find(g => g.id === transfer.from.group_id)?.name || fromGroup.map(m => m.name).join(' & ')
                        : transfer.from.name
                      const toGroupName = transfer.to.group_id
                        ? groups.find(g => g.id === transfer.to.group_id)?.name || toGroup.map(m => m.name).join(' & ')
                        : transfer.to.name
                      return (
                        <>
                          <div className="flex flex-col items-center gap-0.5">
                            <div className="flex -space-x-1.5">
                              {fromGroup.map(m => <Avatar key={m.id} name={m.name} style={m.avatar_style} seed={m.avatar_seed} size={26} />)}
                            </div>
                            <span className="text-[10px] font-medium text-slate-600 dark:text-slate-400">{fromGroupName}</span>
                          </div>
                          <span className="text-sm text-slate-400">→</span>
                          <div className="flex flex-col items-center gap-0.5">
                            <div className="flex -space-x-1.5">
                              {toGroup.map(m => <Avatar key={m.id} name={m.name} style={m.avatar_style} seed={m.avatar_seed} size={26} />)}
                            </div>
                            <span className="text-[10px] font-medium text-slate-600 dark:text-slate-400">{toGroupName}</span>
                          </div>
                        </>
                      )
                    })()}
                  </div>
                  <span className="font-bold">{formatCurrency(transfer.amount, baseCurrency)}</span>
                </div>
                <p className="text-sm text-slate-600 dark:text-slate-400">
                  <span className="font-medium">
                    {transfer.from.group_id
                      ? groups.find(g => g.id === transfer.from.group_id)?.name || members.filter(m => m.group_id === transfer.from.group_id && !m.deleted_at).map(m => m.name).join(' & ')
                      : transfer.from.name}
                  </span>
                  {' '}{t('settle.pays')}{' '}
                  <span className="font-medium">
                    {transfer.to.group_id
                      ? groups.find(g => g.id === transfer.to.group_id)?.name || members.filter(m => m.group_id === transfer.to.group_id && !m.deleted_at).map(m => m.name).join(' & ')
                      : transfer.to.name}
                  </span>
                </p>

                {/* Reason breakdown */}
                <div className="mt-2 p-2 rounded-lg bg-slate-50 dark:bg-slate-700/50 text-[11px] text-slate-600 dark:text-slate-400 space-y-1">
                  {(() => {
                    const fromMembers = transfer.from.group_id
                      ? members.filter(m => m.group_id === transfer.from.group_id && !m.deleted_at)
                      : [transfer.from]
                    const toMembers = transfer.to.group_id
                      ? members.filter(m => m.group_id === transfer.to.group_id && !m.deleted_at)
                      : [transfer.to]
                    
                    const sumFor = (mems: Member[]) => {
                      const deposited = mems.reduce((s, m) => s + deposits.filter(d => d.member_id === m.id).reduce((ds, d) => ds + (Number(d.amount) || 0) * (Number(d.rate_to_base) || 1), 0), 0)
                      const pocketCredit = mems.reduce((s, m) => s + expenses.filter(e => e.paid_from === 'pocket' && e.member_id === m.id).reduce((es, e) => es + (Number(e.amount) || 0) * (Number(e.rate_to_base) || 1), 0), 0)
                      const shares = mems.reduce((s, m) => s + expenseSplits.filter(sp => sp.member_id === m.id).reduce((ss, sp) => ss + (Number(sp.share_amount) || 0), 0), 0)
                      return { deposited, pocketCredit, shares }
                    }

                    const from = sumFor(fromMembers)
                    const to = sumFor(toMembers)
                    const fromGroupName = transfer.from.group_id ? groups.find(g => g.id === transfer.from.group_id)?.name || transfer.from.name : transfer.from.name
                    const toGroupName = transfer.to.group_id ? groups.find(g => g.id === transfer.to.group_id)?.name || transfer.to.name : transfer.to.name

                    return (
                      <>
                        <div className="flex justify-between"><span>{fromGroupName}: {t('settle.reasonDeposited')}</span><span>{formatCurrency(from.deposited, baseCurrency)}</span></div>
                        {from.pocketCredit > 0 && <div className="flex justify-between"><span>{fromGroupName}: {t('settle.reasonPaid')}</span><span>{formatCurrency(from.pocketCredit, baseCurrency)}</span></div>}
                        <div className="flex justify-between"><span>{fromGroupName}: {t('settle.reasonShare')}</span><span>-{formatCurrency(from.shares, baseCurrency)}</span></div>
                        <div className="border-t border-slate-200 dark:border-slate-600 my-1"></div>
                        <div className="flex justify-between"><span>{toGroupName}: {t('settle.reasonDeposited')}</span><span>{formatCurrency(to.deposited, baseCurrency)}</span></div>
                        {to.pocketCredit > 0 && <div className="flex justify-between"><span>{toGroupName}: {t('settle.reasonPaid')}</span><span>{formatCurrency(to.pocketCredit, baseCurrency)}</span></div>}
                        <div className="flex justify-between"><span>{toGroupName}: {t('settle.reasonShare')}</span><span>-{formatCurrency(to.shares, baseCurrency)}</span></div>
                      </>
                    )
                  })()}
                </div>

                {/* Editable settlement amount (Fix 2.6) */}
                <div className="mt-3">
                  <label className="text-xs text-slate-500">{t('settle.amountToSettle')}</label>
                  <input
                    type="number"
                    inputMode="decimal"
                    value={editedAmount !== undefined ? editedAmount : transfer.amount.toString()}
                    onChange={(e) => setSettleAmounts({ ...settleAmounts, [index]: e.target.value })}
                    className="mt-1 w-full px-3 py-1.5 rounded-lg border border-slate-300 dark:border-slate-600 bg-transparent text-sm focus:ring-2 focus:ring-indigo-500 outline-none"
                  />
                </div>

                {/* Settlement method selector (Fix 1.4) */}
                <div className="mt-3 flex gap-2">
                  <button
                    onClick={() => setSettleMethods({ ...settleMethods, [index]: 'direct' })}
                    className={`flex-1 py-1.5 rounded-lg text-xs font-medium border ${
                      method === 'direct'
                        ? 'border-indigo-500 bg-indigo-50 dark:bg-indigo-900/30 text-indigo-700 dark:text-indigo-300'
                        : 'border-slate-200 dark:border-slate-700 text-slate-600 dark:text-slate-400'
                    }`}
                  >
                    {t('settle.direct')}
                  </button>
                  {(() => {
                    // Debtor's pool credit = their deposits - their pool expense shares
                    const fromMembers = transfer.from.group_id
                      ? members.filter(m => m.group_id === transfer.from.group_id && !m.deleted_at)
                      : [transfer.from]
                    const debtorDeposits = fromMembers.reduce((s, m) => s + deposits.filter(d => d.member_id === m.id).reduce((ds, d) => ds + (Number(d.amount) || 0) * (Number(d.rate_to_base) || 1), 0), 0)
                    const debtorPoolShares = fromMembers.reduce((s, m) => s + expenseSplits.filter(sp => sp.member_id === m.id && expenses.find(e => e.id === sp.expense_id && e.paid_from === 'pool')).reduce((ss, sp) => ss + (Number(sp.share_amount) || 0), 0), 0)
                    const debtorPoolCredit = debtorDeposits - debtorPoolShares
                    const canUsePool = debtorPoolCredit > 0

                    return (
                      <button
                        onClick={() => canUsePool && setSettleMethods({ ...settleMethods, [index]: 'via_pool' })}
                        disabled={!canUsePool}
                        className={`flex-1 py-1.5 rounded-lg text-xs font-medium border ${
                          !canUsePool
                            ? 'border-slate-200 dark:border-slate-700 text-slate-400 dark:text-slate-600 opacity-50 cursor-not-allowed'
                            : method === 'via_pool'
                              ? 'border-indigo-500 bg-indigo-50 dark:bg-indigo-900/30 text-indigo-700 dark:text-indigo-300'
                              : 'border-slate-200 dark:border-slate-700 text-slate-600 dark:text-slate-400'
                        }`}
                        title={!canUsePool ? t('settle.noPoolCredit') : ''}
                      >
                        {t('settle.viaPool')}
                        {canUsePool && <span className="block text-[9px] text-slate-400">({formatCurrency(debtorPoolCredit, baseCurrency)})</span>}
                      </button>
                    )
                  })()}
                </div>

                {/* Via pool explanation + warning */}
                {method === 'via_pool' && (
                  <div className="mt-2">
                    <p className="text-[10px] text-slate-500 dark:text-slate-400 italic">
                      {t('settle.viaPoolHint')} ({t('dashboard.pool')}: {formatCurrency(poolBalance, baseCurrency)})
                    </p>
                    {displayAmount > poolBalance && poolBalance >= 0 && (
                      <p className="mt-1 text-[11px] text-amber-600 dark:text-amber-400">
                        ⚠️ {t('settle.poolInsufficient', { amount: formatCurrency(poolBalance, baseCurrency) })}
                      </p>
                    )}
                  </div>
                )}

                <button
                  onClick={() => {
                    if (submittingRef.current) return
                    setSettlingIndex(index)
                    settleMutation.mutate({
                      from: transfer.from,
                      to: transfer.to,
                      amount: displayAmount,
                      method,
                    })
                  }}
                  disabled={settleMutation.isPending && settlingIndex === index}
                  className="mt-3 w-full py-2 rounded-lg border border-green-500 text-green-600 text-sm font-medium hover:bg-green-50 dark:hover:bg-green-900/20 disabled:opacity-50 transition-colors"
                >
                  {settleMutation.isPending && settlingIndex === index ? t('settle.marking') : t('settle.markSettled')}
                </button>
              </div>
            )
          })}
        </div>
      )}

      {/* Pool reimbursements now included in main transfers list above */}

      {/* Pool Surplus Refund */}
      {depositorRefunds.length > 0 && (
        <div className="bg-green-50 dark:bg-green-900/20 border border-green-200 dark:border-green-700 rounded-xl p-4">
          <div className="flex items-center gap-2 mb-2">
            <span className="text-lg">💰</span>
            <div>
              <p className="font-semibold text-sm text-green-800 dark:text-green-200">{t('settle.poolSurplus')}: {formatCurrency(poolSurplus, baseCurrency)}</p>
              <p className="text-xs text-green-600 dark:text-green-400">{t('settle.poolSurplusHint')}</p>
            </div>
          </div>
          <div className="space-y-1.5 mt-3">
            {depositorRefunds.map((r) => (
              <div key={r.member?.id} className="flex items-center justify-between text-sm">
                <span className="text-green-700 dark:text-green-300">{t('settle.refundAmount')}: {r.member?.name}</span>
                <span className="font-bold text-green-700 dark:text-green-300">{formatCurrency(r.refund, baseCurrency)}</span>
              </div>
            ))}
          </div>
        </div>
      )}

      {/* Intra-Group Settlements */}
      {hasIntraGroupDebts && (
        <div className="mt-4">
          <button
            onClick={() => setShowIntraGroup(!showIntraGroup)}
            className="flex items-center justify-between w-full py-2 px-3 rounded-lg bg-slate-100 dark:bg-slate-700 text-sm"
          >
            <span className="font-medium text-slate-600 dark:text-slate-300">
              👥 {t('settle.intraGroup')}
            </span>
            <span className="text-slate-400 text-xs">{showIntraGroup ? '▲' : '▼'}</span>
          </button>

          {showIntraGroup && (
            <div className="mt-2 space-y-3">
              <p className="text-xs text-slate-500 px-1">{t('settle.intraGroupHint')}</p>
              {intraGroupTransfers.map((group) => (
                <div key={group.groupName} className="bg-slate-50 dark:bg-slate-800/50 rounded-xl p-3 border border-slate-200 dark:border-slate-700">
                  <p className="text-xs font-medium text-slate-500 mb-2">{group.groupName}</p>
                  {group.transfers.map((tr, idx) => (
                    <div key={idx} className="flex items-center justify-between py-1.5">
                      <div className="flex items-center gap-2">
                        <Avatar name={tr.from.name} style={tr.from.avatar_style} seed={tr.from.avatar_seed} size={24} />
                        <span className="text-sm">→</span>
                        <Avatar name={tr.to.name} style={tr.to.avatar_style} seed={tr.to.avatar_seed} size={24} />
                        <span className="text-sm text-slate-600 dark:text-slate-400">
                          {tr.from.name} → {tr.to.name}
                        </span>
                      </div>
                      <span className="font-semibold text-sm">{formatCurrency(tr.amount, baseCurrency)}</span>
                    </div>
                  ))}
                </div>
              ))}
            </div>
          )}
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
                  <div>
                    <span>{from?.name} → {to?.name}</span>
                    <span className="ml-2 text-xs text-slate-400">({s.method === 'via_pool' ? t('settle.methodViaPool') : t('settle.methodDirect')})</span>
                  </div>
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
