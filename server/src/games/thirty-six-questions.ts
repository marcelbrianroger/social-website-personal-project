import { randomInt } from 'node:crypto'

import { DARES, QUESTIONS } from './thirty-six-questions-content.js'
import type {
  ChatAudience,
  GameDefinition,
  GamePlayer,
  GameResult,
} from './types.js'

/**
 * 36 Questions — the Aron et al. closeness protocol, with Veto and Penalty.
 *
 * Two people work through a short deck of escalating questions on a video call.
 * It is CO-OPERATIVE: there is nothing to win off each other, so finishing the
 * deck names both of them, and the only losing move is walking out.
 *
 * A NINE-CARD DECK, NOT ALL 36. Three questions are drawn at random from each
 * of the three sets at deal time. The full 36 is a two-hour commitment that
 * almost nobody finishes, and an abandoned session is worth less than a
 * completed short one; drawing per set rather than nine at random from the pile
 * is what preserves the escalation the study actually depends on.
 *
 * ONE PLAYER HOLDS THE CARD. The question text is shown ONLY to whoever's turn
 * it is — they read it aloud, and their partner hears it rather than reading
 * ahead. That makes the question hidden information, so it is stripped in
 * `viewFor` rather than merely hidden in the UI: anything sent to the browser
 * is readable in devtools no matter what the component renders.
 *
 * THE CARD HOLDER RUNS THE DECK. Only they may move on, because only they can
 * see whether there is anything left to ask. The VETO deliberately does not
 * follow: it stays with both players, since the person who wants to refuse a
 * question is the one being asked it, and moving the refusal to the reader
 * would leave it with the wrong seat entirely.
 *
 * VETO AND PENALTY is the one adversarial edge. A player who does not want to
 * answer may refuse, once, and pays for it with a dare drawn at random. The
 * question they refused is skipped when the dare is done, so a veto costs the
 * question AND the forfeit — otherwise it would just be a free skip button.
 *
 * A DARE INVERTS WHO MAY ACT, and this is the subtle part. While a dare is
 * owed, the ONLY legal move belongs to the partner: the penalised player is
 * performing, and letting them close their own penalty makes it worthless. That
 * hands the partner a button the room cannot proceed without, so the dare
 * carries a deadline and `tick` resolves it if they wander off. The clock is
 * data, not a timer — the engine sweeps due games out of a Redis sorted set, so
 * an abandoned dare survives a process restart and a duplicate sweep is a
 * no-op.
 */

/** The three sets the source material is organised into. */
const SET_COUNT = 3

/** Twelve. Derived rather than written down so the two cannot drift apart. */
const SET_SIZE = Math.floor(QUESTIONS.length / SET_COUNT)

/** How many questions are drawn from each set at deal time. */
export const QUESTIONS_PER_SET = 3

/**
 * Questions in a session — NINE, not the 36 in the bank.
 *
 * `QUESTIONS.length` is the size of the source material; this is the length of
 * a game. Read `state.deck.length` in preference to this at runtime: it is the
 * authority for a session that was dealt under a different setting.
 */
export const TOTAL_QUESTIONS = QUESTIONS_PER_SET * SET_COUNT

/**
 * One refusal each.
 *
 * The scarcity is the mechanic. With two vetoes a player saves one for set
 * three and the hard questions stop landing; with one, spending it on question
 * four is a real decision.
 */
export const VETOS_PER_PLAYER = 1

/**
 * How long a dare may sit unconfirmed before the clock ends it.
 *
 * Generous, because some of these are genuinely a three-minute performance and
 * being cut off mid-recipe is worse than waiting. This is a stall guard, not a
 * time limit — the partner confirming is the normal way out.
 */
export const DARE_MS = 180_000

export interface ActiveDare {
  /** Index into DARES. Kept so a game never draws the same one twice. */
  id: number
  text: string
  /** Who owes it. */
  sessionId: string
  /** The question they refused, so the UI can say what is being skipped. */
  questionIndex: number
  /** Epoch ms at which the clock gives up waiting for the partner. */
  endsAt: number
}

export interface ThirtySixQuestionsState {
  /**
   * sessionIds in seat order, fixed at creation.
   *
   * Never projected wholesale, but it IS what the turn walks — seat 0 holds the
   * first card — so the projection publishes the one id whose turn it is.
   */
  order: string[]
  /**
   * The nine questions dealt for this session, as indices into QUESTIONS.
   *
   * Indices rather than text so the wording lives in exactly one place, and so
   * a stored game is a handful of numbers rather than a copy of the script.
   */
  deck: number[]
  /** 0-based, into `deck`. Equal to `deck.length` once the deck is done. */
  questionIndex: number
  /** sessionId -> refusals still available. */
  vetosRemaining: Record<string, number>
  activeDare: ActiveDare | null
  /** Dare indices already served, so a pair never gets a repeat. */
  servedDareIds: number[]
  /** Set when someone walked out mid-set. */
  abandonedBy: string | null
}

export type QuestionMove =
  /** Move on. Either player, any time nothing is owed. */
  | { type: 'next' }
  /** Refuse this one and take the penalty instead. */
  | { type: 'veto' }
  /** "They did it." The partner's move, and only theirs. */
  | { type: 'dare-resolved' }

/** What the browser receives. Redacted per viewer — see `viewFor`. */
export interface ThirtySixQuestionsProjection {
  questionIndex: number
  totalQuestions: number
  /**
   * The current question — ONLY for whoever's turn it is.
   *
   * Null in three different situations the UI has to tell apart, which it does
   * from `activeTurn` and `finished`: it is not your turn, the deck is done, or
   * you are an observer.
   */
  question: string | null
  /** Which of the three escalating sets this question came from. */
  set: 1 | 2 | 3 | null
  /**
   * sessionId of whoever holds the card and reads it aloud.
   *
   * Visibility only. Both players may still press Lanjut and Veto — see the
   * header block on why the turn does not gate the move.
   */
  activeTurn: string | null
  vetosRemaining: Record<string, number>
  activeDare: ActiveDare | null
  abandonedBy: string | null
}

/**
 * The deck, defended against a payload that predates it.
 *
 * Stored games live in Redis under a 12h TTL, so a state written before `deck`
 * existed can still be read back. An undefined `.length` would throw inside
 * `isFinished`, which every other method calls first.
 */
function deckOf(state: ThirtySixQuestionsState): number[] {
  return state.deck ?? []
}

function isFinished(state: ThirtySixQuestionsState): boolean {
  return state.questionIndex >= deckOf(state).length || Boolean(state.abandonedBy)
}

/**
 * Whose turn it is to hold the card.
 *
 * Derived from the question number rather than stored, so it cannot drift out
 * of step with the deck — every path that advances a question (a plain `next`,
 * a resolved dare, the clock giving up on one) passes the card automatically,
 * with nothing to remember to update.
 */
function askerOf(state: ThirtySixQuestionsState): string | null {
  if (isFinished(state)) return null
  return state.order[state.questionIndex % state.order.length] ?? null
}

/** The other seat. Total for two players, which is all this game allows. */
function partnerOf(state: ThirtySixQuestionsState, sessionId: string): string | null {
  return state.order.find((id) => id !== sessionId) ?? null
}

/**
 * Draw `count` distinct entries from `pool`, unbiased.
 *
 * A partial Fisher-Yates rather than "pick one, retry if it repeats": the retry
 * version has no bound on how long it runs, and `randomInt` is rejection
 * sampled so the draw itself is already uniform.
 */
function drawDistinct(pool: number[], count: number): number[] {
  const remaining = [...pool]
  const picked: number[] = []

  while (picked.length < count && remaining.length > 0) {
    const [taken] = remaining.splice(randomInt(remaining.length), 1)
    if (taken !== undefined) picked.push(taken)
  }

  return picked
}

/**
 * Deal a session: three questions from each set, in escalating order.
 *
 * PER SET, NOT NINE FROM THE PILE. The whole mechanism of the original study is
 * the ramp from small talk to the questions you would not normally answer, and
 * a flat random nine would sometimes deal three openers and six confessions.
 * Sorting within each set keeps the milder end of a set first, so the ramp holds
 * inside the deck as well as across it.
 */
function dealDeck(): number[] {
  const deck: number[] = []

  for (let set = 0; set < SET_COUNT; set += 1) {
    const start = set * SET_SIZE
    const pool = Array.from({ length: SET_SIZE }, (_, offset) => start + offset)

    deck.push(...drawDistinct(pool, QUESTIONS_PER_SET).sort((a, b) => a - b))
  }

  return deck
}

/**
 * Draw a dare this game has not served yet.
 *
 * `randomInt` is rejection-sampled and unbiased; `% length` on a raw draw would
 * favour the front of the bank. The fallback matters more than it looks: if
 * every dare has been served the filter is empty, and drawing from an empty
 * list would hand the caller `undefined` and put a dare with no text on screen.
 */
function drawDare(served: number[]): { id: number; text: string } {
  const remaining = DARES.map((_, id) => id).filter((id) => !served.includes(id))
  const pool = remaining.length > 0 ? remaining : DARES.map((_, id) => id)
  const id = pool[randomInt(pool.length)] ?? 0

  return { id, text: DARES[id] ?? '' }
}

/**
 * Clear the dare and move the pair on.
 *
 * The single exit for BOTH ways a dare can end — the partner confirming, and
 * the clock giving up on them. Keeping them one function is what guarantees a
 * timed-out dare leaves exactly the state a confirmed one does, including the
 * spent veto, which must not be refunded for waiting.
 */
function resolveDare(state: ThirtySixQuestionsState): ThirtySixQuestionsState {
  return {
    ...state,
    activeDare: null,
    questionIndex: state.questionIndex + 1,
  }
}

/** A finished game keeps its ending. */
function concede(
  state: ThirtySixQuestionsState,
  quittingSessionId: string,
): ThirtySixQuestionsState {
  if (isFinished(state)) return state
  // The dare goes with them: nobody is left to perform it or to judge it, and
  // leaving it set would keep the sweeper waking up for a dead game.
  return { ...state, activeDare: null, abandonedBy: quittingSessionId }
}

export const thirtySixQuestions: GameDefinition<ThirtySixQuestionsState, QuestionMove> = {
  id: 'thirty-six-questions',
  label: '36 Pertanyaan',
  minPlayers: 2,
  maxPlayers: 2,

  createInitialState(players: GamePlayer[]): ThirtySixQuestionsState {
    const order = players.map((player) => player.sessionId)

    const vetosRemaining: Record<string, number> = {}
    for (const id of order) vetosRemaining[id] = VETOS_PER_PLAYER

    return {
      order,
      deck: dealDeck(),
      questionIndex: 0,
      vetosRemaining,
      activeDare: null,
      servedDareIds: [],
      abandonedBy: null,
    }
  },

  /**
   * Whoever has a legal move right now, which is not simply "both".
   *
   * The card holder always does — they can move on. Their partner only does
   * while they still have a veto to spend; once it is gone they have nothing to
   * press until the card comes round to them. Reporting that honestly is what
   * lets the UI grey the right controls without second-guessing the rules.
   *
   * A dare inverts it entirely: the penalised player is performing, and the
   * partner holds the only button in the room.
   */
  actors(state: ThirtySixQuestionsState): string[] {
    if (isFinished(state)) return []

    if (state.activeDare) {
      const partner = partnerOf(state, state.activeDare.sessionId)
      return partner ? [partner] : []
    }

    const asker = askerOf(state)

    return state.order.filter(
      (id) => id === asker || (state.vetosRemaining[id] ?? 0) > 0,
    )
  },

  /** Untimed — except a dare nobody has confirmed. */
  deadline(state: ThirtySixQuestionsState): number | null {
    if (isFinished(state)) return null
    return state.activeDare?.endsAt ?? null
  },

  tick(state: ThirtySixQuestionsState, now: number): ThirtySixQuestionsState | null {
    if (isFinished(state)) return null
    if (!state.activeDare) return null
    if (now < state.activeDare.endsAt) return null

    // Null on the second pass, because `activeDare` is gone by then — which is
    // what makes two nodes sweeping the same game harmless.
    return resolveDare(state)
  },

  /** No chat: the pair are looking at each other on a video call already. */
  chatAudience(): ChatAudience {
    return { ok: false, reason: 'chat-not-supported' }
  },

  validateMove(state: ThirtySixQuestionsState, sessionId: string, raw: unknown) {
    if (isFinished(state)) {
      return { ok: false as const, reason: 'game-finished' }
    }

    if (!state.order.includes(sessionId)) {
      return { ok: false as const, reason: 'not-a-player' }
    }

    if (typeof raw !== 'object' || raw === null) {
      return { ok: false as const, reason: 'malformed-move' }
    }

    const type = (raw as Record<string, unknown>)['type']

    switch (type) {
      case 'next': {
        if (state.activeDare) {
          return { ok: false as const, reason: 'dare-in-progress' }
        }
        // Enforced here, not merely greyed out in the browser. The listener
        // cannot see the question, so letting them advance from devtools would
        // skip a card their partner was still reading aloud.
        if (sessionId !== askerOf(state)) {
          return { ok: false as const, reason: 'not-your-card' }
        }
        return { ok: true as const, move: { type: 'next' as const } }
      }

      case 'veto': {
        if (state.activeDare) {
          return { ok: false as const, reason: 'dare-in-progress' }
        }
        if ((state.vetosRemaining[sessionId] ?? 0) <= 0) {
          return { ok: false as const, reason: 'no-vetos-left' }
        }
        return { ok: true as const, move: { type: 'veto' as const } }
      }

      case 'dare-resolved': {
        if (!state.activeDare) {
          return { ok: false as const, reason: 'no-active-dare' }
        }
        // The whole point of the penalty. Someone marking their own dare done
        // is not a penalty, it is a button.
        if (state.activeDare.sessionId === sessionId) {
          return { ok: false as const, reason: 'not-your-dare' }
        }
        return { ok: true as const, move: { type: 'dare-resolved' as const } }
      }

      default:
        return { ok: false as const, reason: 'malformed-move' }
    }
  },

  applyMove(
    state: ThirtySixQuestionsState,
    sessionId: string,
    move: QuestionMove,
  ): ThirtySixQuestionsState {
    switch (move.type) {
      case 'next':
        return { ...state, questionIndex: state.questionIndex + 1 }

      case 'veto': {
        const dare = drawDare(state.servedDareIds)

        return {
          ...state,
          vetosRemaining: {
            ...state.vetosRemaining,
            [sessionId]: (state.vetosRemaining[sessionId] ?? 0) - 1,
          },
          servedDareIds: [...state.servedDareIds, dare.id],
          activeDare: {
            id: dare.id,
            text: dare.text,
            sessionId,
            // Recorded now, because resolving advances past it and the UI still
            // wants to say which question was bought off.
            questionIndex: state.questionIndex,
            endsAt: Date.now() + DARE_MS,
          },
        }
      }

      case 'dare-resolved':
        return resolveDare(state)

      default:
        return state
    }
  },

  result(state: ThirtySixQuestionsState): GameResult | null {
    if (state.abandonedBy) {
      const stayed = state.order.find((id) => id !== state.abandonedBy)
      return { winnerSessionIds: stayed ? [stayed] : [], reason: 'forfeit' }
    }

    // The dealt deck, not the constant — the same authority `isFinished` uses,
    // or a session could be over by one measure and running by the other.
    if (state.questionIndex >= deckOf(state).length) {
      // Both, because there was never anything to win off each other. The
      // engine's `reason` vocabulary has no word for "you did it together", and
      // a draw would be a worse lie than a shared win.
      return { winnerSessionIds: [...state.order], reason: 'win' }
    }

    return null
  },

  forfeit(state: ThirtySixQuestionsState, quittingSessionId: string): ThirtySixQuestionsState {
    return concede(state, quittingSessionId)
  },

  /**
   * With exactly two players, losing one IS the end — there is no conversation
   * left to have, so this is `forfeit` under another name.
   */
  eliminate(state: ThirtySixQuestionsState, sessionId: string): ThirtySixQuestionsState {
    return concede(state, sessionId)
  },

  /**
   * THE REDACTION SEAM, and for this game it is load-bearing.
   *
   * The question text goes ONLY to whoever's turn it is. Stripping it here
   * rather than hiding it in the component is the whole point: the listener's
   * payload does not contain the question at all, so there is nothing to read
   * in devtools and nothing to read ahead to. An observer (`sessionId` null) is
   * nobody's turn and gets the same nothing.
   *
   * The projection also resolves the deck index into TEXT, which keeps the
   * wording on the server as the single source of truth instead of shipping a
   * copy of all 36 to the browser for the two to drift apart. `order` is
   * dropped: the UI gets its roster from `GameView.players`, and a second copy
   * only invites the two to disagree about who is who.
   */
  viewFor(state: ThirtySixQuestionsState, sessionId: string | null): unknown {
    const deck = deckOf(state)
    const done = isFinished(state)
    const asker = askerOf(state)
    const sourceIndex = deck[state.questionIndex]

    const yourTurn = sessionId !== null && sessionId === asker

    const projection: ThirtySixQuestionsProjection = {
      questionIndex: state.questionIndex,
      // From the deck, not the constant: a session dealt under a different
      // setting still reports its own real length.
      totalQuestions: deck.length,
      question:
        done || !yourTurn || sourceIndex === undefined
          ? null
          : (QUESTIONS[sourceIndex] ?? null),
      // Which set it CAME FROM, derived from the source index rather than the
      // position in the deck, so it stays truthful if the deal ever changes.
      set:
        done || sourceIndex === undefined
          ? null
          : ((Math.floor(sourceIndex / SET_SIZE) + 1) as 1 | 2 | 3),
      activeTurn: asker,
      vetosRemaining: state.vetosRemaining,
      activeDare: state.activeDare,
      abandonedBy: state.abandonedBy,
    }

    return projection
  },
}
