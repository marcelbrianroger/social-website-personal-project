import assert from 'node:assert/strict'
import { after, beforeEach, describe, it } from 'node:test'

import {
  buildView,
  forfeitGame,
  loadGame,
  purgeGame,
  startGame,
  submitMove,
} from '../src/game-engine.js'
import { ticTacToe, type TicTacToeState } from '../src/games/tic-tac-toe.js'
import type {
  AnyGameDefinition,
  GamePlayer,
  StoredGame,
} from '../src/games/types.js'
import { ROOM_TTL_SECONDS, keys, redis } from '../src/redis.js'
import { resetRedis, teardownRedis, uniqueRoomId } from './helpers/harness.js'

/**
 * Phase 4 — the generic, Redis-backed game state machine.
 *
 * Seam: the exported functions of src/game-engine.ts, against real Redis.
 *
 * The engine's whole job is persistence, turn enforcement and concurrency; the
 * rules live elsewhere. So the tests that matter here are the ones about
 * *writes*: that a simultaneous start installs one board rather than two, that
 * a compare-and-set loop never loses an update, and that state never outlives
 * its room. Tic-Tac-Toe is used as the vehicle because it is the only
 * registered game — see games/tic-tac-toe.test.ts for the rules themselves.
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
const mallory = player('Mallory')

/** Start a two-player Tic-Tac-Toe game, failing loudly if setup breaks. */
async function startTicTacToe(roomId: string): Promise<StoredGame> {
  const started = await startGame(roomId, 'tic-tac-toe', [alice, bob])
  assert.equal(started.ok, true, 'test setup: game should start')
  return (started as { ok: true; stored: StoredGame }).stored
}

function boardOf(stored: StoredGame): (string | null)[] {
  return (stored.state as TicTacToeState).board
}

beforeEach(resetRedis)
after(teardownRedis)

describe('starting a game', () => {
  it('refuses a game that is not registered', async () => {
    const result = await startGame(uniqueRoomId(), 'chess', [alice, bob])

    assert.deepEqual(result, { ok: false, error: 'unknown-game' })
  })

  it('refuses a non-string game id', async () => {
    const result = await startGame(uniqueRoomId(), { id: 'tic-tac-toe' }, [
      alice,
      bob,
    ])

    assert.deepEqual(result, { ok: false, error: 'unknown-game' })
  })

  it('refuses too few players', async () => {
    const result = await startGame(uniqueRoomId(), 'tic-tac-toe', [alice])

    assert.deepEqual(result, { ok: false, error: 'wrong-player-count' })
  })

  it('refuses too many players', async () => {
    const result = await startGame(uniqueRoomId(), 'tic-tac-toe', [
      alice,
      bob,
      mallory,
    ])

    assert.deepEqual(result, { ok: false, error: 'wrong-player-count' })
  })

  it('writes nothing to Redis when it refuses', async () => {
    const roomId = uniqueRoomId()

    await startGame(roomId, 'tic-tac-toe', [alice])

    assert.equal(await loadGame(roomId), null)
  })

  it('installs an opening position at version 1', async () => {
    const roomId = uniqueRoomId()

    const stored = await startTicTacToe(roomId)

    assert.equal(stored.gameId, 'tic-tac-toe')
    assert.equal(stored.version, 1)
    assert.equal(stored.finished, false)
    assert.equal(stored.result, null)
    assert.deepEqual(stored.players, [alice, bob])
    assert.deepEqual(boardOf(stored), Array.from({ length: 9 }, () => null))
  })

  it('persists the game so another node can read it', async () => {
    const roomId = uniqueRoomId()

    const stored = await startTicTacToe(roomId)

    assert.deepEqual(
      await loadGame(roomId),
      stored,
      'the engine is the only writer, but every node reads the same state',
    )
  })

  it('gives the stored game a TTL so a dead node cannot leak it forever', async () => {
    const roomId = uniqueRoomId()

    await startTicTacToe(roomId)
    const ttl = await redis.ttl(keys.game(roomId))

    assert.ok(ttl > 0, `expected a positive TTL, got ${ttl}`)
    assert.ok(
      ttl <= ROOM_TTL_SECONDS,
      `TTL ${ttl} should not exceed the room TTL ${ROOM_TTL_SECONDS}`,
    )
  })

  it('returns the running game instead of restarting it', async () => {
    const roomId = uniqueRoomId()
    await startTicTacToe(roomId)
    await submitMove(roomId, alice.sessionId, { cell: 0 })

    const again = await startGame(roomId, 'tic-tac-toe', [alice, bob])

    assert.equal(again.ok, true)
    assert.equal(
      (again as { ok: true; stored: StoredGame }).stored.version,
      2,
      'a second Start must not wipe a game in progress',
    )
    assert.equal(boardOf((again as { ok: true; stored: StoredGame }).stored)[0], 'X')
  })

  describe('two players pressing Start at the same moment', () => {
    it('installs exactly one board', async () => {
      const roomId = uniqueRoomId()

      // Different seat orders, so the two proposals are distinguishable. If the
      // write were not atomic, each caller could install its own board and the
      // two players would disagree about who is X.
      const [first, second] = await Promise.all([
        startGame(roomId, 'tic-tac-toe', [alice, bob]),
        startGame(roomId, 'tic-tac-toe', [bob, alice]),
      ])

      assert.equal(first.ok, true)
      assert.equal(second.ok, true)

      const firstStored = (first as { ok: true; stored: StoredGame }).stored
      const secondStored = (second as { ok: true; stored: StoredGame }).stored

      assert.deepEqual(
        firstStored,
        secondStored,
        'both callers must be told about the same authoritative game',
      )
      assert.deepEqual(
        await loadGame(roomId),
        firstStored,
        'and that game is what is actually stored',
      )
    })

    it('agrees on who moves first', async () => {
      const roomId = uniqueRoomId()

      const results = await Promise.all([
        startGame(roomId, 'tic-tac-toe', [alice, bob]),
        startGame(roomId, 'tic-tac-toe', [bob, alice]),
      ])

      const turns = results.map((result) =>
        result.ok
          ? (ticTacToe.actors(result.stored.state as TicTacToeState)[0] ?? null)
          : null,
      )

      assert.equal(turns[0], turns[1], 'a split decision here corrupts the game')
    })
  })

  it('replaces a finished game so a rematch can begin', async () => {
    const roomId = uniqueRoomId()
    await startTicTacToe(roomId)

    // X takes the top row: 0, 1, 2. O answers on 3 and 4.
    for (const [sessionId, cell] of [
      [alice.sessionId, 0],
      [bob.sessionId, 3],
      [alice.sessionId, 1],
      [bob.sessionId, 4],
      [alice.sessionId, 2],
    ] as const) {
      await submitMove(roomId, sessionId, { cell })
    }

    const finished = await loadGame(roomId)
    assert.equal(finished?.finished, true, 'test setup: the game should be over')

    const rematch = await startGame(roomId, 'tic-tac-toe', [alice, bob])

    assert.equal(rematch.ok, true)
    const stored = (rematch as { ok: true; stored: StoredGame }).stored
    assert.equal(stored.version, 1, 'a rematch starts a fresh game, not version 6')
    assert.equal(stored.finished, false)
    assert.deepEqual(boardOf(stored), Array.from({ length: 9 }, () => null))
  })
})

describe('submitting a move', () => {
  it('refuses when no game is running', async () => {
    const result = await submitMove(uniqueRoomId(), alice.sessionId, { cell: 0 })

    assert.deepEqual(result, { ok: false, reason: 'no-game' })
  })

  it('refuses a session that is not in the game', async () => {
    const roomId = uniqueRoomId()
    await startTicTacToe(roomId)

    const result = await submitMove(roomId, mallory.sessionId, { cell: 0 })

    assert.deepEqual(
      result,
      { ok: false, reason: 'not-a-player' },
      'the engine checks membership before consulting the rules',
    )
  })

  it('does not let a rejected move touch the board', async () => {
    const roomId = uniqueRoomId()
    await startTicTacToe(roomId)

    await submitMove(roomId, mallory.sessionId, { cell: 0 })
    await submitMove(roomId, bob.sessionId, { cell: 0 })

    const stored = await loadGame(roomId)

    assert.equal(stored?.version, 1, 'a refused move must not bump the version')
    assert.deepEqual(boardOf(stored as StoredGame), Array.from({ length: 9 }, () => null))
  })

  it('passes a rule rejection through unchanged', async () => {
    const roomId = uniqueRoomId()
    await startTicTacToe(roomId)

    // The engine must not flatten the rules' vocabulary into a generic
    // "invalid" — the UI explains the refusal using this string.
    assert.deepEqual(await submitMove(roomId, bob.sessionId, { cell: 0 }), {
      ok: false,
      reason: 'not-your-turn',
    })
    assert.deepEqual(await submitMove(roomId, alice.sessionId, { cell: 99 }), {
      ok: false,
      reason: 'cell-out-of-range',
    })
    assert.deepEqual(await submitMove(roomId, alice.sessionId, 'nope'), {
      ok: false,
      reason: 'malformed-move',
    })
  })

  it('applies a legal move and bumps the version', async () => {
    const roomId = uniqueRoomId()
    await startTicTacToe(roomId)

    const result = await submitMove(roomId, alice.sessionId, { cell: 4 })

    assert.equal(result.ok, true)
    const stored = (result as { ok: true; stored: StoredGame }).stored
    assert.equal(stored.version, 2)
    assert.equal(boardOf(stored)[4], 'X')
    assert.deepEqual(await loadGame(roomId), stored, 'the write is persisted')
  })

  it('hands the turn to the opponent', async () => {
    const roomId = uniqueRoomId()
    await startTicTacToe(roomId)

    await submitMove(roomId, alice.sessionId, { cell: 4 })
    const stored = await loadGame(roomId)

    assert.deepEqual(
      ticTacToe.actors(stored?.state as TicTacToeState),
      [bob.sessionId],
    )
  })

  it('records the terminal result and closes the game', async () => {
    const roomId = uniqueRoomId()
    await startTicTacToe(roomId)

    for (const [sessionId, cell] of [
      [alice.sessionId, 0],
      [bob.sessionId, 3],
      [alice.sessionId, 1],
      [bob.sessionId, 4],
    ] as const) {
      await submitMove(roomId, sessionId, { cell })
    }

    const winning = await submitMove(roomId, alice.sessionId, { cell: 2 })

    assert.equal(winning.ok, true)
    const stored = (winning as { ok: true; stored: StoredGame }).stored
    assert.equal(stored.finished, true)
    assert.deepEqual(stored.result, {
      winnerSessionIds: [alice.sessionId],
      reason: 'win',
    })

    assert.deepEqual(
      await submitMove(roomId, bob.sessionId, { cell: 5 }),
      { ok: false, reason: 'game-finished' },
      'a finished game accepts nothing further',
    )
  })

  describe('concurrent writes', () => {
    it('never loses an update when one player fires twice at once', async () => {
      const roomId = uniqueRoomId()
      await startTicTacToe(roomId)

      // Both requests read version 1 and both validate as legal against it.
      // Without compare-and-set the second write would overwrite the first,
      // and the board would show one mark while the version claimed two moves.
      const results = await Promise.all([
        submitMove(roomId, alice.sessionId, { cell: 0 }),
        submitMove(roomId, alice.sessionId, { cell: 8 }),
      ])

      const accepted = results.filter((result) => result.ok)
      assert.equal(accepted.length, 1, 'exactly one of the two may apply')
      assert.deepEqual(
        results.find((result) => !result.ok),
        { ok: false, reason: 'not-your-turn' },
        'the loser re-reads and is correctly told the turn has moved on',
      )

      const stored = await loadGame(roomId)
      assert.equal(stored?.version, 2, 'one move, one version bump')
      assert.equal(
        boardOf(stored as StoredGame).filter((cell) => cell !== null).length,
        1,
        'the board must carry exactly one mark',
      )
    })

    it('keeps the board consistent when both players fire at once', async () => {
      const roomId = uniqueRoomId()
      await startTicTacToe(roomId)

      const results = await Promise.all([
        submitMove(roomId, alice.sessionId, { cell: 0 }),
        submitMove(roomId, bob.sessionId, { cell: 0 }),
      ])

      assert.equal(results.filter((result) => result.ok).length, 1)

      const stored = await loadGame(roomId)
      assert.equal(boardOf(stored as StoredGame)[0], 'X', 'Alice moves first, so X owns cell 0')
      assert.equal(stored?.version, 2)
    })

    it('serialises a burst of alternating moves without corrupting the board', async () => {
      const roomId = uniqueRoomId()
      await startTicTacToe(roomId)

      // Eight requests, only some of which are legal at the moment they land.
      // Whatever the interleaving, the stored board must stay a board: no cell
      // written twice, and the version must equal the number of marks plus one.
      await Promise.all([
        submitMove(roomId, alice.sessionId, { cell: 0 }),
        submitMove(roomId, bob.sessionId, { cell: 1 }),
        submitMove(roomId, alice.sessionId, { cell: 2 }),
        submitMove(roomId, bob.sessionId, { cell: 5 }),
        submitMove(roomId, alice.sessionId, { cell: 6 }),
        submitMove(roomId, bob.sessionId, { cell: 7 }),
        submitMove(roomId, alice.sessionId, { cell: 8 }),
        submitMove(roomId, bob.sessionId, { cell: 3 }),
      ])

      const stored = (await loadGame(roomId)) as StoredGame
      const marks = boardOf(stored).filter((cell) => cell !== null)

      assert.equal(
        stored.version,
        marks.length + 1,
        'every version bump corresponds to exactly one mark on the board',
      )

      const xs = boardOf(stored).filter((cell) => cell === 'X').length
      const os = boardOf(stored).filter((cell) => cell === 'O').length
      assert.ok(
        xs - os === 0 || xs - os === 1,
        `X and O must alternate, got ${xs} X and ${os} O`,
      )
    })
  })
})

describe('forfeiting', () => {
  it('awards the game to the player who stayed', async () => {
    const roomId = uniqueRoomId()
    await startTicTacToe(roomId)

    const forfeited = await forfeitGame(roomId, alice.sessionId)

    assert.notEqual(forfeited, null)
    assert.equal(forfeited?.stored.finished, true)
    assert.deepEqual(forfeited?.stored.result, {
      winnerSessionIds: [bob.sessionId],
      reason: 'forfeit',
    })
    assert.equal(forfeited?.stored.version, 2, 'the survivor is told via a new version')
  })

  it('keeps the forfeited result readable by the remaining player', async () => {
    const roomId = uniqueRoomId()
    await startTicTacToe(roomId)

    await forfeitGame(roomId, alice.sessionId)

    const stored = await loadGame(roomId)
    assert.equal(
      stored?.result?.reason,
      'forfeit',
      'the state survives the walk-out so the survivor sees why it ended',
    )
  })

  it('does nothing when no game is running', async () => {
    assert.equal(await forfeitGame(uniqueRoomId(), alice.sessionId), null)
  })

  it('does not rewrite a game that already ended', async () => {
    const roomId = uniqueRoomId()
    await startTicTacToe(roomId)

    for (const [sessionId, cell] of [
      [alice.sessionId, 0],
      [bob.sessionId, 3],
      [alice.sessionId, 1],
      [bob.sessionId, 4],
      [alice.sessionId, 2],
    ] as const) {
      await submitMove(roomId, sessionId, { cell })
    }

    const before = await loadGame(roomId)
    assert.equal(await forfeitGame(roomId, bob.sessionId), null)

    assert.deepEqual(
      await loadGame(roomId),
      before,
      'losing and then disconnecting must not convert a loss into a forfeit',
    )
  })

  it('ignores a forfeit from someone who was never playing', async () => {
    const roomId = uniqueRoomId()
    await startTicTacToe(roomId)

    assert.equal(await forfeitGame(roomId, mallory.sessionId), null)
    assert.equal((await loadGame(roomId))?.version, 1)
  })

  it('resolves a simultaneous double forfeit to a single result', async () => {
    const roomId = uniqueRoomId()
    await startTicTacToe(roomId)

    const results = await Promise.all([
      forfeitGame(roomId, alice.sessionId),
      forfeitGame(roomId, bob.sessionId),
    ])

    assert.equal(
      results.filter((result) => result !== null).length,
      1,
      'both players closing the tab at once still produces one outcome',
    )
    assert.equal((await loadGame(roomId))?.version, 2)
  })
})

describe('ephemerality', () => {
  it('reports no game for a room that never had one', async () => {
    assert.equal(await loadGame(uniqueRoomId()), null)
  })

  it('deletes the game when the room is purged', async () => {
    const roomId = uniqueRoomId()
    await startTicTacToe(roomId)

    await purgeGame(roomId)

    assert.equal(await loadGame(roomId), null)
    assert.equal(
      await redis.exists(keys.game(roomId)),
      0,
      'nothing about a game may survive its room',
    )
  })

  it('purges a finished game too', async () => {
    const roomId = uniqueRoomId()
    await startTicTacToe(roomId)
    await forfeitGame(roomId, alice.sessionId)

    await purgeGame(roomId)

    assert.equal(await redis.exists(keys.game(roomId)), 0)
  })

  it('treats a corrupt payload as no game rather than crashing', async () => {
    const roomId = uniqueRoomId()
    await redis.set(keys.game(roomId), 'not-json')

    assert.equal(await loadGame(roomId), null)
    assert.deepEqual(await submitMove(roomId, alice.sessionId, { cell: 0 }), {
      ok: false,
      reason: 'no-game',
    })
  })
})

describe('buildView — the redaction seam', () => {
  it('exposes only the public shape of a game', async () => {
    const roomId = uniqueRoomId()
    const stored = await startTicTacToe(roomId)

    const view = buildView(stored, ticTacToe as AnyGameDefinition, alice.sessionId)

    assert.equal(view.gameId, 'tic-tac-toe')
    assert.equal(view.label, 'Tic-Tac-Toe')
    assert.equal(view.version, 1)
    assert.deepEqual(view.actors, [alice.sessionId])
    assert.equal(view.finished, false)
    assert.deepEqual(
      view.players,
      [
        { sessionId: alice.sessionId, nickname: 'Alice' },
        { sessionId: bob.sessionId, nickname: 'Bob' },
      ],
      'socket ids are an addressing detail and must not be published to players',
    )
  })

  it('reports no turn once the game is over', async () => {
    const roomId = uniqueRoomId()
    await startTicTacToe(roomId)
    const forfeited = await forfeitGame(roomId, alice.sessionId)

    const view = buildView(
      forfeited?.stored as StoredGame,
      ticTacToe as AnyGameDefinition,
      bob.sessionId,
    )

    assert.deepEqual(view.actors, [])
    assert.equal(view.finished, true)
  })

  /**
   * The seam Phase 5 depends on.
   *
   * Tic-Tac-Toe is perfect information, so it cannot demonstrate redaction. A
   * stand-in definition with hidden state proves the property that matters:
   * buildView routes the *viewer's* identity into viewFor and publishes only
   * what comes back. Anything sent to a browser is readable in devtools, so a
   * leak here cannot be fixed in the UI.
   */
  describe('with a hidden-information game', () => {
    interface SecretState {
      secretWord: string
      roles: Record<string, string>
    }

    const secretState: SecretState = {
      secretWord: 'lighthouse',
      roles: { [alice.sessionId]: 'civilian', [bob.sessionId]: 'impostor' },
    }

    const hidden = {
      id: 'hidden',
      label: 'Hidden',
      minPlayers: 2,
      maxPlayers: 2,
      actors: () => [alice.sessionId],
      deadline: () => null,
      viewFor(state: unknown, sessionId: string | null) {
        const typed = state as SecretState
        return {
          yourRole: sessionId ? typed.roles[sessionId] : null,
          // Only a civilian learns the word; observers and the impostor do not.
          secretWord:
            sessionId && typed.roles[sessionId] === 'civilian'
              ? typed.secretWord
              : null,
        }
      },
    } as unknown as AnyGameDefinition

    const stored: StoredGame = {
      gameId: 'hidden',
      version: 3,
      players: [alice, bob],
      state: secretState,
      startedAt: new Date().toISOString(),
      finished: false,
      result: null,
    }

    it('gives each viewer only their own role', () => {
      assert.deepEqual(buildView(stored, hidden, alice.sessionId).state, {
        yourRole: 'civilian',
        secretWord: 'lighthouse',
      })
      assert.deepEqual(buildView(stored, hidden, bob.sessionId).state, {
        yourRole: 'impostor',
        secretWord: null,
      })
    })

    it('never lets the raw state reach the wire', () => {
      for (const viewer of [alice.sessionId, bob.sessionId, null]) {
        const serialised = JSON.stringify(buildView(stored, hidden, viewer))

        assert.equal(
          serialised.includes('"roles"'),
          false,
          `the role table leaked to ${viewer ?? 'an observer'}`,
        )
        assert.notEqual(
          buildView(stored, hidden, viewer).state,
          secretState,
          'the stored state object must never be published by reference',
        )
      }
    })

    it('tells an observer nothing', () => {
      assert.deepEqual(buildView(stored, hidden, null).state, {
        yourRole: null,
        secretWord: null,
      })
    })
  })
})
