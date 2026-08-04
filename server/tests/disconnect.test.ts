import assert from 'node:assert/strict'
import { after, beforeEach, describe, it } from 'node:test'

import {
  buildView,
  dueDisconnects,
  expireDisconnect,
  loadGame,
  markDisconnected,
  markReconnected,
  purgeGame,
  startGame,
} from '../src/game-engine.js'
import { getGameDefinition } from '../src/games/registry.js'
import type { MrWhiteState } from '../src/games/mr-white.js'
import type { AnyGameDefinition, GamePlayer, StoredGame } from '../src/games/types.js'
import { disconnectEntry, keys, redis } from '../src/redis.js'
import { getLobbyMembers, joinLobby, leaveLobby } from '../src/lobby.js'
import {
  resetRedis,
  teardownRedis,
  uniqueRoomId,
  uniqueSocketId,
} from './helpers/harness.js'

/**
 * Connection lifecycle — the reconnect window and what happens when it expires.
 *
 * Source of truth:
 * docs/superpowers/specs/2026-08-04-disconnect-lifecycle-design.md
 *
 * Seam: the presence functions of src/game-engine.ts plus src/lobby.ts, against
 * real Redis. The RULES for auto-elimination are covered as pure functions in
 * games/mr-white.test.ts; what is tested here is the part that only real Redis
 * can show — that the countdown is written where the sweeper will find it, that
 * it is cleared from BOTH the game record and the index, and that a duplicate
 * or late sweep does nothing.
 *
 * Mr. White is the vehicle rather than Tic-Tac-Toe because it is the game whose
 * table has to survive the departure. Tic-Tac-Toe's `eliminate` ends the game,
 * which makes it useless for testing anything downstream of the elimination.
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
const carol = player('Carol')
const dave = player('Dave')
const mallory = player('Mallory')

const TABLE = [alice, bob, carol, dave]

/** Long enough that nothing expires on its own mid-test. */
const GRACE_MS = 60_000

async function startMrWhite(scope: string): Promise<StoredGame> {
  const started = await startGame(scope, 'mr-white', TABLE)
  assert.equal(started.ok, true, 'test setup: the game should start')
  return (started as { ok: true; stored: StoredGame }).stored
}

function stateOf(stored: StoredGame): MrWhiteState {
  return stored.state as MrWhiteState
}

/** Whoever the deal made the impostor, read off the stored state. */
function impostorOf(stored: StoredGame): string {
  const { roles } = stateOf(stored)
  return Object.keys(roles).find((id) => roles[id] === 'mr-white')!
}

function aCivilianOf(stored: StoredGame): string {
  const { roles } = stateOf(stored)
  return Object.keys(roles).find((id) => roles[id] !== 'mr-white')!
}

/** Score of a player's entry in the sweeper index, or null if absent. */
async function indexedDeadline(
  scope: string,
  sessionId: string,
): Promise<number | null> {
  const score = await redis.zscore(
    keys.gameDisconnects,
    disconnectEntry.encode(scope, sessionId),
  )
  return score === null ? null : Number(score)
}

/** Rewrite an open window's deadline so it is already in the past. */
async function expireNow(scope: string, sessionId: string): Promise<void> {
  const stored = await loadGame(scope)
  assert.ok(stored, 'test setup: expected a stored game')

  const past = Date.now() - 1
  await redis.set(
    keys.game(scope),
    JSON.stringify({
      ...stored,
      disconnected: { ...(stored.disconnected ?? {}), [sessionId]: past },
    }),
  )
  await redis.zadd(
    keys.gameDisconnects,
    past,
    disconnectEntry.encode(scope, sessionId),
  )
}

beforeEach(resetRedis)
after(teardownRedis)

describe('opening a reconnect window', () => {
  it('records the deadline on the game and in the sweeper index', async () => {
    const scope = uniqueRoomId()
    await startMrWhite(scope)

    const before = Date.now()
    const opened = await markDisconnected(scope, alice.sessionId, GRACE_MS)

    assert.notEqual(opened, null)
    const deadline = opened?.stored.disconnected?.[alice.sessionId]
    assert.ok(deadline !== undefined, 'the game must carry the deadline')
    assert.ok(
      deadline >= before + GRACE_MS && deadline <= Date.now() + GRACE_MS,
      `deadline ${String(deadline)} is not one grace period from now`,
    )

    assert.equal(
      await indexedDeadline(scope, alice.sessionId),
      deadline,
      'the sweeper reads the index, not the game — the two must agree',
    )
  })

  it('bumps the version so the table is told', async () => {
    const scope = uniqueRoomId()
    const started = await startMrWhite(scope)

    const opened = await markDisconnected(scope, alice.sessionId, GRACE_MS)

    assert.equal(
      opened?.stored.version,
      started.version + 1,
      'without a new version the other players never learn someone dropped',
    )
    assert.deepEqual(await loadGame(scope), opened?.stored, 'and it is persisted')
  })

  it('does not touch the game state itself', async () => {
    const scope = uniqueRoomId()
    const started = await startMrWhite(scope)

    const opened = await markDisconnected(scope, alice.sessionId, GRACE_MS)

    assert.deepEqual(
      stateOf(opened?.stored as StoredGame),
      stateOf(started),
      'dropping out is not a move — nothing about the round changes until the window expires',
    )
  })

  it('ignores a second disconnect while one is already counting down', async () => {
    const scope = uniqueRoomId()
    await startMrWhite(scope)

    const first = await markDisconnected(scope, alice.sessionId, GRACE_MS)
    const second = await markDisconnected(scope, alice.sessionId, GRACE_MS)

    assert.notEqual(first, null)
    assert.equal(
      second,
      null,
      'a connection that flaps must not be able to hold its seat open forever',
    )
    assert.equal(
      (await loadGame(scope))?.version,
      first?.stored.version,
      'and the duplicate writes nothing',
    )
  })

  it('tracks several absent players independently', async () => {
    const scope = uniqueRoomId()
    await startMrWhite(scope)

    await markDisconnected(scope, alice.sessionId, GRACE_MS)
    await markDisconnected(scope, bob.sessionId, GRACE_MS)

    const stored = await loadGame(scope)
    assert.deepEqual(Object.keys(stored?.disconnected ?? {}).sort(), [
      alice.sessionId,
      bob.sessionId,
    ].sort())
    assert.notEqual(await indexedDeadline(scope, bob.sessionId), null)
  })

  it('does nothing when no game is running', async () => {
    const scope = uniqueRoomId()

    assert.equal(await markDisconnected(scope, alice.sessionId, GRACE_MS), null)
    assert.equal(await indexedDeadline(scope, alice.sessionId), null)
  })

  it('does nothing for someone who joined the table mid-game', async () => {
    const scope = uniqueRoomId()
    await startMrWhite(scope)

    // Mallory sat down after the deal, so she is watching. Nothing in the round
    // waits on her, so there is nothing to expire.
    assert.equal(await markDisconnected(scope, mallory.sessionId, GRACE_MS), null)
    assert.equal(await indexedDeadline(scope, mallory.sessionId), null)
  })

  it('does nothing once the game has finished', async () => {
    const scope = uniqueRoomId()
    const started = await startMrWhite(scope)
    await redis.set(
      keys.game(scope),
      JSON.stringify({ ...started, finished: true }),
    )

    assert.equal(await markDisconnected(scope, alice.sessionId, GRACE_MS), null)
    assert.equal(await indexedDeadline(scope, alice.sessionId), null)
  })
})

describe('closing a reconnect window', () => {
  it('clears both the game record and the index', async () => {
    const scope = uniqueRoomId()
    await startMrWhite(scope)
    await markDisconnected(scope, alice.sessionId, GRACE_MS)

    const closed = await markReconnected(scope, alice.sessionId)

    assert.notEqual(closed, null)
    assert.deepEqual(closed?.stored.disconnected, {})
    assert.equal(
      await indexedDeadline(scope, alice.sessionId),
      null,
      'an entry left behind here would eliminate a player who is sitting at the table',
    )
  })

  it('leaves the other absent players counting down', async () => {
    const scope = uniqueRoomId()
    await startMrWhite(scope)
    await markDisconnected(scope, alice.sessionId, GRACE_MS)
    await markDisconnected(scope, bob.sessionId, GRACE_MS)

    await markReconnected(scope, alice.sessionId)

    assert.deepEqual(Object.keys((await loadGame(scope))?.disconnected ?? {}), [
      bob.sessionId,
    ])
    assert.notEqual(await indexedDeadline(scope, bob.sessionId), null)
  })

  it('does nothing for a player who never dropped', async () => {
    const scope = uniqueRoomId()
    const started = await startMrWhite(scope)

    assert.equal(await markReconnected(scope, alice.sessionId), null)
    assert.equal(
      (await loadGame(scope))?.version,
      started.version,
      'an ordinary join must not bump the version for everyone else',
    )
  })

  it('clears an orphaned index entry left by a purged game', async () => {
    const scope = uniqueRoomId()
    await redis.zadd(
      keys.gameDisconnects,
      Date.now(),
      disconnectEntry.encode(scope, alice.sessionId),
    )

    await markReconnected(scope, alice.sessionId)

    assert.equal(await indexedDeadline(scope, alice.sessionId), null)
  })
})

describe('finding windows that have run out', () => {
  it('reports nothing before the deadline', async () => {
    const scope = uniqueRoomId()
    await startMrWhite(scope)
    await markDisconnected(scope, alice.sessionId, GRACE_MS)

    assert.deepEqual(await dueDisconnects(Date.now()), [])
  })

  it('reports the scope and the player once it passes', async () => {
    const scope = uniqueRoomId()
    await startMrWhite(scope)
    await markDisconnected(scope, alice.sessionId, GRACE_MS)

    assert.deepEqual(await dueDisconnects(Date.now() + GRACE_MS + 1), [
      { scope, sessionId: alice.sessionId },
    ])
  })

  it('survives a lobby scope, which contains a colon', async () => {
    // `lobby:aachen-1|<uuid>` has to decode back to its two halves, or the
    // sweeper would look for a game under the wrong key.
    const scope = `lobby:${uniqueRoomId()}`
    await startMrWhite(scope)
    await markDisconnected(scope, alice.sessionId, GRACE_MS)

    assert.deepEqual(await dueDisconnects(Date.now() + GRACE_MS + 1), [
      { scope, sessionId: alice.sessionId },
    ])
  })

  it('drops an entry it cannot parse rather than tripping over it every second', async () => {
    await redis.zadd(keys.gameDisconnects, Date.now() - 1, 'nonsense-with-no-separator')

    assert.deepEqual(await dueDisconnects(), [])
    assert.equal(
      await redis.zscore(keys.gameDisconnects, 'nonsense-with-no-separator'),
      null,
    )
  })
})

describe('expiring a reconnect window', () => {
  it('eliminates the player and clears the index', async () => {
    const scope = uniqueRoomId()
    const started = await startMrWhite(scope)
    const civilian = aCivilianOf(started)

    await markDisconnected(scope, civilian, GRACE_MS)
    await expireNow(scope, civilian)

    const expired = await expireDisconnect(scope, civilian)

    assert.notEqual(expired, null)
    assert.ok(
      stateOf(expired?.stored as StoredGame).eliminated.includes(civilian),
      'the whole point is that the table stops waiting on them',
    )
    assert.deepEqual(expired?.stored.disconnected, {})
    assert.equal(await indexedDeadline(scope, civilian), null)
  })

  it('leaves the game playable for everyone still seated', async () => {
    const scope = uniqueRoomId()
    const started = await startMrWhite(scope)
    const civilian = aCivilianOf(started)

    await markDisconnected(scope, civilian, GRACE_MS)
    await expireNow(scope, civilian)
    const expired = await expireDisconnect(scope, civilian)

    assert.equal(
      expired?.stored.finished,
      false,
      'one dropped connection must not end a four-person game',
    )
    assert.equal(expired?.stored.result, null)
  })

  it('reindexes the deadline of whatever phase it landed on', async () => {
    const scope = uniqueRoomId()
    const started = await startMrWhite(scope)
    const definition = getGameDefinition('mr-white') as AnyGameDefinition
    const civilian = aCivilianOf(started)

    await markDisconnected(scope, civilian, GRACE_MS)
    await expireNow(scope, civilian)
    const expired = await expireDisconnect(scope, civilian)

    const indexed = await redis.zscore(keys.gameDeadlines, scope)
    assert.equal(
      Number(indexed),
      definition.deadline(stateOf(expired?.stored as StoredGame)),
      'without this the game sits in its repaired phase and never advances again',
    )
  })

  it('ends the game when the player who never came back was Mr. White', async () => {
    const scope = uniqueRoomId()
    const started = await startMrWhite(scope)
    const impostor = impostorOf(started)

    await markDisconnected(scope, impostor, GRACE_MS)
    await expireNow(scope, impostor)
    const expired = await expireDisconnect(scope, impostor)

    assert.equal(expired?.stored.finished, true)
    assert.equal(expired?.stored.result?.team, 'civilians')
    assert.equal(expired?.stored.result?.reason, 'forfeit')
  })

  it('does nothing for a player who came back', async () => {
    const scope = uniqueRoomId()
    const started = await startMrWhite(scope)

    await markDisconnected(scope, alice.sessionId, GRACE_MS)
    await expireNow(scope, alice.sessionId)
    await markReconnected(scope, alice.sessionId)

    assert.equal(await expireDisconnect(scope, alice.sessionId), null)
    const stored = await loadGame(scope)
    assert.deepEqual(
      stateOf(stored as StoredGame).eliminated,
      stateOf(started).eliminated,
      'a stale sweep must never eliminate someone who is present',
    )
  })

  it('does nothing before the deadline actually passes', async () => {
    const scope = uniqueRoomId()
    await startMrWhite(scope)
    await markDisconnected(scope, alice.sessionId, GRACE_MS)

    assert.equal(await expireDisconnect(scope, alice.sessionId), null)
    assert.notEqual(
      await indexedDeadline(scope, alice.sessionId),
      null,
      'the window is still owed, so the entry stays',
    )
  })

  it('is a no-op the second time, so two nodes sweeping is harmless', async () => {
    const scope = uniqueRoomId()
    const started = await startMrWhite(scope)
    const civilian = aCivilianOf(started)

    await markDisconnected(scope, civilian, GRACE_MS)
    await expireNow(scope, civilian)

    const first = await expireDisconnect(scope, civilian)
    const second = await expireDisconnect(scope, civilian)

    assert.notEqual(first, null)
    assert.equal(second, null, 'a duplicate sweep must not eliminate a second time')
    assert.equal((await loadGame(scope))?.version, first?.stored.version)
  })

  it('resolves a simultaneous double sweep to one elimination', async () => {
    const scope = uniqueRoomId()
    const started = await startMrWhite(scope)
    const civilian = aCivilianOf(started)

    await markDisconnected(scope, civilian, GRACE_MS)
    await expireNow(scope, civilian)

    const results = await Promise.all([
      expireDisconnect(scope, civilian),
      expireDisconnect(scope, civilian),
    ])

    assert.equal(
      results.filter((result) => result !== null).length,
      1,
      'the compare-and-set loser has to find nothing left to do',
    )
    assert.equal(
      stateOf((await loadGame(scope)) as StoredGame).eliminated.filter(
        (id) => id === civilian,
      ).length,
      1,
    )
  })

  it('drops the index entry when the game is already gone', async () => {
    const scope = uniqueRoomId()
    await redis.zadd(
      keys.gameDisconnects,
      Date.now() - 1,
      disconnectEntry.encode(scope, alice.sessionId),
    )

    assert.equal(await expireDisconnect(scope, alice.sessionId), null)
    assert.equal(
      await indexedDeadline(scope, alice.sessionId),
      null,
      'a game that expired under its TTL must not leave the sweeper spinning',
    )
  })

  it('owes no elimination on a game that finished some other way', async () => {
    const scope = uniqueRoomId()
    await startMrWhite(scope)
    await markDisconnected(scope, alice.sessionId, GRACE_MS)
    await expireNow(scope, alice.sessionId)

    const stored = await loadGame(scope)
    await redis.set(keys.game(scope), JSON.stringify({ ...stored, finished: true }))

    assert.equal(await expireDisconnect(scope, alice.sessionId), null)
    assert.equal(await indexedDeadline(scope, alice.sessionId), null)
  })
})

describe('purging a game with a window open', () => {
  it('clears the disconnect index too', async () => {
    const scope = uniqueRoomId()
    await startMrWhite(scope)
    await markDisconnected(scope, alice.sessionId, GRACE_MS)
    await markDisconnected(scope, bob.sessionId, GRACE_MS)

    await purgeGame(scope)

    assert.equal(await loadGame(scope), null)
    assert.equal(await indexedDeadline(scope, alice.sessionId), null)
    assert.equal(
      await indexedDeadline(scope, bob.sessionId),
      null,
      'nothing about a game may survive its table, the sweeper index included',
    )
  })
})

describe('what the table is shown', () => {
  it('publishes who is missing and when they run out', async () => {
    const scope = uniqueRoomId()
    await startMrWhite(scope)
    const opened = await markDisconnected(scope, alice.sessionId, GRACE_MS)
    const definition = getGameDefinition('mr-white') as AnyGameDefinition

    const view = buildView(opened?.stored as StoredGame, definition, bob.sessionId)

    assert.deepEqual(view.disconnected, opened?.stored.disconnected)
  })

  it('shows nobody missing on a finished game', async () => {
    const scope = uniqueRoomId()
    await startMrWhite(scope)
    const opened = await markDisconnected(scope, alice.sessionId, GRACE_MS)
    const definition = getGameDefinition('mr-white') as AnyGameDefinition

    const view = buildView(
      { ...(opened?.stored as StoredGame), finished: true },
      definition,
      bob.sessionId,
    )

    assert.deepEqual(
      view.disconnected,
      {},
      'a reconnect countdown next to the final result is nonsense',
    )
  })

  it('reads a game stored before the field existed as nobody missing', async () => {
    const scope = uniqueRoomId()
    const started = await startMrWhite(scope)
    const definition = getGameDefinition('mr-white') as AnyGameDefinition

    // Games written by the previous deploy are still in Redis under the 12h TTL.
    const legacy = { ...started }
    delete legacy.disconnected

    assert.deepEqual(buildView(legacy, definition, bob.sessionId).disconnected, {})
  })
})

describe('leaving the lobby before a game starts', () => {
  it('frees the seat immediately', async () => {
    const lobbyId = uniqueRoomId('lob')
    const socketId = uniqueSocketId()

    await joinLobby(lobbyId, {
      socketId,
      sessionId: alice.sessionId,
      nickname: 'Alice',
      joinedAt: Date.now(),
    })

    const left = await leaveLobby(socketId)

    assert.equal(left?.lobbyId, lobbyId)
    assert.equal(left?.member.sessionId, alice.sessionId)
    assert.deepEqual(
      await getLobbyMembers(lobbyId),
      [],
      'a seat held by a socket that is gone is a seat nobody else can take',
    )
  })

  it('reports the remaining occupancy so the caller knows whether to purge', async () => {
    const lobbyId = uniqueRoomId('lob')
    const staying = uniqueSocketId()
    const leaving = uniqueSocketId()

    for (const [socketId, entry] of [
      [staying, bob],
      [leaving, alice],
    ] as const) {
      await joinLobby(lobbyId, {
        socketId,
        sessionId: entry.sessionId,
        nickname: entry.nickname,
        joinedAt: Date.now(),
      })
    }

    assert.equal((await leaveLobby(leaving))?.remaining, 1)
    assert.equal((await leaveLobby(staying))?.remaining, 0)
  })

  it('opens no reconnect window when there is no game to hold', async () => {
    const lobbyId = uniqueRoomId('lob')
    const scope = `lobby:${lobbyId}`
    const socketId = uniqueSocketId()

    await joinLobby(lobbyId, {
      socketId,
      sessionId: alice.sessionId,
      nickname: 'Alice',
      joinedAt: Date.now(),
    })
    await leaveLobby(socketId)

    // This is what separates the two requirements: waiting in a lobby means
    // leaving is instant and total, with nothing left counting down.
    assert.equal(await markDisconnected(scope, alice.sessionId, GRACE_MS), null)
    assert.equal(await indexedDeadline(scope, alice.sessionId), null)
  })

  it('lets a returning player take a fresh seat', async () => {
    const lobbyId = uniqueRoomId('lob')
    const before = uniqueSocketId()
    const after = uniqueSocketId()

    const seat = {
      sessionId: carol.sessionId,
      nickname: 'Carol',
      joinedAt: Date.now(),
    }

    await joinLobby(lobbyId, { ...seat, socketId: before })
    await leaveLobby(before)

    // A socket id does not survive a dropped connection, which is exactly why
    // the seat is freed instantly and the GAME is what remembers them.
    const rejoined = await joinLobby(lobbyId, {
      ...seat,
      socketId: after,
      joinedAt: Date.now() + 1,
    })

    assert.equal(rejoined.ok, true)
    assert.deepEqual(
      (await getLobbyMembers(lobbyId)).map((member) => member.socketId),
      [after],
    )
  })
})
