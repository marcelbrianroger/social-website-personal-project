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
 * suspect each day. Six special roles change the shape of the deduction: the
 * Seer learns one player's alignment per night, the Guard shields one player
 * from the pack, the Witch holds two one-shot potions and acts AFTER seeing who
 * the pack took, the Hunter fires a parting shot whenever they die, Cupid binds
 * two players whose fates are then identical, and the Jester wins alone by
 * getting themselves hanged. The village wins by killing every wolf; the wolves
 * win the moment they equal the rest of the table, because from there no vote
 * can be lost by them.
 *
 * FOUR THINGS DRIVE THE SHAPE OF THIS FILE:
 *
 * 1. `viewFor` IS THE ANTI-CHEAT SEAM. Every projection is built for exactly one
 *    viewer, because anything sent to a browser is readable in devtools whatever
 *    the UI renders. The rule enforced throughout: a projection may contain
 *    another player's sessionId paired with role information ONLY when that
 *    viewer is entitled to it — wolves knowing their own pack, the Witch seeing
 *    tonight's victim, Cupid and the Lovers knowing the bond, and everyone
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
 *
 * 4. NOBODY DIES EXCEPT THROUGH `reap`. Four things kill — the pack, the Witch's
 *    poison, the day vote and the Hunter's shot — and every one of them routes
 *    through the same function, because the Lovers' bond has to fire on all four
 *    and a fifth code path appending to `dead` directly is how that rule quietly
 *    stops holding. `reap` is also the only place `dead` is ever extended.
 */

export type WerewolfPhase =
  | 'reveal'
  /**
   * Cupid binds two players. FIRST NIGHT ONLY, and skipped entirely at table
   * sizes that deal no Cupid — which is why it is a phase of its own rather
   * than a flag on `night`.
   */
  | 'nightZero'
  /** Wolves, Seer and Guard act simultaneously. */
  | 'night'
  /**
   * The Witch, alone, AFTER the pack has settled on a victim.
   *
   * Sequential rather than folded into `night` because the Witch's whole power
   * is reacting to a kill she can see. Acting simultaneously she would be
   * guessing, which is a different and much weaker role.
   */
  | 'witch'
  /** Who died — or who was saved. */
  | 'dawn'
  /**
   * The Hunter, dead, taking someone with them. Interposed before whatever
   * phase was going to follow, and never entered unless a Hunter just died.
   */
  | 'revenge'
  /** Open discussion. No moves, but the table can call the vote early. */
  | 'day'
  | 'vote'
  /** Votes on the table, and who they took. */
  | 'verdict'
  | 'finished'

export type WerewolfRole =
  | 'werewolf'
  | 'seer'
  | 'guard'
  | 'witch'
  | 'hunter'
  | 'cupid'
  /** Neutral. Wins alone, and only by being voted out in daylight. */
  | 'jester'
  | 'villager'

/** What the Seer reads. Deliberately coarse: alignment, never the exact role. */
export type Alignment = 'werewolf' | 'village'

/**
 * `jester` is not a team of one so much as a way of saying the game ended
 * without either side achieving anything.
 */
export type WinningTeam = 'werewolves' | 'village' | 'jester'

/** Where a `revenge` phase returns to once the Hunter has fired. */
export type RevengeReturn = 'day' | 'night'

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
  /** 1-based, incremented on entering each night. `0` during `reveal`/`nightZero`. */
  night: number
  /** Epoch ms. Every non-terminal phase has one, or the game would deadlock. */
  phaseEndsAt: number

  /** Everyone out of the game, in the order they died. */
  dead: string[]

  // --- The bond -------------------------------------------------------------

  /**
   * The two players Cupid tied together, or empty.
   *
   * Exactly zero or two entries — a one-sided bond is not a state this game
   * has, so `bond` takes both targets in a single move rather than letting a
   * half-finished pair exist between two clicks.
   *
   * Projected to Cupid and to the Lovers themselves while the game runs, and to
   * everyone once either of them is dead — at which point both are, and the
   * table can read it off the bodies anyway.
   */
  lovers: string[]

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

  /**
   * Who is currently going to die at dawn, held between `night` and `witch`.
   *
   * ALREADY NET OF THE GUARD. When the shield landed on tonight's victim this
   * is null and `pendingSaved` is true, so the Witch is never offered a heal
   * that would save someone who was not dying — a once-per-game potion spent on
   * nothing is a worse outcome than the Witch inferring that the Guard acted.
   */
  pendingKill: string | null
  /** Whether the Guard is why `pendingKill` is null. */
  pendingSaved: boolean

  /** Whether the Witch spent her heal tonight. */
  witchHealed: boolean
  /** Who the Witch poisoned tonight, or null. */
  witchPoison: string | null

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

  /** Spent, once each, for the whole game. Projected to the Witch alone. */
  healUsed: boolean
  poisonUsed: boolean

  // --- What the last night and the last vote did ----------------------------

  /** Who the pack took. null when the night produced no death. */
  lastKilled: string | null
  /** Whether the Guard's shield is why nobody died. Public — it is a fact. */
  lastSaved: boolean
  /** Whether the Witch's heal is why nobody died. Also public. */
  lastHealed: boolean
  /** Who the Witch poisoned, once it has happened. Public after the fact. */
  lastPoisoned: string | null
  /** Who the day vote hanged. null after a tie, which takes nobody. */
  lastLynched: string | null
  /** Who the Hunter took with them. */
  lastShot: string | null
  /**
   * EVERYONE who died in the most recent resolution, cascade included.
   *
   * The narration needs this and cannot reconstruct it: a night can now kill
   * three people — the pack's victim, the Witch's poison, and a Lover dragged
   * down by either — and `lastKilled` alone names one of them.
   */
  lastDeaths: string[]

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

  // --- The Hunter's pending shot -------------------------------------------

  /**
   * The dead Hunter who still owes the table a shot, or null.
   *
   * Set the moment they die and cleared when the `revenge` phase resolves. It
   * is also the ONE case in which a player in `dead` may legally move.
   */
  revengeBy: string | null
  /** Which phase the `revenge` beat was interposed in front of. */
  revengeNext: RevengeReturn | null

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
  /** Cupid, on night zero. Both targets at once — a half-bond does not exist. */
  | { type: 'bond'; targets: [string, string] }
  /** Witch. Saves whoever the pack took tonight. Once per game. */
  | { type: 'heal' }
  /** Witch. Kills anybody. Once per game. */
  | { type: 'poison'; target: string }
  /** Witch, closing her phase without spending anything further. */
  | { type: 'pass' }
  /** Hunter, dead, during `revenge`. */
  | { type: 'shoot'; target: string }
  /** Any living player, during `vote`. */
  | { type: 'vote'; target: string }
  /** Toggle "I am done arguing". A majority ends the day early. */
  | { type: 'ready' }

/**
 * Phase lengths in ms.
 *
 * `night` is generous because three different roles are deciding at once and
 * only one of them has a chat channel to think out loud in. `revenge` is short
 * on purpose: the whole table is sitting watching a dead player choose, and the
 * Hunter has had the entire game to decide who they distrust.
 */
const PHASE_MS: Record<Exclude<WerewolfPhase, 'finished'>, number> = {
  reveal: 10_000,
  nightZero: 30_000,
  night: 45_000,
  witch: 30_000,
  dawn: 8_000,
  revenge: 20_000,
  day: 90_000,
  vote: 45_000,
  verdict: 8_000,
}

/**
 * Phases in which individual day votes may be shown.
 *
 * Never during `vote` itself. Not to be coy: a live tally on screen is what
 * causes bandwagoning, and hiding it in the UI alone would be theatre.
 *
 * `revenge` is included so the tally stays on screen through a Hunter beat that
 * followed a lynching. It is safe: the only other way into `revenge` is from
 * `dawn`, and `openNight` cleared `votes` long before then.
 */
const VOTES_VISIBLE: readonly WerewolfPhase[] = ['verdict', 'revenge', 'finished']

/** Phases that are night, for the purposes of the pack's private channel. */
const NIGHT_PHASES: readonly WerewolfPhase[] = ['nightZero', 'night', 'witch']

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

/**
 * The special roles dealt after the pack, by table size, in order.
 *
 * A TABLE RATHER THAN AN ALGORITHM, because the interesting question at every
 * size is which role to leave OUT, and that is a judgement per size rather than
 * a formula. Any seat past the end of a row gets `villager`.
 *
 * The order the four new roles enter is by how well each survives a small
 * table. The Witch and the Hunter work anywhere — one is a reaction, the other
 * a deterrent, and neither needs bodies to be interesting. Cupid needs a table
 * big enough that binding two people is not simply binding a quarter of it. The
 * Jester needs the most room of all, because a Jester lynched on day one ENDS
 * THE GAME, and at five seats that is a coin flip deciding the whole round —
 * hence eight only.
 *
 *   5 → 1 wolf  | Seer, Guard, Witch, 1 villager
 *   6 → 1 wolf  | Seer, Guard, Witch, Hunter, 1 villager
 *   7 → 2 wolves| Seer, Guard, Witch, Hunter, Cupid
 *   8 → 2 wolves| Seer, Guard, Witch, Hunter, Cupid, Jester
 */
const ROLE_LADDER: Record<number, readonly WerewolfRole[]> = {
  5: ['seer', 'guard', 'witch', 'villager'],
  6: ['seer', 'guard', 'witch', 'hunter', 'villager'],
  7: ['seer', 'guard', 'witch', 'hunter', 'cupid'],
  8: ['seer', 'guard', 'witch', 'hunter', 'cupid', 'jester'],
}

// --- Derivations -----------------------------------------------------------

function livingOf(state: WerewolfState): string[] {
  return state.order.filter((id) => !state.dead.includes(id))
}

function wolvesOf(state: WerewolfState): string[] {
  return state.order.filter((id) => state.roles[id] === 'werewolf')
}

/**
 * Every non-wolf. This is the PARITY denominator, so the Jester is counted:
 * they hold a seat and cast a vote, and pretending otherwise would hand the
 * wolves a win one body early.
 */
function villageOf(state: WerewolfState): string[] {
  return state.order.filter((id) => state.roles[id] !== 'werewolf')
}

/**
 * Who actually collects a village win. The Jester does not: they are neutral,
 * and their only win is the one they engineer for themselves in daylight.
 */
function villageWinnersOf(state: WerewolfState): string[] {
  return state.order.filter(
    (id) => state.roles[id] !== 'werewolf' && state.roles[id] !== 'jester',
  )
}

function livingWolves(state: WerewolfState): string[] {
  return wolvesOf(state).filter((id) => !state.dead.includes(id))
}

function livingVillage(state: WerewolfState): string[] {
  return villageOf(state).filter((id) => !state.dead.includes(id))
}

/** The single holder of a role, living or dead, or null when none was dealt. */
function holderOf(state: WerewolfState, role: WerewolfRole): string | null {
  return state.order.find((id) => state.roles[id] === role) ?? null
}

/** The single holder of a role, but only while they are still alive. */
function livingHolderOf(state: WerewolfState, role: WerewolfRole): string | null {
  const id = holderOf(state, role)
  return id !== null && !state.dead.includes(id) ? id : null
}

/**
 * Who is decided, or null while the game is still live.
 *
 * The wolves' condition is parity, not elimination: once they equal the rest of
 * the living they can never be out-voted, so playing it out would be a formality
 * with a known ending.
 *
 * The Jester is absent from this entirely. Their win is not a board state that
 * can be read off the living — it is one specific event, a lynching, and it is
 * recorded by `resolveVote` at the moment it happens.
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
 * subset of the living rather than all of them. The Witch is NOT here: she acts
 * in her own phase, after this one, which is the whole point of her.
 */
function nightActors(state: WerewolfState): string[] {
  return livingOf(state).filter((id) => {
    const role = state.roles[id]
    return role === 'werewolf' || role === 'seer' || role === 'guard'
  })
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

// --- Dying -----------------------------------------------------------------

interface Reaping {
  state: WerewolfState
  /** Everyone who actually died, in the order they died, cascade included. */
  died: string[]
}

/**
 * THE ONLY WAY ANYONE DIES. Every caller routes through here.
 *
 * Four things kill in this game — the pack, the Witch's poison, the day vote and
 * the Hunter's shot — and the Lovers' bond has to fire on all four. Written as
 * four separate appends to `dead` it would hold for three of them and then
 * quietly stop holding for whichever one was added last. So `dead` is extended
 * in exactly this function and nowhere else.
 *
 * A WORKLIST, NOT RECURSION. The bond is a two-cycle: killing A queues B, and
 * killing B would queue A straight back. The `dead.includes` guard at the top of
 * the loop is what terminates it, and it also makes the function idempotent for
 * a victim who is already gone — which matters, because `applyMove` and `tick`
 * can both be replayed after a lost compare-and-set.
 *
 * Nulls are accepted and ignored so callers can pass `pendingKill` and
 * `witchPoison` straight in without four-way null branching at each site.
 */
function reap(
  state: WerewolfState,
  victims: ReadonlyArray<string | null>,
): Reaping {
  const dead = [...state.dead]
  const died: string[] = []
  const queue: string[] = victims.filter(
    (victim): victim is string => typeof victim === 'string',
  )

  while (queue.length > 0) {
    const id = queue.shift()
    if (id === undefined) break
    if (dead.includes(id)) continue

    dead.push(id)
    died.push(id)

    // The bond. A Lover does not outlive their partner by so much as a phase —
    // there is no save, no shield and no potion that interrupts this.
    if (state.lovers.includes(id)) {
      for (const other of state.lovers) {
        if (other !== id && !dead.includes(other)) queue.push(other)
      }
    }
  }

  return { state: { ...state, dead }, died }
}

/**
 * The Hunter's trigger, checked against one reaping.
 *
 * Returns the Hunter if they are among the freshly dead and have not already
 * fired. `revengeBy` being null in the guard is what stops a Hunter shot that
 * kills their own Lover from re-opening the phase they are standing in.
 */
function hunterAmong(state: WerewolfState, died: readonly string[]): string | null {
  if (state.revengeBy !== null) return null
  return died.find((id) => state.roles[id] === 'hunter') ?? null
}

/**
 * Drop every vote cast BY or FOR anyone in `gone`.
 *
 * A surviving vote against someone already dead lets `plurality` pick them and
 * hand them to `reap` a second time — harmless, since `reap` is idempotent, but
 * it would also produce a "verdict" naming a corpse.
 */
function purge(
  votes: Record<string, string>,
  gone: readonly string[],
): Record<string, string> {
  const kept: Record<string, string> = {}

  for (const [voter, target] of Object.entries(votes)) {
    if (gone.includes(voter) || gone.includes(target)) continue
    kept[voter] = target
  }

  return kept
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
      pendingKill: null,
      pendingSaved: false,
      witchHealed: false,
      witchPoison: null,
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
 * Interpose the Hunter's shot, or go straight where we were headed.
 *
 * THE OUTCOME CHECK COMES AFTER THE SHOT, NOT BEFORE. A Hunter who dies on the
 * night the pack reaches parity can fire into the pack and break it, and the
 * game carries on. Testing `outcome` first would declare the wolves winners
 * while a loaded gun was still on the table.
 */
function afterDeaths(
  state: WerewolfState,
  next: RevengeReturn,
  now: number,
): WerewolfState {
  if (state.revengeBy !== null) {
    return enter({ ...state, revengeNext: next }, 'revenge', now)
  }

  const decided = outcome(state)
  if (decided) return finish(state, decided)

  return next === 'day' ? openDay(state, now) : openNight(state, now)
}

/**
 * Close the wolves' half of the night.
 *
 * There is no `resolve` phase, because a phase with no deadline and no actors
 * could never advance — it would deadlock. Resolution therefore happens inside
 * the transition out of `night`, triggered either by the last action landing or
 * by the clock.
 *
 * NOTHING DIES HERE. The victim is parked in `pendingKill` and the night hands
 * over to the Witch, who is the only role that gets to see a kill before it
 * lands. `closeWitch` is what finally calls `reap`. When there is no living
 * Witch this function goes straight there, so the two paths converge on one
 * piece of killing code rather than two.
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
    pendingKill: saved ? null : chosen,
    pendingSaved: saved,
  }

  // The Witch only gets a phase while she is alive to use it. Note the phase is
  // NOT skipped when both her potions are spent: she is still there, the table
  // can see the phase, and skipping it the night she runs dry would broadcast
  // that fact to everyone. Her death already tells them, publicly, for free.
  return livingHolderOf(next, 'witch') !== null
    ? enter(next, 'witch', now)
    : closeWitch(next, now)
}

/**
 * Close the Witch's phase and apply everything the night decided.
 *
 * This is where the night's deaths finally land — the pack's victim unless the
 * Guard covered them or the Witch healed them, plus whoever the Witch poisoned,
 * plus anyone bound to either of them.
 *
 * Always shows dawn, even when those deaths ended the game. `tick` finishes it
 * 8 seconds later — the table has earned the right to see who they lost.
 */
function closeWitch(state: WerewolfState, now: number): WerewolfState {
  const killed = state.witchHealed ? null : state.pendingKill
  const { state: reaped, died } = reap(state, [killed, state.witchPoison])

  const next: WerewolfState = {
    ...reaped,
    lastKilled: killed,
    lastSaved: state.pendingSaved,
    lastHealed: state.witchHealed,
    lastPoisoned: state.witchPoison,
    lastLynched: null,
    lastShot: null,
    lastDeaths: died,
    revengeBy: hunterAmong(reaped, died) ?? reaped.revengeBy,
  }

  return enter(next, 'dawn', now)
}

/**
 * Close the vote.
 *
 * A STRICT PLURALITY IS REQUIRED. Two players level at the top hangs neither of
 * them: the village failed to agree, and that costs them the day. Picking one by
 * iteration order would make the outcome depend on Redis' JSON key ordering,
 * which is not a rule anyone agreed to.
 *
 * THE JESTER'S WIN IS RECORDED HERE AND NOWHERE ELSE. It is the vote that has to
 * have done it — a Jester eaten by the pack, poisoned, shot by the Hunter or
 * dragged down by a Lover has lost like anybody else. Tying it to this one
 * transition is what makes that true by construction rather than by four
 * separate checks remembering to exclude themselves.
 */
function resolveVote(state: WerewolfState, now: number): WerewolfState {
  const { top } = plurality(state.votes, state.order)
  const { state: reaped, died } = reap(state, [top])

  const jesterWon = top !== null && state.roles[top] === 'jester'

  const next: WerewolfState = {
    ...reaped,
    lastKilled: null,
    lastSaved: false,
    lastHealed: false,
    lastPoisoned: null,
    lastLynched: top,
    lastShot: null,
    lastDeaths: died,
    // A Jester win outranks the Hunter: the game is already over, so there is
    // nothing for a parting shot to change and no phase left to interpose it in.
    revengeBy: jesterWon ? null : (hunterAmong(reaped, died) ?? reaped.revengeBy),
    winningTeam: jesterWon ? 'jester' : reaped.winningTeam,
  }

  return enter(next, 'verdict', now)
}

/**
 * Close the Hunter's shot and go wherever the interposed phase was headed.
 *
 * A Hunter who let the clock run out shoots nobody. The shot itself can pull a
 * Lover down with it, and — because `hunterAmong` refuses while `revengeBy` is
 * set — cannot re-open this phase even in the pathological case of a second
 * Hunter existing.
 */
function resolveRevenge(state: WerewolfState, now: number): WerewolfState {
  const { state: reaped, died } = reap(state, [state.lastShot])

  const next: WerewolfState = {
    ...reaped,
    lastDeaths: died,
    revengeBy: null,
    revengeNext: null,
  }

  const decided = outcome(next)
  if (decided) return finish(next, decided)

  return state.revengeNext === 'day' ? openDay(next, now) : openNight(next, now)
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
  // Five is the floor at which the power roles still leave a real village
  // behind them: 1 wolf, Seer, Guard, Witch, 1 plain villager. Eight is the
  // lobby's ceiling, and the only size that seats a Jester.
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
    // `?? []` rather than a throw: the ladder covers 5–8 because the engine
    // enforces that range, and a table outside it should degrade to plain
    // Werewolf rather than take the room down.
    const ladder = ROLE_LADDER[order.length] ?? []

    const roles: Record<string, WerewolfRole> = {}
    for (const id of order) roles[id] = 'villager'

    deal.forEach((id, index) => {
      if (index < pack) {
        roles[id] = 'werewolf'
        return
      }
      const special = ladder[index - pack]
      if (special) roles[id] = special
    })

    const state: WerewolfState = {
      order,
      roles,
      phase: 'reveal',
      // `openNight` increments, so the first night is 1.
      night: 0,
      phaseEndsAt: Date.now() + PHASE_MS.reveal,
      dead: [],
      lovers: [],
      wolfVotes: {},
      seerTarget: null,
      guardTarget: null,
      pendingKill: null,
      pendingSaved: false,
      witchHealed: false,
      witchPoison: null,
      inspections: {},
      lastProtected: null,
      healUsed: false,
      poisonUsed: false,
      lastKilled: null,
      lastSaved: false,
      lastHealed: false,
      lastPoisoned: null,
      lastLynched: null,
      lastShot: null,
      lastDeaths: [],
      votes: {},
      readyToVote: [],
      revengeBy: null,
      revengeNext: null,
      winningTeam: null,
      abandonedBy: null,
    }

    return state
  },

  actors(state: WerewolfState): string[] {
    switch (state.phase) {
      // Cupid alone, and only on the one night this phase exists.
      case 'nightZero': {
        const cupid = livingHolderOf(state, 'cupid')
        return cupid ? [cupid] : []
      }

      // Simultaneous, but only the three roles with something to do. A player
      // who has already acted stays listed: they may change their mind until
      // the night closes, exactly as a voter may.
      case 'night':
        return nightActors(state)

      case 'witch': {
        const witch = livingHolderOf(state, 'witch')
        return witch ? [witch] : []
      }

      // The one actor in this game who is dead. `actors` names who may move,
      // and the Hunter may — see the exception in `validateMove`.
      case 'revenge':
        return state.revengeBy ? [state.revengeBy] : []

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
        // Night zero exists only where a Cupid was dealt. Entering it at table
        // sizes with no Cupid would be 30 seconds of nobody being able to act.
        return livingHolderOf(state, 'cupid') !== null
          ? enter(state, 'nightZero', now)
          : openNight(state, now)

      case 'nightZero':
        // A Cupid who never chose binds nobody. There is no second chance:
        // night zero happens once.
        return openNight(state, now)

      case 'night':
        // Anyone who did not act simply sleeps through it. A silent Seer must
        // not be able to stall the game indefinitely.
        return resolveNight(state, now)

      case 'witch':
        // A Witch who sat on her hands keeps both potions.
        return closeWitch(state, now)

      case 'dawn':
        // The game may already have been decided by the kill — but a dead
        // Hunter gets to fire first, because the shot can undo it.
        return afterDeaths(state, 'day', now)

      case 'revenge':
        return resolveRevenge(state, now)

      case 'day':
        return openVote(state, now)

      case 'vote':
        // Abstention is legal. A table that says nothing hangs nobody.
        return resolveVote(state, now)

      case 'verdict': {
        // The Jester's win is already recorded and outranks everything left.
        if (state.winningTeam) return finish(state, state.winningTeam)
        return afterDeaths(state, 'night', now)
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

    // THE ONE EXCEPTION TO "THE DEAD DO NOT ACT". The Hunter's whole role is
    // that dying is when it fires, so they must be able to move from inside
    // `dead`. It is narrow on purpose: this exact phase, and only the player
    // the phase was opened for.
    const isRevenger = state.phase === 'revenge' && state.revengeBy === sessionId

    if (state.dead.includes(sessionId) && !isRevenger) {
      return { ok: false as const, reason: 'eliminated' }
    }

    if (typeof raw !== 'object' || raw === null) {
      return { ok: false as const, reason: 'malformed-move' }
    }

    const move = raw as Record<string, unknown>
    const role = state.roles[sessionId]

    /** Shared shape check for the moves that name somebody. */
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

      case 'bond': {
        if (state.phase !== 'nightZero') {
          return { ok: false as const, reason: 'wrong-phase' }
        }
        if (role !== 'cupid') {
          return { ok: false as const, reason: 'not-cupid' }
        }
        // One shot. Re-binding would let Cupid rewrite the pair after watching
        // a night of information arrive.
        if (state.lovers.length > 0) {
          return { ok: false as const, reason: 'already-bonded' }
        }

        const targets = move['targets']
        if (!Array.isArray(targets) || targets.length !== 2) {
          return { ok: false as const, reason: 'need-two-lovers' }
        }

        const [first, second] = targets
        if (typeof first !== 'string' || typeof second !== 'string') {
          return { ok: false as const, reason: 'invalid-target' }
        }
        if (!state.order.includes(first) || !state.order.includes(second)) {
          return { ok: false as const, reason: 'invalid-target' }
        }
        if (state.dead.includes(first) || state.dead.includes(second)) {
          return { ok: false as const, reason: 'target-eliminated' }
        }
        if (first === second) {
          return { ok: false as const, reason: 'need-two-lovers' }
        }

        // Cupid MAY tie themselves in. It is the classic rule and it is the
        // interesting one: a Cupid inside the pair has staked their own life on
        // the other half surviving.
        return {
          ok: true as const,
          move: { type: 'bond' as const, targets: [first, second] as [string, string] },
        }
      }

      case 'heal': {
        if (state.phase !== 'witch') {
          return { ok: false as const, reason: 'wrong-phase' }
        }
        if (role !== 'witch') {
          return { ok: false as const, reason: 'not-the-witch' }
        }
        if (state.healUsed) {
          return { ok: false as const, reason: 'potion-spent' }
        }
        // Nothing to heal. `pendingKill` is already net of the Guard, so this
        // covers both "the pack never settled on anyone" and "the Guard got
        // there first" — and in neither case is there a death to undo.
        if (state.pendingKill === null) {
          return { ok: false as const, reason: 'nobody-to-heal' }
        }

        return { ok: true as const, move: { type: 'heal' as const } }
      }

      case 'poison': {
        if (state.phase !== 'witch') {
          return { ok: false as const, reason: 'wrong-phase' }
        }
        if (role !== 'witch') {
          return { ok: false as const, reason: 'not-the-witch' }
        }
        if (state.poisonUsed) {
          return { ok: false as const, reason: 'potion-spent' }
        }

        const target = targetOf()
        if (!target.ok) return { ok: false as const, reason: target.reason }

        // Never a real play, always a misclick — refused for the same reason
        // the Seer may not read themselves.
        if (target.target === sessionId) {
          return { ok: false as const, reason: 'cannot-poison-self' }
        }

        return {
          ok: true as const,
          move: { type: 'poison' as const, target: target.target },
        }
      }

      case 'pass': {
        if (state.phase !== 'witch') {
          return { ok: false as const, reason: 'wrong-phase' }
        }
        if (role !== 'witch') {
          return { ok: false as const, reason: 'not-the-witch' }
        }

        return { ok: true as const, move: { type: 'pass' as const } }
      }

      case 'shoot': {
        if (state.phase !== 'revenge') {
          return { ok: false as const, reason: 'wrong-phase' }
        }
        if (state.revengeBy !== sessionId) {
          return { ok: false as const, reason: 'not-the-hunter' }
        }

        const target = targetOf()
        if (!target.ok) return { ok: false as const, reason: target.reason }

        return {
          ok: true as const,
          move: { type: 'shoot' as const, target: target.target },
        }
      }

      case 'vote': {
        if (state.phase !== 'vote') {
          return { ok: false as const, reason: 'wrong-phase' }
        }

        const target = targetOf()
        if (!target.ok) return { ok: false as const, reason: target.reason }

        // Self-votes are legal. Nothing in the rules forbids throwing your own
        // name in, and a player cornered into it is making a real choice — most
        // of all a Jester, for whom it is the entire strategy.
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

    /**
     * Close the Witch's phase once she has nothing left to spend.
     *
     * Only when BOTH potions are gone. A Witch who has just healed may still
     * want to poison, and cutting her off after one would make the order of two
     * independent decisions matter.
     */
    const settleWitch = (next: WerewolfState): WerewolfState =>
      next.healUsed && next.poisonUsed ? closeWitch(next, now) : next

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

      case 'bond':
        // The bond is the only thing night zero is for, so landing it ends the
        // phase — there is nothing else for anyone to wait on.
        return openNight({ ...state, lovers: [...move.targets] }, now)

      case 'heal':
        return settleWitch({ ...state, healUsed: true, witchHealed: true })

      case 'poison':
        return settleWitch({
          ...state,
          poisonUsed: true,
          witchPoison: move.target,
        })

      case 'pass':
        return closeWitch(state, now)

      case 'shoot':
        // Fired and resolved in one step. Unlike a vote there is nobody else to
        // wait for, and letting the Hunter re-aim would just be dead air.
        return resolveRevenge({ ...state, lastShot: move.target }, now)

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
        ? { winnerSessionIds: villageWinnersOf(state), team: 'village', reason: 'forfeit' }
        : { winnerSessionIds: [], reason: 'forfeit' }
    }

    if (state.phase !== 'finished' || !state.winningTeam) return null

    // The Jester wins alone, and nobody else wins anything. It is the one
    // outcome in this game with a single name on it.
    if (state.winningTeam === 'jester') {
      const jester = holderOf(state, 'jester')
      return {
        winnerSessionIds: jester ? [jester] : [],
        team: 'jester',
        reason: 'win',
      }
    }

    // The dead win with their side. A villager lynched on day one still beat the
    // wolves if the village got there, and a team game that said otherwise would
    // punish people for being targeted early.
    return {
      winnerSessionIds:
        state.winningTeam === 'werewolves'
          ? wolvesOf(state)
          : villageWinnersOf(state),
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
   * for a Seer who will never look, `witch` runs its full clock for a Witch who
   * cannot answer, `majorityReady` measures against a denominator including
   * someone who cannot press the button, and `vote` runs the full 45 seconds
   * because the tally can never complete. So this removes them AND lands the
   * game on whatever phase should follow.
   *
   * IT ROUTES THROUGH `reap`, so a dropped Lover still takes their partner with
   * them — dying to a lost connection is still dying.
   *
   * IT DOES NOT OPEN A REVENGE PHASE, and that is deliberate rather than an
   * omission. This function's job is to repair a phase that is mid-flight, and
   * interposing a reactive phase in front of it would mean resuming later into a
   * night that had already half-resolved. The Hunter fires on the three deaths
   * the RULES produce — the pack, a potion, the vote — not on a socket closing.
   */
  eliminate(state: WerewolfState, sessionId: string, now: number): WerewolfState {
    if (state.phase === 'finished') return state
    if (!state.order.includes(sessionId)) return state
    if (state.dead.includes(sessionId)) return state

    const { state: reaped, died } = reap(state, [sessionId])

    const next: WerewolfState = {
      ...reaped,
      // `lastDeaths` is deliberately NOT touched: it narrates what the last
      // RESOLUTION did, and a socket closing mid-dawn is not part of that story.
      // The bond taking a partner down here stays legible from the roster —
      // `lovers` goes public the moment either half of it dies.
      readyToVote: reaped.readyToVote.filter((id) => !died.includes(id)),
      // Their own votes go, and so does every vote cast FOR them — and the same
      // for a partner the bond took down with them.
      votes: purge(reaped.votes, died),
      wolfVotes: purge(reaped.wolfVotes, died),
      // `seerTarget` and `guardTarget` are deliberately left alone even when
      // they name the departed. Both are harmless — a reading nobody will see,
      // and a shield on a corpse — whereas clearing them would make a role that
      // had already acted pending again, re-opening a night that was closing.
    }

    // Losing a wolf, or the last villager, can decide the game outright.
    const decided = outcome(next)
    if (decided) return finish(next, decided)

    switch (next.phase) {
      case 'nightZero':
        // Night zero waits on Cupid and nobody else. Without them there is no
        // bond to be made and no reason to burn the clock.
        return livingHolderOf(next, 'cupid') === null ? openNight(next, now) : next

      case 'night':
        // The denominator shrank. If the leaver was the last one still to act,
        // the night is over and nothing else would ever close it.
        return nightPending(next).length === 0 ? resolveNight(next, now) : next

      case 'witch':
        // The Witch is the sole actor here. Gone, and the phase can only end on
        // a clock nobody is waiting for.
        return livingHolderOf(next, 'witch') === null ? closeWitch(next, now) : next

      case 'day':
        // Two of four was not a majority; two of three is. Without this recheck
        // the day runs its full 90 seconds even though everyone still present
        // has asked to move on.
        return majorityReady(next) ? openVote(next, now) : next

      case 'vote': {
        const pending = livingOf(next).filter((id) => !(id in next.votes))
        return pending.length === 0 ? resolveVote(next, now) : next
      }

      // `reveal`, `dawn`, `revenge` and `verdict` are advanced by the clock
      // alone and wait on nobody. `revenge` needs no repair here for a subtler
      // reason: its actor is ALREADY in `dead`, so a Hunter who drops mid-aim
      // hits the early return at the top of this function and the 20-second
      // clock closes the phase for them.
      default:
        return next
    }
  },

  /**
   * The redaction. This is the whole anti-cheat story.
   *
   * `order`, the full `roles` map, and every role's private choices never leave
   * except to the one player entitled to them. Seven different viewers get seven
   * genuinely different payloads out of the same state:
   *
   *   - A WEREWOLF gets their packmates by sessionId and the pack's live kill
   *     vote. They are allowed to know both; that is what being in the pack is.
   *   - The SEER gets their ledger of readings. Nobody else gets a single entry
   *     of it, so a villager cannot read the Seer's results out of devtools and
   *     play them as their own.
   *   - The GUARD gets who they covered tonight and who they may not cover
   *     again.
   *   - The WITCH gets tonight's victim — the one piece of live kill information
   *     that legitimately reaches a non-wolf — plus which potions she has left.
   *     `pendingKill` is gated on the phase as well as the role, so it is not
   *     sitting in her payload all day for a spectator over her shoulder.
   *   - CUPID gets the pair they made. The LOVERS each get their partner, and
   *     nothing about who chose them.
   *   - The HUNTER gets no standing secret at all — their power is a phase, and
   *     the phase is public the moment it opens.
   *   - The JESTER gets exactly what a villager gets. Being told they are the
   *     Jester is the whole of it.
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

    // The bond goes public the moment it costs somebody their life: both halves
    // are dead by then and both roles are already revealed, so withholding the
    // pair would hide a fact the table can read off the bodies.
    const bondBroken = state.lovers.some((id) => state.dead.includes(id))
    const inLove = sessionId !== null && state.lovers.includes(sessionId)
    const seesBond = finished || bondBroken || yourRole === 'cupid'

    return {
      phase: state.phase,
      night: state.night,
      phaseEndsAt: state.phaseEndsAt,
      dead: state.dead,

      lastKilled: state.lastKilled,
      lastSaved: state.lastSaved,
      lastHealed: state.lastHealed,
      lastPoisoned: state.lastPoisoned,
      lastLynched: state.lastLynched,
      lastShot: state.lastShot,
      lastDeaths: state.lastDeaths,

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

      // Gated on the phase as well as the role: outside her own phase there is
      // no victim to show, and a stale one left in the payload would be a
      // standing leak for the rest of the day.
      pendingKill:
        yourRole === 'witch' && state.phase === 'witch' ? state.pendingKill : null,
      pendingSaved: yourRole === 'witch' && state.phase === 'witch' ? state.pendingSaved : false,
      healUsed: yourRole === 'witch' ? state.healUsed : false,
      poisonUsed: yourRole === 'witch' ? state.poisonUsed : false,
      witchHealed: yourRole === 'witch' ? state.witchHealed : false,
      witchPoison: yourRole === 'witch' ? state.witchPoison : null,

      lovers: seesBond ? state.lovers : [],
      yourLover: inLove
        ? (state.lovers.find((id) => id !== sessionId) ?? null)
        : null,

      // Public. The phase itself announces that a Hunter died; naming them is
      // no more than the revealed-roles list already says.
      revengeBy: state.revengeBy,

      winningTeam: state.winningTeam,
    }
  },

  chatAudience(state: WerewolfState, sessionId: string): ChatAudience {
    if (!state.order.includes(sessionId)) {
      return { ok: false, reason: 'not-a-player' }
    }

    // Checked before the phase gate: the dead keep talking among themselves
    // whatever the living are doing, and they never reach the living again.
    // That includes a Hunter mid-shot — they are dead, and their channel is the
    // dead one even while the whole table is watching them aim.
    if (state.dead.includes(sessionId)) {
      return { ok: true, channel: 'dead', to: [...state.dead] }
    }

    // The pack confers through the whole night, Cupid's and the Witch's beats
    // included. This is the channel that makes a two-wolf game playable without
    // a side call the server cannot see.
    if (NIGHT_PHASES.includes(state.phase)) {
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
