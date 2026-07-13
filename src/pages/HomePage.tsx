import { useState, useEffect } from 'react'
import { useNavigate } from 'react-router-dom'
import { useTranslation } from 'react-i18next'
import { useQuery } from '@tanstack/react-query'
import { nanoid } from 'nanoid'
import { Calendar, Users, Hash } from 'lucide-react'
import { useAppStore } from '@/lib/store'
import { supabase, ensureAnonymousAuth } from '@/lib/supabase'
import { Avatar, AvatarPicker } from '@/components/common/Avatar'
import { LanguageToggle } from '@/components/common/LanguageToggle'

interface TripRef { id: string; name: string; invite_code: string; joined_at: string }

interface TripSummary { currency: string; shortCode: string; archived: boolean; memberCount: number }

function TripCard({ trip, summary, onClick }: { trip: TripRef; summary?: TripSummary; onClick: () => void }) {
  return (
    <button
      onClick={onClick}
      className="w-full text-left p-4 bg-white dark:bg-slate-800 rounded-xl shadow-sm border border-slate-200 dark:border-slate-700 hover:border-indigo-300 transition-colors"
    >
      <div className="flex items-center justify-between mb-2">
        <p className="font-semibold text-lg">{trip.name}</p>
        {summary?.archived && (
          <span className="text-[10px] bg-green-100 dark:bg-green-900 text-green-600 dark:text-green-400 px-1.5 py-0.5 rounded font-medium">Done</span>
        )}
      </div>
      <div className="flex items-center gap-3 text-xs text-slate-500">
        {summary?.shortCode && (
          <span className="flex items-center gap-1 bg-slate-100 dark:bg-slate-700 px-1.5 py-0.5 rounded font-mono">
            <Hash size={10} />{summary.shortCode}
          </span>
        )}
        {summary?.memberCount && (
          <span className="flex items-center gap-1">
            <Users size={10} />{summary.memberCount}
          </span>
        )}
        {summary?.currency && (
          <span className="bg-indigo-50 dark:bg-indigo-900/30 text-indigo-600 dark:text-indigo-400 px-1.5 py-0.5 rounded font-medium">
            {summary.currency}
          </span>
        )}
        <span className="flex items-center gap-1 ml-auto">
          <Calendar size={10} />{new Date(trip.joined_at).toLocaleDateString()}
        </span>
      </div>
    </button>
  )
}

function generateShortCode(): string {
  const chars = 'ABCDEFGHJKLMNPQRSTUVWXYZ23456789' // no 0/O/1/I confusion
  let code = ''
  for (let i = 0; i < 6; i++) {
    code += chars[Math.floor(Math.random() * chars.length)]
  }
  return code
}

export function HomePage() {
  const { t } = useTranslation()
  const { myTrips, addTrip } = useAppStore()
  const navigate = useNavigate()

  // Sync trips from server: fetch trips where user is a member (recovers after cache clear)
  useEffect(() => {
    async function syncTrips() {
      const { data: { session } } = await supabase.auth.getSession()
      if (!session?.user?.id) return
      const authUid = session.user.id

      // Find trips via direct auth_uid on member OR via member_sessions
      const { data: directMembers } = await supabase
        .from('members')
        .select('trip_id')
        .eq('auth_uid', authUid)
        .is('deleted_at', null)

      const { data: sessionMembers } = await supabase
        .from('member_sessions')
        .select('member_id, members(trip_id)')
        .eq('auth_uid', authUid)

      // Collect all trip IDs
      const tripIds = new Set<string>()
      if (directMembers) directMembers.forEach(m => tripIds.add(m.trip_id))
      if (sessionMembers) sessionMembers.forEach((s: any) => {
        if (s.members?.trip_id) tripIds.add(s.members.trip_id)
      })

      if (tripIds.size === 0) return

      // Fetch trip details
      const { data: trips } = await supabase
        .from('trips')
        .select('id, name, invite_code')
        .in('id', [...tripIds])

      if (!trips) return
      for (const trip of trips) {
        if (!myTrips.some(t => t.id === trip.id)) {
          addTrip({ id: trip.id, name: trip.name, invite_code: trip.invite_code, joined_at: new Date().toISOString() })
        }
      }
    }
    syncTrips()
  }, [])

  // Batch fetch all trip summaries in ONE query (avoids N+1)
  const tripIds = myTrips.map((t) => t.id)
  const { data: tripSummaries = {} } = useQuery({
    queryKey: ['trip-summaries', tripIds.join(',')],
    enabled: tripIds.length > 0,
    staleTime: 1000 * 60 * 10,
    queryFn: async () => {
      const { data: trips } = await supabase
        .from('trips')
        .select('id, base_currency, short_code, archived_at')
        .in('id', tripIds)
      const { data: members } = await supabase
        .from('members')
        .select('id, trip_id')
        .in('trip_id', tripIds)
        .is('deleted_at', null)

      const summaries: Record<string, TripSummary> = {}
      for (const t of trips || []) {
        summaries[t.id] = {
          currency: t.base_currency,
          shortCode: t.short_code || '',
          archived: !!t.archived_at,
          memberCount: (members || []).filter((m) => m.trip_id === t.id).length,
        }
      }
      return summaries
    },
  })

  const [showCreate, setShowCreate] = useState(false)
  const [showJoin, setShowJoin] = useState(false)
  const [name, setName] = useState('')
  const [currency, setCurrency] = useState('VND')
  const [memberName, setMemberName] = useState('')
  const [avatarStyle, setAvatarStyle] = useState('adventurer')
  const [avatarSeed, setAvatarSeed] = useState(0)
  const [joinCode, setJoinCode] = useState('')
  const [joinName, setJoinName] = useState('')
  const [joinToken, setJoinToken] = useState('')
  const [joinTrip, setJoinTrip] = useState<any>(null)
  const [joinMembers, setJoinMembers] = useState<any[]>([])
  const [joinSelectedMember, setJoinSelectedMember] = useState<string | null>(null)
  const [joinStep, setJoinStep] = useState<'code' | 'pick'>('code')
  const [loading, setLoading] = useState(false)
  const [error, setError] = useState('')

  const handleLookupCode = async () => {
    if (!joinCode.trim()) {
      setError('Enter a trip code')
      return
    }
    setLoading(true)
    setError('')

    try {
      await ensureAnonymousAuth()

      const { data: trip, error: tripError } = await supabase
        .from('trips')
        .select('id, name, invite_code, short_code')
        .ilike('short_code', joinCode.trim().toUpperCase())
        .is('archived_at', null)
        .single()

      if (tripError || !trip) {
        setError('Trip not found. Check the code and try again.')
        setLoading(false)
        return
      }

      // Fetch members
      const { data: members } = await supabase
        .from('members')
        .select('*')
        .eq('trip_id', trip.id)
        .is('deleted_at', null)

      setJoinTrip(trip)
      setJoinMembers(members || [])
      setJoinStep('pick')
    } catch (e) {
      setError(e instanceof Error ? e.message : 'Failed to find trip')
    } finally {
      setLoading(false)
    }
  }

  const handleJoinByCode = async () => {
    setLoading(true)
    setError('')

    try {
      const authUid = await ensureAnonymousAuth()
      const trip = joinTrip

      if (!trip) {
        setError('No trip selected')
        setLoading(false)
        return
      }

      // Check if already a member — only skip if not trying to claim someone else
      const { data: existing } = await supabase
        .from('members')
        .select('id')
        .eq('trip_id', trip.id)
        .eq('auth_uid', authUid)
        .is('deleted_at', null)
        .single()

      if (existing && !joinSelectedMember) {
        addTrip({ id: trip.id, name: trip.name, invite_code: trip.invite_code, joined_at: new Date().toISOString() })
        navigate(`/trip/${trip.id}`)
        return
      }

      if (joinSelectedMember) {
        // Claiming an existing member — verify token
        const target = joinMembers.find((m: any) => m.id === joinSelectedMember)
        if (!target) { setError('Member not found'); setLoading(false); return }

        if (!joinToken.trim()) {
          setError('Enter the member PIN to claim this account')
          setLoading(false)
          return
        }

        // Server-side PIN verification via Edge Function
        const response = await supabase.functions.invoke('claim-member', {
          body: { member_id: joinSelectedMember, pin: joinToken.trim(), trip_id: trip.id },
        })

        if (response.error) throw new Error(response.error.message)
        const result = response.data
        if (result.error) {
          setError(result.error === 'Invalid PIN' ? 'Incorrect PIN. Ask the trip admin for your PIN.' : result.error)
          setLoading(false)
          return
        }
      } else {
        // Create new member
        if (!joinName.trim()) {
          setError('Enter your name')
          setLoading(false)
          return
        }

        const colors = ['#6366f1', '#ec4899', '#f59e0b', '#10b981', '#3b82f6', '#8b5cf6', '#ef4444', '#14b8a6']
        const color = colors[Math.floor(Math.random() * colors.length)]

        const { error: memberError } = await supabase
          .from('members')
          .insert({ trip_id: trip.id, auth_uid: authUid, name: joinName.trim(), color, claimed: true })

        if (memberError) {
          if (memberError.message.includes('idx_members_unique_name_per_trip') || memberError.message.includes('duplicate')) {
            throw new Error('This name is already taken. Pick your name from the list above or choose a different name.')
          }
          throw new Error(memberError.message)
        }
      }

      addTrip({ id: trip.id, name: trip.name, invite_code: trip.invite_code, joined_at: new Date().toISOString() })
      navigate(`/trip/${trip.id}`)
    } catch (e) {
      setError(e instanceof Error ? e.message : 'Failed to join trip')
    } finally {
      setLoading(false)
    }
  }

  const handleCreate = async () => {
    if (!name.trim() || !memberName.trim()) {
      setError('Trip name and your name are required')
      return
    }

    setLoading(true)
    setError('')

    try {
      const authUid = await ensureAnonymousAuth()
      const inviteCode = nanoid(21)
      const shortCode = generateShortCode()

      // Create trip
      const { data: trip, error: tripError } = await supabase
        .from('trips')
        .insert({ name: name.trim(), base_currency: currency, invite_code: inviteCode, short_code: shortCode })
        .select()
        .single()

      if (tripError || !trip) throw new Error(tripError?.message || 'Failed to create trip')

      // Create first member (becomes admin via trigger)
      const { error: memberError } = await supabase
        .from('members')
        .insert({ trip_id: trip.id, auth_uid: authUid, name: memberName.trim(), avatar_style: avatarStyle, avatar_seed: avatarSeed })

      if (memberError) throw new Error(memberError.message)

      // Save to local store
      addTrip({ id: trip.id, name: trip.name, invite_code: inviteCode, joined_at: new Date().toISOString() })

      // Navigate to dashboard
      navigate(`/trip/${trip.id}`)
    } catch (e) {
      setError(e instanceof Error ? e.message : 'Something went wrong')
    } finally {
      setLoading(false)
    }
  }

  return (
    <div className="space-y-6">
      <div className="flex items-center justify-between">
        <div className="flex items-center gap-3">
          <h1 className="text-2xl font-bold">TripSplit</h1>
          <LanguageToggle />
        </div>
        <div className="flex gap-2">
          <button
            onClick={() => setShowJoin(true)}
            className="border border-indigo-600 text-indigo-600 px-3 py-2 rounded-lg text-sm font-medium hover:bg-indigo-50 dark:hover:bg-indigo-900/20 transition-colors"
          >
            {t('home.join')}
          </button>
          <button
            onClick={() => setShowCreate(true)}
            className="bg-indigo-600 text-white px-3 py-2 rounded-lg text-sm font-medium hover:bg-indigo-700 transition-colors"
          >
            {t('home.new')}
          </button>
        </div>
      </div>

      {/* Play Games (outside trips) */}
      <button
        onClick={() => navigate('/play/new')}
        className="w-full flex items-center gap-3 p-4 bg-white dark:bg-slate-800 rounded-xl shadow-sm border border-slate-200 dark:border-slate-700 hover:border-indigo-300 transition-colors"
      >
        <span className="text-2xl">🎮</span>
        <div className="text-left">
          <p className="font-semibold text-sm">{t('home.playGames')}</p>
          <p className="text-xs text-slate-500">{t('home.playGamesHint')}</p>
        </div>
      </button>

      {/* Trip List */}
      {myTrips.length === 0 ? (
        <div className="text-center py-12 text-slate-500">
          <p className="text-4xl mb-4">✈️</p>
          <p className="font-medium">{t('app.noTrips')}</p>
          <p className="text-sm">{t('app.noTripsHint')}</p>
        </div>
      ) : (
        <div className="space-y-3">
          {myTrips.map((trip) => (
            <TripCard key={trip.id} trip={trip} summary={tripSummaries[trip.id]} onClick={() => navigate(`/trip/${trip.id}`)} />
          ))}
        </div>
      )}

      {/* Create Modal */}
      {showCreate && (
        <div className="fixed inset-0 bg-black/30 backdrop-blur-sm z-50 flex items-end justify-center">
          <div className="absolute inset-0" onClick={() => setShowCreate(false)} />
          <div className="relative bg-white/80 dark:bg-slate-800/80 backdrop-blur-xl rounded-t-2xl p-6 w-full max-w-lg space-y-4 max-h-[85vh] overflow-y-auto border-t border-white/30 dark:border-slate-700/50 shadow-[0_-4px_30px_rgba(0,0,0,0.1)] animate-[slideUp_0.2s_ease-out]" style={{ paddingBottom: 'calc(env(safe-area-inset-bottom, 16px) + 16px)' }}>
            <h2 className="text-xl font-bold">{t('trip.create')}</h2>

            <div>
              <label className="text-sm font-medium text-slate-600 dark:text-slate-300">{t('trip.name')}</label>
              <input
                type="text"
                value={name}
                onChange={(e) => setName(e.target.value)}
                placeholder="Bali 2026"
                className="mt-1 w-full px-3 py-2 rounded-lg border border-slate-300 dark:border-slate-600 bg-transparent focus:ring-2 focus:ring-indigo-500 outline-none"
              />
            </div>

            <div>
              <label className="text-sm font-medium text-slate-600 dark:text-slate-300">{t('trip.yourName')}</label>
              <input
                type="text"
                value={memberName}
                onChange={(e) => setMemberName(e.target.value)}
                placeholder="Nhat"
                className="mt-1 w-full px-3 py-2 rounded-lg border border-slate-300 dark:border-slate-600 bg-transparent focus:ring-2 focus:ring-indigo-500 outline-none"
              />
            </div>

            {/* Avatar picker */}
            {memberName.trim() && (
              <div>
                <label className="text-sm font-medium text-slate-600 dark:text-slate-300">{t('members.chooseAvatar')}</label>
                <div className="mt-2">
                  <AvatarPicker name={memberName} selected={avatarStyle} seed={avatarSeed} onSelect={(style, seed) => { setAvatarStyle(style); setAvatarSeed(seed) }} />
                </div>
              </div>
            )}

            <div>
              <label className="text-sm font-medium text-slate-600 dark:text-slate-300">{t('trip.baseCurrency')}</label>
              <select
                value={currency}
                onChange={(e) => setCurrency(e.target.value)}
                className="mt-1 w-full px-3 py-2 rounded-lg border border-slate-300 dark:border-slate-600 bg-transparent focus:ring-2 focus:ring-indigo-500 outline-none"
              >
                <option value="VND">VND - Vietnamese Dong</option>
                <option value="USD">USD - US Dollar</option>
                <option value="EUR">EUR - Euro</option>
                <option value="JPY">JPY - Japanese Yen</option>
                <option value="THB">THB - Thai Baht</option>
                <option value="SGD">SGD - Singapore Dollar</option>
                <option value="KRW">KRW - Korean Won</option>
              </select>
            </div>

            {error && <p className="text-red-500 text-sm">{error}</p>}

            <div className="flex gap-3">
              <button
                onClick={() => setShowCreate(false)}
                className="flex-1 px-4 py-2 rounded-lg border border-slate-300 dark:border-slate-600 font-medium"
              >
                {t('common.cancel')}
              </button>
              <button
                onClick={handleCreate}
                disabled={loading}
                className="flex-1 px-4 py-2 rounded-lg bg-indigo-600 text-white font-medium hover:bg-indigo-700 disabled:opacity-50 transition-colors"
              >
                {loading ? t('home.creating') : t('home.create')}
              </button>
            </div>
          </div>
        </div>
      )}

      {/* Join by Code Modal */}
      {showJoin && (
        <div className="fixed inset-0 bg-black/30 backdrop-blur-sm z-50 flex items-end justify-center">
          <div className="absolute inset-0" onClick={() => setShowJoin(false)} />
          <div className="relative bg-white/80 dark:bg-slate-800/80 backdrop-blur-xl rounded-t-2xl p-6 w-full max-w-lg space-y-4 max-h-[85vh] overflow-y-auto border-t border-white/30 dark:border-slate-700/50 shadow-[0_-4px_30px_rgba(0,0,0,0.1)] animate-[slideUp_0.2s_ease-out]" style={{ paddingBottom: 'calc(env(safe-area-inset-bottom, 16px) + 16px)' }}>
            <h2 className="text-xl font-bold">{t('join.title')}{joinTrip ? `: ${joinTrip.name}` : ''}</h2>

            {/* Step 1: Enter code */}
            {joinStep === 'code' && (
              <>
                <div>
                  <label className="text-sm font-medium text-slate-600 dark:text-slate-300">{t('join.tripCode')}</label>
                  <input
                    type="text"
                    value={joinCode}
                    onChange={(e) => setJoinCode(e.target.value.toUpperCase())}
                    placeholder="e.g. ABC123"
                    maxLength={6}
                    className="mt-1 w-full px-3 py-3 rounded-lg border border-slate-300 dark:border-slate-600 bg-transparent focus:ring-2 focus:ring-indigo-500 outline-none text-center text-2xl font-mono tracking-widest uppercase"
                    autoFocus
                  />
                </div>

                {error && <p className="text-red-500 text-sm">{error}</p>}

                <div className="flex gap-3">
                  <button
                    onClick={() => { setShowJoin(false); setError(''); setJoinStep('code'); setJoinTrip(null); setJoinMembers([]); setJoinSelectedMember(null) }}
                    className="flex-1 px-4 py-2 rounded-lg border border-slate-300 dark:border-slate-600 font-medium"
                  >
                    {t('common.cancel')}
                  </button>
                  <button
                    onClick={handleLookupCode}
                    disabled={loading}
                    className="flex-1 px-4 py-2 rounded-lg bg-indigo-600 text-white font-medium hover:bg-indigo-700 disabled:opacity-50 transition-colors"
                  >
                    {loading ? '...' : t('join.next')}
                  </button>
                </div>
              </>
            )}

            {/* Step 2: Pick member or create new */}
            {joinStep === 'pick' && (
              <>
                {/* Existing members to pick */}
                {joinMembers.length > 0 && (
                  <div>
                    <p className="text-sm font-medium text-slate-600 dark:text-slate-300 mb-2">{t('join.iAm')}</p>
                    <div className="space-y-2 max-h-48 overflow-y-auto">
                      {joinMembers.map((m: any) => (
                        <button
                          key={m.id}
                          onClick={() => setJoinSelectedMember(joinSelectedMember === m.id ? null : m.id)}
                          className={`w-full flex items-center gap-3 p-3 rounded-lg border transition-colors ${
                            joinSelectedMember === m.id
                              ? 'border-indigo-500 bg-indigo-50 dark:bg-indigo-900/30'
                              : 'border-slate-200 dark:border-slate-700'
                          }`}
                        >
                          <Avatar name={m.name} style={m.avatar_style} seed={m.avatar_seed} size={32} className="shrink-0" />
                          <span className="font-medium text-sm">{m.name}</span>
                          {!m.claimed && <span className="text-[10px] bg-amber-100 text-amber-600 px-1 py-0.5 rounded ml-auto">{t('join.unclaimed')}</span>}
                        </button>
                      ))}
                    </div>
                  </div>
                )}

                {/* Token input when claiming */}
                {joinSelectedMember && (
                  <div>
                    <label className="text-sm font-medium text-slate-600 dark:text-slate-300">{t('join.memberPin')}</label>
                    <input
                      type="text"
                      value={joinToken}
                      onChange={(e) => setJoinToken(e.target.value.toUpperCase())}
                      placeholder={t('join.pinPlaceholder')}
                      maxLength={4}
                      className="mt-1 w-full px-3 py-2 rounded-lg border border-slate-300 dark:border-slate-600 bg-transparent focus:ring-2 focus:ring-indigo-500 outline-none text-center text-lg font-mono tracking-widest uppercase"
                    />
                    <p className="text-[10px] text-slate-400 mt-1">{t('join.pinHint')}</p>
                  </div>
                )}

                {/* New name input (when not claiming) */}
                {!joinSelectedMember && (
                  <div>
                    <label className="text-sm font-medium text-slate-600 dark:text-slate-300">{t('join.newName')}</label>
                    <input
                      type="text"
                      value={joinName}
                      onChange={(e) => setJoinName(e.target.value)}
                      placeholder={t('join.namePlaceholderShort')}
                      className="mt-1 w-full px-3 py-2 rounded-lg border border-slate-300 dark:border-slate-600 bg-transparent focus:ring-2 focus:ring-indigo-500 outline-none"
                    />
                  </div>
                )}

                {error && <p className="text-red-500 text-sm">{error}</p>}

                <div className="flex gap-3">
                  <button
                    onClick={() => { setJoinStep('code'); setError(''); setJoinSelectedMember(null); setJoinToken('') }}
                    className="flex-1 px-4 py-2 rounded-lg border border-slate-300 dark:border-slate-600 font-medium"
                  >
                    {t('join.back')}
                  </button>
                  <button
                    onClick={handleJoinByCode}
                    disabled={loading}
                    className="flex-1 px-4 py-2 rounded-lg bg-indigo-600 text-white font-medium hover:bg-indigo-700 disabled:opacity-50 transition-colors"
                  >
                    {loading ? '...' : t('join.join')}
                  </button>
                </div>
              </>
            )}
          </div>
        </div>
      )}
    </div>
  )
}
