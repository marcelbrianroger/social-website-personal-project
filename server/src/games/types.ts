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
  /**
   * Everyone who won. Empty for a draw, or for a game nobody won.
   *
   * A list rather than a single id because social-deduction games are won by a
   * TEAM: "the civilians" is three or four sessionIds, not one.
   */
  winnerSessionIds: string[]
  /** Which side won, for team games. Absent when winning is individual. */
  team?: string
  reason: 'win' | 'draw' | 'forfeit'
}

export type MoveValidation<M> =
  | { ok: true; move: M }
  | { ok: false; reason: string }

/**
 * Who may hear a chat message.
 *
 * The rules decide, not the transport — a dead player talking to other dead
 * players and a living table talking openly are the same event with different
 * audiences. The engine resolves `to` (sessionIds) to sockets and emits per
 * recipient, exactly as `game:state` already does.
 *
 * Chat never enters game state, never bumps the version, and is never
 * persisted.
 */
export type ChatAudience =
  | { ok: true; channel: string; to: string[] }
  | { ok: false; reason: string }

export interface GameDefinition<S, M> {
  readonly id: string
  readonly label: string
  readonly minPlayers: number
  readonly maxPlayers: number

  /** Build the opening position. Player order is fixed here. */
  createInitialState(players: GamePlayer[]): S

  /**
   * Everyone who may act right now.
   *
   * One concept covering sequential and simultaneous play: Tic-Tac-Toe returns
   * the single player whose turn it is, a vote phase returns every living
   * player, and a discussion phase returns nobody. The alternative — a
   * `currentTurn` for turn-based games plus a parallel path for simultaneous
   * ones — would fork every consumer in the engine.
   *
   * Empty means "nobody may move", which is legal only while something else can
   * still advance the game (see `deadline`).
   */
  actors(state: S): string[]

  /**
   * Epoch ms at which the current phase ends, or null if it is untimed.
   *
   * The engine indexes this in a Redis sorted set so the deadline sweeper can
   * find games that are actually due, rather than polling every running game.
   * Storing the deadline as data — not as a live `setTimeout` — is also what
   * makes it survive a process restart.
   */
  deadline(state: S): number | null

  /**
   * Advance a phase whose deadline has passed. MUST be pure.
   *
   * Returns the next state, or null when there is nothing to do. The null is
   * load-bearing: two nodes can sweep the same due game at the same moment, and
   * the one that loses the compare-and-set re-reads and ticks again. It has to
   * find nothing left to do, or the phase would advance twice.
   */
  tick(state: S, now: number): S | null

  /**
   * Who may hear a chat message from `sessionId` right now.
   *
   * Lives on the definition because the audience is a rule: the same message is
   * public during discussion, restricted to the dead after elimination, and
   * refused outright during a clue round.
   */
  chatAudience(state: S, sessionId: string): ChatAudience

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
  /** sessionIds who may act right now. Empty when nobody may, or when finished. */
  actors: string[]
  finished: boolean
  result: GameResult | null
  state: unknown
  /** Epoch ms the current phase ends, or null when untimed. */
  phaseEndsAt: number | null
  /**
   * Server epoch ms at the moment this view was built.
   *
   * A browser clock can be minutes out, so `phaseEndsAt` compared against a raw
   * client `Date.now()` shows the wrong number — negative on a fast clock,
   * which reads as "time's up" while the server is still accepting moves. The
   * client pins `offset = serverNow - Date.now()` once per push and renders
   * against that.
   */
  serverNow: number
}
