import type { LobbyMember } from '@/lib/socket/events'

/**
 * The game-agnostic half of a table.
 *
 * WHY THIS EXISTS. The lobby room draws the same three furniture pieces —
 * a phase banner, a player rail, a chat panel — whatever game is running. Those
 * three were written against `MrWhiteTable`, so adding Werewolf to the room
 * meant one of two things: make them generic over every game's table type, or
 * give them a shape neither game owns. Generics lose here — the components do
 * not need to know a Werewolf phase from a Mr. White one, they need a label and
 * a number of seconds, and a type parameter threaded through three components
 * to deliver a string is a cost with no return.
 *
 * So each game's view module projects ITS table down to this, and the furniture
 * reads only this. A third game joins by writing one more adapter and touching
 * no component.
 *
 * WHAT DOES *NOT* BELONG HERE: anything one game has and another does not.
 * The Seer's ledger, Mr. White's word, the Witch's potions — those are the
 * business of that game's own action panel, which is game-specific by design.
 * This is the furniture's vocabulary, deliberately small.
 */

export interface TableSeat {
  sessionId: string
  nickname: string
  /** Seat index. Fixed by `joinedAt`, and several games walk it in order. */
  seat: number
  alive: boolean
  /** Whether they may act right now. Drives the rail's highlight. */
  actor: boolean
  /**
   * Votes standing against them.
   *
   * Zero whenever the game is redacting the tally — which both games do during
   * their own voting phase, to stop a live count causing a bandwagon. A zero
   * here means "nothing to show", never "nobody voted".
   */
  votes: number
  /**
   * One short line under the name: a clue they gave, a role the game has
   * revealed, whatever that game wants a seat to say. Null for most seats most
   * of the time.
   */
  note: string | null
  /** Epoch ms at which a dropped player is auto-eliminated, or null if present. */
  droppedUntil: number | null
}

export interface TableSummary {
  /** Null before a game starts — the lobby is simply waiting. */
  phaseLabel: string | null
  /** Nominal phase length in seconds, the denominator for the depleting rule. */
  phaseSeconds: number | null
  /** The eyebrow above the phase: `round 2`, `night 3`, or `lobby`. */
  roundLabel: string
  phaseEndsAt: number | null
  serverNow: number
  seats: TableSeat[]
  aliveCount: number
  finished: boolean
  /**
   * The `[STATE]` line for the transcript on entering this phase, e.g.
   * `VOTING PHASE`. Null before a game starts.
   */
  phaseNote: string | null
  /**
   * A stable key for the current phase.
   *
   * The chat hook compares this to decide whether the phase turned over. It is
   * never parsed or indexed — two different games may safely both call a phase
   * `vote`, because only one game runs in a lobby at a time.
   */
  phaseKey: string | null
}

/**
 * The roster before any game exists.
 *
 * The rail has to render in the lobby too: "are we five yet" is the only
 * question anyone has before the deal, and a blank panel does not answer it.
 * Everyone is alive, nobody may act, and there is nothing to say about them.
 */
export function seatsFromMembers(members: LobbyMember[]): TableSeat[] {
  return members.map((member, seat) => ({
    sessionId: member.sessionId,
    nickname: member.nickname,
    seat,
    alive: true,
    actor: false,
    votes: 0,
    note: null,
    droppedUntil: null,
  }))
}

/**
 * Everyone in the room who is not in the current round.
 *
 * A lobby takes people while a game runs, but the roster is fixed at the deal —
 * so between those two moments a person is genuinely seated and genuinely not
 * playing, and the room has to be able to draw them. They are dealt in by the
 * next `game:start`, which reads lobby membership rather than the old roster.
 *
 * Empty whenever no game is running, because `waitingSummary` seats everybody.
 * The reverse case — a seat in the game whose player has since left the lobby —
 * deliberately does not appear here: they are still in the round, and the
 * engine holds their seat open for the reconnect window.
 */
export function waitingFor(
  members: LobbyMember[],
  summary: TableSummary,
): LobbyMember[] {
  const dealtIn = new Set(summary.seats.map((seat) => seat.sessionId))

  return members.filter((member) => !dealtIn.has(member.sessionId))
}

/** The summary for a lobby with no game running. */
export function waitingSummary(members: LobbyMember[]): TableSummary {
  const seats = seatsFromMembers(members)

  return {
    phaseLabel: null,
    phaseSeconds: null,
    roundLabel: 'lobby',
    phaseEndsAt: null,
    serverNow: 0,
    seats,
    aliveCount: seats.length,
    finished: false,
    phaseNote: null,
    phaseKey: null,
  }
}
