import assert from 'node:assert/strict'
import { describe, it } from 'node:test'

import type { GamePlayer } from '../../src/games/types.js'

/**
 * Mr. White — PENDING. Phase 5 is designed but not implemented.
 *
 * Source of truth: docs/superpowers/specs/2026-08-03-phase5-social-deduction-design.md
 * (Status: awaiting review). At the time of writing, games/registry.ts registers
 * only Tic-Tac-Toe, and games/types.ts still exposes the Phase 4 contract
 * (`currentTurn`, `winnerSessionId`) rather than the generalized one
 * (`actors`, `winnerSessionIds`, `tick`, `deadline`, `chatAudience`).
 *
 * Every test below is skipped, so the suite stays green. They exist as the red
 * baseline for whoever builds Phase 5: delete the `skip` option on a block, and
 * it should fail until the corresponding behaviour exists. Werewolf is not
 * covered at all — the design doc puts it out of scope pending its own spec.
 *
 * Modules are imported dynamically through a non-literal specifier so this file
 * compiles and runs while those modules do not yet exist.
 */

const MR_WHITE_MODULE = '../../src/games/mr-white.js'
const LOBBY_MODULE = '../../src/lobby.js'
const ENGINE_MODULE = '../../src/game-engine.js'

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

const PENDING = {
  skip: 'Phase 5 is a design doc; no implementation exists yet.',
} as const

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

describe('Mr. White — vote resolution', () => {
  it('eliminates the plurality target', PENDING, async () => {
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
      votes: { [a]: b, [c]: b, [d]: a, [b]: a },
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
