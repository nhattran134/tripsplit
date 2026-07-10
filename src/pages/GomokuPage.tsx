import { useState, useCallback, useEffect, useRef } from 'react'
import { useParams, useNavigate } from 'react-router-dom'
import { useQuery, useQueryClient } from '@tanstack/react-query'
import { ArrowLeft, Users, Wifi, X } from 'lucide-react'
import { supabase } from '@/lib/supabase'
import { Avatar } from '@/components/common/Avatar'
import { BOARD_SIZE, createBoard, checkWinner, boardFromMoves } from '@/lib/gomoku'
import type { Stone, Board } from '@/lib/gomoku'
import type { Member } from '@/types'

function GomokuBoard({ board, onPlace, lastMove, disabled }: {
  board: Board
  onPlace: (row: number, col: number) => void
  lastMove: { row: number; col: number } | null
  disabled: boolean
}) {
  const CELL_SIZE = 36 // bigger, easy to touch (44px tap target with padding)

  return (
    <div
      className="overflow-auto rounded-xl border-2 border-slate-400 dark:border-slate-600 touch-pan-x touch-pan-y"
      style={{ maxHeight: '60vh', WebkitOverflowScrolling: 'touch' }}
    >
      <div
        className="bg-slate-200 dark:bg-slate-800 relative"
        style={{ width: CELL_SIZE * BOARD_SIZE, height: CELL_SIZE * BOARD_SIZE, minWidth: CELL_SIZE * BOARD_SIZE }}
      >
        {board.map((row, r) => (
          <div key={r} className="flex">
            {row.map((cell, c) => (
              <button
                key={`${r}-${c}`}
                disabled={disabled || !!cell}
                onClick={() => onPlace(r, c)}
                className="relative flex items-center justify-center active:bg-slate-300/50 transition-colors"
                style={{ width: CELL_SIZE, height: CELL_SIZE }}
              >
                {/* Grid lines */}
                <div className="absolute inset-0 pointer-events-none">
                  <div className="absolute w-full h-px bg-slate-400/50 top-1/2" />
                  <div className="absolute h-full w-px bg-slate-400/50 left-1/2" />
                </div>
                {/* Star points (standard Gomoku markers) */}
                {((r === 3 || r === 7 || r === 11) && (c === 3 || c === 7 || c === 11)) && !cell && (
                  <div className="absolute w-2 h-2 bg-slate-500/50 rounded-full z-0" />
                )}
                {/* Stone */}
                {cell && (
                  <div
                    className={`relative z-10 rounded-full transition-transform duration-150 ${
                      cell === 'black'
                        ? 'bg-gradient-to-br from-teal-500 to-teal-700 shadow-lg'
                        : 'bg-gradient-to-br from-white to-slate-50 shadow-lg border border-slate-300'
                    } ${lastMove?.row === r && lastMove?.col === c
                        ? 'ring-2 ring-red-500 ring-offset-1 scale-110'
                        : ''
                    }`}
                    style={{
                      width: CELL_SIZE - 6,
                      height: CELL_SIZE - 6,
                      animation: lastMove?.row === r && lastMove?.col === c ? 'scaleIn 0.2s ease-out' : undefined,
                    }}
                  />
                )}
              </button>
            ))}
          </div>
        ))}
      </div>
    </div>
  )
}

function ScoreBoard({ tripId, members }: { tripId: string | undefined; members: Member[] }) {
  const { data: games = [] } = useQuery({
    queryKey: ['gomoku-scores', tripId],
    queryFn: async () => {
      const query = supabase.from('gomoku_games').select('player_black, player_white, winner').not('winner', 'is', null)
      if (tripId) query.eq('trip_id', tripId)
      const { data } = await query
      return data || []
    },
    staleTime: 1000 * 60 * 5,
  })

  // Calculate wins per member
  const scores = new Map<string, { wins: number; losses: number; draws: number }>()
  for (const g of games) {
    if (!scores.has(g.player_black)) scores.set(g.player_black, { wins: 0, losses: 0, draws: 0 })
    if (!scores.has(g.player_white)) scores.set(g.player_white, { wins: 0, losses: 0, draws: 0 })
    const b = scores.get(g.player_black)!
    const w = scores.get(g.player_white)!
    if (g.winner === 'black') { b.wins++; w.losses++ }
    else if (g.winner === 'white') { w.wins++; b.losses++ }
    else { b.draws++; w.draws++ }
  }

  const sorted = [...scores.entries()]
    .map(([id, s]) => ({ member: members.find(m => m.id === id), ...s }))
    .filter(s => s.member)
    .sort((a, b) => b.wins - a.wins)

  if (sorted.length === 0) return null

  return (
    <div className="p-4 bg-white dark:bg-slate-800 rounded-xl border border-slate-200 dark:border-slate-700">
      <p className="font-semibold mb-2 text-sm">🏆 Scoreboard</p>
      <div className="space-y-1.5">
        {sorted.map((s, i) => (
          <div key={s.member!.id} className="flex items-center gap-2 text-sm">
            <span className="w-5 text-center font-bold text-slate-400">{i + 1}</span>
            <Avatar name={s.member!.name} style={s.member!.avatar_style} seed={s.member!.avatar_seed} size={20} />
            <span className="flex-1 font-medium text-xs">{s.member!.name}</span>
            <span className="text-xs text-green-600 font-mono">{s.wins}W</span>
            <span className="text-xs text-red-500 font-mono">{s.losses}L</span>
            <span className="text-xs text-slate-400 font-mono">{s.draws}D</span>
          </div>
        ))}
      </div>
    </div>
  )
}

export function GomokuPage() {
  const { tripId } = useParams<{ tripId: string }>()
  const navigate = useNavigate()
  const queryClient = useQueryClient()

  const [mode, setMode] = useState<'menu' | 'local' | 'online'>('menu')
  const [board, setBoard] = useState<Board>(createBoard())
  const [boardSize, setBoardSize] = useState(BOARD_SIZE)
  const [moves, setMoves] = useState<{row: number; col: number; color: Stone}[]>([])
  const [currentTurn, setCurrentTurn] = useState<Stone>('black')
  const [winner, setWinner] = useState<Stone | 'draw' | null>(null)
  const [gameId, setGameId] = useState<string | null>(null)
  const [myColor, setMyColor] = useState<Stone>(null)
  const [blackTime, setBlackTime] = useState(300) // 5 minutes each
  const [whiteTime, setWhiteTime] = useState(300)
  const timerRef = useRef<ReturnType<typeof setInterval> | null>(null)
  const TOTAL_TIME = 300 // 5 minutes per player

  const { data: members = [] } = useQuery({
    queryKey: ['members', tripId],
    queryFn: async () => {
      const { data, error } = await supabase.from('members').select('*').eq('trip_id', tripId).is('deleted_at', null)
      if (error) throw error
      return data as Member[]
    },
  })

  const { data: session } = useQuery({
    queryKey: ['session'],
    queryFn: async () => { const { data } = await supabase.auth.getSession(); return data.session },
  })
  const currentAuthUid = session?.user?.id
  const myMember = members.find(m => m.auth_uid === currentAuthUid)

  // --- LOCAL MODE ---
  // Use refs for immediate state to prevent double-moves from rapid clicks
  const boardRef = useRef(board)
  const turnRef = useRef(currentTurn)
  const winnerRef = useRef(winner)
  boardRef.current = board
  turnRef.current = currentTurn
  winnerRef.current = winner

  // Expand board if a stone is placed within 2 cells of any edge
  const maybeExpandBoard = (b: Board, row: number, col: number): Board => {
    const size = b.length
    const MARGIN = 2
    let expandTop = row < MARGIN ? MARGIN : 0
    let expandBottom = row >= size - MARGIN ? MARGIN : 0
    let expandLeft = col < MARGIN ? MARGIN : 0
    let expandRight = col >= size - MARGIN ? MARGIN : 0

    if (!expandTop && !expandBottom && !expandLeft && !expandRight) return b

    const newSize = size + expandTop + expandBottom
    const newWidth = (b[0]?.length || size) + expandLeft + expandRight
    const newBoard: Board = Array(newSize).fill(null).map(() => Array(newWidth).fill(null))

    for (let r = 0; r < size; r++) {
      for (let c = 0; c < (b[0]?.length || size); c++) {
        newBoard[r + expandTop][c + expandLeft] = b[r][c]
      }
    }

    setBoardSize(newSize)

    // Adjust moves offset
    if (expandTop || expandLeft) {
      setMoves(prev => prev.map(m => ({
        ...m,
        row: m.row + expandTop,
        col: m.col + expandLeft,
      })))
    }

    return newBoard
  }

  const handleLocalPlace = useCallback((row: number, col: number) => {
    if (winnerRef.current || boardRef.current[row][col]) return
    const turn = turnRef.current!
    const newBoard = boardRef.current.map(r => [...r])
    newBoard[row][col] = turn
    
    const w = checkWinner(newBoard, row, col)
    if (w) { setBoard(newBoard); setWinner(w); setMoves(prev => [...prev, { row, col, color: turn }]); return }
    
    // Expand board if near edge
    const expandedBoard = maybeExpandBoard(newBoard, row, col)
    setBoard(expandedBoard)
    
    const newMoves = [...moves, { row, col, color: turn }]
    setMoves(newMoves)
    if (newMoves.length === boardSize * boardSize) { setWinner('draw'); return }
    setCurrentTurn(turn === 'black' ? 'white' : 'black')
  }, [moves, boardSize])

  // --- ONLINE MODE ---
  const [challengeSent, setChallengeSent] = useState<string | null>(null)

  const sendChallenge = async (opponentId: string) => {
    if (!myMember) return
    const { data } = await supabase.from('gomoku_challenges').insert({
      trip_id: tripId,
      from_member_id: myMember.id,
      to_member_id: opponentId,
      status: 'pending',
    }).select().single()
    if (data) {
      setChallengeSent(opponentId)
      // Subscribe to challenge status changes
      supabase.channel(`challenge-${data.id}`)
        .on('postgres_changes', { event: 'UPDATE', schema: 'public', table: 'gomoku_challenges', filter: `id=eq.${data.id}` },
          (payload: any) => {
            const c = payload.new
            if (c.status === 'accepted' && c.game_id) {
              setChallengeSent(null)
              // Join the created game
              supabase.from('gomoku_games').select('*').eq('id', c.game_id).single().then(({ data: game }) => {
                if (game) joinExistingGame(game)
              })
            } else if (c.status === 'declined') {
              setChallengeSent(null)
            }
          }
        ).subscribe()
    }
  }

  const acceptChallenge = async (challenge: any) => {
    if (!myMember) return
    // Create the game
    const { data: game } = await supabase.from('gomoku_games').insert({
      trip_id: tripId,
      player_black: challenge.from_member_id,
      player_white: myMember.id,
      board: '',
      current_turn: 'black',
    }).select().single()

    if (game) {
      // Update challenge as accepted
      await supabase.from('gomoku_challenges').update({ status: 'accepted', game_id: game.id }).eq('id', challenge.id)
      joinExistingGame(game)
    }
  }

  const declineChallenge = async (challengeId: string) => {
    await supabase.from('gomoku_challenges').update({ status: 'declined' }).eq('id', challengeId)
    queryClient.invalidateQueries({ queryKey: ['gomoku-challenges', tripId] })
  }

  // Incoming challenges (for current user)
  const { data: incomingChallenges = [] } = useQuery({
    queryKey: ['gomoku-challenges', tripId],
    refetchInterval: 5000, // poll every 5s for new challenges
    queryFn: async () => {
      if (!myMember) return []
      const { data } = await supabase.from('gomoku_challenges')
        .select('*')
        .eq('trip_id', tripId)
        .eq('to_member_id', myMember.id)
        .eq('status', 'pending')
        .order('created_at', { ascending: false })
      return data || []
    },
  })

  const joinExistingGame = async (game: any) => {
    if (!myMember) return
    setGameId(game.id)
    setMyColor(game.player_black === myMember.id ? 'black' : 'white')
    setBoard(boardFromMoves(game.board))
    setCurrentTurn(game.current_turn)
    setWinner(game.winner)
    setMode('online')
    subscribeToGame(game.id)
  }

  const subscribeToGame = (id: string) => {
    supabase.channel(`gomoku-${id}`)
      .on('postgres_changes', { event: 'UPDATE', schema: 'public', table: 'gomoku_games', filter: `id=eq.${id}` },
        (payload: any) => {
          const g = payload.new
          setBoard(boardFromMoves(g.board))
          setCurrentTurn(g.current_turn)
          setWinner(g.winner)
        }
      ).subscribe()
  }

  const handleOnlinePlace = async (row: number, col: number) => {
    if (!gameId || winner || currentTurn !== myColor || board[row][col]) return
    const newBoard = board.map(r => [...r])
    newBoard[row][col] = myColor
    setBoard(newBoard)

    const newMoves = [...moves, { row, col, color: myColor }]
    setMoves(newMoves)
    const boardStr = (await supabase.from('gomoku_games').select('board').eq('id', gameId).single()).data?.board || ''
    const updatedBoard = boardStr ? `${boardStr};${row},${col},${myColor}` : `${row},${col},${myColor}`

    const w = checkWinner(newBoard, row, col)
    const nextTurn = myColor === 'black' ? 'white' : 'black'

    await supabase.from('gomoku_games').update({
      board: updatedBoard,
      current_turn: w ? currentTurn : nextTurn,
      winner: w || null,
      updated_at: new Date().toISOString(),
    }).eq('id', gameId)
  }

  // Check for active games
  const { data: activeGames = [] } = useQuery({
    queryKey: ['gomoku-active', tripId],
    enabled: mode === 'menu',
    queryFn: async () => {
      const { data } = await supabase.from('gomoku_games')
        .select('*')
        .eq('trip_id', tripId)
        .is('winner', null)
        .order('created_at', { ascending: false })
        .limit(5)
      return data || []
    },
  })

  const resetGame = () => {
    setBoard(createBoard())
    setMoves([])
    setCurrentTurn('black')
    setWinner(null)
    setGameId(null)
    setMyColor(null)
    setMode('menu')
    if (timerRef.current) clearInterval(timerRef.current)
    setBlackTime(TOTAL_TIME)
    setWhiteTime(TOTAL_TIME)
  }

  // Close/forfeit an online game
  const closeGame = async (id: string) => {
    await supabase.from('gomoku_games').update({ winner: 'draw' }).eq('id', id)
    queryClient.invalidateQueries({ queryKey: ['gomoku-active', tripId] })
    if (gameId === id) resetGame()
  }

  // Chess clock - ticks down the current player's time
  useEffect(() => {
    if (winner || mode === 'menu') {
      if (timerRef.current) clearInterval(timerRef.current)
      return
    }

    timerRef.current = setInterval(() => {
      if (currentTurn === 'black') {
        setBlackTime((prev) => {
          if (prev <= 1) {
            setWinner('white')
            if (gameId) {
              supabase.from('gomoku_games').update({ winner: 'white' }).eq('id', gameId)
            }
            return 0
          }
          return prev - 1
        })
      } else {
        setWhiteTime((prev) => {
          if (prev <= 1) {
            setWinner('black')
            if (gameId) {
              supabase.from('gomoku_games').update({ winner: 'black' }).eq('id', gameId)
            }
            return 0
          }
          return prev - 1
        })
      }
    }, 1000)

    return () => { if (timerRef.current) clearInterval(timerRef.current) }
  }, [currentTurn, winner, mode])

  const lastMove = moves.length > 0 ? moves[moves.length - 1] : null

  // --- MENU ---
  if (mode === 'menu') {
    return (
      <div className="space-y-4">
        <div className="flex items-center gap-3">
          <button onClick={() => navigate(`/trip/${tripId}`)} className="text-indigo-600"><ArrowLeft size={20} /></button>
          <h1 className="text-xl font-bold">Gomoku</h1>
        </div>

        <div className="space-y-3">
          <button
            onClick={() => setMode('local')}
            className="w-full p-4 bg-white dark:bg-slate-800 rounded-xl border border-slate-200 dark:border-slate-700 text-left flex items-center gap-3 hover:border-indigo-300 transition-colors"
          >
            <Users size={24} className="text-indigo-500" />
            <div>
              <p className="font-semibold">Local (Pass & Play)</p>
              <p className="text-xs text-slate-500">Two players on the same device</p>
            </div>
          </button>

          <div className="w-full p-4 bg-white dark:bg-slate-800 rounded-xl border border-slate-200 dark:border-slate-700">
            <div className="flex items-center gap-3 mb-3">
              <Wifi size={24} className="text-green-500" />
              <div>
                <p className="font-semibold">Online</p>
                <p className="text-xs text-slate-500">Challenge a trip member</p>
              </div>
            </div>
            <div className="space-y-2 max-h-40 overflow-y-auto">
              {members.filter(m => m.id !== myMember?.id).map(m => (
                <div key={m.id} className="flex items-center gap-2 p-2 rounded-lg border border-slate-200 dark:border-slate-700">
                  <Avatar name={m.name} style={m.avatar_style} seed={m.avatar_seed} size={24} />
                  <span className="text-sm font-medium flex-1">{m.name}</span>
                  <button
                    onClick={() => sendChallenge(m.id)}
                    disabled={challengeSent === m.id}
                    className={`px-3 py-1 rounded-lg text-xs font-medium transition-colors ${
                      challengeSent === m.id
                        ? 'bg-amber-100 text-amber-600 dark:bg-amber-900/30'
                        : 'bg-indigo-600 text-white hover:bg-indigo-700'
                    }`}
                  >
                    {challengeSent === m.id ? 'Waiting...' : 'Challenge'}
                  </button>
                </div>
              ))}
            </div>
          </div>

          {/* Incoming Challenges */}
          {incomingChallenges.length > 0 && (
            <div className="p-4 bg-amber-50 dark:bg-amber-900/20 rounded-xl border border-amber-200 dark:border-amber-800 space-y-2 animate-pulse">
              <p className="font-semibold text-sm text-amber-800 dark:text-amber-300">⚔️ Incoming Challenge!</p>
              {incomingChallenges.map((c: any) => {
                const challenger = members.find(m => m.id === c.from_member_id)
                return (
                  <div key={c.id} className="flex items-center gap-2 p-2 bg-white dark:bg-slate-800 rounded-lg">
                    <Avatar name={challenger?.name || '?'} style={challenger?.avatar_style} seed={challenger?.avatar_seed} size={28} />
                    <span className="text-sm font-medium flex-1">{challenger?.name}</span>
                    <button
                      onClick={() => acceptChallenge(c)}
                      className="px-3 py-1.5 rounded-lg bg-green-600 text-white text-xs font-medium hover:bg-green-700"
                    >
                      Accept
                    </button>
                    <button
                      onClick={() => declineChallenge(c.id)}
                      className="px-3 py-1.5 rounded-lg border border-red-300 text-red-600 text-xs font-medium hover:bg-red-50"
                    >
                      Decline
                    </button>
                  </div>
                )
              })}
            </div>
          )}

          {/* Active games to rejoin */}
          {activeGames.length > 0 && (
            <div className="p-4 bg-white dark:bg-slate-800 rounded-xl border border-slate-200 dark:border-slate-700">
              <p className="font-semibold mb-2 text-sm">Active Games</p>
              {activeGames.map((g: any) => {
                const black = members.find(m => m.id === g.player_black)
                const white = members.find(m => m.id === g.player_white)
                return (
                  <div key={g.id} className="flex items-center gap-2 p-2 rounded-lg border border-slate-200 dark:border-slate-700 mb-2">
                    <button onClick={() => joinExistingGame(g)} className="flex-1 text-left py-1">
                      <p className="text-sm font-medium">{black?.name} vs {white?.name}</p>
                      <p className="text-[10px] text-indigo-500">Tap to resume</p>
                    </button>
                    <button
                      onClick={(e) => { e.stopPropagation(); if (confirm('End this game?')) closeGame(g.id) }}
                      className="px-3 py-2 rounded-lg bg-red-50 dark:bg-red-900/20 border border-red-200 dark:border-red-800 text-red-600 text-xs font-medium hover:bg-red-100 transition-colors"
                    >
                      End
                    </button>
                  </div>
                )
              })}
            </div>
          )}

          {/* Scoreboard */}
          <ScoreBoard tripId={tripId} members={members} />
        </div>
      </div>
    )
  }

  // --- GAME VIEW (both local and online) ---
  return (
    <div className="space-y-3">
      <div className="flex items-center justify-between">
        <button onClick={resetGame} className="text-indigo-600 flex items-center gap-1 text-sm">
          <ArrowLeft size={16} /> Back
        </button>
        <div className="flex items-center gap-2">
          {/* Chess clocks */}
          {!winner && (
            <div className="flex items-center gap-1">
              <span className={`flex items-center gap-0.5 text-xs px-2 py-1 rounded-full font-mono ${
                currentTurn === 'black'
                  ? blackTime <= 30 ? 'bg-red-100 text-red-600 animate-pulse' : 'bg-teal-600 text-white'
                  : 'bg-slate-200 dark:bg-slate-700 text-slate-500'
              }`}>
                🟢 {Math.floor(blackTime / 60)}:{(blackTime % 60).toString().padStart(2, '0')}
              </span>
              <span className={`flex items-center gap-0.5 text-xs px-2 py-1 rounded-full font-mono ${
                currentTurn === 'white'
                  ? whiteTime <= 30 ? 'bg-red-100 text-red-600 animate-pulse' : 'bg-white text-slate-900 border border-slate-300 shadow-sm'
                  : 'bg-slate-200 dark:bg-slate-700 text-slate-500'
              }`}>
                ⚪ {Math.floor(whiteTime / 60)}:{(whiteTime % 60).toString().padStart(2, '0')}
              </span>
            </div>
          )}
          <span className="text-xs px-2 py-1 rounded bg-slate-100 dark:bg-slate-700">
            {mode === 'local' ? 'Local' : 'Online'}
          </span>
          {/* Forfeit/Close */}
          {!winner && (
            <button
              onClick={() => {
                if (confirm('End this game? It will be marked as a draw.')) {
                  if (gameId) closeGame(gameId)
                  else resetGame()
                }
              }}
              className="p-1.5 rounded-lg border border-red-300 text-red-500 hover:bg-red-50 dark:hover:bg-red-900/20"
            >
              <X size={14} />
            </button>
          )}
        </div>
      </div>

      {/* Turn indicator */}
      <div className="text-center">
        {winner ? (
          <p className="font-bold text-lg">
            {winner === 'draw' ? "It's a draw!" : `${winner === 'black' ? '🟢' : '⚪'} ${winner.charAt(0).toUpperCase() + winner.slice(1)} wins!`}
          </p>
        ) : (
          <p className="text-sm font-medium">
            {currentTurn === 'black' ? '🟢' : '⚪'} {currentTurn}'s turn
            {mode === 'online' && currentTurn === myColor && ' (you)'}
            {mode === 'online' && currentTurn !== myColor && ' (waiting...)'}
          </p>
        )}
      </div>

      {/* Board */}
      <GomokuBoard
        board={board}
        onPlace={mode === 'local' ? handleLocalPlace : handleOnlinePlace}
        lastMove={lastMove}
        disabled={!!winner || (mode === 'online' && currentTurn !== myColor)}
      />

      {/* Reset button */}
      {winner && (
        <button
          onClick={resetGame}
          className="w-full py-2 rounded-lg bg-indigo-600 text-white font-medium text-sm"
        >
          New Game
        </button>
      )}
    </div>
  )
}
