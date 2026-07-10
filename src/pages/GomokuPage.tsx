import { useState, useCallback } from 'react'
import { useParams, useNavigate } from 'react-router-dom'
import { useQuery } from '@tanstack/react-query'
import { ArrowLeft, Users, Wifi } from 'lucide-react'
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
  const cellSize = Math.min(Math.floor((window.innerWidth - 48) / BOARD_SIZE), 28)

  return (
    <div
      className="mx-auto border border-amber-800 bg-amber-100 dark:bg-amber-900/30 rounded overflow-hidden"
      style={{ width: cellSize * BOARD_SIZE, height: cellSize * BOARD_SIZE }}
    >
      {board.map((row, r) => (
        <div key={r} className="flex">
          {row.map((cell, c) => (
            <button
              key={`${r}-${c}`}
              disabled={disabled || !!cell}
              onClick={() => onPlace(r, c)}
              className="relative border-r border-b border-amber-700/30 flex items-center justify-center"
              style={{ width: cellSize, height: cellSize }}
            >
              {/* Grid lines */}
              <div className="absolute inset-0 flex items-center justify-center">
                <div className="absolute w-full h-px bg-amber-700/40 top-1/2" />
                <div className="absolute h-full w-px bg-amber-700/40 left-1/2" />
              </div>
              {/* Stone */}
              {cell && (
                <div className={`relative z-10 rounded-full shadow-md ${
                  cell === 'black' ? 'bg-slate-900' : 'bg-white border border-slate-300'
                } ${lastMove?.row === r && lastMove?.col === c ? 'ring-2 ring-red-500' : ''}`}
                  style={{ width: cellSize - 4, height: cellSize - 4 }}
                />
              )}
            </button>
          ))}
        </div>
      ))}
    </div>
  )
}

export function GomokuPage() {
  const { tripId } = useParams<{ tripId: string }>()
  const navigate = useNavigate()

  const [mode, setMode] = useState<'menu' | 'local' | 'online'>('menu')
  const [board, setBoard] = useState<Board>(createBoard())
  const [moves, setMoves] = useState<{row: number; col: number; color: Stone}[]>([])
  const [currentTurn, setCurrentTurn] = useState<Stone>('black')
  const [winner, setWinner] = useState<Stone | 'draw' | null>(null)
  const [gameId, setGameId] = useState<string | null>(null)
  const [myColor, setMyColor] = useState<Stone>(null)

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
  const handleLocalPlace = useCallback((row: number, col: number) => {
    if (winner || board[row][col]) return
    const newBoard = board.map(r => [...r])
    newBoard[row][col] = currentTurn
    setBoard(newBoard)
    const newMoves = [...moves, { row, col, color: currentTurn }]
    setMoves(newMoves)

    const w = checkWinner(newBoard, row, col)
    if (w) { setWinner(w); return }
    if (newMoves.length === BOARD_SIZE * BOARD_SIZE) { setWinner('draw'); return }
    setCurrentTurn(currentTurn === 'black' ? 'white' : 'black')
  }, [board, currentTurn, winner, moves])

  // --- ONLINE MODE ---
  const createOnlineGame = async (opponentId: string) => {
    if (!myMember) return
    const { data } = await supabase.from('gomoku_games').insert({
      trip_id: tripId,
      player_black: myMember.id,
      player_white: opponentId,
      board: '',
      current_turn: 'black',
    }).select().single()
    if (data) {
      setGameId(data.id)
      setMyColor('black')
      setMode('online')
      subscribeToGame(data.id)
    }
  }

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
  }

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
                <button
                  key={m.id}
                  onClick={() => createOnlineGame(m.id)}
                  className="w-full flex items-center gap-2 p-2 rounded-lg border border-slate-200 dark:border-slate-700 hover:border-indigo-300 transition-colors"
                >
                  <Avatar name={m.name} style={m.avatar_style} seed={m.avatar_seed} size={24} />
                  <span className="text-sm font-medium">{m.name}</span>
                </button>
              ))}
            </div>
          </div>

          {/* Active games to rejoin */}
          {activeGames.length > 0 && (
            <div className="p-4 bg-white dark:bg-slate-800 rounded-xl border border-slate-200 dark:border-slate-700">
              <p className="font-semibold mb-2 text-sm">Active Games</p>
              {activeGames.map((g: any) => {
                const black = members.find(m => m.id === g.player_black)
                const white = members.find(m => m.id === g.player_white)
                return (
                  <button key={g.id} onClick={() => joinExistingGame(g)}
                    className="w-full flex items-center gap-2 p-2 rounded-lg border border-slate-200 dark:border-slate-700 hover:border-indigo-300 mb-1">
                    <span className="text-xs">{black?.name} vs {white?.name}</span>
                    <span className="ml-auto text-[10px] text-indigo-500">Resume →</span>
                  </button>
                )
              })}
            </div>
          )}
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
        <span className="text-xs px-2 py-1 rounded bg-slate-100 dark:bg-slate-700">
          {mode === 'local' ? 'Local' : 'Online'}
        </span>
      </div>

      {/* Turn indicator */}
      <div className="text-center">
        {winner ? (
          <p className="font-bold text-lg">
            {winner === 'draw' ? "It's a draw!" : `${winner === 'black' ? '⚫' : '⚪'} ${winner.charAt(0).toUpperCase() + winner.slice(1)} wins!`}
          </p>
        ) : (
          <p className="text-sm font-medium">
            {currentTurn === 'black' ? '⚫' : '⚪'} {currentTurn}'s turn
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
