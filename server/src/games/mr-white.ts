import { randomInt } from 'node:crypto'

import type {
  ChatAudience,
  GameDefinition,
  GamePlayer,
  GameResult,
} from './types.js'

/**
 * Mr. White — hidden-role social deduction.
 *
 * Civilians share a secret word. Exactly one player, Mr. White, is given no
 * word and must infer it from everyone else's clues while bluffing one of their
 * own. Civilians win by voting Mr. White out AND surviving the final guess;
 * Mr. White wins by lasting to the final two, or by naming the word after being
 * caught.
 *
 * THE ANTI-CHEAT SEAM IS `viewFor`. Everything the browser receives passes
 * through it, and anything present is readable in devtools no matter what the
 * UI renders. Two consequences drive the shape of this file:
 *
 *   - No projection may contain another player's sessionId while their role is
 *     still secret. That is why `order` never leaves this module — the roster
 *     the UI draws comes from `GameView.players`, which carries no roles.
 *   - Votes are withheld until `reveal-vote`. Not to be coy: a live tally on
 *     screen is what causes bandwagoning, and hiding it in the UI alone would
 *     be theatre.
 *
 * THE PHASE CLOCK is data, not a timer. `phaseEndsAt` lives in state, `tick` is
 * pure, and the engine sweeps due games out of a Redis sorted set. That is what
 * makes a phase survive a process restart, and what makes a duplicate tick from
 * two nodes harmless — the second one finds nothing to do and returns null.
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

export interface MrWhiteState {
  /**
   * sessionIds in seat order, fixed at creation. The clue rotation walks this,
   * so it must be stable — the engine derives it from `joinedAt`.
   *
   * Never projected: it names every player, which during `reveal` would be
   * enough to correlate with `roles` if either ever leaked.
   */
  order: string[]
  roles: Record<string, MrWhiteRole>
  secretWord: string

  phase: MrWhitePhase
  round: number
  /** Epoch ms. Every non-terminal phase has one, or the game would deadlock. */
  phaseEndsAt: number

  eliminated: string[]
  /** sessionId -> word for this round, or null where the clue clock ran out. */
  clues: Record<string, string | null>
  /** voter -> target, for the current vote only. */
  votes: Record<string, string>
  /**
   * Living players who have said they are done arguing.
   *
   * A strict majority ends the discussion early. Public on purpose: seeing
   * "2 of 4 ready" is what makes the button worth pressing, and wanting to move
   * on reveals nothing about anyone's role.
   */
  readyToVote: string[]

  /** Who the last vote removed. null after a tie, which eliminates nobody. */
  lastEliminated: string | null
  /** Mr. White's final guess, once submitted. */
  guess: string | null
  /** Set only when the game ends normally. */
  winningTeam: WinningTeam | null
  /** Set when someone walked out mid-game. */
  abandonedBy: string | null
}

export type MrWhiteMove =
  | { type: 'clue'; word: string }
  | { type: 'vote'; target: string }
  | { type: 'guess'; word: string }
  /** Toggle "I am done arguing". A majority ends the discussion early. */
  | { type: 'ready' }

/**
 * Phase lengths in ms, from the Phase 5 design doc.
 *
 * `clue` is per turn, not per round — the clock restarts for each player.
 */
const PHASE_MS: Record<Exclude<MrWhitePhase, 'finished'>, number> = {
  reveal: 10_000,
  clue: 30_000,
  discussion: 90_000,
  vote: 45_000,
  'reveal-vote': 8_000,
  guess: 30_000,
}

/** Phases in which individual votes may be shown. Never during `vote` itself. */
const VOTES_VISIBLE: readonly MrWhitePhase[] = ['reveal-vote', 'guess', 'finished']

/**
 * A clue is ONE word.
 *
 * The whole game is that a single word has to prove you know the secret
 * without handing it over; a phrase lets a civilian describe the word until
 * Mr. White simply reads the answer off the screen. The length cap is the
 * other half of the same rule — without it, a pasted paragraph with the spaces
 * stripped out would pass the whitespace check.
 */
const MAX_CLUE_LENGTH = 24

/**
 * Concrete nouns only.
 *
 * An abstract word ("freedom") makes every clue equally plausible, which
 * removes the deduction the game is built on. Two-word answers are avoided for
 * the same reason the guess comparison is loose: near-misses should not turn on
 * spelling.
 */
const WORDS: readonly string[] = [
  'Lighthouse',
  'Bicycle',
  'Umbrella',
  'Postcard',
  'Elevator',
  'Pineapple',
  'Telescope',
  'Mailbox',
  'Campfire',
  'Passport',
  'Snowman',
  'Keyboard',
  'Windmill',
  'Suitcase',
  'Fountain',
  'Compass',
  'Blanket',
  'Harbour',
  'Lantern',
  'Balcony',
]

// --- Derivations -----------------------------------------------------------

function livingOf(state: MrWhiteState): string[] {
  return state.order.filter((id) => !state.eliminated.includes(id))
}

function impostorOf(state: MrWhiteState): string {
  // `order` and `roles` are written together at creation, so this is total.
  return state.order.find((id) => state.roles[id] === 'mr-white') ?? ''
}

function civiliansOf(state: MrWhiteState): string[] {
  return state.order.filter((id) => state.roles[id] !== 'mr-white')
}

/** Whose turn it is to give a clue: first living seat that has not spoken. */
function currentClueActor(state: MrWhiteState): string | null {
  return state.order.find((id) => !state.eliminated.includes(id) && !(id in state.clues)) ?? null
}

/**
 * Guess comparison.
 *
 * Deliberately forgiving on case and surrounding space. A player who typed the
 * right word with a capital letter has won the game, and losing on that would
 * be indefensible.
 */
function sameWord(a: string, b: string): boolean {
  return a.trim().toLowerCase() === b.trim().toLowerCase()
}

function enter(
  state: MrWhiteState,
  phase: Exclude<MrWhitePhase, 'finished'>,
  now: number,
): MrWhiteState {
  return { ...state, phase, phaseEndsAt: now + PHASE_MS[phase] }
}

function finish(state: MrWhiteState, team: WinningTeam): MrWhiteState {
  return { ...state, phase: 'finished', winningTeam: team }
}

/**
 * Close the vote and decide what happens next.
 *
 * There is no `resolve` phase, because a phase with no deadline and no actors
 * could never advance — it would deadlock. Tallying therefore happens inside
 * the transition out of `vote`, triggered either by the last vote landing or by
 * the clock, and lands directly on the next real phase.
 */
function resolveVote(state: MrWhiteState, now: number): MrWhiteState {
  const tally: Record<string, number> = {}
  for (const target of Object.values(state.votes)) {
    tally[target] = (tally[target] ?? 0) + 1
  }

  let top: string | null = null
  let best = 0
  let tied = false

  for (const [target, count] of Object.entries(tally)) {
    if (count > best) {
      best = count
      top = target
      tied = false
    } else if (count === best) {
      tied = true
    }
  }

  // A tie eliminates nobody. Picking a winner by iteration order would make the
  // outcome depend on Redis' JSON key ordering, which is not a rule anyone
  // agreed to.
  const removed = tied ? null : top

  const next: MrWhiteState = {
    ...state,
    lastEliminated: removed,
    eliminated: removed ? [...state.eliminated, removed] : state.eliminated,
  }

  // Caught the impostor: they get their one shot at the word, after the table
  // has seen who voted for whom.
  if (removed && state.roles[removed] === 'mr-white') {
    return enter(next, 'reveal-vote', now)
  }

  // Down to the final two with Mr. White still seated — no vote can save the
  // civilians from here, so the game is called rather than played out.
  if (livingOf(next).length <= 2) {
    return finish(next, 'mr-white')
  }

  return enter(next, 'reveal-vote', now)
}

/** Open a fresh clue round: clues cleared, votes cleared, seat order restarts. */
function openClueRound(state: MrWhiteState, now: number, round: number): MrWhiteState {
  return enter(
    { ...state, round, clues: {}, votes: {}, readyToVote: [] },
    'clue',
    now,
  )
}

/** Open the argument. Readiness always starts from zero each round. */
function openDiscussion(state: MrWhiteState, now: number): MrWhiteState {
  return enter({ ...state, readyToVote: [] }, 'discussion', now)
}

/** Open the vote, whether the clock ran out or a majority called it early. */
function openVote(state: MrWhiteState, now: number): MrWhiteState {
  return enter({ ...state, votes: {}, readyToVote: [] }, 'vote', now)
}

/** Whether enough of the living have asked to stop arguing. */
function majorityReady(state: MrWhiteState): boolean {
  // Strict majority: 3 of 4, 3 of 5, 2 of 3. A tie is not enough — half the
  // table wanting to move on is exactly the case worth still arguing about.
  return state.readyToVote.length * 2 > livingOf(state).length
}

// --- Definition ------------------------------------------------------------

export const mrWhite: GameDefinition<MrWhiteState, MrWhiteMove> = {
  id: 'mr-white',
  label: 'Mr. White',
  minPlayers: 4,
  maxPlayers: 8,

  createInitialState(players: GamePlayer[]): MrWhiteState {
    const order = players.map((player) => player.sessionId)
    // randomInt is rejection-sampled and unbiased; `% length` on a raw draw
    // would favour low seats whenever the count is not a power of two.
    const impostor = order[randomInt(order.length)]

    const roles: Record<string, MrWhiteRole> = {}
    for (const id of order) {
      roles[id] = id === impostor ? 'mr-white' : 'civilian'
    }

    return {
      order,
      roles,
      secretWord: WORDS[randomInt(WORDS.length)] ?? 'Lighthouse',
      phase: 'reveal',
      round: 1,
      phaseEndsAt: Date.now() + PHASE_MS.reveal,
      eliminated: [],
      clues: {},
      votes: {},
      readyToVote: [],
      lastEliminated: null,
      guess: null,
      winningTeam: null,
      abandonedBy: null,
    }
  },

  actors(state: MrWhiteState): string[] {
    switch (state.phase) {
      case 'clue': {
        const actor = currentClueActor(state)
        return actor ? [actor] : []
      }
      // Simultaneous: everyone still alive may cast at once.
      case 'vote':
        return livingOf(state)
      // Mr. White alone, and only after being voted out.
      case 'guess':
        return [impostorOf(state)]
      // `reveal`, `discussion` and `reveal-vote` are watched, not played. They
      // are advanced by the clock, which is why they still carry a deadline.
      default:
        return []
    }
  },

  deadline(state: MrWhiteState): number | null {
    return state.phase === 'finished' ? null : state.phaseEndsAt
  },

  tick(state: MrWhiteState, now: number): MrWhiteState | null {
    if (state.phase === 'finished') return null
    if (now < state.phaseEndsAt) return null

    switch (state.phase) {
      case 'reveal':
        return openClueRound(state, now, state.round)

      case 'clue': {
        const stalling = currentClueActor(state)
        // Nobody left to speak — fall through to the discussion.
        if (!stalling) return openDiscussion(state, now)

        // A timeout is a skip, recorded as an explicit null so the seat is not
        // asked again. Leaving it absent would hang the rotation forever.
        const skipped: MrWhiteState = {
          ...state,
          clues: { ...state.clues, [stalling]: null },
        }

        return currentClueActor(skipped)
          ? enter(skipped, 'clue', now)
          : openDiscussion(skipped, now)
      }

      case 'discussion':
        return openVote(state, now)

      case 'vote':
        // Anyone who did not vote simply abstains. A silent table must not be
        // able to stall the game indefinitely.
        return resolveVote(state, now)

      case 'reveal-vote': {
        const removed = state.lastEliminated
        if (removed && state.roles[removed] === 'mr-white') {
          return enter(state, 'guess', now)
        }
        return openClueRound(state, now, state.round + 1)
      }

      case 'guess':
        // Silence is a wrong answer.
        return finish(state, 'civilians')

      default:
        return null
    }
  },

  validateMove(state: MrWhiteState, sessionId: string, raw: unknown) {
    if (state.phase === 'finished') {
      return { ok: false as const, reason: 'game-finished' }
    }

    if (!state.order.includes(sessionId)) {
      return { ok: false as const, reason: 'not-a-player' }
    }

    const isImpostor = state.roles[sessionId] === 'mr-white'
    const eliminated = state.eliminated.includes(sessionId)

    // The dead do not act — with one exception: Mr. White's final guess happens
    // precisely because they were voted out.
    if (eliminated && !(state.phase === 'guess' && isImpostor)) {
      return { ok: false as const, reason: 'eliminated' }
    }

    if (typeof raw !== 'object' || raw === null) {
      return { ok: false as const, reason: 'malformed-move' }
    }

    const move = raw as Record<string, unknown>

    switch (move['type']) {
      case 'clue': {
        if (state.phase !== 'clue') {
          return { ok: false as const, reason: 'wrong-phase' }
        }
        // Turn check before shape check, so an out-of-turn player gets the more
        // useful message.
        if (currentClueActor(state) !== sessionId) {
          return { ok: false as const, reason: 'not-your-turn' }
        }

        const word = move['word']
        if (typeof word !== 'string' || word.trim().length === 0) {
          return { ok: false as const, reason: 'malformed-move' }
        }

        const clue = word.trim()

        // One word. Any internal whitespace — including a newline pasted in —
        // makes it a phrase, and a phrase can describe the secret outright.
        if (/\s/u.test(clue)) {
          return { ok: false as const, reason: 'not-one-word' }
        }

        if (clue.length > MAX_CLUE_LENGTH) {
          return { ok: false as const, reason: 'clue-too-long' }
        }

        return { ok: true as const, move: { type: 'clue' as const, word: clue } }
      }

      case 'vote': {
        if (state.phase !== 'vote') {
          return { ok: false as const, reason: 'wrong-phase' }
        }

        const target = move['target']
        if (typeof target !== 'string' || !state.order.includes(target)) {
          return { ok: false as const, reason: 'invalid-target' }
        }
        if (state.eliminated.includes(target)) {
          return { ok: false as const, reason: 'target-eliminated' }
        }

        // Self-votes are legal. Nothing in the rules forbids throwing your own
        // name in, and a player cornered into it is making a real choice.
        return { ok: true as const, move: { type: 'vote' as const, target } }
      }

      case 'guess': {
        if (state.phase !== 'guess') {
          return { ok: false as const, reason: 'wrong-phase' }
        }
        if (!isImpostor) {
          return { ok: false as const, reason: 'not-mr-white' }
        }

        const word = move['word']
        if (typeof word !== 'string' || word.trim().length === 0) {
          return { ok: false as const, reason: 'malformed-move' }
        }

        return { ok: true as const, move: { type: 'guess' as const, word: word.trim() } }
      }

      case 'ready': {
        if (state.phase !== 'discussion') {
          return { ok: false as const, reason: 'wrong-phase' }
        }

        // Note this is legal while `actors(state)` is empty. That is not an
        // inconsistency: `actors` names who may make a *game* move, and the
        // discussion deliberately has none — being ready to stop talking is a
        // vote about the clock, not a play.
        return { ok: true as const, move: { type: 'ready' as const } }
      }

      default:
        return { ok: false as const, reason: 'malformed-move' }
    }
  },

  applyMove(state: MrWhiteState, sessionId: string, move: MrWhiteMove): MrWhiteState {
    const now = Date.now()

    switch (move.type) {
      case 'clue': {
        const clued: MrWhiteState = {
          ...state,
          clues: { ...state.clues, [sessionId]: move.word },
        }

        // Last seat to speak closes the round and opens the argument.
        return currentClueActor(clued)
          ? enter(clued, 'clue', now)
          : openDiscussion(clued, now)
      }

      case 'ready': {
        // Toggle, so a player who changes their mind can take it back — the
        // count is a live reading of the room, not a one-way ratchet.
        const readyToVote = state.readyToVote.includes(sessionId)
          ? state.readyToVote.filter((id) => id !== sessionId)
          : [...state.readyToVote, sessionId]

        const next: MrWhiteState = { ...state, readyToVote }

        return majorityReady(next) ? openVote(next, now) : next
      }

      case 'vote': {
        const voted: MrWhiteState = {
          ...state,
          votes: { ...state.votes, [sessionId]: move.target },
        }

        // Close early once every living player has cast — a full table should
        // not have to sit out the remaining clock.
        const pending = livingOf(voted).filter((id) => !(id in voted.votes))
        return pending.length === 0 ? resolveVote(voted, now) : voted
      }

      case 'guess': {
        const correct = sameWord(move.word, state.secretWord)

        return finish(
          { ...state, guess: move.word },
          correct ? 'mr-white' : 'civilians',
        )
      }

      default:
        return state
    }
  },

  result(state: MrWhiteState): GameResult | null {
    if (state.abandonedBy) {
      // The impostor walking out hands it to the civilians. Anyone else leaving
      // simply breaks the game — there is no honest winner to name.
      return state.roles[state.abandonedBy] === 'mr-white'
        ? { winnerSessionIds: civiliansOf(state), team: 'civilians', reason: 'forfeit' }
        : { winnerSessionIds: [], reason: 'forfeit' }
    }

    if (state.phase !== 'finished' || !state.winningTeam) return null

    return {
      winnerSessionIds:
        state.winningTeam === 'mr-white' ? [impostorOf(state)] : civiliansOf(state),
      team: state.winningTeam,
      reason: 'win',
    }
  },

  forfeit(state: MrWhiteState, quittingSessionId: string): MrWhiteState {
    if (state.phase === 'finished') return state
    if (!state.order.includes(quittingSessionId)) return state

    return { ...state, phase: 'finished', abandonedBy: quittingSessionId }
  },

  /**
   * The redaction.
   *
   * `order` and the unredacted `roles` never appear. During `vote`, `votes` is
   * emptied rather than filtered — a partial map would still reveal who had
   * already cast, which is most of the information.
   */
  viewFor(state: MrWhiteState, sessionId: string | null): unknown {
    const finished = state.phase === 'finished'
    const yourRole = sessionId ? (state.roles[sessionId] ?? null) : null

    return {
      phase: state.phase,
      round: state.round,
      phaseEndsAt: state.phaseEndsAt,
      eliminated: state.eliminated,
      clues: state.clues,
      votes: VOTES_VISIBLE.includes(state.phase) ? state.votes : {},
      // Public: the count is the whole point of the button, and wanting to stop
      // arguing says nothing about anyone's role.
      readyToVote: state.readyToVote,
      lastEliminated: state.lastEliminated,
      guess: state.guess,
      yourRole,
      // Mr. White never learns the word until the game is over, at which point
      // it is public anyway.
      secretWord: finished || yourRole === 'civilian' ? state.secretWord : null,
      roles: finished ? state.roles : null,
    }
  },

  chatAudience(state: MrWhiteState, sessionId: string): ChatAudience {
    if (!state.order.includes(sessionId)) {
      return { ok: false, reason: 'not-a-player' }
    }

    // Checked before the phase gate: the eliminated keep talking among
    // themselves whatever the living are doing.
    if (state.eliminated.includes(sessionId)) {
      return { ok: true, channel: 'dead', to: [...state.eliminated] }
    }

    if (state.phase === 'discussion' || state.phase === 'vote') {
      return { ok: true, channel: 'table', to: livingOf(state) }
    }

    return { ok: false, reason: 'chat-closed' }
  },
}
