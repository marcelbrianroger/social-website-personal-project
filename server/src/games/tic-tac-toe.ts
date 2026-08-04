import type {
  ChatAudience,
  GameDefinition,
  GamePlayer,
  GameResult,
} from './types.js'

/**
 * Tic-Tac-Toe — the proof-of-concept implementation of the generic contract.
 *
 * Chosen because the rules are trivial, which keeps the interesting parts
 * visible: every move is validated server-side against stored state, and the
 * client can do nothing but propose a cell index.
 */

export type Mark = 'X' | 'O'

export interface TicTacToeState {
  /** Row-major, length 9. */
  board: (Mark | null)[]
  /** sessionIds in play order. Index 0 plays X and moves first. */
  order: string[]
  /** Index into `order` for whoever moves next. */
  turn: number
  winnerSessionId: string | null
  /** Board indices forming the winning line, for UI highlighting. */
  winningLine: number[] | null
  draw: boolean
  /** Set when the game ended because someone walked away. */
  forfeitedBy: string | null
}

export interface CellMove {
  cell: number
}

const LINES: number[][] = [
  [0, 1, 2],
  [3, 4, 5],
  [6, 7, 8],
  [0, 3, 6],
  [1, 4, 7],
  [2, 5, 8],
  [0, 4, 8],
  [2, 4, 6],
]

function markFor(state: TicTacToeState, sessionId: string): Mark | null {
  const index = state.order.indexOf(sessionId)
  if (index === -1) return null
  return index === 0 ? 'X' : 'O'
}

function findWinningLine(board: (Mark | null)[]): { mark: Mark; line: number[] } | null {
  for (const line of LINES) {
    const [a, b, c] = line as [number, number, number]
    const first = board[a]
    if (first && first === board[b] && first === board[c]) {
      return { mark: first, line }
    }
  }
  return null
}

export const ticTacToe: GameDefinition<TicTacToeState, CellMove> = {
  id: 'tic-tac-toe',
  label: 'Tic-Tac-Toe',
  minPlayers: 2,
  maxPlayers: 2,

  createInitialState(players: GamePlayer[]): TicTacToeState {
    return {
      board: Array.from({ length: 9 }, () => null),
      order: players.map((player) => player.sessionId),
      turn: 0,
      winnerSessionId: null,
      winningLine: null,
      draw: false,
      forfeitedBy: null,
    }
  },

  /**
   * Exactly one actor, or none once the game is over.
   *
   * The Phase 5 generalisation of `currentTurn`. Behaviour is unchanged — a
   * strictly sequential game simply returns a one-element list.
   */
  actors(state: TicTacToeState): string[] {
    if (state.winnerSessionId || state.draw || state.forfeitedBy) return []

    const mover = state.order[state.turn]
    return mover ? [mover] : []
  },

  /** Untimed. Nothing here expires, so nothing indexes into the sweeper. */
  deadline(): number | null {
    return null
  },

  /** Untimed, so there is never anything for the clock to advance. */
  tick(): TicTacToeState | null {
    return null
  },

  /** No table talk in Tic-Tac-Toe — there is nothing to deduce. */
  chatAudience(): ChatAudience {
    return { ok: false, reason: 'chat-not-supported' }
  },

  validateMove(state: TicTacToeState, sessionId: string, raw: unknown) {
    if (state.winnerSessionId || state.draw || state.forfeitedBy) {
      return { ok: false as const, reason: 'game-finished' }
    }

    if (!state.order.includes(sessionId)) {
      return { ok: false as const, reason: 'not-a-player' }
    }

    // Turn check comes before shape validation so an out-of-turn player gets
    // the more useful message.
    if (state.order[state.turn] !== sessionId) {
      return { ok: false as const, reason: 'not-your-turn' }
    }

    if (typeof raw !== 'object' || raw === null) {
      return { ok: false as const, reason: 'malformed-move' }
    }

    const cell = (raw as Record<string, unknown>)['cell']

    if (typeof cell !== 'number' || !Number.isInteger(cell) || cell < 0 || cell > 8) {
      return { ok: false as const, reason: 'cell-out-of-range' }
    }

    if (state.board[cell] !== null) {
      return { ok: false as const, reason: 'cell-taken' }
    }

    return { ok: true as const, move: { cell } }
  },

  applyMove(state: TicTacToeState, sessionId: string, move: CellMove): TicTacToeState {
    const mark = markFor(state, sessionId)
    // validateMove already proved membership; this keeps applyMove total.
    if (!mark) return state

    const board = [...state.board]
    board[move.cell] = mark

    const won = findWinningLine(board)
    const full = board.every((cell) => cell !== null)

    return {
      ...state,
      board,
      turn: (state.turn + 1) % state.order.length,
      winnerSessionId: won ? sessionId : null,
      winningLine: won ? won.line : null,
      draw: !won && full,
    }
  },

  /**
   * `team` is deliberately omitted rather than set to undefined: winning here is
   * individual, and an explicit `team: undefined` key would change the object's
   * shape under a deep-equality check.
   */
  result(state: TicTacToeState): GameResult | null {
    if (state.forfeitedBy) {
      const winner = state.order.find((id) => id !== state.forfeitedBy)
      return { winnerSessionIds: winner ? [winner] : [], reason: 'forfeit' }
    }
    if (state.winnerSessionId) {
      return { winnerSessionIds: [state.winnerSessionId], reason: 'win' }
    }
    if (state.draw) {
      return { winnerSessionIds: [], reason: 'draw' }
    }
    return null
  },

  forfeit(state: TicTacToeState, quittingSessionId: string): TicTacToeState {
    // A game that already ended keeps its original result.
    if (state.winnerSessionId || state.draw || state.forfeitedBy) return state
    return { ...state, forfeitedBy: quittingSessionId }
  },

  viewFor(state: TicTacToeState): unknown {
    // Tic-Tac-Toe is perfect information — every player may see everything, so
    // no redaction is needed. Games with hidden roles strip them here.
    return state
  },
}
