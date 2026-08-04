import type { GameView } from '@/lib/socket/events'

/**
 * Mr. White, client side.
 *
 * TWO SHAPES, because the wire has two layers. `GameView` is game-agnostic and
 * carries the roster, whose turn it is and the clock; `state` inside it is
 * whatever that game's `viewFor` produced, already redacted for this viewer.
 * `MrWhiteProjection` is that inner half.
 *
 * Components take the MERGED shape (`MrWhiteTable`), because splitting "the
 * phase" from "who may act in it" across two objects makes every consumer
 * reassemble them. `asMrWhite` does that join once, and returns null for
 * anything that is not a Mr. White view — which is also the type guard that
 * keeps a Tic-Tac-Toe payload from being read as a table.
 *
 * MIRRORS `server/src/games/mr-white.ts`. Note what is NOT here: `order`, and
 * `roles` before the game ends. The server never sends them, so there is
 * nothing to model — a civilian's payload does not contain the impostor's
 * sessionId at all.
 */

export type MrWhitePhase =
  | 'reveal'
  | 'clue'
  | 'discussion'
  | 'vote'
  | 'reveal-vote'
  | 'guess'
  | 'finished'

export type MrWhiteRole = 'civilian' | 'mr-white'

export type WinningTeam = 'civilians' | 'mr-white'

export interface MrWhitePlayer {
  sessionId: string
  nickname: string
  /** Seat index, derived from the roster's order. Fixes the clue rotation. */
  seat: number
}

export interface MrWhiteResult {
  winnerSessionIds: string[]
  team?: string
  reason: 'win' | 'draw' | 'forfeit'
}

/** The redacted half — exactly what `mrWhite.viewFor` returns. */
export interface MrWhiteProjection {
  phase: MrWhitePhase
  round: number
  phaseEndsAt: number
  eliminated: string[]
  clues: Record<string, string | null>
  /** `{}` during `vote` itself: a live tally is what causes bandwagoning. */
  votes: Record<string, string>
  /**
   * Living players who have said they are done arguing.
   *
   * Public, unlike `votes` — the running count is the entire point of the
   * button, and wanting to move on reveals nothing about anyone's role.
   */
  readyToVote: string[]
  lastEliminated: string | null
  guess: string | null
  /** This viewer's own role. null for an observer. */
  yourRole: MrWhiteRole | null
  /** Civilians only, until the game ends and it goes public. */
  secretWord: string | null
  /** Every role. null until `phase === 'finished'`. */
  roles: Record<string, MrWhiteRole> | null
}

/** `GameView` and its projection, joined. This is what components consume. */
export interface MrWhiteTable extends MrWhiteProjection {
  version: number
  players: MrWhitePlayer[]
  /** Who may act right now. Empty during reveal, discussion and reveal-vote. */
  actors: string[]
  finished: boolean
  result: MrWhiteResult | null
  /** Server epoch ms when this arrived, for clock-skew correction. */
  serverNow: number
}

// --- Narrowing -------------------------------------------------------------

const PHASES: readonly string[] = [
  'reveal',
  'clue',
  'discussion',
  'vote',
  'reveal-vote',
  'guess',
  'finished',
]

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === 'object' && value !== null
}

/**
 * Narrow a generic `GameView` to a Mr. White table.
 *
 * Returns null when this is some other game, or when the payload does not look
 * like one — the state field is typed `unknown` on purpose, and trusting it
 * because `gameId` matched would put a runtime crash one bad deploy away.
 */
export function asMrWhite(view: GameView | null): MrWhiteTable | null {
  if (!view || view.gameId !== 'mr-white') return null
  if (!isRecord(view.state)) return null

  const projection = view.state
  if (typeof projection['phase'] !== 'string') return null
  if (!PHASES.includes(projection['phase'])) return null

  return {
    ...(projection as unknown as MrWhiteProjection),
    version: view.version,
    // Roster order IS seat order: the server builds `players` from lobby
    // membership sorted by joinedAt.
    players: view.players.map((player, seat) => ({ ...player, seat })),
    actors: view.actors,
    finished: view.finished,
    result: view.result,
    serverNow: view.serverNow,
  }
}

// --- Labels ----------------------------------------------------------------

export const PHASE_LABEL: Record<MrWhitePhase, string> = {
  reveal: 'Role reveal',
  clue: 'Clue round',
  discussion: 'Discussion',
  vote: 'Voting',
  'reveal-vote': 'Votes revealed',
  guess: 'Final guess',
  finished: 'Finished',
}

/** The `[STATE]` line written into the transcript on entering each phase. */
export const PHASE_LOG: Record<MrWhitePhase, string> = {
  reveal: 'ROLES DEALT',
  clue: 'CLUE ROUND STARTED',
  discussion: 'DISCUSSION STARTED',
  vote: 'VOTING PHASE',
  'reveal-vote': 'VOTES REVEALED',
  guess: 'MR. WHITE MAY GUESS',
  finished: 'GAME OVER',
}

/**
 * Nominal phase lengths in seconds, from the design doc's phase table.
 *
 * DISPLAY ONLY — the denominator for the countdown bar and nothing else. The
 * server owns the clock; `phaseEndsAt` is the only value that decides whether a
 * move arrived in time.
 */
export const PHASE_SECONDS: Record<MrWhitePhase, number | null> = {
  reveal: 10,
  clue: 30,
  discussion: 90,
  vote: 45,
  'reveal-vote': 8,
  guess: 30,
  finished: null,
}

// --- Chat ------------------------------------------------------------------

/**
 * `lobby` is the pre-game and post-game channel; `table` is the living players
 * mid-game; `dead` only ever reaches eliminated players.
 */
export type ChatChannel = 'lobby' | 'table' | 'dead'

export interface ChatEntryMessage {
  kind: 'message'
  id: string
  from: string
  nickname: string
  body: string
  channel: string
  at: number
}

/**
 * A `[STATE] ...` line.
 *
 * Synthesised on the client from phase transitions — chat never enters game
 * state, so the server does not send these. Keeping them out of `ChatMessage`
 * means moderation and rate limiting never see a synthetic message.
 */
export interface ChatEntrySystem {
  kind: 'system'
  id: string
  text: string
  at: number
}

export type ChatEntry = ChatEntryMessage | ChatEntrySystem

/** Phases in which the server's `chatAudience` returns `ok: true`. */
export const CHAT_OPEN_PHASES: readonly MrWhitePhase[] = ['discussion', 'vote']

// --- Derivations -----------------------------------------------------------

export function isAlive(table: MrWhiteTable, sessionId: string): boolean {
  return !table.eliminated.includes(sessionId)
}

export function isActor(table: MrWhiteTable, sessionId: string): boolean {
  return table.actors.includes(sessionId)
}

/** Living players in seat order — the clue rotation and the vote roster. */
export function livingPlayers(table: MrWhiteTable): MrWhitePlayer[] {
  return table.players.filter((player) => isAlive(table, player.sessionId))
}

/**
 * Votes cast against each player.
 *
 * Empty during `vote`, because the server sends `{}` then by design. Do not try
 * to reconstruct a live tally from anything else.
 */
export function voteTally(table: MrWhiteTable): Record<string, number> {
  const tally: Record<string, number> = {}

  for (const target of Object.values(table.votes)) {
    tally[target] = (tally[target] ?? 0) + 1
  }

  return tally
}

/**
 * How many readiness votes it takes to cut the discussion short.
 *
 * A strict majority of the living: 3 of 4, 2 of 3, 3 of 5. Mirrors
 * `majorityReady` on the server — half the table wanting to move on is exactly
 * the split still worth arguing about, so a tie is not enough.
 */
export function readyThreshold(table: MrWhiteTable): number {
  return Math.floor(livingPlayers(table).length / 2) + 1
}

/**
 * Whether this viewer may type right now.
 *
 * Mirrors the server's rule rather than guessing: eliminated players always
 * have the `dead` channel, a lobby with no running game is open to everyone
 * seated, and mid-game it is discussion and voting only.
 */
export function canChat(
  table: MrWhiteTable | null,
  sessionId: string | null,
): boolean {
  if (!table) return true
  if (table.finished) return true
  if (sessionId && !isAlive(table, sessionId)) return true

  return CHAT_OPEN_PHASES.includes(table.phase)
}
