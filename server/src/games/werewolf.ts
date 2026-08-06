import { randomInt } from 'node:crypto'

import type {
  ChatAudience,
  GameDefinition,
  GamePlayer,
  GameResult,
} from './types.js'

/**
 * Werewolf — hidden-role social deduction, played over a night/day cycle.
 *
 * A pack of werewolves eats one villager each night. The village lynches one
 * suspect each day. Two special villagers change the shape of the deduction: the
 * Seer learns one player's alignment per night, and the Guard shields one player
 * from the pack. The village wins by killing every wolf; the wolves win the
 * moment they equal the rest of the table, because from there no vote can be
 * lost by them.
 *
 * THREE THINGS DRIVE THE SHAPE OF THIS FILE:
 *
 * 1. `viewFor` IS THE ANTI-CHEAT SEAM. Every projection is built for exactly one
 *    viewer, because anything sent to a browser is readable in devtools whatever
 *    the UI renders. The rule enforced throughout: a projection may contain
 *    another player's sessionId paired with role information ONLY when that
 *    viewer is entitled to it — wolves knowing their own pack, and everyone
 *    seeing the roles of the dead. `order` and the full `roles` map never leave.
 *
 * 2. TALLIES ARE RESOLVED IN SEAT ORDER, NEVER IN KEY ORDER. `votes` and
 *    `wolfVotes` are plain objects that round-trip through Redis as JSON, and
 *    JSON gives no ordering guarantee worth betting a lynching on. `plurality`
 *    therefore walks `order` — fixed at creation — and never `Object.keys`, so
 *    the same votes always produce the same victim no matter how the map was
 *    serialised, reordered or rehydrated.
 *
 * 3. THE PHASE CLOCK IS DATA, NOT A TIMER. `phaseEndsAt` lives in state, `tick`
 *    is pure, and the engine sweeps due games out of a Redis sorted set. That is
 *    what makes a phase survive a process restart, and what makes a duplicate
 *    tick from two nodes harmless — the loser of the compare-and-set re-reads and
 *    finds nothing left to do.
 */

export type WerewolfPhase =
  /** Roles dealt. Watched, not played. */
  | 'reveal'
  /** Wolves, Seer and Guard act simultaneously. */
  | 'night'
  /** Who died — or who was saved. */
  | 'dawn'
  /** Open discussion. No moves, but the table can call the vote early. */
  | 'day'
  | 'vote'
  /** Votes on the table, and who they took. */
  | 'verdict'
  | 'finished'

export type WerewolfRole = 'werewolf' | 'seer' | 'guard' | 'villager'

/** What the Seer reads. Deliberately coarse: alignment, never the exact role. */
export type Alignment = 'werewolf' | 'village'

export type WinningTeam = 'werewolves' | 'village'

export interface WerewolfState {
  /**
   * sessionIds in seat order, fixed at creation.
   *
   * Two jobs. It is the roster the engine derives from `joinedAt`, so it lines
   * up with `GameView.players` seat for seat; and it is the canonical iteration
   * order for every tally, which is what keeps vote resolution independent of
   * JSON key ordering.
   *
   * Never projected: it names every player, which paired with a leaked `roles`
   * would be the whole game.
   */
  order: string[]
  roles: Record<string, WerewolfRole>

  phase: WerewolfPhase
  /** 1-based, incremented on entering each night. `0` during `reveal`. */
  night: number
  /** Epoch ms. Every non-terminal phase has one, or the game would deadlock. */
  phaseEndsAt: number

  /** Everyone out of the game, in the order they died. */
  dead: string[]

  // --- This night's business. All cleared by `openNight`. --------------------

  /**
   * wolf sessionId -> victim. A plurality decides, so a pack that splits still
   * eats (see `resolveNight`).
   *
   * Projected to wolves only. It is how they coordinate without a private
   * channel the server cannot see.
   */
  wolfVotes: Record<string, string>
  /** Who the Seer looked at tonight, or null while they have not chosen. */
  seerTarget: string | null
  /** Who the Guard covered tonight, or null while they have not chosen. */
  guardTarget: string | null

  // --- Accumulated private knowledge ----------------------------------------

  /**
   * Every reading the Seer has taken: target -> alignment. Grows one entry per
   * night and is projected to the Seer alone.
   */
  inspections: Record<string, Alignment>
  /**
   * Who the Guard covered LAST night. They may not repeat it, which is what
   * stops one player being permanently immortal.
   */
  lastProtected: string | null

  // --- What the last night and the last vote did ----------------------------

  /** Who the pack took. null when the night produced no death. */
  lastKilled: string | null
  /** Whether the Guard's shield is why nobody died. Public — it is a fact. */
  lastSaved: boolean
  /** Who the day vote hanged. null after a tie, which takes nobody. */
  lastLynched: string | null

  // --- Day business ---------------------------------------------------------

  /** voter -> accused, for the current vote only. */
  votes: Record<string, string>
  /**
   * Living players who have said they are done arguing.
   *
   * Public on purpose: the running count is the entire point of the button, and
   * wanting to move on reveals nothing about anyone's role.
   */
  readyToVote: string[]

  /** Set only when the game ends normally. */
  winningTeam: WinningTeam | null
  /** Set when someone walked out mid-game. */
  abandonedBy: string | null
}

export type WerewolfMove =
  /** Werewolf, at night. A vote within the pack, not a unilateral kill. */
  | { type: 'kill'; target: string }
  /** Seer, at night. */
  | { type: 'inspect'; target: string }
  /** Guard, at night. */
  | { type: 'protect'; target: string }
  /** Any living player, during `vote`. */
  | { type: 'vote'; target: string }
  /** Toggle "I am done arguing". A majority ends the day early. */
  | { type: 'ready' }

/**
 * Phase lengths in ms.
 *
 * `night` is generous because three different roles are deciding at once and
 * only one of them has a chat channel to think out loud in.
 */
const PHASE_MS: Record<Exclude<WerewolfPhase, 'finished'>, number> = {
  reveal: 10_000,
  night: 45_000,
  dawn: 8_000,
  day: 90_000,
  vote: 45_000,
  verdict: 8_000,
}

/**
 * Phases in which individual day votes may be shown.
 *
 * Never during `vote` itself. Not to be coy: a live tally on screen is what
 * causes bandwagoning, and hiding it in the UI alone would be theatre.
 */
const VOTES_VISIBLE: readonly WerewolfPhase[] = ['verdict', 'finished']

/**
 * How many wolves for a table of this size.
 *
 * Roughly a quarter of the seats, which is the standard ratio. Below it the
 * village cannot realistically lose; above it they cannot realistically win.
 * The table only has to cover 5–8 because that is the seating range.
 */
function packSizeFor(players: number): number {
  return players >= 7 ? 2 : 1
}

// --- Derivations -----------------------------------------------------------

function livingOf(state: WerewolfState): string[] {
  return state.order.filter((id) => !state.dead.includes(id))
}

function wolvesOf(state: WerewolfState): string[] {
  return state.order.filter((id) => state.roles[id] === 'werewolf')
}

function villageOf(state: WerewolfState): string[] {
  return state.order.filter((id) => state.roles[id] !== 'werewolf')
}

function livingWolves(state: WerewolfState): string[] {
  return wolvesOf(state).filter((id) => !state.dead.includes(id))
}

function livingVillage(state: WerewolfState): string[] {
  return villageOf(state).filter((id) => !state.dead.includes(id))
}

/**
 * Who is decided, or null while the game is still live.
 *
 * The wolves' condition is parity, not elimination: once they equal the rest of
 * the living they can never be out-voted, so playing it out would be a formality
 * with a known ending.
 */
function outcome(state: WerewolfState): WinningTeam | null {
  const wolves = livingWolves(state).length
  if (wolves === 0) return 'village'
  if (wolves >= livingVillage(state).length) return 'werewolves'
  return null
}

/**
 * Everyone with a night action, living only.
 *
 * Villagers sleep, so `night` is one of the phases where `actors` is a strict
 * subset of the living rather than all of them.
 */
function nightActors(state: WerewolfState): string[] {
  return livingOf(state).filter((id) => state.roles[id] !== 'villager')
}

/** Night actors who have not moved yet. Empty means the night can close. */
function nightPending(state: WerewolfState): string[] {
  return nightActors(state).filter((id) => {
    switch (state.roles[id]) {
      case 'werewolf':
        return !(id in state.wolfVotes)
      case 'seer':
        return state.seerTarget === null
      case 'guard':
        return state.guardTarget === null
      default:
        return false
    }
  })
}

/** Whether enough of the living have asked to stop arguing. */
function majorityReady(state: WerewolfState): boolean {
  // Strict majority: 3 of 4, 3 of 5, 2 of 3. A tie is not enough — half the
  // table wanting to move on is exactly the case worth still arguing about.
  return state.readyToVote.length * 2 > livingOf(state).length
}

// --- Tallying --------------------------------------------------------------

interface Plurality {
  /** The outright leader, or null when two or more are level at the top. */
  top: string | null
  /** How many votes the leaders have. 0 when nobody voted. */
  count: number
  /** Every player level at the top, in seat order. One entry means no tie. */
  leaders: string[]
}

/**
 * Count a vote map and find the leader — deterministically.
 *
 * THIS IS WHY IT WALKS `order` AND NOT `Object.keys(votes)`. The map is stored
 * in Redis as JSON and comes back as whatever key order the serialiser felt
 * like. Resolving a tie by "first key wins" would therefore make the outcome of
 * a lynching depend on a serialisation detail — a rule nobody at the table
 * agreed to, and one that could differ between two nodes reading the same game.
 * Seat order is fixed at creation, survives every round trip, and is the same
 * everywhere.
 *
 * Ties are reported, never silently broken. Each caller decides what a tie
 * means, because the two votes in this game disagree about it: see
 * `resolveVote` and `resolveNight`.
 */
function plurality(
  votes: Record<string, string>,
  order: readonly string[],
): Plurality {
  const tally = new Map<string, number>()

  for (const target of Object.values(votes)) {
    tally.set(target, (tally.get(target) ?? 0) + 1)
  }

  let count = 0
  const leaders: string[] = []

  // Seat order, so a tie is broken — or reported — the same way every time.
  for (const id of order) {
    const votesFor = tally.get(id) ?? 0
    if (votesFor === 0) continue

    if (votesFor > count) {
      count = votesFor
      leaders.length = 0
      leaders.push(id)
    } else if (votesFor === count) {
      leaders.push(id)
    }
  }

  return { top: leaders.length === 1 ? (leaders[0] ?? null) : null, count, leaders }
}

// --- Transitions -----------------------------------------------------------

function enter(
  state: WerewolfState,
  phase: Exclude<WerewolfPhase, 'finished'>,
  now: number,
): WerewolfState {
  return { ...state, phase, phaseEndsAt: now + PHASE_MS[phase] }
}

function finish(state: WerewolfState, team: WinningTeam): WerewolfState {
  return { ...state, phase: 'finished', winningTeam: team }
}

/** Open a fresh night: every night-action slot cleared, the counter advanced. */
function openNight(state: WerewolfState, now: number): WerewolfState {
  return enter(
    {
      ...state,
      night: state.night + 1,
      wolfVotes: {},
      seerTarget: null,
      guardTarget: null,
      votes: {},
      readyToVote: [],
    },
    'night',
    now,
  )
}

/** Open the argument. Readiness always starts from zero each day. */
function openDay(state: WerewolfState, now: number): WerewolfState {
  return enter({ ...state, votes: {}, readyToVote: [] }, 'day', now)
}

/** Open the vote, whether the clock ran out or a majority called it early. */
function openVote(state: WerewolfState, now: number): WerewolfState {
  return enter({ ...state, votes: {}, readyToVote: [] }, 'vote', now)
}

/**
 * Close the night and apply everything that happened in it.
 *
 * There is no `resolve` phase, because a phase with no deadline and no actors
 * could never advance — it would deadlock. Resolution therefore happens inside
 * the transition out of `night`, triggered either by the last action landing or
 * by the clock, and lands directly on `dawn`.
 *
 * TIE-BREAK, AND WHY IT DIFFERS FROM THE DAY VOTE. A split pack still eats: the
 * lowest seat among the tied victims is taken. The day vote does the opposite
 * and hangs nobody. The asymmetry is deliberate — an inconclusive lynching is a
 * real and interesting outcome that costs the village a day, whereas a pack that
 * loses its whole night to a 1–1 disagreement makes two-wolf games swing on
 * something no player can control. Both rules are decided here, in seat order,
 * and neither depends on how Redis happened to serialise the map.
 */
function resolveNight(state: WerewolfState, now: number): WerewolfState {
  const { top, leaders } = plurality(state.wolfVotes, state.order)
  const chosen = top ?? leaders[0] ?? null

  // The shield only matters if it landed on tonight's victim. A Guard covering
  // anyone else has simply guessed wrong, which is most nights.
  const saved = chosen !== null && chosen === state.guardTarget
  const killed = saved ? null : chosen

  // The Seer's reading is banked at the end of the night rather than the moment
  // they click. Alignment, not role: a Seer who could tell a Guard from a plain
  // villager would hand the village a second confirmed power role every night.
  const inspections = { ...state.inspections }
  if (state.seerTarget !== null) {
    inspections[state.seerTarget] =
      state.roles[state.seerTarget] === 'werewolf' ? 'werewolf' : 'village'
  }

  const next: WerewolfState = {
    ...state,
    inspections,
    // Set even when null, so a Guard who slept through the night is free to
    // cover anyone tomorrow.
    lastProtected: state.guardTarget,
    lastKilled: killed,
    lastSaved: saved,
    dead: killed ? [...state.dead, killed] : state.dead,
  }

  // Always show dawn, even when that death ended the game. `tick` finishes it
  // 8 seconds later — the table has earned the right to see who they lost.
  return enter(next, 'dawn', now)
}

/**
 * Close the vote.
 *
 * A STRICT PLURALITY IS REQUIRED. Two players level at the top hangs neither of
 * them: the village failed to agree, and that costs them the day. Picking one by
 * iteration order would make the outcome depend on Redis' JSON key ordering,
 * which is not a rule anyone agreed to.
 */
function resolveVote(state: WerewolfState, now: number): WerewolfState {
  const { top } = plurality(state.votes, state.order)

  return enter(
    {
      ...state,
      lastLynched: top,
      dead: top ? [...state.dead, top] : state.dead,
    },
    'verdict',
    now,
  )
}

/** Fisher–Yates. Used once, at the deal. */
function shuffle(ids: readonly string[]): string[] {
  const out = [...ids]

  for (let i = out.length - 1; i > 0; i -= 1) {
    // randomInt is rejection-sampled and unbiased; `% (i + 1)` on a raw draw
    // would skew the deal toward low seats.
    const j = randomInt(i + 1)
    const a = out[i]
    const b = out[j]
    if (a === undefined || b === undefined) continue
    out[i] = b
    out[j] = a
  }

  return out
}

// --- Definition ------------------------------------------------------------

export const werewolf: GameDefinition<WerewolfState, WerewolfMove> = {
  id: 'werewolf',
  label: 'Werewolf',
  // Five is the floor at which the two power roles still leave a real village
  // behind them: 1 wolf, 1 Seer, 1 Guard, 2 plain villagers. Eight is the
  // lobby's ceiling.
  minPlayers: 5,
  maxPlayers: 8,

  createInitialState(players: GamePlayer[]): WerewolfState {
    const order = players.map((player) => player.sessionId)

    // Seat order stays as the engine dealt it — the client renders the roster
    // from `GameView.players` and derives seats from its index, so shuffling
    // `order` here would silently renumber everyone's seat. The DEAL is
    // shuffled instead, on a copy.
    const deal = shuffle(order)
    const pack = packSizeFor(order.length)

    const roles: Record<string, WerewolfRole> = {}
    for (const id of order) roles[id] = 'villager'

    deal.forEach((id, index) => {
      if (index < pack) roles[id] = 'werewolf'
      else if (index === pack) roles[id] = 'seer'
      else if (index === pack + 1) roles[id] = 'guard'
    })

    return {
      order,
      roles,
      phase: 'reveal',
      // `openNight` increments, so the first night is 1.
      night: 0,
      phaseEndsAt: Date.now() + PHASE_MS.reveal,
      dead: [],
      wolfVotes: {},
      seerTarget: null,
      guardTarget: null,
      inspections: {},
      lastProtected: null,
      lastKilled: null,
      lastSaved: false,
      lastLynched: null,
      votes: {},
      readyToVote: [],
      winningTeam: null,
      abandonedBy: null,
    }
  },

  actors(state: WerewolfState): string[] {
    switch (state.phase) {
      // Simultaneous, but only the three roles with something to do. A player
      // who has already acted stays listed: they may change their mind until
      // the night closes, exactly as a voter may.
      case 'night':
        return nightActors(state)
      case 'vote':
        return livingOf(state)
      // `reveal`, `dawn`, `day` and `verdict` are watched, not played. They are
      // advanced by the clock, which is why they still carry a deadline. `day`
      // still accepts `ready` — see the note in `validateMove`.
      default:
        return []
    }
  },

  deadline(state: WerewolfState): number | null {
    return state.phase === 'finished' ? null : state.phaseEndsAt
  },

  tick(state: WerewolfState, now: number): WerewolfState | null {
    if (state.phase === 'finished') return null
    if (now < state.phaseEndsAt) return null

    switch (state.phase) {
      case 'reveal':
        return openNight(state, now)

      case 'night':
        // Anyone who did not act simply sleeps through it. A silent Seer must
        // not be able to stall the game indefinitely.
        return resolveNight(state, now)

      case 'dawn': {
        // The game may already have been decided by the kill. This is where
        // that gets acted on, one beat after the table saw the body.
        const decided = outcome(state)
        return decided ? finish(state, decided) : openDay(state, now)
      }

      case 'day':
        return openVote(state, now)

      case 'vote':
        // Abstention is legal. A table that says nothing hangs nobody.
        return resolveVote(state, now)

      case 'verdict': {
        const decided = outcome(state)
        return decided ? finish(state, decided) : openNight(state, now)
      }

      default:
        return null
    }
  },

  validateMove(state: WerewolfState, sessionId: string, raw: unknown) {
    if (state.phase === 'finished') {
      return { ok: false as const, reason: 'game-finished' }
    }

    if (!state.order.includes(sessionId)) {
      return { ok: false as const, reason: 'not-a-player' }
    }

    // The dead do not act. Unlike Mr. White there is no exception — a corpse in
    // Werewolf has no last word.
    if (state.dead.includes(sessionId)) {
      return { ok: false as const, reason: 'eliminated' }
    }

    if (typeof raw !== 'object' || raw === null) {
      return { ok: false as const, reason: 'malformed-move' }
    }

    const move = raw as Record<string, unknown>
    const role = state.roles[sessionId]

    /** Shared shape check for the four moves that name somebody. */
    const targetOf = (): { ok: true; target: string } | { ok: false; reason: string } => {
      const target = move['target']
      if (typeof target !== 'string' || !state.order.includes(target)) {
        return { ok: false, reason: 'invalid-target' }
      }
      if (state.dead.includes(target)) {
        return { ok: false, reason: 'target-eliminated' }
      }
      return { ok: true, target }
    }

    switch (move['type']) {
      case 'kill': {
        if (state.phase !== 'night') {
          return { ok: false as const, reason: 'wrong-phase' }
        }
        if (role !== 'werewolf') {
          return { ok: false as const, reason: 'not-a-werewolf' }
        }

        const target = targetOf()
        if (!target.ok) return { ok: false as const, reason: target.reason }

        // The pack does not eat its own. Allowing it would hand a wolf a way to
        // fake a night kill and clear their own name.
        if (state.roles[target.target] === 'werewolf') {
          return { ok: false as const, reason: 'target-is-pack' }
        }

        return { ok: true as const, move: { type: 'kill' as const, target: target.target } }
      }

      case 'inspect': {
        if (state.phase !== 'night') {
          return { ok: false as const, reason: 'wrong-phase' }
        }
        if (role !== 'seer') {
          return { ok: false as const, reason: 'not-the-seer' }
        }

        const target = targetOf()
        if (!target.ok) return { ok: false as const, reason: target.reason }

        if (target.target === sessionId) {
          return { ok: false as const, reason: 'cannot-inspect-self' }
        }
        // Refused rather than silently wasted: the Seer already has this
        // reading, and spending a night re-reading it is always a misclick.
        if (target.target in state.inspections) {
          return { ok: false as const, reason: 'already-inspected' }
        }

        return {
          ok: true as const,
          move: { type: 'inspect' as const, target: target.target },
        }
      }

      case 'protect': {
        if (state.phase !== 'night') {
          return { ok: false as const, reason: 'wrong-phase' }
        }
        if (role !== 'guard') {
          return { ok: false as const, reason: 'not-the-guard' }
        }

        const target = targetOf()
        if (!target.ok) return { ok: false as const, reason: target.reason }

        // No two nights running. Without this one player is simply immortal,
        // and the pack has no way to break through.
        if (target.target === state.lastProtected) {
          return { ok: false as const, reason: 'repeat-protection' }
        }

        return {
          ok: true as const,
          move: { type: 'protect' as const, target: target.target },
        }
      }

      case 'vote': {
        if (state.phase !== 'vote') {
          return { ok: false as const, reason: 'wrong-phase' }
        }

        const target = targetOf()
        if (!target.ok) return { ok: false as const, reason: target.reason }

        // Self-votes are legal. Nothing in the rules forbids throwing your own
        // name in, and a player cornered into it is making a real choice.
        return { ok: true as const, move: { type: 'vote' as const, target: target.target } }
      }

      case 'ready': {
        if (state.phase !== 'day') {
          return { ok: false as const, reason: 'wrong-phase' }
        }

        // Legal while `actors(state)` is empty. Not an inconsistency: `actors`
        // names who may make a *game* move, and the day deliberately has none —
        // being ready to stop talking is a vote about the clock, not a play.
        return { ok: true as const, move: { type: 'ready' as const } }
      }

      default:
        return { ok: false as const, reason: 'malformed-move' }
    }
  },

  applyMove(state: WerewolfState, sessionId: string, move: WerewolfMove): WerewolfState {
    const now = Date.now()

    /** Close the night early once nobody is left to act. */
    const settle = (next: WerewolfState): WerewolfState =>
      nightPending(next).length === 0 ? resolveNight(next, now) : next

    switch (move.type) {
      case 'kill':
        return settle({
          ...state,
          wolfVotes: { ...state.wolfVotes, [sessionId]: move.target },
        })

      case 'inspect':
        return settle({ ...state, seerTarget: move.target })

      case 'protect':
        return settle({ ...state, guardTarget: move.target })

      case 'vote': {
        const voted: WerewolfState = {
          ...state,
          votes: { ...state.votes, [sessionId]: move.target },
        }

        // Close early once every living player has cast — a full table should
        // not have to sit out the remaining clock.
        const pending = livingOf(voted).filter((id) => !(id in voted.votes))
        return pending.length === 0 ? resolveVote(voted, now) : voted
      }

      case 'ready': {
        // Toggle, so a player who changes their mind can take it back — the
        // count is a live reading of the room, not a one-way ratchet.
        const readyToVote = state.readyToVote.includes(sessionId)
          ? state.readyToVote.filter((id) => id !== sessionId)
          : [...state.readyToVote, sessionId]

        const next: WerewolfState = { ...state, readyToVote }

        return majorityReady(next) ? openVote(next, now) : next
      }

      default:
        return state
    }
  },

  result(state: WerewolfState): GameResult | null {
    if (state.abandonedBy) {
      // A wolf walking out hands it to the village — they were the only side
      // that could still lose it. Anyone else leaving simply breaks the game,
      // and there is no honest winner to name.
      return state.roles[state.abandonedBy] === 'werewolf'
        ? { winnerSessionIds: villageOf(state), team: 'village', reason: 'forfeit' }
        : { winnerSessionIds: [], reason: 'forfeit' }
    }

    if (state.phase !== 'finished' || !state.winningTeam) return null

    // The dead win with their side. A villager lynched on day one still beat the
    // wolves if the village got there, and a team game that said otherwise would
    // punish people for being targeted early.
    return {
      winnerSessionIds:
        state.winningTeam === 'werewolves' ? wolvesOf(state) : villageOf(state),
      team: state.winningTeam,
      reason: 'win',
    }
  },

  forfeit(state: WerewolfState, quittingSessionId: string): WerewolfState {
    if (state.phase === 'finished') return state
    if (!state.order.includes(quittingSessionId)) return state

    return { ...state, phase: 'finished', abandonedBy: quittingSessionId }
  },

  /**
   * A player who dropped and never came back.
   *
   * WHY THIS IS NOT `forfeit`. Ending an eight-seat game because one person's
   * wifi blinked would be indefensible. But marking them dead is not enough
   * either — every phase that was waiting on them would deadlock: `night` holds
   * for a Seer who will never look, `majorityReady` measures against a
   * denominator including someone who cannot press the button, and `vote` runs
   * the full 45 seconds because the tally can never complete. So this removes
   * them AND lands the game on whatever phase should follow.
   */
  eliminate(state: WerewolfState, sessionId: string, now: number): WerewolfState {
    if (state.phase === 'finished') return state
    if (!state.order.includes(sessionId)) return state
    if (state.dead.includes(sessionId)) return state

    // Their own votes go, and so does every vote cast FOR them. A surviving vote
    // against someone already dead lets `plurality` pick them and append them to
    // `dead` a second time.
    const votes: Record<string, string> = {}
    for (const [voter, target] of Object.entries(state.votes)) {
      if (voter === sessionId || target === sessionId) continue
      votes[voter] = target
    }

    const wolfVotes: Record<string, string> = {}
    for (const [voter, target] of Object.entries(state.wolfVotes)) {
      if (voter === sessionId || target === sessionId) continue
      wolfVotes[voter] = target
    }

    const next: WerewolfState = {
      ...state,
      dead: [...state.dead, sessionId],
      readyToVote: state.readyToVote.filter((id) => id !== sessionId),
      votes,
      wolfVotes,
      // `seerTarget` and `guardTarget` are deliberately left alone even when
      // they name the departed. Both are harmless — a reading nobody will see,
      // and a shield on a corpse — whereas clearing them would make a role that
      // had already acted pending again, re-opening a night that was closing.
    }

    // Losing a wolf, or the last villager, can decide the game outright.
    const decided = outcome(next)
    if (decided) return finish(next, decided)

    switch (next.phase) {
      case 'night':
        // The denominator shrank. If the leaver was the last one still to act,
        // the night is over and nothing else would ever close it.
        return nightPending(next).length === 0 ? resolveNight(next, now) : next

      case 'day':
        // Two of four was not a majority; two of three is. Without this recheck
        // the day runs its full 90 seconds even though everyone still present
        // has asked to move on.
        return majorityReady(next) ? openVote(next, now) : next

      case 'vote': {
        const pending = livingOf(next).filter((id) => !(id in next.votes))
        return pending.length === 0 ? resolveVote(next, now) : next
      }

      // `reveal`, `dawn` and `verdict` are advanced by the clock alone and wait
      // on nobody.
      default:
        return next
    }
  },

  /**
   * The redaction. This is the whole anti-cheat story.
   *
   * `order`, the full `roles` map, and the Seer's and Guard's choices never
   * leave except to the one player entitled to them. Four different viewers get
   * four genuinely different payloads out of the same state:
   *
   *   - A WEREWOLF gets their packmates by sessionId and the pack's live kill
   *     vote. They are allowed to know both; that is what being in the pack is.
   *   - The SEER gets their ledger of readings. Nobody else gets a single entry
   *     of it, so a villager cannot read the Seer's results out of devtools and
   *     play them as their own.
   *   - The GUARD gets who they covered tonight and who they may not cover
   *     again.
   *   - A VILLAGER gets their own role and nothing else — the same payload an
   *     observer gets, plus one word.
   *
   * The dead are told no more than the living. A dead player usually knows
   * everything in a face-to-face game, but here they may well be sitting in a
   * voice call with someone still alive, so omniscience would be a hole rather
   * than a courtesy.
   */
  viewFor(state: WerewolfState, sessionId: string | null): unknown {
    const finished = state.phase === 'finished'
    const yourRole = sessionId ? (state.roles[sessionId] ?? null) : null
    const isWolf = yourRole === 'werewolf'

    // Public: the roles of everyone who is out, and of everyone once it is over.
    // This is the only place another player's role legitimately reaches a
    // viewer who is not their packmate.
    const revealedRoles: Record<string, WerewolfRole> = {}
    for (const id of state.order) {
      if (!finished && !state.dead.includes(id)) continue
      const role = state.roles[id]
      if (role) revealedRoles[id] = role
    }

    return {
      phase: state.phase,
      night: state.night,
      phaseEndsAt: state.phaseEndsAt,
      dead: state.dead,

      lastKilled: state.lastKilled,
      lastSaved: state.lastSaved,
      lastLynched: state.lastLynched,

      votes: VOTES_VISIBLE.includes(state.phase) ? state.votes : {},
      readyToVote: state.readyToVote,
      revealedRoles,

      yourRole,
      // Empty for everyone who is not a wolf — including, deliberately, the
      // count. Knowing there are two wolves left is worth a lot to a villager.
      packmates: isWolf ? wolvesOf(state).filter((id) => id !== sessionId) : [],
      wolfVotes: isWolf ? state.wolfVotes : {},

      inspections: yourRole === 'seer' ? state.inspections : {},
      seerTarget: yourRole === 'seer' ? state.seerTarget : null,

      guardTarget: yourRole === 'guard' ? state.guardTarget : null,
      lastProtected: yourRole === 'guard' ? state.lastProtected : null,
    }
  },

  chatAudience(state: WerewolfState, sessionId: string): ChatAudience {
    if (!state.order.includes(sessionId)) {
      return { ok: false, reason: 'not-a-player' }
    }

    // Checked before the phase gate: the dead keep talking among themselves
    // whatever the living are doing, and they never reach the living again.
    if (state.dead.includes(sessionId)) {
      return { ok: true, channel: 'dead', to: [...state.dead] }
    }

    // The pack confers at night, and only with itself. This is the channel that
    // makes a two-wolf game playable without a side call the server cannot see.
    if (state.phase === 'night') {
      return state.roles[sessionId] === 'werewolf'
        ? { ok: true, channel: 'pack', to: livingWolves(state) }
        : { ok: false, reason: 'chat-closed' }
    }

    if (state.phase === 'day' || state.phase === 'vote') {
      return { ok: true, channel: 'table', to: livingOf(state) }
    }

    return { ok: false, reason: 'chat-closed' }
  },
}
