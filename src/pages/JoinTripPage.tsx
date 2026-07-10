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
  const { t } = useTranslation()
  const navigate = useNavigate()
  const { addTrip } = useAppStore()

  const [name, setName] = useState('')
  const [token, setToken] = useState('')
  const [pin, setPin] = useState('')
  const [loading, setLoading] = useState(false)
  const [error, setError] = useState('')
  const [needsPin, setNeedsPin] = useState(false)
  const [trip, setTrip] = useState<any>(null)
  const [allMembers, setAllMembers] = useState<Member[]>([])
  const [unclaimedMembers, setUnclaimedMembers] = useState<Member[]>([])
  const [selectedMember, setSelectedMember] = useState<string | null>(claimMemberId)
  const [mode, setMode] = useState<'pick' | 'new'>('pick')
  const [showTokenInput, setShowTokenInput] = useState(!!claimMemberId)
  const [duplicateDetected, setDuplicateDetected] = useState(false)

  // Load trip and members
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

        const { data: members } = await supabase
          .from('members')
          .select('*')
          .eq('trip_id', tripData.id)
          .is('deleted_at', null)

        if (members) {
          setAllMembers(members as Member[])
          const unclaimed = members.filter((m: any) => !m.claimed)
          setUnclaimedMembers(unclaimed as Member[])

          if (claimMemberId) {
            setMode('pick')
            setShowTokenInput(true)
          } else if (unclaimed.length > 0) {
            setMode('pick')
          } else {
            setMode('new')
          }
        }
      }
    }
    load()
  }, [inviteCode, claimMemberId])

  const handleJoin = async () => {
    setLoading(true)
    setError('')
    setDuplicateDetected(false)

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
        setError(t('join.pinRequired'))
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
        addTrip({ id: trip.id, name: trip.name, invite_code: trip.invite_code, joined_at: new Date().toISOString() })
        navigate(`/trip/${trip.id}`)
        return
      }

      const memberToClaim = claimMemberId || selectedMember

      if (memberToClaim && (mode === 'pick' || claimMemberId)) {
        // Claiming an existing member — verify token
        if (!token.trim()) {
          setShowTokenInput(true)
          setError('Enter the member PIN to claim this account')
          setLoading(false)
          return
        }

        // Verify token matches
        const targetMember = allMembers.find((m) => m.id === memberToClaim)
        if (!targetMember || targetMember.member_token?.toUpperCase() !== token.trim().toUpperCase()) {
          setError('Incorrect PIN. Ask the trip admin for your PIN.')
          setLoading(false)
          return
        }

        // Claim: update auth_uid and mark claimed
        const { error: claimError } = await supabase
          .from('members')
          .update({ auth_uid: authUid, claimed: true })
          .eq('id', memberToClaim)

        if (claimError) throw new Error(claimError.message)
      } else {
        // Create new member
        if (!name.trim()) {
          setError('Please enter your name')
          setLoading(false)
          return
        }

        // Check if name already exists (case insensitive)
        const existingByName = allMembers.find(
          (m) => m.name.toLowerCase() === name.trim().toLowerCase()
        )

        if (existingByName) {
          // Name exists — ask for token to claim it instead
          setDuplicateDetected(true)
          setSelectedMember(existingByName.id)
          setShowTokenInput(true)
          setError(`"${existingByName.name}" already exists. Enter their PIN to log in as them, or choose a different name.`)
          setLoading(false)
          return
        }

        const colors = ['#6366f1', '#ec4899', '#f59e0b', '#10b981', '#3b82f6', '#8b5cf6', '#ef4444', '#14b8a6']
        const color = colors[Math.floor(Math.random() * colors.length)]

        const { error: memberError } = await supabase
          .from('members')
          .insert({ trip_id: trip.id, auth_uid: authUid, name: name.trim(), color, claimed: true })

        if (memberError) {
          if (memberError.message.includes('duplicate') || memberError.message.includes('unique')) {
            setError('This name is already taken. Please choose a different name.')
          } else {
            throw new Error(memberError.message)
          }
          setLoading(false)
          return
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

  // Handle "claim with token" when duplicate is detected
  const handleClaimWithToken = async () => {
    if (!selectedMember || !token.trim()) {
      setError('Enter the PIN')
      return
    }
    setDuplicateDetected(false)
    setMode('pick')
    await handleJoin()
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
          <p className="text-sm text-slate-500">
            {claimMemberId ? t('join.claimSpot') : t('join.pickOrCreate')}
          </p>
        </div>

        {/* Unclaimed members to pick from */}
        {!claimMemberId && !duplicateDetected && unclaimedMembers.length > 0 && (
          <div>
            <p className="text-sm font-medium text-slate-600 dark:text-slate-300 mb-2">{t('join.iAm')}</p>
            <div className="space-y-2">
              {unclaimedMembers.map((m) => (
                <button
                  key={m.id}
                  onClick={() => { setSelectedMember(m.id); setMode('pick'); setShowTokenInput(true) }}
                  className={`w-full flex items-center gap-3 p-3 rounded-lg border transition-colors ${
                    selectedMember === m.id && mode === 'pick'
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

              <button
                onClick={() => { setSelectedMember(null); setMode('new'); setShowTokenInput(false); setError('') }}
                className={`w-full flex items-center gap-3 p-3 rounded-lg border transition-colors ${
                  mode === 'new'
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

        {/* Token input for claiming */}
        {showTokenInput && (selectedMember || claimMemberId) && (
          <div>
            <label className="text-sm font-medium text-slate-600 dark:text-slate-300">Member PIN</label>
            <input
              type="text"
              value={token}
              onChange={(e) => setToken(e.target.value.toUpperCase())}
              placeholder="4-char PIN"
              maxLength={4}
              className="mt-1 w-full px-3 py-3 rounded-lg border border-slate-300 dark:border-slate-600 bg-transparent focus:ring-2 focus:ring-indigo-500 outline-none text-center text-xl font-mono tracking-widest uppercase"
              autoFocus
            />
            <p className="text-[10px] text-slate-400 mt-1">Ask the trip admin for your PIN</p>
          </div>
        )}

        {/* Name input for new member */}
        {mode === 'new' && !duplicateDetected && (
          <div>
            <label className="text-sm font-medium text-slate-600 dark:text-slate-300">{t('trip.yourName')}</label>
            <input
              type="text"
              value={name}
              onChange={(e) => setName(e.target.value)}
              placeholder={t('join.namePlaceholder')}
              className="mt-1 w-full px-3 py-2 rounded-lg border border-slate-300 dark:border-slate-600 bg-transparent focus:ring-2 focus:ring-indigo-500 outline-none"
              autoFocus={!showTokenInput}
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
              placeholder="Enter trip PIN"
              className="mt-1 w-full px-3 py-2 rounded-lg border border-slate-300 dark:border-slate-600 bg-transparent focus:ring-2 focus:ring-indigo-500 outline-none"
            />
          </div>
        )}

        {error && <p className="text-red-500 text-sm text-center">{error}</p>}

        <button
          onClick={duplicateDetected ? handleClaimWithToken : handleJoin}
          disabled={loading}
          className="w-full px-4 py-3 rounded-lg bg-indigo-600 text-white font-medium hover:bg-indigo-700 disabled:opacity-50 transition-colors"
        >
          {loading ? t('join.joining') : duplicateDetected ? 'Claim Account' : t('join.joinButton')}
        </button>

        {duplicateDetected && (
          <button
            onClick={() => { setDuplicateDetected(false); setSelectedMember(null); setShowTokenInput(false); setError(''); setName('') }}
            className="w-full text-sm text-slate-500 hover:text-slate-700"
          >
            ← Use a different name instead
          </button>
        )}
      </div>
    </div>
  )
}
