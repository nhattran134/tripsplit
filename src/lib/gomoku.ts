export const BOARD_SIZE = 15
export type Stone = 'black' | 'white' | null
export type Board = Stone[][]

export function createBoard(): Board {
  return Array(BOARD_SIZE).fill(null).map(() => Array(BOARD_SIZE).fill(null))
}

export function checkWinner(board: Board, row: number, col: number): Stone {
  const stone = board[row][col]
  if (!stone) return null

  const rows = board.length
  const cols = board[0]?.length || rows
  const directions = [[0,1],[1,0],[1,1],[1,-1]]
  
  for (const [dr, dc] of directions) {
    let count = 1
    for (let i = 1; i < 5; i++) {
      const r = row + dr * i, c = col + dc * i
      if (r < 0 || r >= rows || c < 0 || c >= cols || board[r][c] !== stone) break
      count++
    }
    for (let i = 1; i < 5; i++) {
      const r = row - dr * i, c = col - dc * i
      if (r < 0 || r >= rows || c < 0 || c >= cols || board[r][c] !== stone) break
      count++
    }
    if (count >= 5) return stone
  }
  return null
}

export function boardFromMoves(moves: string): Board {
  const board = createBoard()
  if (!moves) return board
  for (const move of moves.split(';')) {
    const [r, c, color] = move.split(',')
    if (r && c && color) {
      board[parseInt(r)][parseInt(c)] = color as Stone
    }
  }
  return board
}

export function movesToString(moves: {row: number; col: number; color: Stone}[]): string {
  return moves.map(m => `${m.row},${m.col},${m.color}`).join(';')
}
