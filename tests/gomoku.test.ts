import { describe, it, expect } from 'vitest'
import {
  BOARD_SIZE,
  createBoard,
  checkWinner,
  boardFromMoves,
  movesToString,
  type Board,
  type Stone,
} from '@/lib/gomoku'

// Helper: place stones on a board
function placeStones(board: Board, stones: { row: number; col: number; color: Stone }[]) {
  for (const { row, col, color } of stones) {
    board[row][col] = color
  }
}

describe('createBoard', () => {
  it('creates a board with correct dimensions', () => {
    const board = createBoard()
    expect(board).toHaveLength(BOARD_SIZE)
    for (const row of board) {
      expect(row).toHaveLength(BOARD_SIZE)
    }
  })

  it('initializes all cells to null', () => {
    const board = createBoard()
    for (let r = 0; r < BOARD_SIZE; r++) {
      for (let c = 0; c < BOARD_SIZE; c++) {
        expect(board[r][c]).toBeNull()
      }
    }
  })

  it('rows are independent (not shared references)', () => {
    const board = createBoard()
    board[0][0] = 'black'
    expect(board[1][0]).toBeNull()
  })
})

describe('checkWinner — horizontal', () => {
  it('returns the stone color for 5 in a row horizontally', () => {
    const board = createBoard()
    placeStones(board, [
      { row: 7, col: 3, color: 'black' },
      { row: 7, col: 4, color: 'black' },
      { row: 7, col: 5, color: 'black' },
      { row: 7, col: 6, color: 'black' },
      { row: 7, col: 7, color: 'black' },
    ])
    expect(checkWinner(board, 7, 7)).toBe('black')
  })

  it('returns winner when checking from the middle of 5 in a row', () => {
    const board = createBoard()
    placeStones(board, [
      { row: 7, col: 3, color: 'white' },
      { row: 7, col: 4, color: 'white' },
      { row: 7, col: 5, color: 'white' },
      { row: 7, col: 6, color: 'white' },
      { row: 7, col: 7, color: 'white' },
    ])
    expect(checkWinner(board, 7, 5)).toBe('white')
  })

  it('returns null for only 4 in a row horizontally', () => {
    const board = createBoard()
    placeStones(board, [
      { row: 7, col: 3, color: 'black' },
      { row: 7, col: 4, color: 'black' },
      { row: 7, col: 5, color: 'black' },
      { row: 7, col: 6, color: 'black' },
    ])
    expect(checkWinner(board, 7, 6)).toBeNull()
  })

  it('does not count opponent stones in the line', () => {
    const board = createBoard()
    placeStones(board, [
      { row: 7, col: 2, color: 'white' },
      { row: 7, col: 3, color: 'black' },
      { row: 7, col: 4, color: 'black' },
      { row: 7, col: 5, color: 'black' },
      { row: 7, col: 6, color: 'black' },
    ])
    expect(checkWinner(board, 7, 6)).toBeNull()
  })
})

describe('checkWinner — vertical', () => {
  it('returns winner for 5 in a column', () => {
    const board = createBoard()
    placeStones(board, [
      { row: 2, col: 5, color: 'white' },
      { row: 3, col: 5, color: 'white' },
      { row: 4, col: 5, color: 'white' },
      { row: 5, col: 5, color: 'white' },
      { row: 6, col: 5, color: 'white' },
    ])
    expect(checkWinner(board, 6, 5)).toBe('white')
  })

  it('returns winner when checking from first stone of vertical 5', () => {
    const board = createBoard()
    placeStones(board, [
      { row: 2, col: 5, color: 'black' },
      { row: 3, col: 5, color: 'black' },
      { row: 4, col: 5, color: 'black' },
      { row: 5, col: 5, color: 'black' },
      { row: 6, col: 5, color: 'black' },
    ])
    expect(checkWinner(board, 2, 5)).toBe('black')
  })

  it('returns null for 4 in a column', () => {
    const board = createBoard()
    placeStones(board, [
      { row: 3, col: 5, color: 'white' },
      { row: 4, col: 5, color: 'white' },
      { row: 5, col: 5, color: 'white' },
      { row: 6, col: 5, color: 'white' },
    ])
    expect(checkWinner(board, 6, 5)).toBeNull()
  })
})

describe('checkWinner — diagonal (\\)', () => {
  it('returns winner for 5 on main diagonal direction', () => {
    const board = createBoard()
    placeStones(board, [
      { row: 3, col: 3, color: 'black' },
      { row: 4, col: 4, color: 'black' },
      { row: 5, col: 5, color: 'black' },
      { row: 6, col: 6, color: 'black' },
      { row: 7, col: 7, color: 'black' },
    ])
    expect(checkWinner(board, 7, 7)).toBe('black')
  })

  it('returns winner when checking from the middle of diagonal', () => {
    const board = createBoard()
    placeStones(board, [
      { row: 3, col: 3, color: 'white' },
      { row: 4, col: 4, color: 'white' },
      { row: 5, col: 5, color: 'white' },
      { row: 6, col: 6, color: 'white' },
      { row: 7, col: 7, color: 'white' },
    ])
    expect(checkWinner(board, 5, 5)).toBe('white')
  })

  it('returns null for 4 on diagonal', () => {
    const board = createBoard()
    placeStones(board, [
      { row: 3, col: 3, color: 'black' },
      { row: 4, col: 4, color: 'black' },
      { row: 5, col: 5, color: 'black' },
      { row: 6, col: 6, color: 'black' },
    ])
    expect(checkWinner(board, 6, 6)).toBeNull()
  })
})

describe('checkWinner — anti-diagonal (/)', () => {
  it('returns winner for 5 on anti-diagonal', () => {
    const board = createBoard()
    placeStones(board, [
      { row: 3, col: 9, color: 'white' },
      { row: 4, col: 8, color: 'white' },
      { row: 5, col: 7, color: 'white' },
      { row: 6, col: 6, color: 'white' },
      { row: 7, col: 5, color: 'white' },
    ])
    expect(checkWinner(board, 7, 5)).toBe('white')
  })

  it('returns winner when checking from the middle of anti-diagonal', () => {
    const board = createBoard()
    placeStones(board, [
      { row: 3, col: 9, color: 'black' },
      { row: 4, col: 8, color: 'black' },
      { row: 5, col: 7, color: 'black' },
      { row: 6, col: 6, color: 'black' },
      { row: 7, col: 5, color: 'black' },
    ])
    expect(checkWinner(board, 5, 7)).toBe('black')
  })

  it('returns null for 4 on anti-diagonal', () => {
    const board = createBoard()
    placeStones(board, [
      { row: 4, col: 8, color: 'white' },
      { row: 5, col: 7, color: 'white' },
      { row: 6, col: 6, color: 'white' },
      { row: 7, col: 5, color: 'white' },
    ])
    expect(checkWinner(board, 7, 5)).toBeNull()
  })
})

describe('checkWinner — no winner', () => {
  it('returns null for an empty cell', () => {
    const board = createBoard()
    expect(checkWinner(board, 7, 7)).toBeNull()
  })

  it('returns null for a single stone', () => {
    const board = createBoard()
    board[7][7] = 'black'
    expect(checkWinner(board, 7, 7)).toBeNull()
  })

  it('returns null for scattered stones of same color', () => {
    const board = createBoard()
    placeStones(board, [
      { row: 0, col: 0, color: 'black' },
      { row: 2, col: 2, color: 'black' },
      { row: 4, col: 4, color: 'black' },
      { row: 6, col: 6, color: 'black' },
      { row: 8, col: 8, color: 'black' },
    ])
    expect(checkWinner(board, 4, 4)).toBeNull()
  })

  it('returns null when 5 stones are broken by opponent stone', () => {
    const board = createBoard()
    placeStones(board, [
      { row: 7, col: 3, color: 'black' },
      { row: 7, col: 4, color: 'black' },
      { row: 7, col: 5, color: 'white' }, // breaks the line
      { row: 7, col: 6, color: 'black' },
      { row: 7, col: 7, color: 'black' },
    ])
    expect(checkWinner(board, 7, 7)).toBeNull()
  })

  it('returns null when 5 stones are broken by empty cell', () => {
    const board = createBoard()
    placeStones(board, [
      { row: 7, col: 3, color: 'black' },
      { row: 7, col: 4, color: 'black' },
      // col 5 is empty
      { row: 7, col: 6, color: 'black' },
      { row: 7, col: 7, color: 'black' },
      { row: 7, col: 8, color: 'black' },
    ])
    expect(checkWinner(board, 7, 7)).toBeNull()
  })
})

describe('checkWinner — edge cases', () => {
  it('detects win at top-left corner (horizontal)', () => {
    const board = createBoard()
    placeStones(board, [
      { row: 0, col: 0, color: 'black' },
      { row: 0, col: 1, color: 'black' },
      { row: 0, col: 2, color: 'black' },
      { row: 0, col: 3, color: 'black' },
      { row: 0, col: 4, color: 'black' },
    ])
    expect(checkWinner(board, 0, 0)).toBe('black')
  })

  it('detects win at bottom-right corner (horizontal)', () => {
    const board = createBoard()
    placeStones(board, [
      { row: 14, col: 10, color: 'white' },
      { row: 14, col: 11, color: 'white' },
      { row: 14, col: 12, color: 'white' },
      { row: 14, col: 13, color: 'white' },
      { row: 14, col: 14, color: 'white' },
    ])
    expect(checkWinner(board, 14, 14)).toBe('white')
  })

  it('detects win along the top edge (vertical from row 0)', () => {
    const board = createBoard()
    placeStones(board, [
      { row: 0, col: 7, color: 'black' },
      { row: 1, col: 7, color: 'black' },
      { row: 2, col: 7, color: 'black' },
      { row: 3, col: 7, color: 'black' },
      { row: 4, col: 7, color: 'black' },
    ])
    expect(checkWinner(board, 0, 7)).toBe('black')
  })

  it('detects win along the right edge (vertical at col 14)', () => {
    const board = createBoard()
    placeStones(board, [
      { row: 5, col: 14, color: 'white' },
      { row: 6, col: 14, color: 'white' },
      { row: 7, col: 14, color: 'white' },
      { row: 8, col: 14, color: 'white' },
      { row: 9, col: 14, color: 'white' },
    ])
    expect(checkWinner(board, 7, 14)).toBe('white')
  })

  it('detects win spanning both directions from placed stone', () => {
    // Place stone in the middle to complete a line: 2 on left + placed + 2 on right = 5
    const board = createBoard()
    placeStones(board, [
      { row: 7, col: 3, color: 'black' },
      { row: 7, col: 4, color: 'black' },
      { row: 7, col: 5, color: 'black' }, // the placed stone
      { row: 7, col: 6, color: 'black' },
      { row: 7, col: 7, color: 'black' },
    ])
    // Check from the middle stone — should still detect 5 in a row
    expect(checkWinner(board, 7, 5)).toBe('black')
  })

  it('detects win with 3 forward + 1 backward from placed stone', () => {
    // 1 stone before, placed stone, 3 stones after = 5 total
    const board = createBoard()
    placeStones(board, [
      { row: 7, col: 4, color: 'white' },
      { row: 7, col: 5, color: 'white' }, // placed stone
      { row: 7, col: 6, color: 'white' },
      { row: 7, col: 7, color: 'white' },
      { row: 7, col: 8, color: 'white' },
    ])
    expect(checkWinner(board, 7, 5)).toBe('white')
  })

  it('detects diagonal win touching corner (0,0 to 4,4)', () => {
    const board = createBoard()
    placeStones(board, [
      { row: 0, col: 0, color: 'black' },
      { row: 1, col: 1, color: 'black' },
      { row: 2, col: 2, color: 'black' },
      { row: 3, col: 3, color: 'black' },
      { row: 4, col: 4, color: 'black' },
    ])
    expect(checkWinner(board, 2, 2)).toBe('black')
  })

  it('detects anti-diagonal win touching bottom-left corner', () => {
    const board = createBoard()
    placeStones(board, [
      { row: 10, col: 4, color: 'white' },
      { row: 11, col: 3, color: 'white' },
      { row: 12, col: 2, color: 'white' },
      { row: 13, col: 1, color: 'white' },
      { row: 14, col: 0, color: 'white' },
    ])
    expect(checkWinner(board, 14, 0)).toBe('white')
  })
})

describe('checkWinner — exactly 5 (overline)', () => {
  it('6 in a row horizontally counts as win', () => {
    const board = createBoard()
    placeStones(board, [
      { row: 7, col: 2, color: 'black' },
      { row: 7, col: 3, color: 'black' },
      { row: 7, col: 4, color: 'black' },
      { row: 7, col: 5, color: 'black' },
      { row: 7, col: 6, color: 'black' },
      { row: 7, col: 7, color: 'black' },
    ])
    expect(checkWinner(board, 7, 5)).toBe('black')
  })

  it('7 in a row vertically counts as win', () => {
    const board = createBoard()
    for (let i = 0; i < 7; i++) {
      board[i][7] = 'white'
    }
    expect(checkWinner(board, 3, 7)).toBe('white')
  })

  it('6 on diagonal counts as win', () => {
    const board = createBoard()
    for (let i = 0; i < 6; i++) {
      board[2 + i][2 + i] = 'black'
    }
    expect(checkWinner(board, 5, 5)).toBe('black')
  })
})

describe('boardFromMoves', () => {
  it('returns empty board for empty string', () => {
    const board = boardFromMoves('')
    for (let r = 0; r < BOARD_SIZE; r++) {
      for (let c = 0; c < BOARD_SIZE; c++) {
        expect(board[r][c]).toBeNull()
      }
    }
  })

  it('places a single black stone correctly', () => {
    const board = boardFromMoves('7,7,black')
    expect(board[7][7]).toBe('black')
  })

  it('places multiple stones from semicolon-separated string', () => {
    const board = boardFromMoves('0,0,black;1,1,white;2,2,black')
    expect(board[0][0]).toBe('black')
    expect(board[1][1]).toBe('white')
    expect(board[2][2]).toBe('black')
  })

  it('leaves other cells null after placing stones', () => {
    const board = boardFromMoves('7,7,black;8,8,white')
    expect(board[7][7]).toBe('black')
    expect(board[8][8]).toBe('white')
    expect(board[0][0]).toBeNull()
    expect(board[14][14]).toBeNull()
  })

  it('handles edge positions correctly', () => {
    const board = boardFromMoves('0,0,black;14,14,white;0,14,black;14,0,white')
    expect(board[0][0]).toBe('black')
    expect(board[14][14]).toBe('white')
    expect(board[0][14]).toBe('black')
    expect(board[14][0]).toBe('white')
  })
})

describe('movesToString', () => {
  it('returns empty string for empty moves array', () => {
    expect(movesToString([])).toBe('')
  })

  it('serializes a single move', () => {
    const result = movesToString([{ row: 7, col: 7, color: 'black' }])
    expect(result).toBe('7,7,black')
  })

  it('serializes multiple moves separated by semicolons', () => {
    const result = movesToString([
      { row: 0, col: 0, color: 'black' },
      { row: 1, col: 1, color: 'white' },
      { row: 2, col: 2, color: 'black' },
    ])
    expect(result).toBe('0,0,black;1,1,white;2,2,black')
  })

  it('round-trips with boardFromMoves', () => {
    const moves = [
      { row: 7, col: 7, color: 'black' as Stone },
      { row: 8, col: 8, color: 'white' as Stone },
      { row: 3, col: 5, color: 'black' as Stone },
    ]
    const str = movesToString(moves)
    const board = boardFromMoves(str)
    expect(board[7][7]).toBe('black')
    expect(board[8][8]).toBe('white')
    expect(board[3][5]).toBe('black')
  })

  it('preserves move order in serialization', () => {
    const moves = [
      { row: 14, col: 0, color: 'white' as Stone },
      { row: 0, col: 14, color: 'black' as Stone },
    ]
    const result = movesToString(moves)
    expect(result).toBe('14,0,white;0,14,black')
  })
})
