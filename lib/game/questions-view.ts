import type {
  ActiveDare,
  GameView,
  ThirtySixQuestionsProjection,
} from '@/lib/socket/events'

/**
 * 36 Questions, client side.
 *
 * Same two-layer shape as Mr. White: `GameView` is game-agnostic and carries
 * the roster, who may act and the clock; `state` inside it is whatever that
 * game's `viewFor` produced. `asQuestions` joins the two once so components do
 * not each reassemble them, and returns null for anything that is not a 36
 * Questions view — which is also the type guard that stops a Tic-Tac-Toe
 * payload being read as a question card.
 */

export interface QuestionsPlayer {
  sessionId: string
  nickname: string
}

export interface QuestionsTable extends ThirtySixQuestionsProjection {
  version: number
  players: QuestionsPlayer[]
  /** Who may act. Both players normally; the partner alone during a dare. */
  actors: string[]
  finished: boolean
  result: { winnerSessionIds: string[]; reason: 'win' | 'draw' | 'forfeit' } | null
  disconnected: Record<string, number>
  serverNow: number
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === 'object' && value !== null
}

export function asQuestions(view: GameView | null): QuestionsTable | null {
  if (!view || view.gameId !== 'thirty-six-questions') return null
  if (!isRecord(view.state)) return null

  const projection = view.state
  // `question` is legitimately null once the set is finished, so its presence
  // cannot be the guard — the index is what always exists.
  if (typeof projection['questionIndex'] !== 'number') return null
  if (typeof projection['totalQuestions'] !== 'number') return null

  return {
    ...(projection as unknown as ThirtySixQuestionsProjection),
    version: view.version,
    players: view.players,
    actors: view.actors,
    finished: view.finished,
    result: view.result,
    // `?? {}` for a server that has not been redeployed yet: a missing field
    // must read as "nobody is missing", not crash the room.
    disconnected: view.disconnected ?? {},
    serverNow: view.serverNow,
  }
}

// --- Derivations -----------------------------------------------------------

/** How many refusals this player has left. Zero for an unknown session. */
export function vetosLeft(table: QuestionsTable, sessionId: string | null): number {
  if (!sessionId) return 0
  return table.vetosRemaining[sessionId] ?? 0
}

/** Whether this viewer is the one currently performing a dare. */
export function isPerformer(dare: ActiveDare | null, sessionId: string | null): boolean {
  return Boolean(dare && sessionId && dare.sessionId === sessionId)
}

/**
 * Whether this viewer holds the card and reads the question aloud.
 *
 * Read this rather than testing `question !== null`: the two agree today, but
 * the question is also null once the deck is finished, and conflating "not your
 * turn" with "we are done" puts the wrong copy on the last screen of the game.
 */
export function isMyTurn(table: QuestionsTable, sessionId: string | null): boolean {
  return Boolean(sessionId && table.activeTurn === sessionId)
}

/** Whoever is holding the card, for "It's X's turn to ask". */
export function askerNickname(table: QuestionsTable): string {
  return table.activeTurn ? nicknameOf(table, table.activeTurn) : 'They'
}

/** The other seat, for "Watching [name] do their dare...". */
export function partnerOf(
  table: QuestionsTable,
  sessionId: string | null,
): QuestionsPlayer | null {
  return table.players.find((player) => player.sessionId !== sessionId) ?? null
}

export function nicknameOf(table: QuestionsTable, sessionId: string): string {
  return table.players.find((player) => player.sessionId === sessionId)?.nickname ?? 'They'
}

/**
 * Progress through the set, 0–1.
 *
 * Guarded against a zero denominator: `totalQuestions` comes off the wire, and
 * a malformed payload dividing by zero would render `NaN%` as a bar width.
 */
export function progressOf(table: QuestionsTable): number {
  if (table.totalQuestions <= 0) return 0
  return Math.min(1, table.questionIndex / table.totalQuestions)
}

/** Labels for the three escalating sets. */
export const SET_LABEL: Record<1 | 2 | 3, string> = {
  1: 'Set one · warming up',
  2: 'Set two · going deeper',
  3: 'Set three · most honest',
}
