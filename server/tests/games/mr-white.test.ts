import assert from 'node:assert/strict'
import { after, describe, it } from 'node:test'

import type { GamePlayer } from '../../src/games/types.js'
import { teardownRedis } from '../helpers/harness.js'

/**
 * Mr. White — the Phase 5 spec suite, now live.
 *
 * Source of truth: docs/superpowers/specs/2026-08-03-phase5-social-deduction-design.md
 *
 * These were written as a skipped red baseline before any implementation
 * existed. The implementation landed, so the skip is gone and every assertion
 * below now runs against real code. Werewolf is still not covered at all — the
 * design doc puts it out of scope pending its own spec.
 *
 * ONE FIXTURE WAS CORRECTED, and only a fixture: see the note on 'eliminates
 * the plurality target'. As scaffolded it tallied 2-2, identical to the tie
 * case it sits next to, so the two tests contradicted each other. No assertion
 * was weakened to make the implementation pass.
 *
 * The dynamic imports through a non-literal specifier are a leftover from when
 * these modules did not exist. They still resolve, so they are left alone
 * rather than churned — the `any` typing that comes with them is the cost.
 */

const MR_WHITE_MODULE = '../../src/games/mr-white.js'
const LOBBY_MODULE = '../../src/lobby.js'
const ENGINE_MODULE = '../../src/game-engine.js'

/**
 * The engine and lobby imports below reach src/redis.ts, which opens three
 * connections at module load. Two are the Socket.io adapter's and go unused
 * here, but an open handle is still an open handle — without this the process
 * finishes every assertion and then hangs forever waiting on the event loop.
 *
 * Not needed while this suite was skipped, because nothing was ever imported.
 */
after(teardownRedis)

/* eslint-disable @typescript-eslint/no-explicit-any */

async function loadMrWhite(): Promise<any> {
  const loaded = await import(MR_WHITE_MODULE)
  return loaded.mrWhite
}

function player(nickname: string): GamePlayer {
  return {
    sessionId: `session-${nickname.toLowerCase()}`,
    socketId: `socket-${nickname.toLowerCase()}`,
    nickname,
  }
}

const PLAYERS = ['Alice', 'Bob', 'Carol', 'Dave'].map(player)

/** Everyone who is not Mr. White, according to a definition's own state. */
function civiliansOf(state: any): string[] {
  return Object.entries(state.roles as Record<string, string>)
    .filter(([, role]) => role !== 'mr-white')
    .map(([sessionId]) => sessionId)
}

function mrWhiteOf(state: any): string {
  return Object.entries(state.roles as Record<string, string>).find(
    ([, role]) => role === 'mr-white',
  )![0]
}

/**
 * Formerly `{ skip: ... }`.
 *
 * Kept as an empty options object rather than deleted from 39 call sites, so
 * the diff that turned this suite on is one line and reviewable as such.
 */
const PENDING = {} as const

describe('Mr. White — role assignment', () => {
  it('gives exactly one player the Mr. White role', PENDING, async () => {
    const mrWhite = await loadMrWhite()
    const state = mrWhite.createInitialState(PLAYERS)

    const impostors = Object.values(state.roles).filter(
      (role) => role === 'mr-white',
    )

    assert.equal(impostors.length, 1)
  })

  it('gives every civilian the same secret word', PENDING, async () => {
    const mrWhite = await loadMrWhite()
    const state = mrWhite.createInitialState(PLAYERS)

    const words = civiliansOf(state).map(
      (sessionId) => mrWhite.viewFor(state, sessionId).secretWord,
    )

    assert.equal(new Set(words).size, 1, 'civilians must share one word')
    assert.ok(words[0], 'and it must not be empty')
  })

  it('does not assign the same player Mr. White every game', PENDING, async () => {
    const mrWhite = await loadMrWhite()

    const chosen = new Set(
      Array.from({ length: 50 }, () =>
        mrWhiteOf(mrWhite.createInitialState(PLAYERS)),
      ),
    )

    assert.ok(chosen.size > 1, 'the role must be randomised between games')
  })

  it('accepts 4 to 8 players', PENDING, async () => {
    const mrWhite = await loadMrWhite()

    assert.equal(mrWhite.minPlayers, 4)
    assert.equal(mrWhite.maxPlayers, 8)
  })
})

describe('Mr. White — redaction (the anti-cheat seam)', () => {
  it('never puts another player’s role on the wire', PENDING, async () => {
    const mrWhite = await loadMrWhite()
    const state = mrWhite.createInitialState(PLAYERS)
    const impostor = mrWhiteOf(state)

    for (const viewer of PLAYERS) {
      const serialised = JSON.stringify(mrWhite.viewFor(state, viewer.sessionId))

      if (viewer.sessionId === impostor) continue
      assert.equal(
        serialised.includes(impostor),
        false,
        `a civilian's payload named Mr. White — devtools would show it regardless of the UI`,
      )
    }
  })

  it('withholds the secret word from Mr. White', PENDING, async () => {
    const mrWhite = await loadMrWhite()
    const state = mrWhite.createInitialState(PLAYERS)
    const impostor = mrWhiteOf(state)

    const view = mrWhite.viewFor(state, impostor)

    assert.equal(view.yourRole, 'mr-white', 'they must know they are the impostor')
    assert.equal(view.secretWord, null, 'but never learn the word')
  })

  it('tells an observer nothing', PENDING, async () => {
    const mrWhite = await loadMrWhite()
    const state = mrWhite.createInitialState(PLAYERS)

    const view = mrWhite.viewFor(state, null)

    assert.equal(view.yourRole, null)
    assert.equal(view.secretWord, null)
  })

  it('hides individual votes while voting is open', PENDING, async () => {
    const mrWhite = await loadMrWhite()
    const state = {
      ...mrWhite.createInitialState(PLAYERS),
      phase: 'vote',
      votes: { [PLAYERS[0]!.sessionId]: PLAYERS[1]!.sessionId },
    }

    const view = mrWhite.viewFor(state, PLAYERS[2]!.sessionId)

    assert.equal(
      JSON.stringify(view).includes(PLAYERS[1]!.sessionId),
      false,
      'visible tallies cause bandwagoning',
    )
  })

  it('reveals who voted for whom at reveal-vote', PENDING, async () => {
    const mrWhite = await loadMrWhite()
    const state = {
      ...mrWhite.createInitialState(PLAYERS),
      phase: 'reveal-vote',
      votes: { [PLAYERS[0]!.sessionId]: PLAYERS[1]!.sessionId },
    }

    const view = mrWhite.viewFor(state, PLAYERS[2]!.sessionId)

    assert.deepEqual(view.votes, {
      [PLAYERS[0]!.sessionId]: PLAYERS[1]!.sessionId,
    })
  })

  it('reveals every role once the game is finished', PENDING, async () => {
    const mrWhite = await loadMrWhite()
    const base = mrWhite.createInitialState(PLAYERS)
    const state = { ...base, phase: 'finished' }

    const view = mrWhite.viewFor(state, PLAYERS[0]!.sessionId)

    assert.deepEqual(view.roles, base.roles)
    assert.equal(view.secretWord, base.secretWord)
  })
})

describe('Mr. White — phases', () => {
  it('gives every non-terminal phase a deadline, actors, or both', PENDING, async () => {
    const mrWhite = await loadMrWhite()

    // The design doc calls this out explicitly: a phase with neither would
    // deadlock, because nothing could ever advance it. That is why there is no
    // `resolve` phase — tallying happens inside the transition out of `vote`.
    for (const phase of [
      'reveal',
      'clue',
      'discussion',
      'vote',
      'reveal-vote',
      'guess',
    ]) {
      const state = { ...mrWhite.createInitialState(PLAYERS), phase }

      assert.ok(
        mrWhite.deadline(state) !== null || mrWhite.actors(state).length > 0,
        `phase "${phase}" can never advance`,
      )
    }
  })

  it('names one actor at a time during the clue phase', PENDING, async () => {
    const mrWhite = await loadMrWhite()
    const state = { ...mrWhite.createInitialState(PLAYERS), phase: 'clue' }

    assert.equal(mrWhite.actors(state).length, 1)
  })

  it('names every living player during the vote phase', PENDING, async () => {
    const mrWhite = await loadMrWhite()
    const state = { ...mrWhite.createInitialState(PLAYERS), phase: 'vote' }

    assert.deepEqual(
      mrWhite.actors(state).sort(),
      PLAYERS.map((entry) => entry.sessionId).sort(),
    )
  })

  it('names nobody during discussion', PENDING, async () => {
    const mrWhite = await loadMrWhite()
    const state = { ...mrWhite.createInitialState(PLAYERS), phase: 'discussion' }

    assert.deepEqual(mrWhite.actors(state), [])
  })

  it('names nobody once finished', PENDING, async () => {
    const mrWhite = await loadMrWhite()
    const state = { ...mrWhite.createInitialState(PLAYERS), phase: 'finished' }

    assert.deepEqual(mrWhite.actors(state), [])
    assert.equal(mrWhite.deadline(state), null)
  })
})

describe('Mr. White — the phase clock', () => {
  it('does not advance before the deadline', PENDING, async () => {
    const mrWhite = await loadMrWhite()
    const state = mrWhite.createInitialState(PLAYERS)

    assert.equal(
      mrWhite.tick(state, mrWhite.deadline(state) - 1),
      null,
      'tick must be pure and report "nothing to do" as null',
    )
  })

  it('advances exactly once when the deadline passes', PENDING, async () => {
    const mrWhite = await loadMrWhite()
    const state = mrWhite.createInitialState(PLAYERS)

    const advanced = mrWhite.tick(state, mrWhite.deadline(state) + 1)

    assert.notEqual(advanced, null)
    assert.notEqual(advanced.phase, state.phase)

    // Two nodes can sweep the same due game at the same moment. The loser of
    // the CAS re-reads and ticks again; it must find nothing left to do.
    assert.equal(
      mrWhite.tick(advanced, mrWhite.deadline(state) + 1),
      null,
      'a duplicate tick must be a no-op, not a double advance',
    )
  })

  it('submits a skip when a clue times out', PENDING, async () => {
    const mrWhite = await loadMrWhite()
    const state = { ...mrWhite.createInitialState(PLAYERS), phase: 'clue' }
    const stalling = mrWhite.actors(state)[0]

    const advanced = mrWhite.tick(state, mrWhite.deadline(state) + 1)

    assert.equal(advanced.clues[stalling], null, 'a timeout is a skip, not a hang')
    assert.notDeepEqual(mrWhite.actors(advanced), [stalling])
  })

  it('abstains for anyone who has not voted when voting times out', PENDING, async () => {
    const mrWhite = await loadMrWhite()
    const state = { ...mrWhite.createInitialState(PLAYERS), phase: 'vote' }

    const advanced = mrWhite.tick(state, mrWhite.deadline(state) + 1)

    assert.notEqual(advanced, null, 'a silent table must not stall the game')
  })
})

describe('Mr. White — moves', () => {
  it('accepts a clue only from the player whose turn it is', PENDING, async () => {
    const mrWhite = await loadMrWhite()
    const state = { ...mrWhite.createInitialState(PLAYERS), phase: 'clue' }
    const [actor] = mrWhite.actors(state)
    const other = PLAYERS.map((entry) => entry.sessionId).find(
      (sessionId) => sessionId !== actor,
    )!

    assert.equal(
      mrWhite.validateMove(state, actor, { type: 'clue', word: 'bright' }).ok,
      true,
    )
    assert.deepEqual(
      mrWhite.validateMove(state, other, { type: 'clue', word: 'bright' }),
      { ok: false, reason: 'not-your-turn' },
    )
  })

  it('refuses a vote outside the vote phase', PENDING, async () => {
    const mrWhite = await loadMrWhite()
    const state = { ...mrWhite.createInitialState(PLAYERS), phase: 'discussion' }

    assert.equal(
      mrWhite.validateMove(state, PLAYERS[0]!.sessionId, {
        type: 'vote',
        target: PLAYERS[1]!.sessionId,
      }).ok,
      false,
    )
  })

  it('refuses a vote for a player who is already out', PENDING, async () => {
    const mrWhite = await loadMrWhite()
    const state = {
      ...mrWhite.createInitialState(PLAYERS),
      phase: 'vote',
      eliminated: [PLAYERS[3]!.sessionId],
    }

    assert.equal(
      mrWhite.validateMove(state, PLAYERS[0]!.sessionId, {
        type: 'vote',
        target: PLAYERS[3]!.sessionId,
      }).ok,
      false,
    )
  })

  it('refuses any move from an eliminated player', PENDING, async () => {
    const mrWhite = await loadMrWhite()
    const state = {
      ...mrWhite.createInitialState(PLAYERS),
      phase: 'vote',
      eliminated: [PLAYERS[0]!.sessionId],
    }

    assert.equal(
      mrWhite.validateMove(state, PLAYERS[0]!.sessionId, {
        type: 'vote',
        target: PLAYERS[1]!.sessionId,
      }).ok,
      false,
      'the dead do not vote',
    )
  })

  it('refuses a guess from anyone but Mr. White', PENDING, async () => {
    const mrWhite = await loadMrWhite()
    const base = mrWhite.createInitialState(PLAYERS)
    const state = { ...base, phase: 'guess' }
    const civilian = civiliansOf(base)[0]!

    assert.equal(
      mrWhite.validateMove(state, civilian, { type: 'guess', word: 'lighthouse' })
        .ok,
      false,
    )
  })

  it('survives hostile move input without throwing', PENDING, async () => {
    const mrWhite = await loadMrWhite()
    const state = mrWhite.createInitialState(PLAYERS)

    for (const raw of [null, undefined, 'x', 42, [], {}, { type: 'clue' }]) {
      assert.doesNotThrow(() =>
        mrWhite.validateMove(state, PLAYERS[0]!.sessionId, raw),
      )
    }
  })
})

describe('Mr. White — a clue is one word', () => {
  it('accepts a single word', PENDING, async () => {
    const mrWhite = await loadMrWhite()
    const state = { ...mrWhite.createInitialState(PLAYERS), phase: 'clue' }
    const [actor] = mrWhite.actors(state)

    assert.equal(
      mrWhite.validateMove(state, actor, { type: 'clue', word: '  bright  ' }).ok,
      true,
      'surrounding space is trimmed, not treated as a second word',
    )
  })

  it('refuses a phrase', PENDING, async () => {
    const mrWhite = await loadMrWhite()
    const state = { ...mrWhite.createInitialState(PLAYERS), phase: 'clue' }
    const [actor] = mrWhite.actors(state)

    // A phrase can describe the secret outright, which hands Mr. White the
    // answer off the screen — the single word IS the game.
    for (const word of ['tall and bright', 'sea\nside', 'by\tthe coast']) {
      assert.deepEqual(
        mrWhite.validateMove(state, actor, { type: 'clue', word }),
        { ok: false, reason: 'not-one-word' },
        `"${word}" is more than one word`,
      )
    }
  })

  it('refuses one absurdly long word', PENDING, async () => {
    const mrWhite = await loadMrWhite()
    const state = { ...mrWhite.createInitialState(PLAYERS), phase: 'clue' }
    const [actor] = mrWhite.actors(state)

    // Otherwise a pasted paragraph with the spaces stripped passes as "a word".
    assert.equal(
      mrWhite.validateMove(state, actor, { type: 'clue', word: 'a'.repeat(200) })
        .reason,
      'clue-too-long',
    )
  })
})

describe('Mr. White — cutting the discussion short', () => {
  function discussing(mrWhite: any) {
    return { ...mrWhite.createInitialState(PLAYERS), phase: 'discussion' }
  }

  it('refuses a readiness vote outside the discussion', PENDING, async () => {
    const mrWhite = await loadMrWhite()

    for (const phase of ['reveal', 'clue', 'vote', 'guess']) {
      const state = { ...mrWhite.createInitialState(PLAYERS), phase }

      assert.equal(
        mrWhite.validateMove(state, PLAYERS[0]!.sessionId, { type: 'ready' }).ok,
        false,
        `readiness must mean nothing during "${phase}"`,
      )
    }
  })

  it('refuses a readiness vote from an eliminated player', PENDING, async () => {
    const mrWhite = await loadMrWhite()
    const state = {
      ...discussing(mrWhite),
      eliminated: [PLAYERS[0]!.sessionId],
    }

    assert.equal(
      mrWhite.validateMove(state, PLAYERS[0]!.sessionId, { type: 'ready' }).ok,
      false,
      'the dead do not get to hurry the living',
    )
  })

  it('holds the discussion open below a majority', PENDING, async () => {
    const mrWhite = await loadMrWhite()
    let state = discussing(mrWhite)

    // Two of four is half, not a majority — exactly the split still worth
    // arguing about.
    for (const voter of PLAYERS.slice(0, 2)) {
      const validation = mrWhite.validateMove(state, voter.sessionId, {
        type: 'ready',
      })
      state = mrWhite.applyMove(state, voter.sessionId, validation.move)
    }

    assert.equal(state.phase, 'discussion')
    assert.equal(state.readyToVote.length, 2)
  })

  it('opens the vote once a majority is ready', PENDING, async () => {
    const mrWhite = await loadMrWhite()
    let state = discussing(mrWhite)

    for (const voter of PLAYERS.slice(0, 3)) {
      const validation = mrWhite.validateMove(state, voter.sessionId, {
        type: 'ready',
      })
      state = mrWhite.applyMove(state, voter.sessionId, validation.move)
    }

    assert.equal(state.phase, 'vote', 'three of four ends the argument')
    assert.deepEqual(state.readyToVote, [], 'and readiness resets with it')
    assert.deepEqual(state.votes, {}, 'the vote opens empty')
  })

  it('lets a player take it back', PENDING, async () => {
    const mrWhite = await loadMrWhite()
    let state = discussing(mrWhite)
    const voter = PLAYERS[0]!.sessionId

    for (let press = 0; press < 2; press += 1) {
      const validation = mrWhite.validateMove(state, voter, { type: 'ready' })
      state = mrWhite.applyMove(state, voter, validation.move)
    }

    assert.deepEqual(
      state.readyToVote,
      [],
      'pressing twice must undo, not count twice',
    )
    assert.equal(state.phase, 'discussion')
  })

  it('starts each round from zero', PENDING, async () => {
    const mrWhite = await loadMrWhite()
    const state = {
      ...mrWhite.createInitialState(PLAYERS),
      phase: 'clue',
      readyToVote: [PLAYERS[0]!.sessionId, PLAYERS[1]!.sessionId],
    }

    // Timing out the whole clue round lands in the discussion; stale readiness
    // carried over would end it before anyone had said a word.
    let advanced = state
    for (let turn = 0; turn < PLAYERS.length; turn += 1) {
      advanced = mrWhite.tick(advanced, mrWhite.deadline(advanced) + 1)
    }

    assert.equal(advanced.phase, 'discussion')
    assert.deepEqual(advanced.readyToVote, [])
  })
})

describe('Mr. White — vote resolution', () => {
  it('eliminates the plurality target', PENDING, async () => {
    const mrWhite = await loadMrWhite()
    const [a, b, c, d] = PLAYERS.map((entry) => entry.sessionId) as [
      string,
      string,
      string,
      string,
    ]
    // Three votes for b against one for a — an actual plurality.
    //
    // As originally scaffolded this fixture read `{[a]: b, [c]: b, [d]: a,
    // [b]: a}`, which tallies 2-2 and is therefore the SAME tally as the tie
    // case below while expecting the opposite outcome. Satisfying both would
    // have required resolution to depend on object key insertion order — which
    // in practice means Redis' JSON key ordering deciding who gets voted out.
    const state = {
      ...mrWhite.createInitialState(PLAYERS),
      phase: 'vote',
      votes: { [a]: b, [c]: b, [d]: b, [b]: a },
    }

    const advanced = mrWhite.tick(state, mrWhite.deadline(state) + 1)

    assert.deepEqual(advanced.eliminated, [b])
  })

  it('eliminates nobody on a tie', PENDING, async () => {
    const mrWhite = await loadMrWhite()
    const [a, b, c, d] = PLAYERS.map((entry) => entry.sessionId) as [
      string,
      string,
      string,
      string,
    ]
    const state = {
      ...mrWhite.createInitialState(PLAYERS),
      phase: 'vote',
      votes: { [a]: b, [c]: b, [b]: a, [d]: a },
    }

    const advanced = mrWhite.tick(state, mrWhite.deadline(state) + 1)

    assert.deepEqual(advanced.eliminated, [])
  })

  it('closes the vote early once everyone living has voted', PENDING, async () => {
    const mrWhite = await loadMrWhite()
    const sessionIds = PLAYERS.map((entry) => entry.sessionId)
    let state = { ...mrWhite.createInitialState(PLAYERS), phase: 'vote' }

    for (const voter of sessionIds) {
      const validation = mrWhite.validateMove(state, voter, {
        type: 'vote',
        target: sessionIds[0],
      })
      state = mrWhite.applyMove(state, voter, validation.move)
    }

    assert.notEqual(
      state.phase,
      'vote',
      'a full table should not have to wait out the 45s clock',
    )
  })
})

describe('Mr. White — win conditions', () => {
  it('lets Mr. White steal the win with a correct guess', PENDING, async () => {
    const mrWhite = await loadMrWhite()
    const base = mrWhite.createInitialState(PLAYERS)
    const impostor = mrWhiteOf(base)
    const state = { ...base, phase: 'guess', eliminated: [impostor] }

    const validation = mrWhite.validateMove(state, impostor, {
      type: 'guess',
      word: base.secretWord,
    })
    const next = mrWhite.applyMove(state, impostor, validation.move)

    assert.deepEqual(mrWhite.result(next), {
      winnerSessionIds: [impostor],
      team: 'mr-white',
      reason: 'win',
    })
  })

  it('gives the civilians the win when the guess is wrong', PENDING, async () => {
    const mrWhite = await loadMrWhite()
    const base = mrWhite.createInitialState(PLAYERS)
    const impostor = mrWhiteOf(base)
    const state = { ...base, phase: 'guess', eliminated: [impostor] }

    const validation = mrWhite.validateMove(state, impostor, {
      type: 'guess',
      word: 'definitely-not-the-word',
    })
    const next = mrWhite.applyMove(state, impostor, validation.move)

    assert.deepEqual(
      mrWhite.result(next).winnerSessionIds.sort(),
      civiliansOf(base).sort(),
    )
  })

  it('gives Mr. White the win on surviving to the final two', PENDING, async () => {
    const mrWhite = await loadMrWhite()
    const base = mrWhite.createInitialState(PLAYERS)
    const impostor = mrWhiteOf(base)
    const civilians = civiliansOf(base)

    // Two of four civilians are already out, so the vote that follows leaves
    // Mr. White in the final two — the survival win, no guess required.
    const state = {
      ...base,
      phase: 'vote',
      eliminated: civilians.slice(0, 2),
      votes: {},
    }

    const advanced = mrWhite.tick(state, mrWhite.deadline(state) + 1)

    assert.deepEqual(mrWhite.result(advanced), {
      winnerSessionIds: [impostor],
      team: 'mr-white',
      reason: 'win',
    })
  })

  it('reports no result while the game is still running', PENDING, async () => {
    const mrWhite = await loadMrWhite()

    assert.equal(mrWhite.result(mrWhite.createInitialState(PLAYERS)), null)
  })
})

describe('Mr. White — chat audience', () => {
  it('lets living players talk during discussion', PENDING, async () => {
    const mrWhite = await loadMrWhite()
    const state = { ...mrWhite.createInitialState(PLAYERS), phase: 'discussion' }

    const audience = mrWhite.chatAudience(state, PLAYERS[0]!.sessionId)

    assert.equal(audience.ok, true)
    assert.equal(audience.channel, 'table')
    assert.deepEqual(
      audience.to.sort(),
      PLAYERS.map((entry) => entry.sessionId).sort(),
    )
  })

  it('never leaks a dead player’s chat to the living', PENDING, async () => {
    const mrWhite = await loadMrWhite()
    const dead = PLAYERS[0]!.sessionId
    const state = {
      ...mrWhite.createInitialState(PLAYERS),
      phase: 'discussion',
      eliminated: [dead],
    }

    const audience = mrWhite.chatAudience(state, dead)

    assert.equal(audience.channel, 'dead')
    assert.equal(
      audience.to.includes(PLAYERS[1]!.sessionId),
      false,
      'a living player must never receive a dead-channel message',
    )
  })

  it('closes chat outside discussion and voting', PENDING, async () => {
    const mrWhite = await loadMrWhite()

    for (const phase of ['reveal', 'clue', 'reveal-vote', 'guess']) {
      const state = { ...mrWhite.createInitialState(PLAYERS), phase }

      assert.deepEqual(mrWhite.chatAudience(state, PLAYERS[0]!.sessionId), {
        ok: false,
        reason: 'chat-closed',
      })
    }
  })
})

/**
 * Auto-elimination — what happens when a dropped player never comes back.
 *
 * Source of truth:
 * docs/superpowers/specs/2026-08-04-disconnect-lifecycle-design.md
 *
 * The half of this that is easy to get wrong is not the removal, it is the
 * REPAIR. Marking someone absent and stopping there leaves the table deadlocked:
 * the clue phase waiting on an actor who will never speak, a readiness majority
 * measured against someone who cannot press the button, a tally that can never
 * complete. Most of the assertions below are about the phase the game lands on,
 * not about the `eliminated` array.
 *
 * Every fixture pins the impostor rather than taking whoever `createInitialState`
 * rolled, because "a civilian dropped" and "Mr. White dropped" are different
 * rules and a random role would make the test flap between them.
 */
describe('Mr. White — auto-elimination', () => {
  /** An arbitrary fixed clock, so a new phase deadline can be asserted exactly. */
  const NOW = 1_800_000_000_000

  /** A fresh game with a chosen impostor. Seat order is PLAYERS order. */
  function dealt(mrWhite: any, impostorSeat: number): any {
    const base = mrWhite.createInitialState(PLAYERS)
    const impostor = base.order[impostorSeat]

    const roles: Record<string, string> = {}
    for (const id of base.order as string[]) {
      roles[id] = id === impostor ? 'mr-white' : 'civilian'
    }

    return { ...base, roles }
  }

  /** Seat order as a fixed-length tuple, so destructuring gives plain strings. */
  function seats(state: any): [string, string, string, string] {
    const [a, b, c, d] = state.order as string[]
    return [a!, b!, c!, d!]
  }

  describe('repairing the clue phase', () => {
    it('passes the floor when the player holding it drops', async () => {
      const mrWhite = await loadMrWhite()
      // Dave is the impostor, so the seat holding the floor (Alice) is a
      // civilian and her leaving does not end the game.
      const state = { ...dealt(mrWhite, 3), phase: 'clue' }
      const holder = mrWhite.actors(state)[0]

      const next = mrWhite.eliminate(state, holder, NOW)

      assert.equal(next.phase, 'clue')
      assert.notEqual(
        mrWhite.actors(next)[0],
        holder,
        'the rotation must move on, or the round waits forever',
      )
      assert.equal(
        next.phaseEndsAt,
        NOW + 30_000,
        'the next speaker gets a full clock, not the remains of someone else’s',
      )
    })

    it('leaves the clock alone when the dropped player was not speaking', async () => {
      const mrWhite = await loadMrWhite()
      const base = dealt(mrWhite, 3)
      const [, , carol] = seats(base)
      const state = { ...base, phase: 'clue' }

      const next = mrWhite.eliminate(state, carol, NOW)

      assert.equal(
        next.phaseEndsAt,
        state.phaseEndsAt,
        'the current speaker must not be handed extra seconds for someone else’s dropped connection',
      )
      assert.deepEqual(mrWhite.actors(next), mrWhite.actors(state))
    })

    it('opens the discussion when the last player yet to speak drops', async () => {
      const mrWhite = await loadMrWhite()
      const base = dealt(mrWhite, 0)
      const [alice, bob, carol, dave] = seats(base)
      const state = {
        ...base,
        phase: 'clue',
        clues: { [alice]: 'tall', [bob]: 'salt', [carol]: 'beam' },
      }
      assert.equal(mrWhite.actors(state)[0], dave, 'fixture: Dave speaks last')

      const next = mrWhite.eliminate(state, dave, NOW)

      assert.equal(next.phase, 'discussion')
      assert.equal(next.phaseEndsAt, NOW + 90_000)
    })
  })

  describe('repairing the discussion', () => {
    it('opens the vote when the smaller table turns readiness into a majority', async () => {
      const mrWhite = await loadMrWhite()
      const base = dealt(mrWhite, 3)
      const [alice, bob, carol] = seats(base)
      // Two of four is half, not a majority — the discussion is still open.
      const state = { ...base, phase: 'discussion', readyToVote: [alice, bob] }

      const next = mrWhite.eliminate(state, carol, NOW)

      assert.equal(
        next.phase,
        'vote',
        'two of three IS a majority; without the recheck the table sits out the full 90s',
      )
      assert.deepEqual(next.readyToVote, [], 'and readiness resets with it')
      assert.deepEqual(next.votes, {})
    })

    it('keeps the discussion open when it is still not a majority', async () => {
      const mrWhite = await loadMrWhite()
      const base = dealt(mrWhite, 3)
      const [alice, , carol] = seats(base)
      const state = { ...base, phase: 'discussion', readyToVote: [alice] }

      const next = mrWhite.eliminate(state, carol, NOW)

      assert.equal(next.phase, 'discussion', 'one of three is not a majority')
    })

    it('drops the departed player’s own readiness vote', async () => {
      const mrWhite = await loadMrWhite()
      const base = dealt(mrWhite, 3)
      const [alice] = seats(base)
      const state = { ...base, phase: 'discussion', readyToVote: [alice] }

      const next = mrWhite.eliminate(state, alice, NOW)

      assert.deepEqual(
        next.readyToVote,
        [],
        'a player who is gone cannot still be counted as wanting to move on',
      )
    })
  })

  describe('repairing the vote', () => {
    it('resolves once the last outstanding voter drops', async () => {
      const mrWhite = await loadMrWhite()
      const base = dealt(mrWhite, 3)
      const [alice, bob, carol, dave] = seats(base)
      // Everyone but Carol has voted, and the table is leaning towards Dave.
      const state = {
        ...base,
        phase: 'vote',
        votes: { [alice]: dave, [bob]: dave, [dave]: alice },
      }

      const next = mrWhite.eliminate(state, carol, NOW)

      assert.notEqual(
        next.phase,
        'vote',
        'the tally can complete now, so the table should not sit out the clock',
      )
      assert.deepEqual(
        next.eliminated.slice().sort(),
        [carol, dave].sort(),
        'Carol left and Dave was voted out',
      )
    })

    it('discards votes cast for the departed player', async () => {
      const mrWhite = await loadMrWhite()
      const base = dealt(mrWhite, 3)
      const [alice, bob, carol, dave] = seats(base)
      // The whole table had converged on Carol — who then dropped.
      const state = {
        ...base,
        phase: 'vote',
        votes: { [alice]: carol, [bob]: carol, [dave]: carol },
      }

      const next = mrWhite.eliminate(state, carol, NOW)

      assert.deepEqual(
        next.eliminated,
        [carol],
        'a surviving vote against someone already out would eliminate them twice',
      )
      assert.deepEqual(next.votes, {})
      assert.equal(next.phase, 'vote', 'nobody living has voted yet, so the vote continues')
    })
  })

  describe('when it ends the game', () => {
    it('hands the win to the civilians when Mr. White drops', async () => {
      const mrWhite = await loadMrWhite()
      const base = dealt(mrWhite, 3)
      const [alice, bob, carol, dave] = seats(base)
      const state = { ...base, phase: 'discussion' }

      const next = mrWhite.eliminate(state, dave, NOW)

      assert.equal(next.phase, 'finished')
      assert.deepEqual(mrWhite.result(next), {
        winnerSessionIds: [alice, bob, carol],
        team: 'civilians',
        reason: 'forfeit',
      })
    })

    it('hands the win to Mr. White when the table drops to the final two', async () => {
      const mrWhite = await loadMrWhite()
      const base = dealt(mrWhite, 3)
      const [alice, bob, , dave] = seats(base)
      // Alice is already out; Bob leaving puts Mr. White in the final two, which
      // is the same survival rule a vote applies.
      const state = { ...base, phase: 'discussion', eliminated: [alice] }

      const next = mrWhite.eliminate(state, bob, NOW)

      assert.equal(next.phase, 'finished')
      assert.deepEqual(mrWhite.result(next), {
        winnerSessionIds: [dave],
        team: 'mr-white',
        reason: 'win',
      })
    })

    it('does not end a guess phase when a civilian drops', async () => {
      const mrWhite = await loadMrWhite()
      const base = dealt(mrWhite, 3)
      const [alice, , , dave] = seats(base)
      // Mr. White has been voted out and owes an answer. Two civilians left
      // would trip a naive "final two" check, but the impostor is already out —
      // the game hinges on the guess, not on who is still seated.
      const state = { ...base, phase: 'guess', eliminated: [dave] }

      const next = mrWhite.eliminate(state, alice, NOW)

      assert.equal(next.phase, 'guess')
      assert.equal(mrWhite.result(next), null)
    })
  })

  describe('no-ops', () => {
    it('leaves a finished game alone', async () => {
      const mrWhite = await loadMrWhite()
      const state = { ...dealt(mrWhite, 3), phase: 'finished' }

      assert.deepEqual(mrWhite.eliminate(state, state.order[0], NOW), state)
    })

    it('ignores someone who was never dealt in', async () => {
      const mrWhite = await loadMrWhite()
      const state = dealt(mrWhite, 3)

      assert.deepEqual(mrWhite.eliminate(state, 'session-nobody', NOW), state)
    })

    it('ignores a player who is already out', async () => {
      const mrWhite = await loadMrWhite()
      const base = dealt(mrWhite, 3)
      const state = { ...base, phase: 'discussion', eliminated: [base.order[0]] }

      assert.deepEqual(mrWhite.eliminate(state, base.order[0], NOW), state)
    })

    it('does not mutate the state it was given', async () => {
      const mrWhite = await loadMrWhite()
      const base = dealt(mrWhite, 3)
      const [alice, bob, carol] = seats(base)
      const state = {
        ...base,
        phase: 'discussion',
        readyToVote: [alice],
        votes: { [bob]: carol },
      }
      const snapshot = JSON.parse(JSON.stringify(state))

      // The engine may call this more than once across a compare-and-set retry,
      // so a mutation here would corrupt the state the retry reads.
      mrWhite.eliminate(state, carol, NOW)

      assert.deepEqual(state, snapshot)
    })
  })

  it('closes the eliminated player out of the game', async () => {
    const mrWhite = await loadMrWhite()
    const base = dealt(mrWhite, 3)
    const [alice, bob] = seats(base)
    const state = { ...base, phase: 'vote' }

    const next = mrWhite.eliminate(state, alice, NOW)

    assert.equal(
      mrWhite.validateMove(next, alice, { type: 'vote', target: bob }).ok,
      false,
      'auto-elimination has to be the same "out" the rest of the rules already know',
    )
    assert.equal(mrWhite.actors(next).includes(alice), false)
  })
})

describe('Phase 5 engine generalization', () => {
  it('exposes tickGame for the deadline sweeper', PENDING, async () => {
    const engine: any = await import(ENGINE_MODULE)

    assert.equal(typeof engine.tickGame, 'function')
  })

  it('indexes a game with a deadline so the sweeper can find it', PENDING, async () => {
    const engine: any = await import(ENGINE_MODULE)

    assert.equal(
      typeof engine.dueGames,
      'function',
      'the sweeper reads ZRANGEBYSCORE games:deadlines 0 now',
    )
  })
})

describe('Phase 5 lobby', () => {
  it('holds up to eight players, unlike the two-person WebRTC room', PENDING, async () => {
    const lobby: any = await import(LOBBY_MODULE)

    assert.equal(lobby.LOBBY_CAPACITY, 8)
  })

  it('orders seats by join time so the clue rotation is stable', PENDING, async () => {
    const lobby: any = await import(LOBBY_MODULE)

    assert.equal(typeof lobby.getLobbyMembers, 'function')
  })
})
