import type { TableSeat, TableSummary } from '@/lib/game/table-view'
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
 * arrives as `{}` for everyone who is not the Seer, `packmates` as `[]` for
 * everyone who is not a wolf, and `pendingKill` as null for everyone who is not
 * the Witch standing in her own phase. That is the server's redaction, not a
 * loading state: there is no request the client could make that would fill them
 * in.
 */

export type WerewolfPhase =
  | 'reveal'
  /** Cupid's one and only beat. Skipped entirely at sizes with no Cupid. */
  | 'nightZero'
  | 'night'
  /** The Witch alone, after the pack has settled on somebody. */
  | 'witch'
  | 'dawn'
  /** A dead Hunter taking one more person with them. */
  | 'revenge'
  | 'day'
  | 'vote'
  | 'verdict'
  | 'finished'

export type WerewolfRole =
  | 'werewolf'
  | 'seer'
  | 'guard'
  | 'witch'
  | 'hunter'
  | 'cupid'
  | 'jester'
  | 'villager'

/** What the Seer reads. Alignment only — never the exact role. */
export type Alignment = 'werewolf' | 'village'

export type WinningTeam = 'werewolves' | 'village' | 'jester'

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
  /** 1-based. `0` during `reveal` and `nightZero`, before the first night. */
  night: number
  phaseEndsAt: number
  dead: string[]

  /** Who the pack took last night. null when nobody died to them. */
  lastKilled: string | null
  /** Whether the Guard's shield is why nobody died. */
  lastSaved: boolean
  /** Whether the Witch's heal is why nobody died. */
  lastHealed: boolean
  /** Who the Witch poisoned, once it has happened. Public after the fact. */
  lastPoisoned: string | null
  /** Who the last vote hanged. null after a tie, which takes nobody. */
  lastLynched: string | null
  /** Who the Hunter took with them. */
  lastShot: string | null
  /**
   * EVERYONE who died in the most recent resolution, the Lovers' cascade
   * included. A night can now kill three people, and `lastKilled` names one.
   */
  lastDeaths: string[]

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

  /**
   * Who the pack settled on, shown to the WITCH and only during her own phase.
   *
   * ALREADY NET OF THE GUARD: null here means nobody is dying tonight, whether
   * because the pack never agreed or because the shield got there first. So a
   * null with `pendingSaved` true is the Witch being told to keep her potion,
   * not a payload that failed to load.
   */
  pendingKill: string | null
  /** Whether the Guard is why `pendingKill` is null. Witch-only, phase-only. */
  pendingSaved: boolean
  /** Potions spent for the whole game. `false` for everyone but the Witch. */
  healUsed: boolean
  poisonUsed: boolean
  /** What the Witch has already done tonight, echoed back to her. */
  witchHealed: boolean
  witchPoison: string | null

  /**
   * The bound pair.
   *
   * `[]` unless this viewer is Cupid, the game is over, or the bond has already
   * cost somebody their life — at which point both halves are dead, both roles
   * are revealed, and hiding the pair would conceal nothing.
   */
  lovers: string[]
  /** Your partner, if you are one of them. null otherwise. */
  yourLover: string | null

  /** The dead Hunter who still owes the table a shot. Public. */
  revengeBy: string | null

  /** Set once decided. `'jester'` means neither side achieved anything. */
  winningTeam: WinningTeam | null
}

/** `GameView` and its projection, joined. This is what components consume. */
export interface WerewolfTable extends WerewolfProjection {
  version: number
  players: WerewolfPlayer[]
  /** Who may act right now. The night's roles, the Witch, a voter — or the Hunter. */
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
  'nightZero',
  'night',
  'witch',
  'dawn',
  'revenge',
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
  nightZero: 'The first night',
  night: 'Night',
  witch: "The Witch's turn",
  dawn: 'Dawn',
  revenge: "The Hunter's shot",
  day: 'Discussion',
  vote: 'Voting',
  verdict: 'Verdict',
  finished: 'Finished',
}

export const ROLE_LABEL: Record<WerewolfRole, string> = {
  werewolf: 'Werewolf',
  seer: 'Seer',
  guard: 'Guard',
  witch: 'Witch',
  hunter: 'Hunter',
  cupid: 'Cupid',
  jester: 'Jester',
  villager: 'Villager',
}

/** One line telling a player what their role is actually for. */
export const ROLE_BRIEF: Record<WerewolfRole, string> = {
  werewolf:
    'Every night the pack eats one person. By day you are an ordinary villager, until somebody starts wondering.',
  seer: 'Every night you may read one person: werewolf or not. Do not be in a hurry to say so out loud.',
  guard:
    'Every night you may cover one person from the pack. Never the same person two nights running.',
  witch:
    'You wake after the pack and you see who they took. One potion saves that person, one kills anybody you like. Each of them works once, for the whole game.',
  hunter:
    'You have no night action. But whenever you die — eaten, poisoned or hanged — you take one person down with you, and you choose who.',
  cupid:
    'On the first night you tie two people together. From then on they live and die as one: kill either and the other goes with them.',
  jester:
    'You do not win with the village and you do not win with the pack. You win by getting the table to hang you in daylight — and then you win alone.',
  villager: 'You have no special power. Only your vote, and that is enough.',
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
  nightZero: 30,
  night: 45,
  witch: 30,
  dawn: 8,
  revenge: 20,
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

/** Phases that count as night for the pack's private channel. */
export const NIGHT_PHASES: readonly WerewolfPhase[] = [
  'nightZero',
  'night',
  'witch',
]

// --- Derivations -----------------------------------------------------------

/**
 * Whether you are in THIS round at all.
 *
 * A lobby accepts people while a game is running, and the roster is fixed when
 * the cards are dealt — so somebody can be sitting in the room, watching, and
 * dealt in only on the next start. Mirrors the server's own gate, which refuses
 * their moves and their chat with `not-a-player`.
 *
 * `isAlive` DOES NOT ANSWER THIS. It asks whether you are in `dead`, and a
 * person who was never dealt a role is not — so a mid-game arrival reads as a
 * living player to every check written against it, and gets offered controls
 * the server will refuse. Ask this first, always.
 */
export function isPlaying(
  table: WerewolfTable,
  sessionId: string | null,
): boolean {
  return (
    sessionId !== null &&
    table.players.some((player) => player.sessionId === sessionId)
  )
}

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

/** Several sessionIds as one readable list. Used all over the narration. */
export function nicknamesOf(
  table: WerewolfTable,
  sessionIds: readonly string[],
): string {
  return sessionIds.map((id) => nicknameOf(table, id) ?? 'somebody').join(' and ')
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
 * know WHICH control to draw, not merely whether to draw one. Scoped to `night`
 * proper: Cupid and the Witch have phases of their own, and asking this
 * function about them would conflate three different screens.
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

// --- Cupid -----------------------------------------------------------------

/** Whether this viewer is the Cupid whose one beat is open right now. */
export function canBond(table: WerewolfTable, sessionId: string | null): boolean {
  return (
    sessionId !== null &&
    table.phase === 'nightZero' &&
    table.yourRole === 'cupid' &&
    isAlive(table, sessionId) &&
    table.lovers.length === 0
  )
}

// --- The Witch -------------------------------------------------------------

/**
 * What the Witch may still do tonight.
 *
 * `heal` needs a victim to undo, which is why `pendingKill` being null closes
 * it — that null already accounts for the Guard, so it covers both "the pack
 * never agreed" and "somebody else got there first".
 */
export function witchOptions(
  table: WerewolfTable,
  sessionId: string | null,
): { heal: boolean; poison: boolean } {
  if (
    !sessionId ||
    table.phase !== 'witch' ||
    table.yourRole !== 'witch' ||
    !isAlive(table, sessionId)
  ) {
    return { heal: false, poison: false }
  }

  return {
    heal: !table.healUsed && table.pendingKill !== null,
    poison: !table.poisonUsed,
  }
}

/** Mirrors the server's `poison` gate. A hint, not a gate. */
export function canPoison(
  table: WerewolfTable,
  sessionId: string | null,
  target: string,
): boolean {
  if (!witchOptions(table, sessionId).poison) return false
  return isAlive(table, target) && target !== sessionId
}

// --- The Hunter ------------------------------------------------------------

/**
 * Whether this viewer is the dead Hunter currently holding the gun.
 *
 * The one place in this game where being in `dead` does not end your turn — so
 * every caller must ask this rather than `isAlive`.
 */
export function isRevenger(
  table: WerewolfTable,
  sessionId: string | null,
): boolean {
  return (
    sessionId !== null &&
    table.phase === 'revenge' &&
    table.revengeBy === sessionId
  )
}

/** Who the Hunter may still shoot. Living only — a corpse is not a target. */
export function shootableBy(table: WerewolfTable): WerewolfPlayer[] {
  return livingPlayers(table)
}

// --- Narration -------------------------------------------------------------

/**
 * Everyone the last resolution killed BEYOND the one it is named for.
 *
 * The dawn and verdict panels lead with the headline death — who the pack ate,
 * who the table hanged — and this is the rest: a poisoning, and above all a
 * Lover pulled down by a death nobody aimed at them. Without it the roster
 * silently grows a second corpse and no line of text explains why.
 */
export function collateralOf(
  table: WerewolfTable,
  headlines: ReadonlyArray<string | null>,
): string[] {
  return table.lastDeaths.filter((id) => !headlines.includes(id))
}

/**
 * Whether this viewer may type right now.
 *
 * Mirrors the server's rule rather than guessing: the eliminated always have
 * the `dead` channel, wolves have the `pack` channel through the whole night —
 * Cupid's beat and the Witch's included — and everyone living has the table
 * during the day and the vote.
 */
export function canChat(
  table: WerewolfTable | null,
  sessionId: string | null,
): boolean {
  if (!table) return true
  if (table.finished) return true
  // Watching, not playing. The server answers `not-a-player` to anything they
  // send, so an open field here would only earn them an error per message.
  if (sessionId && !isPlaying(table, sessionId)) return false
  if (sessionId && !isAlive(table, sessionId)) return true
  if (NIGHT_PHASES.includes(table.phase)) return table.yourRole === 'werewolf'

  return CHAT_OPEN_PHASES.includes(table.phase)
}

// --- The lobby room's furniture --------------------------------------------

/**
 * Project a Werewolf table down to the room's game-agnostic shape.
 *
 * WHAT EACH SEAT SAYS, and why. The note under a name is the one line the rail
 * can carry, so it is ranked rather than concatenated: a revealed role beats a
 * lover mark beats a pending shot, because a role is permanent information and
 * the others are context. `votes` is whatever the server is currently willing
 * to publish, which during `vote` itself is nothing at all.
 *
 * The pack's private kill tally is deliberately NOT surfaced here. It is real
 * and a wolf can see it, but the rail is drawn from a shape three components
 * share, and a field that is populated for two viewers out of eight is exactly
 * the kind of thing that leaks by being forgotten about. Wolves read their
 * tally in their own action panel, which is wolf-only by construction.
 */
export function werewolfSummary(table: WerewolfTable): TableSummary {
  const tally = voteTally(table)

  const seats: TableSeat[] = table.players.map((player) => {
    const alive = isAlive(table, player.sessionId)
    const revealed = table.revealedRoles[player.sessionId]

    const note = revealed
      ? ROLE_LABEL[revealed].toUpperCase()
      : table.lovers.includes(player.sessionId)
        ? 'in love'
        : table.revengeBy === player.sessionId
          ? 'taking aim'
          : null

    return {
      sessionId: player.sessionId,
      nickname: player.nickname,
      seat: player.seat,
      alive,
      actor: isActor(table, player.sessionId),
      votes: tally[player.sessionId] ?? 0,
      note,
      droppedUntil: reconnectingUntil(table, player.sessionId),
    }
  })

  return {
    phaseLabel: PHASE_LABEL[table.phase],
    phaseSeconds: PHASE_SECONDS[table.phase],
    // `night 0` would be a lie during Cupid's beat — it is the first night, and
    // the counter does not start until the pack actually hunts.
    roundLabel: table.night > 0 ? `night ${table.night}` : 'first night',
    phaseEndsAt: table.finished ? null : table.phaseEndsAt,
    serverNow: table.serverNow,
    seats,
    aliveCount: seats.filter((seat) => seat.alive).length,
    finished: table.finished,
    phaseNote: WEREWOLF_PHASE_LOG[table.phase],
    phaseKey: table.phase,
  }
}

/** The `[STATE]` line written into the transcript on entering each phase. */
export const WEREWOLF_PHASE_LOG: Record<WerewolfPhase, string> = {
  reveal: 'ROLES DEALT',
  nightZero: 'THE FIRST NIGHT — CUPID IS AWAKE',
  night: 'NIGHT FALLS',
  witch: 'THE WITCH WAKES',
  dawn: 'DAWN',
  revenge: "THE HUNTER'S SHOT",
  day: 'THE TABLE ARGUES',
  vote: 'VOTING PHASE',
  verdict: 'THE VERDICT',
  finished: 'GAME OVER',
}
