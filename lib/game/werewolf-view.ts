import type { GameView } from '@/lib/socket/events'

/**
 * Werewolf, client side.
 *
 * TWO SHAPES, because the wire has two layers. `GameView` is game-agnostic and
 * carries the roster, whose turn it is and the clock; `state` inside it is
 * whatever that game's `viewFor` produced, already redacted for this viewer.
 * `WerewolfProjection` is that inner half. Components take the MERGED shape
 * (`WerewolfTable`), because splitting "the phase" from "who may act in it"
 * across two objects makes every consumer reassemble them. `asWerewolf` does
 * that join once, and is also the type guard that keeps a Tic-Tac-Toe payload
 * from being read as a table.
 *
 * MIRRORS `server/src/games/werewolf.ts`. Note what is NOT here: `order`, and
 * the full `roles` map. The server never sends either, so there is nothing to
 * model — a villager's payload does not contain a single wolf's sessionId.
 *
 * THE OPTIONAL-LOOKING FIELDS ARE NOT OPTIONAL, THEY ARE EMPTY. `inspections`
 * arrives as `{}` for everyone who is not the Seer and `packmates` as `[]` for
 * everyone who is not a wolf. That is the server's redaction, not a loading
 * state: there is no request the client could make that would fill them in.
 */

export type WerewolfPhase =
  | 'reveal'
  | 'night'
  | 'dawn'
  | 'day'
  | 'vote'
  | 'verdict'
  | 'finished'

export type WerewolfRole = 'werewolf' | 'seer' | 'guard' | 'villager'

/** What the Seer reads. Alignment only — never the exact role. */
export type Alignment = 'werewolf' | 'village'

export type WinningTeam = 'werewolves' | 'village'

export interface WerewolfPlayer {
  sessionId: string
  nickname: string
  /** Seat index, derived from the roster's order. */
  seat: number
}

export interface WerewolfResult {
  winnerSessionIds: string[]
  team?: string
  reason: 'win' | 'draw' | 'forfeit'
}

/** The redacted half — exactly what `werewolf.viewFor` returns. */
export interface WerewolfProjection {
  phase: WerewolfPhase
  /** 1-based. `0` during `reveal`, before the first night opens. */
  night: number
  phaseEndsAt: number
  dead: string[]

  /** Who the pack took last night. null when nobody died. */
  lastKilled: string | null
  /** Whether the Guard's shield is why nobody died. */
  lastSaved: boolean
  /** Who the last vote hanged. null after a tie, which takes nobody. */
  lastLynched: string | null

  /** `{}` during `vote` itself: a live tally is what causes bandwagoning. */
  votes: Record<string, string>
  /** Public, unlike `votes` — the running count is the point of the button. */
  readyToVote: string[]
  /** The dead, and everyone once the game ends. The only public role data. */
  revealedRoles: Record<string, WerewolfRole>

  /** This viewer's own role. null for an observer. */
  yourRole: WerewolfRole | null
  /** The other wolves. `[]` for everyone who is not one. */
  packmates: string[]
  /** The pack's live kill vote. `{}` for everyone who is not a wolf. */
  wolfVotes: Record<string, string>

  /** The Seer's ledger of readings. `{}` for everyone else. */
  inspections: Record<string, Alignment>
  /** Who the Seer looked at tonight. null for everyone else. */
  seerTarget: string | null

  /** Who the Guard covered tonight. null for everyone else. */
  guardTarget: string | null
  /** Who the Guard covered last night, and so may not cover again. */
  lastProtected: string | null
}

/** `GameView` and its projection, joined. This is what components consume. */
export interface WerewolfTable extends WerewolfProjection {
  version: number
  players: WerewolfPlayer[]
  /** Who may act right now. The night's roles, or the living during a vote. */
  actors: string[]
  finished: boolean
  result: WerewolfResult | null
  /**
   * Players who have dropped, mapped to the epoch ms at which the game gives up
   * on them. Comes from `GameView`, not the projection — presence is a property
   * of the connection, not of the rules.
   */
  disconnected: Record<string, number>
  /** Server epoch ms when this arrived, for clock-skew correction. */
  serverNow: number
}

// --- Narrowing -------------------------------------------------------------

const PHASES: readonly string[] = [
  'reveal',
  'night',
  'dawn',
  'day',
  'vote',
  'verdict',
  'finished',
]

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === 'object' && value !== null
}

/**
 * Narrow a generic `GameView` to a Werewolf table.
 *
 * Returns null when this is some other game, or when the payload does not look
 * like one — `state` is typed `unknown` on purpose, and trusting it because
 * `gameId` matched would put a runtime crash one bad deploy away.
 */
export function asWerewolf(view: GameView | null): WerewolfTable | null {
  if (!view || view.gameId !== 'werewolf') return null
  if (!isRecord(view.state)) return null

  const projection = view.state
  if (typeof projection['phase'] !== 'string') return null
  if (!PHASES.includes(projection['phase'])) return null

  return {
    ...(projection as unknown as WerewolfProjection),
    version: view.version,
    // Roster order IS seat order: the server builds `players` from lobby
    // membership sorted by joinedAt.
    players: view.players.map((player, seat) => ({ ...player, seat })),
    actors: view.actors,
    finished: view.finished,
    result: view.result,
    // `?? {}` for a server that has not been redeployed yet — a missing field
    // must read as "nobody is missing", not crash the table.
    disconnected: view.disconnected ?? {},
    serverNow: view.serverNow,
  }
}

// --- Labels ----------------------------------------------------------------

export const PHASE_LABEL: Record<WerewolfPhase, string> = {
  reveal: 'Roles dealt',
  night: 'Night',
  dawn: 'Dawn',
  day: 'Discussion',
  vote: 'Voting',
  verdict: 'Verdict',
  finished: 'Finished',
}

export const ROLE_LABEL: Record<WerewolfRole, string> = {
  werewolf: 'Werewolf',
  seer: 'Seer',
  guard: 'Guard',
  villager: 'Villager',
}

/** One line telling a player what their role is actually for. */
export const ROLE_BRIEF: Record<WerewolfRole, string> = {
  werewolf:
    'Every night the pack eats one person. By day you are an ordinary villager, until somebody starts wondering.',
  seer: 'Every night you may read one person: werewolf or not. Do not be in a hurry to say so out loud.',
  guard:
    'Every night you may cover one person from the pack. Never the same person two nights running.',
  villager:
    'You have no special power. Only your vote, and that is enough.',
}

/**
 * Nominal phase lengths in seconds.
 *
 * DISPLAY ONLY — the denominator for the countdown bar and nothing else. The
 * server owns the clock; `phaseEndsAt` is the only value that decides whether a
 * move arrived in time.
 */
export const PHASE_SECONDS: Record<WerewolfPhase, number | null> = {
  reveal: 10,
  night: 45,
  dawn: 8,
  day: 90,
  vote: 45,
  verdict: 8,
  finished: null,
}

// --- Chat ------------------------------------------------------------------

/**
 * `table` is the living mid-day, `pack` only ever reaches living wolves at
 * night, and `dead` only ever reaches the eliminated.
 */
export type ChatChannel = 'table' | 'pack' | 'dead'

/** Phases in which a living villager's `chatAudience` returns `ok: true`. */
export const CHAT_OPEN_PHASES: readonly WerewolfPhase[] = ['day', 'vote']

// --- Derivations -----------------------------------------------------------

export function isAlive(table: WerewolfTable, sessionId: string): boolean {
  return !table.dead.includes(sessionId)
}

export function isActor(table: WerewolfTable, sessionId: string): boolean {
  return table.actors.includes(sessionId)
}

export function nicknameOf(
  table: WerewolfTable,
  sessionId: string | null | undefined,
): string | null {
  if (!sessionId) return null
  return (
    table.players.find((player) => player.sessionId === sessionId)?.nickname ??
    null
  )
}

/** Living players in seat order — the night's menu and the vote roster. */
export function livingPlayers(table: WerewolfTable): WerewolfPlayer[] {
  return table.players.filter((player) => isAlive(table, player.sessionId))
}

/**
 * Epoch ms at which a missing player is auto-eliminated, or null if they are
 * here. Only ever set for the living.
 */
export function reconnectingUntil(
  table: WerewolfTable,
  sessionId: string,
): number | null {
  return table.disconnected[sessionId] ?? null
}

/**
 * Day votes cast against each player.
 *
 * Empty during `vote`, because the server sends `{}` then by design. Do not try
 * to reconstruct a live tally from anything else.
 */
export function voteTally(table: WerewolfTable): Record<string, number> {
  const tally: Record<string, number> = {}

  for (const target of Object.values(table.votes)) {
    tally[target] = (tally[target] ?? 0) + 1
  }

  return tally
}

/**
 * The pack's live kill vote, per victim.
 *
 * Non-empty for wolves only — `wolfVotes` is `{}` in everyone else's payload,
 * so this is `{}` for them too rather than something to be hidden in the UI.
 */
export function packTally(table: WerewolfTable): Record<string, number> {
  const tally: Record<string, number> = {}

  for (const target of Object.values(table.wolfVotes)) {
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
export function readyThreshold(table: WerewolfTable): number {
  return Math.floor(livingPlayers(table).length / 2) + 1
}

/**
 * The move this viewer owes tonight, or null if they have nothing to do.
 *
 * Derived from the role rather than from `actors`, because the panel needs to
 * know WHICH control to draw, not merely whether to draw one.
 */
export function nightAction(
  table: WerewolfTable,
  sessionId: string | null,
): 'kill' | 'inspect' | 'protect' | null {
  if (!sessionId || table.phase !== 'night') return null
  if (!isAlive(table, sessionId)) return null

  switch (table.yourRole) {
    case 'werewolf':
      return 'kill'
    case 'seer':
      return 'inspect'
    case 'guard':
      return 'protect'
    default:
      return null
  }
}

/** What this viewer already submitted tonight, or null. */
export function nightChoice(
  table: WerewolfTable,
  sessionId: string | null,
): string | null {
  if (!sessionId) return null

  switch (table.yourRole) {
    case 'werewolf':
      return table.wolfVotes[sessionId] ?? null
    case 'seer':
      return table.seerTarget
    case 'guard':
      return table.guardTarget
    default:
      return null
  }
}

/**
 * Whether `target` is a legal night target for this viewer.
 *
 * Mirrors `validateMove` so the UI can grey out what the server would refuse.
 * A HINT ONLY — every click is still sent and the server is the sole judge,
 * because anything enforced in the browser can be bypassed from devtools.
 */
export function canTargetTonight(
  table: WerewolfTable,
  sessionId: string | null,
  target: string,
): boolean {
  const action = nightAction(table, sessionId)
  if (!action || !isAlive(table, target)) return false

  switch (action) {
    // The pack does not eat its own.
    case 'kill':
      return !table.packmates.includes(target) && target !== sessionId
    // Reading yourself tells you nothing, and a reading you already have is a
    // wasted night.
    case 'inspect':
      return target !== sessionId && !(target in table.inspections)
    // No two nights running, or one player would simply be immortal.
    case 'protect':
      return target !== table.lastProtected
    default:
      return false
  }
}

/**
 * Whether this viewer may type right now.
 *
 * Mirrors the server's rule rather than guessing: the eliminated always have
 * the `dead` channel, wolves have the `pack` channel at night, and everyone
 * living has the table during the day and the vote.
 */
export function canChat(
  table: WerewolfTable | null,
  sessionId: string | null,
): boolean {
  if (!table) return true
  if (table.finished) return true
  if (sessionId && !isAlive(table, sessionId)) return true
  if (table.phase === 'night') return table.yourRole === 'werewolf'

  return CHAT_OPEN_PHASES.includes(table.phase)
}
