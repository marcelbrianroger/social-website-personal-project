import assert from 'node:assert/strict'
import { describe, it } from 'node:test'

import {
  DARE_MS,
  TOTAL_QUESTIONS,
  VETOS_PER_PLAYER,
  thirtySixQuestions,
  type QuestionMove,
  type ThirtySixQuestionsProjection,
  type ThirtySixQuestionsState,
} from '../../src/games/thirty-six-questions.js'
import { DARES, QUESTIONS } from '../../src/games/thirty-six-questions-content.js'
import type { GamePlayer } from '../../src/games/types.js'

/**
 * 36 Questions — the co-operative one, with Veto and Penalty.
 *
 * Seam: the GameDefinition contract. No Redis and no sockets.
 *
 * Two things here are unlike every other game in the registry, and they are
 * what these tests are mostly about:
 *
 *   - NOBODY TAKES TURNS. Both players are actors on every question, because
 *     the real thing is a conversation and either person can say "next".
 *   - A DARE INVERTS WHO MAY ACT. While one player performs, only the OTHER
 *     may end it — so the tests care a great deal about which of the two is
 *     being refused, and why.
 */

function player(nickname: string): GamePlayer {
  return {
    sessionId: `session-${nickname.toLowerCase()}`,
    socketId: `socket-${nickname.toLowerCase()}`,
    nickname,
  }
}

const alice = player('Alice')
const bob = player('Bob')

function opening(): ThirtySixQuestionsState {
  return thirtySixQuestions.createInitialState([alice, bob])
}

/** Play a move, asserting the rules allow it. */
function play(
  state: ThirtySixQuestionsState,
  sessionId: string,
  raw: unknown,
): ThirtySixQuestionsState {
  const validation = thirtySixQuestions.validateMove(state, sessionId, raw)
  assert.equal(
    validation.ok,
    true,
    `${JSON.stringify(raw)} should have been legal, got ${
      (validation as { reason?: string }).reason
    }`,
  )

  return thirtySixQuestions.applyMove(
    state,
    sessionId,
    (validation as { ok: true; move: QuestionMove }).move,
  )
}

/** Why a move was refused. Fails if it was actually allowed. */
function refusal(
  state: ThirtySixQuestionsState,
  sessionId: string,
  raw: unknown,
): string {
  const validation = thirtySixQuestions.validateMove(state, sessionId, raw)
  assert.equal(validation.ok, false, `${JSON.stringify(raw)} should have been refused`)
  return (validation as { ok: false; reason: string }).reason
}

function projection(
  state: ThirtySixQuestionsState,
  sessionId: string | null = alice.sessionId,
): ThirtySixQuestionsProjection {
  return thirtySixQuestions.viewFor(state, sessionId) as ThirtySixQuestionsProjection
}

/** Advance `count` questions, alternating who presses the button. */
function advance(state: ThirtySixQuestionsState, count: number): ThirtySixQuestionsState {
  let next = state

  for (let index = 0; index < count; index += 1) {
    const mover = index % 2 === 0 ? alice.sessionId : bob.sessionId
    next = play(next, mover, { type: 'next' })
  }

  return next
}

/** Alice vetoes, producing an active dare against her. */
function vetoed(state = opening()): ThirtySixQuestionsState {
  return play(state, alice.sessionId, { type: 'veto' })
}

describe('the content', () => {
  it('carries a full bank, and deals a short game out of it', () => {
    // THESE ARE TWO DIFFERENT NUMBERS ON PURPOSE. `QUESTIONS` is the source
    // material; `TOTAL_QUESTIONS` is the length of one session. A session deals
    // three from each of the three sets, so the ramp survives the shortening.
    assert.equal(QUESTIONS.length, 36, 'the bank is the original 36')
    assert.equal(TOTAL_QUESTIONS, 9, 'a session plays nine of them')
  })

  it('has no blank or duplicated questions', () => {
    for (const question of QUESTIONS) {
      assert.ok(question.trim().length > 0, 'a blank question would render an empty card')
    }
    assert.equal(new Set(QUESTIONS).size, QUESTIONS.length, 'questions must be distinct')
  })

  it('carries enough dares that a pair does not exhaust them', () => {
    // Two players, one veto each, so a game can draw at most two — but the bank
    // has to be wide enough that the same dare is not a coin flip every match.
    assert.ok(DARES.length >= 8, `expected a real bank, got ${DARES.length}`)
    assert.equal(new Set(DARES).size, DARES.length, 'dares must be distinct')
  })

  it('has no dare that needs anything but a camera and a voice', () => {
    for (const dare of DARES) {
      assert.ok(dare.trim().length > 0)
      assert.ok(dare.length <= 200, `too long to read off a video call: ${dare}`)
    }
  })
})

describe('the opening position', () => {
  it('starts on the first question with nothing owed', () => {
    const state = opening()

    assert.equal(state.questionIndex, 0)
    assert.equal(state.activeDare, null)
    assert.equal(thirtySixQuestions.result(state), null)
  })

  it('gives every player the same veto allowance', () => {
    const state = opening()

    assert.deepEqual(state.vetosRemaining, {
      [alice.sessionId]: VETOS_PER_PLAYER,
      [bob.sessionId]: VETOS_PER_PLAYER,
    })
  })

  it('lets BOTH players act, because it is a conversation not a turn order', () => {
    assert.deepEqual(thirtySixQuestions.actors(opening()).sort(), [
      alice.sessionId,
      bob.sessionId,
    ].sort())
  })

  it('is untimed until a dare is owed', () => {
    assert.equal(
      thirtySixQuestions.deadline(opening()),
      null,
      'a conversation must not be on a clock',
    )
  })

  it('is a two-player game', () => {
    assert.equal(thirtySixQuestions.minPlayers, 2)
    assert.equal(thirtySixQuestions.maxPlayers, 2)
  })

  it('publishes the first question text, not just its index', () => {
    const state = opening()
    // Alice holds seat 0, so she holds the first card and is the one told what
    // it says. Reading the text out of the DEALT DECK, never `QUESTIONS[0]` —
    // the deal is a random draw per set, so the first card is not the first
    // question in the bank.
    const view = projection(state, alice.sessionId)

    assert.equal(view.questionIndex, 0)
    assert.equal(view.question, QUESTIONS[state.deck[0] ?? -1])
    assert.equal(view.set, 1, 'the first of three escalating sets')
  })
})

describe('advancing through the set', () => {
  it('moves to the next question', () => {
    const state = play(opening(), alice.sessionId, { type: 'next' })

    assert.equal(state.questionIndex, 1)
    // The card passes with the question, so Bob is the one who can now read it.
    assert.equal(
      projection(state, bob.sessionId).question,
      QUESTIONS[state.deck[1] ?? -1],
    )
  })

  it('lets only the player holding the card advance', () => {
    // Alice holds card 0. Advancing is hers alone — the partner reading along
    // cannot move the deck on, or the person mid-answer gets cut off.
    assert.equal(play(opening(), alice.sessionId, { type: 'next' }).questionIndex, 1)
    assert.equal(
      refusal(opening(), bob.sessionId, { type: 'next' }),
      'not-your-card',
    )
  })

  it('walks all three sets', () => {
    // Nine cards, three per set: positions 0-2 are set one, 3-5 set two, 6-8
    // set three. `set` reports where a card CAME FROM in the bank, so it is
    // readable by either player and not gated on whose turn it is.
    assert.equal(projection(advance(opening(), 2)).set, 1, 'card three is still set one')
    assert.equal(projection(advance(opening(), 3)).set, 2)
    assert.equal(projection(advance(opening(), 6)).set, 3)
  })

  it('finishes once the last question is done', () => {
    const state = advance(opening(), TOTAL_QUESTIONS)

    assert.equal(state.questionIndex, TOTAL_QUESTIONS)
    assert.deepEqual(thirtySixQuestions.actors(state), [])
    assert.equal(projection(state).question, null)
  })

  it('names both players as winners, because nobody was competing', () => {
    const state = advance(opening(), TOTAL_QUESTIONS)

    const result = thirtySixQuestions.result(state)
    assert.equal(result?.reason, 'win')
    assert.deepEqual(
      [...(result?.winnerSessionIds ?? [])].sort(),
      [alice.sessionId, bob.sessionId].sort(),
      'finishing 36 Questions is something the pair did together',
    )
  })

  it('refuses every move once finished', () => {
    const state = advance(opening(), TOTAL_QUESTIONS)

    assert.equal(refusal(state, alice.sessionId, { type: 'next' }), 'game-finished')
    assert.equal(refusal(state, bob.sessionId, { type: 'veto' }), 'game-finished')
  })

  it('refuses a session that is not in the game', () => {
    assert.equal(
      refusal(opening(), 'session-mallory', { type: 'next' }),
      'not-a-player',
    )
  })

  it('refuses input that is not a move at all', () => {
    for (const raw of [null, undefined, 'nope', 42, true, [], () => {}]) {
      const validation = thirtySixQuestions.validateMove(opening(), alice.sessionId, raw)
      assert.equal(validation.ok, false, `${String(raw)} should not validate`)
    }
  })

  it('refuses a move type it does not know', () => {
    assert.equal(
      refusal(opening(), alice.sessionId, { type: 'skip-to-end' }),
      'malformed-move',
    )
  })
})

describe('vetoing a question', () => {
  it('serves a dare to the player who vetoed', () => {
    const state = vetoed()

    assert.notEqual(state.activeDare, null)
    assert.equal(state.activeDare?.sessionId, alice.sessionId)
  })

  it('draws the dare text from the bank', () => {
    const state = vetoed()

    assert.ok(
      DARES.includes(state.activeDare?.text ?? ''),
      'the dare has to be one we actually wrote',
    )
  })

  it('records which question was refused', () => {
    const state = vetoed(advance(opening(), 5))

    assert.equal(state.activeDare?.questionIndex, 5)
  })

  it('spends the veto', () => {
    const state = vetoed()

    assert.equal(state.vetosRemaining[alice.sessionId], VETOS_PER_PLAYER - 1)
  })

  it('does not spend the partner’s veto', () => {
    const state = vetoed()

    assert.equal(state.vetosRemaining[bob.sessionId], VETOS_PER_PLAYER)
  })

  it('does not advance the question by itself', () => {
    const state = vetoed(advance(opening(), 3))

    assert.equal(
      state.questionIndex,
      3,
      'the dare has to be performed before the pair moves on',
    )
  })

  it('refuses a second veto from a player who has spent theirs', () => {
    // Alice vetoes, Bob ends her dare, then Alice tries again.
    const resumed = play(vetoed(), bob.sessionId, { type: 'dare-resolved' })

    assert.equal(refusal(resumed, alice.sessionId, { type: 'veto' }), 'no-vetos-left')
  })

  it('still lets the partner spend their own', () => {
    const resumed = play(vetoed(), bob.sessionId, { type: 'dare-resolved' })
    const bobVetoed = play(resumed, bob.sessionId, { type: 'veto' })

    assert.equal(bobVetoed.activeDare?.sessionId, bob.sessionId)
  })

  it('never serves the same dare twice in one game', () => {
    const first = vetoed()
    const resumed = play(first, bob.sessionId, { type: 'dare-resolved' })
    const second = play(resumed, bob.sessionId, { type: 'veto' })

    assert.notEqual(
      first.activeDare?.text,
      second.activeDare?.text,
      'drawing the same dare twice reads as a broken shuffle',
    )
  })
})

describe('while a dare is owed', () => {
  it('hands the only action to the partner', () => {
    assert.deepEqual(
      thirtySixQuestions.actors(vetoed()),
      [bob.sessionId],
      'the penalised player is performing, not clicking',
    )
  })

  it('refuses to let the penalised player end their own dare', () => {
    assert.equal(
      refusal(vetoed(), alice.sessionId, { type: 'dare-resolved' }),
      'not-your-dare',
    )
  })

  it('refuses to let anyone skip past it', () => {
    const state = vetoed()

    assert.equal(refusal(state, alice.sessionId, { type: 'next' }), 'dare-in-progress')
    assert.equal(refusal(state, bob.sessionId, { type: 'next' }), 'dare-in-progress')
  })

  it('refuses a veto stacked on top of a dare', () => {
    assert.equal(refusal(vetoed(), bob.sessionId, { type: 'veto' }), 'dare-in-progress')
  })

  it('refuses a resolution when nothing is owed', () => {
    assert.equal(
      refusal(opening(), bob.sessionId, { type: 'dare-resolved' }),
      'no-active-dare',
    )
  })

  it('clears the dare and moves on when the partner confirms', () => {
    const state = play(vetoed(advance(opening(), 2)), bob.sessionId, {
      type: 'dare-resolved',
    })

    assert.equal(state.activeDare, null)
    assert.equal(state.questionIndex, 3, 'the refused question is behind them now')
    // Bob alone: he holds card 3, and he is also the only one with a veto left
    // — Alice spent hers to land here. Both routes into `actors` point at him.
    assert.deepEqual(thirtySixQuestions.actors(state), [bob.sessionId])
  })

  it('projects the dare so the UI can render it', () => {
    const view = projection(vetoed())

    assert.equal(view.activeDare?.sessionId, alice.sessionId)
    assert.ok((view.activeDare?.text ?? '').length > 0)
  })

  it('can end the game, if the refused question was the last one', () => {
    const last = vetoed(advance(opening(), TOTAL_QUESTIONS - 1))
    const state = play(last, bob.sessionId, { type: 'dare-resolved' })

    assert.equal(state.questionIndex, TOTAL_QUESTIONS)
    assert.equal(thirtySixQuestions.result(state)?.reason, 'win')
  })
})

describe('the stall guard', () => {
  /**
   * The partner holds the only button that ends a dare, which is the whole
   * point — and also a way to freeze the room forever if they wander off. The
   * engine's phase clock is the answer: the dare carries a deadline, and `tick`
   * resolves it without anyone pressing anything.
   */
  it('puts the dare on a deadline', () => {
    const before = Date.now()
    const state = vetoed()
    const deadline = thirtySixQuestions.deadline(state)

    assert.notEqual(deadline, null, 'an unresolved dare must be sweepable')
    assert.ok(
      (deadline as number) >= before && (deadline as number) <= Date.now() + DARE_MS,
      `deadline ${deadline} should be within one dare window`,
    )
    assert.equal(deadline, state.activeDare?.endsAt)
  })

  it('does nothing while there is still time', () => {
    const state = vetoed()

    assert.equal(
      thirtySixQuestions.tick(state, Date.now()),
      null,
      'a dare in progress is not the sweeper’s business',
    )
  })

  it('resolves the dare itself once the window closes', () => {
    const state = vetoed(advance(opening(), 4))
    const ticked = thirtySixQuestions.tick(state, (state.activeDare?.endsAt ?? 0) + 1)

    assert.notEqual(ticked, null, 'an expired dare has to be cleared by the clock')
    assert.equal(ticked?.activeDare, null)
    assert.equal(ticked?.questionIndex, 5, 'and the pair moves on, exactly as if confirmed')
  })

  it('returns null on a second tick, so a duplicate sweep is harmless', () => {
    // Two nodes can sweep the same due game at once; the CAS loser re-reads and
    // ticks again, and must find nothing left to do.
    const state = vetoed()
    const expired = (state.activeDare?.endsAt ?? 0) + 1
    const ticked = thirtySixQuestions.tick(state, expired) as ThirtySixQuestionsState

    assert.equal(thirtySixQuestions.tick(ticked, expired), null)
  })

  it('does not tick a game with nothing owed', () => {
    assert.equal(thirtySixQuestions.tick(opening(), Date.now() + DARE_MS), null)
  })

  it('leaves the spent veto spent', () => {
    const state = vetoed()
    const ticked = thirtySixQuestions.tick(state, (state.activeDare?.endsAt ?? 0) + 1)

    assert.equal(
      ticked?.vetosRemaining[alice.sessionId],
      VETOS_PER_PLAYER - 1,
      'waiting out the clock must not refund the veto',
    )
  })
})

describe('purity', () => {
  it('does not mutate the state applyMove was given', () => {
    const state = opening()
    const snapshot = structuredClone(state)

    thirtySixQuestions.applyMove(state, alice.sessionId, { type: 'veto' })

    assert.deepEqual(
      state,
      snapshot,
      'the engine stores the returned state; mutating the input would corrupt a CAS retry',
    )
  })

  it('does not mutate the veto ledger it copied', () => {
    const state = opening()
    const snapshot = structuredClone(state)

    thirtySixQuestions.applyMove(state, alice.sessionId, { type: 'veto' })

    assert.deepEqual(state.vetosRemaining, snapshot.vetosRemaining)
  })

  it('does not mutate on tick', () => {
    const state = vetoed()
    const snapshot = structuredClone(state)

    thirtySixQuestions.tick(state, (state.activeDare?.endsAt ?? 0) + 1)

    assert.deepEqual(state, snapshot)
  })
})

describe('walking out', () => {
  it('awards the game to the player who stayed', () => {
    const state = thirtySixQuestions.forfeit(advance(opening(), 3), alice.sessionId)

    assert.deepEqual(thirtySixQuestions.result(state), {
      winnerSessionIds: [bob.sessionId],
      reason: 'forfeit',
    })
    assert.deepEqual(thirtySixQuestions.actors(state), [])
  })

  it('treats losing one of two players as the end', () => {
    const state = thirtySixQuestions.eliminate(opening(), bob.sessionId, Date.now())

    assert.equal(thirtySixQuestions.result(state)?.reason, 'forfeit')
  })

  it('leaves a completed game alone', () => {
    const done = advance(opening(), TOTAL_QUESTIONS)
    const state = thirtySixQuestions.forfeit(done, bob.sessionId)

    assert.equal(state, done, 'a finished state is returned untouched')
    assert.equal(thirtySixQuestions.result(state)?.reason, 'win')
  })

  it('drops any dare that was owed', () => {
    const state = thirtySixQuestions.forfeit(vetoed(), bob.sessionId)

    assert.equal(
      thirtySixQuestions.deadline(state),
      null,
      'an abandoned game must leave nothing in the sweeper’s index',
    )
  })
})

describe('viewFor', () => {
  it('shows the question only to whoever is holding the card', () => {
    const state = opening()

    assert.equal(
      projection(state, alice.sessionId).question,
      QUESTIONS[state.deck[0] ?? -1],
      'Alice holds seat 0, so she reads card 0 out loud',
    )
    assert.equal(
      projection(state, bob.sessionId).question,
      null,
      'the partner answers the question, they do not read ahead',
    )
    assert.equal(
      projection(state, null).question,
      null,
      'and an observer is not in the conversation at all',
    )
  })

  it('shows everything BUT the question text to both alike', () => {
    const state = vetoed(advance(opening(), 7))

    // The card is the only scoped field. The dare, the veto tally, the set
    // number and the clock are all public — a partner who could not see the
    // dare could not confirm it.
    assert.deepEqual(
      { ...projection(state, alice.sessionId), question: null },
      { ...projection(state, bob.sessionId), question: null },
    )
  })

  it('does not publish the seat order, which the UI never needs', () => {
    const view = projection(opening()) as unknown as Record<string, unknown>

    assert.equal('order' in view, false)
  })
})

describe('chat', () => {
  it('is closed, because the pair are already on a video call', () => {
    assert.deepEqual(thirtySixQuestions.chatAudience(opening(), alice.sessionId), {
      ok: false,
      reason: 'chat-not-supported',
    })
  })
})
