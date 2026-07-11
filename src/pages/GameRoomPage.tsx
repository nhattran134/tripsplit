import { useState, useEffect } from 'react'
import { useParams, useNavigate } from 'react-router-dom'
import { useQuery, useQueryClient } from '@tanstack/react-query'
import { nanoid } from 'nanoid'
import { supabase, ensureAnonymousAuth } from '@/lib/supabase'
import { Avatar } from '@/components/common/Avatar'
import { useCopy } from '@/hooks/useCopy'

interface RoomPlayer {
  id: string
  room_id: string
  auth_uid: string
  name: string
  avatar_style: string
  avatar_seed: number
}

export function GameRoomPage() {
  const { roomCode } = useParams<{ roomCode: string }>()
  const navigate = useNavigate()
  const queryClient = useQueryClient()
  const { copy, copiedId } = useCopy()

  const [joining, setJoining] = useState(false)
  const [name, setName] = useState('')
  const [error, setError] = useState('')
  const [room, setRoom] = useState<any>(null)
  const [myPlayer, setMyPlayer] = useState<RoomPlayer | null>(null)

  // Load or create room
  useEffect(() => {
    const init = async () => {
      const authUid = await ensureAnonymousAuth()

      if (roomCode) {
        // Join existing room
        const { data } = await supabase
          .from('game_rooms')
          .select('*')
          .eq('invite_code', roomCode)
          .single()

        if (data) {
          setRoom(data)
          // Check if already in the room
          const { data: player } = await supabase
            .from('game_room_players')
            .select('*')
            .eq('room_id', data.id)
            .eq('auth_uid', authUid)
            .single()

          if (player) setMyPlayer(player as RoomPlayer)
        }
      }
    }
    init()
  }, [roomCode])

  const { data: players = [] } = useQuery({
    queryKey: ['room-players', room?.id],
    enabled: !!room,
    refetchInterval: 3000,
    queryFn: async () => {
      const { data } = await supabase
        .from('game_room_players')
        .select('*')
        .eq('room_id', room.id)
      return (data || []) as RoomPlayer[]
    },
  })

  const handleJoinRoom = async () => {
    if (!name.trim()) { setError('Enter your name'); return }
    setJoining(true)
    try {
      const authUid = await ensureAnonymousAuth()
      const { data: player, error: err } = await supabase
        .from('game_room_players')
        .insert({ room_id: room.id, auth_uid: authUid, name: name.trim() })
        .select()
        .single()
      if (err) throw new Error(err.message)
      setMyPlayer(player as RoomPlayer)
      queryClient.invalidateQueries({ queryKey: ['room-players', room.id] })
    } catch (e) {
      setError(e instanceof Error ? e.message : 'Failed to join')
    } finally {
      setJoining(false)
    }
  }

  const inviteLink = room ? `${window.location.origin}/play/${room.invite_code}` : ''

  // Not in room yet — show join screen
  if (room && !myPlayer) {
    return (
      <div className="min-h-screen bg-slate-50 dark:bg-slate-900 flex items-center justify-center p-4">
        <div className="bg-white dark:bg-slate-800 rounded-2xl p-6 w-full max-w-sm space-y-4 shadow-lg">
          <div className="text-center">
            <p className="text-4xl mb-2">🎮</p>
            <h1 className="text-xl font-bold text-slate-900 dark:text-white">Join Game Room</h1>
            <p className="text-sm text-slate-400">{room.name}</p>
          </div>
          <div>
            <label className="text-sm font-medium text-slate-700 dark:text-slate-200">Your Name</label>
            <input
              type="text"
              value={name}
              onChange={(e) => setName(e.target.value)}
              placeholder="Enter your name"
              className="mt-1 w-full px-3 py-2 rounded-lg border border-slate-300 dark:border-slate-600 bg-transparent focus:ring-2 focus:ring-indigo-500 outline-none"
              autoFocus
            />
          </div>
          {error && <p className="text-red-500 text-sm">{error}</p>}
          <button
            onClick={handleJoinRoom}
            disabled={joining}
            className="w-full py-3 rounded-lg bg-indigo-600 text-white font-medium hover:bg-indigo-700 disabled:opacity-50"
          >
            {joining ? 'Joining...' : 'Join'}
          </button>
        </div>
      </div>
    )
  }

  // No room found
  if (!room) {
    return (
      <div className="min-h-screen bg-slate-50 dark:bg-slate-900 flex items-center justify-center p-4">
        <p className="text-slate-500">Room not found</p>
      </div>
    )
  }

  // In the room — show players and game options
  return (
    <div className="min-h-screen bg-slate-50 dark:bg-slate-900 text-slate-900 dark:text-slate-100 p-4">
      <div className="max-w-lg mx-auto space-y-4 pt-6">
        <div className="flex items-center justify-between">
          <div>
            <h1 className="text-xl font-bold">{room.name}</h1>
            <p className="text-xs text-slate-500">{players.length} player{players.length !== 1 ? 's' : ''}</p>
          </div>
          <button
            onClick={() => navigate('/')}
            className="text-sm text-indigo-600"
          >
            Leave
          </button>
        </div>

        {/* Invite Link */}
        <div className="bg-white dark:bg-slate-800 rounded-xl p-4 border border-slate-200 dark:border-slate-700">
          <p className="text-sm font-medium mb-2">Share this link to invite players:</p>
          <div className="flex gap-2">
            <input type="text" value={inviteLink} readOnly className="flex-1 px-3 py-2 rounded-lg border border-slate-300 dark:border-slate-600 bg-slate-50 dark:bg-slate-700 text-xs truncate" />
            <button
              onClick={() => copy(inviteLink, 'room-link')}
              className={`px-3 py-2 rounded-lg text-sm font-medium transition-all ${
                copiedId === 'room-link' ? 'bg-green-500 text-white' : 'bg-indigo-600 text-white hover:bg-indigo-700'
              }`}
            >
              {copiedId === 'room-link' ? '✓' : 'Copy'}
            </button>
          </div>
        </div>

        {/* Players */}
        <div className="bg-white dark:bg-slate-800 rounded-xl p-4 border border-slate-200 dark:border-slate-700">
          <p className="font-semibold text-sm mb-2">Players</p>
          <div className="space-y-2">
            {players.map((p) => (
              <div key={p.id} className="flex items-center gap-2">
                <Avatar name={p.name} style={p.avatar_style} seed={p.avatar_seed} size={28} />
                <span className="text-sm font-medium">{p.name}</span>
                {p.auth_uid === myPlayer?.auth_uid && <span className="text-[10px] bg-green-100 text-green-600 px-1.5 py-0.5 rounded">You</span>}
              </div>
            ))}
          </div>
        </div>

        {/* Start Game */}
        {players.length >= 2 && (
          <div className="bg-white dark:bg-slate-800 rounded-xl p-4 border border-slate-200 dark:border-slate-700">
            <p className="font-semibold text-sm mb-2">Start a Game</p>
            <p className="text-xs text-slate-500 mb-3">Choose an opponent:</p>
            <div className="space-y-2">
              {players.filter(p => p.id !== myPlayer?.id).map((p) => (
                <button
                  key={p.id}
                  onClick={async () => {
                    const { data } = await supabase.from('gomoku_games').insert({
                      room_id: room.id,
                      player_black: myPlayer!.id,
                      player_white: p.id,
                      board: '',
                      current_turn: 'black',
                    }).select().single()
                    if (data) {
                      navigate(`/play/${room.invite_code}/game/${data.id}`)
                    }
                  }}
                  className="w-full flex items-center gap-2 p-3 rounded-lg border border-slate-200 dark:border-slate-700 hover:border-indigo-300 transition-colors"
                >
                  <Avatar name={p.name} style={p.avatar_style} seed={p.avatar_seed} size={24} />
                  <span className="text-sm font-medium flex-1">{p.name}</span>
                  <span className="text-xs text-indigo-600 font-medium">Play →</span>
                </button>
              ))}
            </div>
          </div>
        )}

        {players.length < 2 && (
          <div className="text-center py-8 text-slate-500">
            <p className="text-sm">Waiting for more players to join...</p>
            <p className="text-xs mt-1">Share the link above</p>
          </div>
        )}
      </div>
    </div>
  )
}

export function CreateGameRoomPage() {
  const navigate = useNavigate()
  const [name, setName] = useState('')
  const [playerName, setPlayerName] = useState('')
  const [loading, setLoading] = useState(false)

  const handleCreate = async () => {
    if (!playerName.trim()) return
    setLoading(true)
    try {
      const authUid = await ensureAnonymousAuth()
      const inviteCode = nanoid(8).toUpperCase()

      const { data: room } = await supabase
        .from('game_rooms')
        .insert({ name: name.trim() || 'Game Room', invite_code: inviteCode })
        .select()
        .single()

      if (room) {
        await supabase.from('game_room_players').insert({
          room_id: room.id,
          auth_uid: authUid,
          name: playerName.trim(),
        })
        navigate(`/play/${inviteCode}`)
      }
    } catch {
      // handle error
    } finally {
      setLoading(false)
    }
  }

  return (
    <div className="min-h-screen bg-slate-50 dark:bg-slate-900 flex items-center justify-center p-4">
      <div className="bg-white dark:bg-slate-800 rounded-2xl p-6 w-full max-w-sm space-y-4 shadow-lg">
        <div className="text-center">
          <p className="text-4xl mb-2">🎮</p>
          <h1 className="text-xl font-bold text-slate-900 dark:text-white">Create Game Room</h1>
          <p className="text-sm text-slate-400">Play with anyone — just share the link</p>
        </div>
        <div>
          <label className="text-sm font-medium text-slate-700 dark:text-slate-200">Room Name (optional)</label>
          <input
            type="text"
            value={name}
            onChange={(e) => setName(e.target.value)}
            placeholder="Friday Night Games"
            className="mt-1 w-full px-3 py-2 rounded-lg border border-slate-300 dark:border-slate-600 bg-transparent focus:ring-2 focus:ring-indigo-500 outline-none"
          />
        </div>
        <div>
          <label className="text-sm font-medium text-slate-700 dark:text-slate-200">Your Name</label>
          <input
            type="text"
            value={playerName}
            onChange={(e) => setPlayerName(e.target.value)}
            placeholder="Your name"
            className="mt-1 w-full px-3 py-2 rounded-lg border border-slate-300 dark:border-slate-600 bg-transparent focus:ring-2 focus:ring-indigo-500 outline-none"
            autoFocus
          />
        </div>
        <button
          onClick={handleCreate}
          disabled={loading || !playerName.trim()}
          className="w-full py-3 rounded-lg bg-indigo-600 text-white font-medium hover:bg-indigo-700 disabled:opacity-50"
        >
          {loading ? 'Creating...' : 'Create Room'}
        </button>
        <button onClick={() => navigate('/')} className="w-full text-sm text-slate-500">
          ← Back to TripSplit
        </button>
      </div>
    </div>
  )
}
