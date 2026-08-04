import type {
  ChatAudience,
  GameDefinition,
  GamePlayer,
  GameResult,
} from './types.js'

/**
 * Ultimate Tic-Tac-Toe — a 3×3 grid of 3×3 Tic-Tac-Toe boards.
 *
 * Win a local board and you own that square of the global board; own three
 * global squares in a line and you win the game.
 *
 * THE RULE THAT MAKES IT A GAME: the *cell* you take names the *local board*
 * your opponent must play in next. Taking cell 4 sends them to local board 4,
 * wherever you happened to be. So a move is never just "where do I want a
 * mark" — it is also "where am I willing to send them".
 *
 * The escape hatch is what most of the code below is about: if the board they
 * are sent to is already decided — won, or full with no line — there is nothing
 * to play for there, so the constraint lifts and they may choose any open
 * board. `activeBoardIndex: null` is that state, and it is also the opening
 * position, since the first move is unconstrained by definition.
 *
 * Everything is still validated server-side against stored state; the client
 * can do nothing but propose a (board, cell) pair.
 */

export type Mark = 'X' | 'O'

/**
 * What has become of one local board.
 *
 * `'draw'` is not cosmetic: a full board with no line belongs to nobody, but it
 * is just as closed as a won one, and it counts toward the grid being full. A
 * plain `Mark | null` would force every consumer to re-derive that from the
 * cells.
 */
export type BoardOutcome = Mark | 'draw' | null

export interface TicTacToeState {
  /** Nine local boards, each row-major and length 9. `boards[board][cell]`. */
  boards: (Mark | null)[][]
  /** Row-major, length 9. Who owns each local board. */
  globalBoard: BoardOutcome[]
  /** Per local board, the three cells that won it. For UI highlighting. */
  localWinningLines: (number[] | null)[]
  /**
   * The local board the mover MUST play in, or null for "any open board".
   *
   * Null is legitimate and common — it is the opening position, and it is what
   * happens every time a move points at a board that is already decided.
   */
  activeBoardIndex: number | null
  /** sessionIds in play order. Index 0 plays X and moves first. */
  order: string[]
  /** Index into `order` for whoever moves next. */
  turn: number
  winnerSessionId: string | null
  /** LOCAL BOARD indices forming the winning line, for UI highlighting. */
  winningLine: number[] | null
  draw: boolean
  /** Set when the game ended because someone walked away. */
  forfeitedBy: string | null
}

export interface CellMove {
  /** Which local board, 0–8. */
  board: number
  /** Which cell within that board, 0–8. Also names the next local board. */
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

function isFinished(state: TicTacToeState): boolean {
  return Boolean(state.winnerSessionId) || state.draw || Boolean(state.forfeitedBy)
}

/** Hand the game to whoever is left. A finished game keeps its result. */
function concede(state: TicTacToeState, quittingSessionId: string): TicTacToeState {
  if (isFinished(state)) return state
  return { ...state, forfeitedBy: quittingSessionId }
}

function isCoordinate(value: unknown): value is number {
  return typeof value === 'number' && Number.isInteger(value) && value >= 0 && value <= 8
}

/**
 * The three cells of the line `mark` completed, or null.
 *
 * Shared by both scales: `cells` is a local board's nine squares, or the global
 * board's nine local outcomes. `'draw'` never matches because it is filtered
 * out first — three drawn boards in a row are three boards nobody won, not a
 * win for somebody called "draw".
 */
function findWinningLine(cells: BoardOutcome[]): { mark: Mark; line: number[] } | null {
  for (const line of LINES) {
    const [a, b, c] = line as [number, number, number]
    const first = cells[a]
    if (first && first !== 'draw' && first === cells[b] && first === cells[c]) {
      return { mark: first, line }
    }
  }
  return null
}

/** Nothing left to play for here: won outright, or full with no line. */
function isDecided(state: TicTacToeState, board: number): boolean {
  return state.globalBoard[board] !== null
}

export const ticTacToe: GameDefinition<TicTacToeState, CellMove> = {
  id: 'tic-tac-toe',
  label: 'Ultimate Tic-Tac-Toe',
  minPlayers: 2,
  maxPlayers: 2,

  createInitialState(players: GamePlayer[]): TicTacToeState {
    return {
      boards: Array.from({ length: 9 }, () =>
        Array.from({ length: 9 }, () => null),
      ),
      globalBoard: Array.from({ length: 9 }, () => null),
      localWinningLines: Array.from({ length: 9 }, () => null),
      // The opening move goes anywhere — there is no previous cell to obey.
      activeBoardIndex: null,
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
    if (isFinished(state)) return []

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
    if (isFinished(state)) {
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

    const board = (raw as Record<string, unknown>)['board']
    const cell = (raw as Record<string, unknown>)['cell']

    if (!isCoordinate(board)) {
      return { ok: false as const, reason: 'board-out-of-range' }
    }

    if (!isCoordinate(cell)) {
      return { ok: false as const, reason: 'cell-out-of-range' }
    }

    // Being pinned outranks the board being decided: "you must play there" is
    // what the player can act on, and a pinned board is open by construction —
    // the constraint lifts the moment its target closes.
    if (state.activeBoardIndex !== null && board !== state.activeBoardIndex) {
      return { ok: false as const, reason: 'wrong-board' }
    }

    if (isDecided(state, board)) {
      return { ok: false as const, reason: 'board-closed' }
    }

    if (state.boards[board]?.[cell] !== null) {
      return { ok: false as const, reason: 'cell-taken' }
    }

    return { ok: true as const, move: { board, cell } }
  },

  applyMove(state: TicTacToeState, sessionId: string, move: CellMove): TicTacToeState {
    const mark = markFor(state, sessionId)
    // validateMove already proved membership; this keeps applyMove total.
    if (!mark) return state

    // The nested board is copied too — sharing it would let a stored state be
    // mutated out from under the engine's compare-and-set retry.
    const boards = [...state.boards]
    const local = [...(boards[move.board] ?? Array.from({ length: 9 }, () => null))]
    local[move.cell] = mark
    boards[move.board] = local

    const globalBoard = [...state.globalBoard]
    const localWinningLines = [...state.localWinningLines]

    // Only an undecided board can change hands, so a stray move into a settled
    // one could never rewrite its owner even if validation let it through.
    if (globalBoard[move.board] === null) {
      const localWin = findWinningLine(local)

      if (localWin) {
        globalBoard[move.board] = localWin.mark
        localWinningLines[move.board] = localWin.line
      } else if (local.every((cell) => cell !== null)) {
        globalBoard[move.board] = 'draw'
      }
    }

    const won = findWinningLine(globalBoard)
    const gridFull = globalBoard.every((outcome) => outcome !== null)
    const finished = Boolean(won) || gridFull

    // The cell just taken names the next local board — unless there is nothing
    // left to play for there, in which case the next player goes anywhere.
    const target = move.cell
    const activeBoardIndex =
      finished || globalBoard[target] !== null ? null : target

    return {
      ...state,
      boards,
      globalBoard,
      localWinningLines,
      activeBoardIndex,
      turn: (state.turn + 1) % state.order.length,
      winnerSessionId: won ? sessionId : null,
      winningLine: won ? won.line : null,
      draw: !won && gridFull,
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
    return concede(state, quittingSessionId)
  },

  /**
   * With exactly two players, losing one IS the end — there is no game left to
   * repair, so this is `forfeit` under another name. The distinction only earns
   * its keep in a game where the table outlives the departure.
   */
  eliminate(state: TicTacToeState, sessionId: string): TicTacToeState {
    return concede(state, sessionId)
  },

  viewFor(state: TicTacToeState): unknown {
    // Ultimate Tic-Tac-Toe is perfect information — every player may see
    // everything, so no redaction is needed. Games with hidden roles strip
    // them here.
    return state
  },
}
