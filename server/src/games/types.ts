/**
 * The generic board-game contract.
 *
 * A game is a pure set of rules: given a state and a proposed move, decide
 * whether it is legal and what the next state is. It knows nothing about
 * Redis, sockets or rooms — the engine (game-engine.ts) owns all of that.
 * That split is what lets a new game be added without touching transport code.
 *
 * SERVER AUTHORITY: clients submit *intent* only ("cell 4"), never state. The
 * server is the sole writer. A client that lies about whose turn it is, or
 * fabricates a board, changes nothing — its move is validated against the
 * stored state before anything is applied.
 *
 * NOTE ON DECLARATION STYLE: every member below is declared with method
 * shorthand rather than an arrow property. That makes the parameters bivariant,
 * which is what allows a concrete `GameDefinition<TicTacToeState, CellMove>` to
 * live in a registry typed as `GameDefinition<unknown, unknown>` without `any`.
 */

export interface GamePlayer {
  /** Stable anonymous identity. This is what the rules key off. */
  sessionId: string
  /**
   * Current socket. Changes on reconnect, so it is an addressing detail only —
   * never use it to identify a player inside game rules.
   */
  socketId: string
  nickname: string
}

export interface GameResult {
  /** Winning player's sessionId, or null for a draw. */
  winnerSessionId: string | null
  reason: 'win' | 'draw' | 'forfeit'
}

export type MoveValidation<M> =
  | { ok: true; move: M }
  | { ok: false; reason: string }

export interface GameDefinition<S, M> {
  readonly id: string
  readonly label: string
  readonly minPlayers: number
  readonly maxPlayers: number

  /** Build the opening position. Player order is fixed here. */
  createInitialState(players: GamePlayer[]): S

  /** sessionId of whoever may move next, or null when the game is over. */
  currentTurn(state: S): string | null

  /**
   * Decide whether `raw` (untrusted client input) is a legal move right now.
   *
   * Must check turn order, shape, and rule legality. Returning `ok: false` with
   * a specific reason is what lets the UI explain the rejection instead of
   * silently ignoring the click.
   */
  validateMove(state: S, sessionId: string, raw: unknown): MoveValidation<M>

  /** Apply an already-validated move. Must be pure — no mutation of `state`. */
  applyMove(state: S, sessionId: string, move: M): S

  /** Terminal result, or null while the game is still running. */
  result(state: S): GameResult | null

  /** End a running game early, e.g. when an opponent disconnects. */
  forfeit(state: S, quittingSessionId: string): S

  /**
   * Project the state for one viewer.
   *
   * THIS IS THE ANTI-CHEAT SEAM. Werewolf and Mr. White depend on it: roles and
   * the secret word must be stripped for everyone except their owner, because
   * anything sent to the browser can be read in devtools regardless of what the
   * UI chooses to render. Tic-Tac-Toe has no hidden information, so its
   * implementation returns the state unchanged — but the seam exists so hidden
   * information is the default shape, not a retrofit.
   *
   * `sessionId` is null for observers.
   */
  viewFor(state: S, sessionId: string | null): unknown
}

/**
 * A game definition with its type parameters erased, for storage in the
 * registry. Safe because of the bivariance note above.
 */
export type AnyGameDefinition = GameDefinition<unknown, unknown>

/** What the engine persists in Redis for a room. */
export interface StoredGame {
  gameId: string
  /**
   * Incremented on every write. The engine uses it for compare-and-set so two
   * moves arriving at once cannot both apply to the same base state.
   */
  version: number
  players: GamePlayer[]
  state: unknown
  startedAt: string
  /**
   * Explicit boolean rather than a nullable timestamp: the Lua start script
   * has to test this, and Redis' cjson decodes JSON null to a *truthy*
   * lightuserdata, so `not finishedAt` would be wrong inside the script.
   */
  finished: boolean
  result: GameResult | null
}

/** What a client receives. Never contains another player's hidden state. */
export interface GameView {
  gameId: string
  label: string
  version: number
  players: Array<Pick<GamePlayer, 'sessionId' | 'nickname'>>
  /** sessionId whose turn it is, or null when finished. */
  currentTurn: string | null
  finished: boolean
  result: GameResult | null
  state: unknown
}
