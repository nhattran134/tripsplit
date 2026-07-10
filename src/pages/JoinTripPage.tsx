import { useState, useEffect } from 'react'
import { useParams, useNavigate, useSearchParams } from 'react-router-dom'
import { useTranslation } from 'react-i18next'
import { supabase, ensureAnonymousAuth } from '@/lib/supabase'
import { useAppStore } from '@/lib/store'
import type { Member } from '@/types'

export function JoinTripPage() {
  const { inviteCode } = useParams<{ inviteCode: string }>()
  const [searchParams] = useSearchParams()
  const claimMemberId = searchParams.get('claim')
  const navigate = useNavigate()
  const { addTrip } = useAppStore()
  const { t } = useTranslation()

  const [name, setName] = useState('')
  const [pin, setPin] = useState('')
  const [loading, setLoading] = useState(false)
  const [error, setError] = useState('')
  const [needsPin, setNeedsPin] = useState(false)
  const [trip, setTrip] = useState<any>(null)
  const [unclaimedMembers, setUnclaimedMembers] = useState<Member[]>([])
  const [selectedMember, setSelectedMember] = useState<string | null>(claimMemberId)
  const [mode, setMode] = useState<'pick' | 'new'>('pick')

  // Load trip and unclaimed members
  useEffect(() => {
    const load = async () => {
      await ensureAnonymousAuth()

      const { data: tripData } = await supabase
        .from('trips')
        .select('id, name, invite_code, pin_hash, short_code')
        .eq('invite_code', inviteCode)
        .is('archived_at', null)
        .single()

      if (tripData) {
        setTrip(tripData)

        // If claiming a specific member via link, skip the pick UI
        if (claimMemberId) {
          setMode('new') // will auto-claim
          return
        }

        // Fetch unclaimed members
        const { data: members } = await supabase
          .from('members')
          .select('*')
          .eq('trip_id', tripData.id)
          .eq('claimed', false)
          .is('deleted_at', null)

        if (members && members.length > 0) {
          setUnclaimedMembers(members as Member[])
          setMode('pick')
        } else {
          setMode('new')
        }
      }
    }
    load()
  }, [inviteCode, claimMemberId])

  const handleJoin = async () => {
    setLoading(true)
    setError('')

    try {
      const authUid = await ensureAnonymousAuth()

      if (!trip) {
        setError(t('join.notFound'))
        setLoading(false)
        return
      }

      // Check PIN if required
      if (trip.pin_hash && !pin) {
        setNeedsPin(true)
        setError('This trip requires a PIN')
        setLoading(false)
        return
      }

      // Check if already a member
      const { data: existing } = await supabase
        .from('members')
        .select('id')
        .eq('trip_id', trip.id)
        .eq('auth_uid', authUid)
        .is('deleted_at', null)
        .single()

      if (existing) {
        // Already a member, just navigate
        addTrip({ id: trip.id, name: trip.name, invite_code: trip.invite_code, joined_at: new Date().toISOString() })
        navigate(`/trip/${trip.id}`)
        return
      }

      const memberToClaim = claimMemberId || selectedMember

      if (memberToClaim && mode === 'pick') {
        // Claim an existing unclaimed member
        const { error: claimError } = await supabase
          .from('members')
          .update({ auth_uid: authUid, claimed: true })
          .eq('id', memberToClaim)
          .eq('claimed', false)

        if (claimError) throw new Error(claimError.message)
      } else if (claimMemberId) {
        // Direct claim link
        const { error: claimError } = await supabase
          .from('members')
          .update({ auth_uid: authUid, claimed: true })
          .eq('id', claimMemberId)
          .eq('claimed', false)

        if (claimError) throw new Error(claimError.message)
      } else {
        // Create a new member
        if (!name.trim()) {
          setError('Please enter your name')
          setLoading(false)
          return
        }

        const colors = ['#6366f1', '#ec4899', '#f59e0b', '#10b981', '#3b82f6', '#8b5cf6', '#ef4444', '#14b8a6']
        const color = colors[Math.floor(Math.random() * colors.length)]

        const { error: memberError } = await supabase
          .from('members')
          .insert({ trip_id: trip.id, auth_uid: authUid, name: name.trim(), color, claimed: true })

        if (memberError) {
          if (memberError.message.includes('idx_members_unique_name_per_trip') || memberError.message.includes('duplicate')) {
            throw new Error('This name is already taken in the trip. Please choose a different name.')
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

  if (!trip) {
    return (
      <div className="min-h-screen bg-slate-50 dark:bg-slate-900 flex items-center justify-center p-4">
        <p className="text-slate-500">{t('common.loading')}</p>
      </div>
    )
  }

  return (
    <div className="min-h-screen bg-slate-50 dark:bg-slate-900 flex items-center justify-center p-4">
      <div className="bg-white dark:bg-slate-800 rounded-2xl p-6 w-full max-w-sm space-y-4 shadow-lg">
        <div className="text-center">
          <p className="text-4xl mb-2">🎒</p>
          <h1 className="text-xl font-bold text-slate-900 dark:text-white">{t('join.title')} {trip.name}</h1>
          {claimMemberId ? (
            <p className="text-sm text-slate-500">{t('join.claimSpot')}</p>
          ) : (
            <p className="text-sm text-slate-500">{t('join.pickOrCreate')}</p>
          )}
        </div>

        {/* Unclaimed members to pick from */}
        {!claimMemberId && unclaimedMembers.length > 0 && (
          <div>
            <p className="text-sm font-medium text-slate-600 dark:text-slate-300 mb-2">{t('join.iAm')}</p>
            <div className="space-y-2">
              {unclaimedMembers.map((m) => (
                <button
                  key={m.id}
                  onClick={() => { setSelectedMember(m.id); setMode('pick') }}
                  className={`w-full flex items-center gap-3 p-3 rounded-lg border transition-colors ${
                    selectedMember === m.id
                      ? 'border-indigo-500 bg-indigo-50 dark:bg-indigo-900/30'
                      : 'border-slate-200 dark:border-slate-700'
                  }`}
                >
                  <div
                    className="w-8 h-8 rounded-full flex items-center justify-center text-white text-sm font-bold"
                    style={{ backgroundColor: m.color }}
                  >
                    {m.name.charAt(0).toUpperCase()}
                  </div>
                  <span className="font-medium text-sm">{m.name}</span>
                </button>
              ))}

              {/* Option to create new */}
              <button
                onClick={() => { setSelectedMember(null); setMode('new') }}
                className={`w-full flex items-center gap-3 p-3 rounded-lg border transition-colors ${
                  mode === 'new' && !selectedMember
                    ? 'border-indigo-500 bg-indigo-50 dark:bg-indigo-900/30'
                    : 'border-slate-200 dark:border-slate-700'
                }`}
              >
                <div className="w-8 h-8 rounded-full flex items-center justify-center bg-slate-200 dark:bg-slate-600 text-slate-600 dark:text-slate-300 text-sm font-bold">
                  +
                </div>
                <span className="font-medium text-sm text-slate-600 dark:text-slate-400">{t('join.someoneElse')}</span>
              </button>
            </div>
          </div>
        )}

        {/* Name input for new member */}
        {(mode === 'new' && !claimMemberId && !selectedMember) && (
          <div>
            <label className="text-sm font-medium text-slate-600 dark:text-slate-300">{t('trip.yourName')}</label>
            <input
              type="text"
              value={name}
              onChange={(e) => setName(e.target.value)}
              placeholder={t('join.namePlaceholder')}
              className="mt-1 w-full px-3 py-2 rounded-lg border border-slate-300 dark:border-slate-600 bg-transparent focus:ring-2 focus:ring-indigo-500 outline-none"
              autoFocus
            />
          </div>
        )}

        {/* Name input when no unclaimed members exist */}
        {unclaimedMembers.length === 0 && !claimMemberId && (
          <div>
            <label className="text-sm font-medium text-slate-600 dark:text-slate-300">{t('trip.yourName')}</label>
            <input
              type="text"
              value={name}
              onChange={(e) => setName(e.target.value)}
              placeholder={t('join.namePlaceholder')}
              className="mt-1 w-full px-3 py-2 rounded-lg border border-slate-300 dark:border-slate-600 bg-transparent focus:ring-2 focus:ring-indigo-500 outline-none"
              autoFocus
            />
          </div>
        )}

        {needsPin && (
          <div>
            <label className="text-sm font-medium text-slate-600 dark:text-slate-300">{t('join.pin')}</label>
            <input
              type="text"
              value={pin}
              onChange={(e) => setPin(e.target.value)}
              placeholder="Enter PIN"
              className="mt-1 w-full px-3 py-2 rounded-lg border border-slate-300 dark:border-slate-600 bg-transparent focus:ring-2 focus:ring-indigo-500 outline-none"
            />
          </div>
        )}

        {error && <p className="text-red-500 text-sm text-center">{error}</p>}

        <button
          onClick={handleJoin}
          disabled={loading}
          className="w-full px-4 py-3 rounded-lg bg-indigo-600 text-white font-medium hover:bg-indigo-700 disabled:opacity-50 transition-colors"
        >
          {loading ? t('join.joining') : t('join.joinButton')}
        </button>
      </div>
    </div>
  )
}
