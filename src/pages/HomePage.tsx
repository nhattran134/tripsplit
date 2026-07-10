import { useState } from 'react'
import { useNavigate } from 'react-router-dom'
import { useTranslation } from 'react-i18next'
import { nanoid } from 'nanoid'
import { useAppStore } from '@/lib/store'
import { supabase, ensureAnonymousAuth } from '@/lib/supabase'
import { Avatar } from '@/components/common/Avatar'

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
  const [showCreate, setShowCreate] = useState(false)
  const [showJoin, setShowJoin] = useState(false)
  const [name, setName] = useState('')
  const [currency, setCurrency] = useState('VND')
  const [memberName, setMemberName] = useState('')
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
        .insert({ trip_id: trip.id, auth_uid: authUid, name: memberName.trim() })

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
        <h1 className="text-2xl font-bold">TripSplit</h1>
        <div className="flex gap-2">
          <button
            onClick={() => setShowJoin(true)}
            className="border border-indigo-600 text-indigo-600 px-3 py-2 rounded-lg text-sm font-medium hover:bg-indigo-50 dark:hover:bg-indigo-900/20 transition-colors"
          >
            Join
          </button>
          <button
            onClick={() => setShowCreate(true)}
            className="bg-indigo-600 text-white px-3 py-2 rounded-lg text-sm font-medium hover:bg-indigo-700 transition-colors"
          >
            + New
          </button>
        </div>
      </div>

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
            <button
              key={trip.id}
              onClick={() => navigate(`/trip/${trip.id}`)}
              className="w-full text-left p-4 bg-white dark:bg-slate-800 rounded-xl shadow-sm border border-slate-200 dark:border-slate-700 hover:border-indigo-300 transition-colors"
            >
              <p className="font-semibold">{trip.name}</p>
              <p className="text-sm text-slate-500">Joined {new Date(trip.joined_at).toLocaleDateString()}</p>
            </button>
          ))}
        </div>
      )}

      {/* Create Modal */}
      {showCreate && (
        <div className="fixed inset-0 bg-black/50 flex items-end sm:items-center justify-center z-50 p-4">
          <div className="bg-white dark:bg-slate-800 rounded-2xl p-6 w-full max-w-md space-y-4">
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
                Cancel
              </button>
              <button
                onClick={handleCreate}
                disabled={loading}
                className="flex-1 px-4 py-2 rounded-lg bg-indigo-600 text-white font-medium hover:bg-indigo-700 disabled:opacity-50 transition-colors"
              >
                {loading ? 'Creating...' : 'Create'}
              </button>
            </div>
          </div>
        </div>
      )}

      {/* Join by Code Modal */}
      {showJoin && (
        <div className="fixed inset-0 bg-black/50 flex items-end sm:items-center justify-center z-50 p-4">
          <div className="bg-white dark:bg-slate-800 rounded-2xl p-6 w-full max-w-md space-y-4 max-h-[85vh] overflow-y-auto">
            <h2 className="text-xl font-bold">{t('join.title')}{joinTrip ? `: ${joinTrip.name}` : ''}</h2>

            {/* Step 1: Enter code */}
            {joinStep === 'code' && (
              <>
                <div>
                  <label className="text-sm font-medium text-slate-600 dark:text-slate-300">Trip Code</label>
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
                    Cancel
                  </button>
                  <button
                    onClick={handleLookupCode}
                    disabled={loading}
                    className="flex-1 px-4 py-2 rounded-lg bg-indigo-600 text-white font-medium hover:bg-indigo-700 disabled:opacity-50 transition-colors"
                  >
                    {loading ? '...' : 'Next'}
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
                    <p className="text-sm font-medium text-slate-600 dark:text-slate-300 mb-2">I am...</p>
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
                          <Avatar name={m.name} size={32} className="shrink-0" />
                          <span className="font-medium text-sm">{m.name}</span>
                          {!m.claimed && <span className="text-[10px] bg-amber-100 text-amber-600 px-1 py-0.5 rounded ml-auto">Unclaimed</span>}
                        </button>
                      ))}
                    </div>
                  </div>
                )}

                {/* Token input when claiming */}
                {joinSelectedMember && (
                  <div>
                    <label className="text-sm font-medium text-slate-600 dark:text-slate-300">Member PIN</label>
                    <input
                      type="text"
                      value={joinToken}
                      onChange={(e) => setJoinToken(e.target.value.toUpperCase())}
                      placeholder="4-char PIN"
                      maxLength={4}
                      className="mt-1 w-full px-3 py-2 rounded-lg border border-slate-300 dark:border-slate-600 bg-transparent focus:ring-2 focus:ring-indigo-500 outline-none text-center text-lg font-mono tracking-widest uppercase"
                    />
                    <p className="text-[10px] text-slate-400 mt-1">Ask the trip admin for your PIN</p>
                  </div>
                )}

                {/* New name input (when not claiming) */}
                {!joinSelectedMember && (
                  <div>
                    <label className="text-sm font-medium text-slate-600 dark:text-slate-300">Or enter a new name</label>
                    <input
                      type="text"
                      value={joinName}
                      onChange={(e) => setJoinName(e.target.value)}
                      placeholder="Your name"
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
                    Back
                  </button>
                  <button
                    onClick={handleJoinByCode}
                    disabled={loading}
                    className="flex-1 px-4 py-2 rounded-lg bg-indigo-600 text-white font-medium hover:bg-indigo-700 disabled:opacity-50 transition-colors"
                  >
                    {loading ? '...' : 'Join'}
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
