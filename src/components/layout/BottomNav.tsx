import { useState, useRef } from 'react'
import { useNavigate, useLocation, useParams } from 'react-router-dom'
import { useTranslation } from 'react-i18next'
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query'
import { LayoutDashboard, Plus, Wallet, Users, Handshake, X } from 'lucide-react'
import { supabase } from '@/lib/supabase'
import { generateId } from '@/lib/utils'
import { MoneyInput } from '@/components/common/MoneyInput'
import { getCurrencyDecimals, formatCurrency } from '@/lib/currency'
import type { Member } from '@/types'

const QUICK_CATEGORIES = [
  { value: 'food', emoji: '🍜' },
  { value: 'transport', emoji: '🚗' },
  { value: 'accommodation', emoji: '🏨' },
  { value: 'shopping', emoji: '🛒' },
  { value: 'other', emoji: '📦' },
]

export function BottomNav() {
  const { t } = useTranslation()
  const navigate = useNavigate()
  const location = useLocation()
  const { tripId } = useParams()
  const queryClient = useQueryClient()

  const [showQuick, setShowQuick] = useState(false)
  const [quickAmount, setQuickAmount] = useState('')
  const [quickCategory, setQuickCategory] = useState('food')
  const [quickDesc, setQuickDesc] = useState('')
  const longPressTimer = useRef<ReturnType<typeof setTimeout> | null>(null)

  const { data: trip } = useQuery({
    queryKey: ['trip', tripId],
    queryFn: async () => {
      const { data } = await supabase.from('trips').select('*').eq('id', tripId).single()
      return data
    },
    enabled: !!tripId,
  })

  const { data: members = [] } = useQuery({
    queryKey: ['members', tripId],
    queryFn: async () => {
      const { data } = await supabase.from('members').select('*').eq('trip_id', tripId).is('deleted_at', null)
      return (data || []) as Member[]
    },
    enabled: !!tripId,
  })

  const quickMutation = useMutation({
    mutationFn: async () => {
      const amount = parseFloat(quickAmount)
      if (!amount || amount <= 0) throw new Error('Enter amount')
      
      const { data: { session } } = await supabase.auth.getSession()
      const authUid = session?.user?.id
      const myMember = members.find(m => m.auth_uid === authUid)
      const payer = myMember?.id || members[0]?.id
      if (!payer) throw new Error('No members')

      const baseCurrency = trip?.base_currency || 'VND'
      const decimals = getCurrencyDecimals(baseCurrency)
      const memberIds = members.map(m => m.id)
      const perPerson = Math.floor(amount * Math.pow(10, decimals) / memberIds.length) / Math.pow(10, decimals)
      const remainder = Math.round((amount - perPerson * memberIds.length) * Math.pow(10, decimals)) / Math.pow(10, decimals)

      const expenseId = generateId()
      await supabase.from('expenses').insert({
        id: expenseId,
        trip_id: tripId,
        member_id: payer,
        amount,
        currency: baseCurrency,
        rate_to_base: 1,
        category: quickCategory,
        description: quickDesc.trim(),
        date: new Date().toISOString().split('T')[0],
        split_type: 'equal',
        paid_from: 'pocket',
      })

      const splits = memberIds.map((id, i) => ({
        id: generateId(),
        expense_id: expenseId,
        member_id: id,
        share_amount: i === 0 ? perPerson + remainder : perPerson,
      }))
      await supabase.from('expense_splits').insert(splits)
    },
    onSuccess: () => {
      queryClient.removeQueries({ queryKey: ['expenses', tripId] })
      queryClient.removeQueries({ queryKey: ['expense_splits', tripId] })
      queryClient.removeQueries({ queryKey: ['expenses-count', tripId] })
      queryClient.removeQueries({ queryKey: ['recent-expenses', tripId] })
      setShowQuick(false)
      setQuickAmount('')
      setQuickDesc('')
    },
  })

  const basePath = `/trip/${tripId}`
  const isActive = (path: string) => location.pathname === `${basePath}${path}`

  const navBtn = (path: string, labelKey: string, Icon: any) => (
    <button
      key={path}
      onClick={() => navigate(`${basePath}${path}`, { replace: true })}
      className={`flex flex-col items-center gap-0.5 px-2 py-1 rounded-lg transition-colors active:scale-95 ${
        isActive(path)
          ? 'text-indigo-600 dark:text-indigo-400'
          : 'text-slate-500 dark:text-slate-400'
      }`}
    >
      <Icon size={20} strokeWidth={isActive(path) ? 2.5 : 2} />
      <span className="text-[10px] font-medium">{t(labelKey)}</span>
    </button>
  )

  const handlePointerDown = () => {
    longPressTimer.current = setTimeout(() => {
      setShowQuick(true)
    }, 500)
  }
  const handlePointerUp = () => {
    if (longPressTimer.current) {
      clearTimeout(longPressTimer.current)
      longPressTimer.current = null
    }
  }
  const handleTap = () => {
    if (!showQuick) navigate(`${basePath}/expense/new`, { replace: true })
  }

  return (
    <>
      {/* Quick Expense Modal */}
      {showQuick && (
        <div className="fixed inset-0 z-[9998] flex items-end justify-center">
          <div className="absolute inset-0 bg-black/30 backdrop-blur-sm" onClick={() => setShowQuick(false)} />
          <div className="relative w-full max-w-lg bg-white/80 dark:bg-slate-800/80 backdrop-blur-xl rounded-t-2xl p-5 space-y-4 bottom-sheet animate-[slideUp_0.2s_ease-out] border-t border-white/30 dark:border-slate-700/50 shadow-[0_-4px_30px_rgba(0,0,0,0.1)]" style={{ paddingBottom: 'calc(env(safe-area-inset-bottom, 16px) + 16px)' }}>
            <div className="flex items-center justify-between">
              <h2 className="font-bold text-lg">{t('expense.quickAdd')}</h2>
              <button onClick={() => setShowQuick(false)} className="p-1 text-slate-400"><X size={20} /></button>
            </div>

            <MoneyInput
              value={quickAmount}
              onChange={setQuickAmount}
              currency={trip?.base_currency || 'VND'}
              placeholder="0"
              autoFocus
            />

            {/* Suggested amounts */}
            <div className="flex flex-wrap gap-2">
              {(() => {
                const currency = trip?.base_currency || 'VND'
                const suggestions = currency === 'VND'
                  ? [20000, 50000, 100000, 200000, 500000, 1000000]
                  : currency === 'JPY'
                  ? [500, 1000, 2000, 5000, 10000, 20000]
                  : [5, 10, 20, 50, 100, 200] // USD, EUR, etc.
                return suggestions.map(amt => (
                  <button
                    key={amt}
                    onClick={() => setQuickAmount(amt.toString())}
                    className={`px-3 py-1.5 rounded-full text-xs font-medium border transition-colors ${
                      quickAmount === amt.toString()
                        ? 'border-indigo-500 bg-indigo-50 dark:bg-indigo-900/30 text-indigo-700 dark:text-indigo-300'
                        : 'border-slate-200 dark:border-slate-700 text-slate-600 dark:text-slate-400 active:bg-slate-100'
                    }`}
                  >
                    {amt.toLocaleString()}
                  </button>
                ))
              })()}
            </div>

            <div className="flex gap-2">
              {QUICK_CATEGORIES.map(c => (
                <button
                  key={c.value}
                  onClick={() => setQuickCategory(c.value)}
                  className={`flex-1 py-2 rounded-lg text-lg ${quickCategory === c.value ? 'bg-indigo-100 dark:bg-indigo-900/40 ring-2 ring-indigo-400' : 'bg-slate-100 dark:bg-slate-700'}`}
                >
                  {c.emoji}
                </button>
              ))}
            </div>

            <input
              type="text"
              value={quickDesc}
              onChange={e => setQuickDesc(e.target.value)}
              placeholder={t('expense.description')}
              className="w-full px-3 py-2 rounded-lg border border-slate-300 dark:border-slate-600 bg-transparent text-sm"
            />

            <button
              onClick={() => quickMutation.mutate()}
              disabled={quickMutation.isPending || !quickAmount}
              className="w-full py-3 rounded-xl bg-indigo-600 text-white font-semibold disabled:opacity-50 active:scale-[0.98] transition-transform"
            >
              {quickMutation.isPending ? '...' : `${t('expense.add')} ${quickAmount ? formatCurrency(Number(quickAmount), trip?.base_currency || 'VND') : ''}`}
            </button>
          </div>
        </div>
      )}

      <nav className="fixed bottom-0 left-0 right-0 bg-white/70 dark:bg-slate-900/70 backdrop-blur-xl border-t border-white/20 dark:border-slate-700/50 shadow-[0_-2px_20px_rgba(0,0,0,0.05)]"
        style={{ paddingBottom: 'env(safe-area-inset-bottom, 0px)' }}
      >
        <div className="max-w-lg mx-auto flex justify-around items-end py-2">
          {navBtn('', 'nav.dashboard', LayoutDashboard)}
          {navBtn('/deposit/new', 'nav.deposit', Wallet)}

          {/* Hero center button - Tap: full form, Hold: quick add */}
          <button
            onClick={handleTap}
            onPointerDown={handlePointerDown}
            onPointerUp={handlePointerUp}
            onPointerLeave={handlePointerUp}
            className="flex flex-col items-center gap-0.5 -mt-5"
          >
            <div className={`w-12 h-12 rounded-full flex items-center justify-center shadow-lg transition-transform active:scale-90 ${
              isActive('/expense/new')
                ? 'bg-indigo-600 ring-2 ring-indigo-300'
                : 'bg-indigo-500 hover:bg-indigo-600'
            }`}>
              <Plus size={24} className="text-white" strokeWidth={2.5} />
            </div>
            <span className="text-[10px] font-medium text-indigo-600 dark:text-indigo-400">{t('nav.expense')}</span>
          </button>

          {navBtn('/members', 'nav.members', Users)}
          {navBtn('/settle', 'nav.settle', Handshake)}
        </div>
      </nav>
    </>
  )
}
