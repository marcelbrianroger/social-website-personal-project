import assert from 'node:assert/strict'
import { after, beforeEach, describe, it } from 'node:test'

import type { RoomPeer } from '../src/events.js'
import { ROOM_TTL_SECONDS, keys, redis } from '../src/redis.js'
import {
  ROOM_CAPACITY,
  canRelay,
  getMembers,
  getSocketRoom,
  isValidRoomId,
  joinRoom,
  leaveRoom,
} from '../src/rooms.js'
import { resetRedis, teardownRedis, uniqueRoomId, uniqueSocketId } from './helpers/harness.js'

/**
 * Room registry — the membership primitive matchmaking pairs into and the
 * game engine seats players from.
 *
 * Seam: the exported functions of src/rooms.ts, against real Redis.
 *
 * Two properties carry real weight here. Capacity is enforced inside a Lua
 * script because two nodes checking HLEN separately would both see "1 member"
 * and both insert. And `canRelay` is the only thing standing between the
 * signalling relay and an open message bus.
 */

let clock = 1_700_000_000_000

function peer(nickname: string, joinedAt?: number): RoomPeer {
  clock += 1
  return {
    socketId: uniqueSocketId(),
    sessionId: `session-${nickname.toLowerCase()}-${clock}`,
    nickname,
    joinedAt: joinedAt ?? clock,
  }
}

beforeEach(resetRedis)
after(teardownRedis)

describe('room ids', () => {
  it('accepts the shapes the app generates', () => {
    for (const id of ['abc', 'room-1', 'a_b-C9', 'm-0123456789abcdef0123']) {
      assert.equal(isValidRoomId(id), true, `${id} should be valid`)
    }
  })

  it('rejects anything that could be abused as a key or a probe', () => {
    for (const id of [
      'ab', // too short to be worth guessing against
      'x'.repeat(33), // unbounded ids would let a client grow the keyspace
      'room:1', // a colon would collide with the Redis key layout
      'room 1',
      'room/../etc',
      '',
      42,
      null,
      undefined,
      { toString: () => 'abc' },
    ]) {
      assert.equal(isValidRoomId(id), false, `${String(id)} should be invalid`)
    }
  })

  it('refuses to create a room with an invalid id', async () => {
    const alice = peer('Alice')

    assert.deepEqual(await joinRoom('ab', alice), {
      ok: false,
      error: 'invalid-room-id',
    })
    assert.equal(await getSocketRoom(alice.socketId), null)
  })
})

describe('joining', () => {
  it('creates the room implicitly and reports an empty room', async () => {
    const roomId = uniqueRoomId()

    const result = await joinRoom(roomId, peer('Alice'))

    assert.deepEqual(result, { ok: true, peers: [] }, 'the first arrival sees nobody')
  })

  it('never shows a joiner to themselves', async () => {
    const roomId = uniqueRoomId()
    const alice = peer('Alice')

    const result = await joinRoom(roomId, alice)

    assert.equal(
      (result as { ok: true; peers: RoomPeer[] }).peers.some(
        (existing) => existing.socketId === alice.socketId,
      ),
      false,
      'a self-peer would make the client negotiate WebRTC with itself',
    )
  })

  it('tells the second arrival who is already there', async () => {
    const roomId = uniqueRoomId()
    const alice = peer('Alice')

    await joinRoom(roomId, alice)
    const result = await joinRoom(roomId, peer('Bob'))

    assert.deepEqual(
      (result as { ok: true; peers: RoomPeer[] }).peers,
      [alice],
      'the joiner offers to each peer returned here',
    )
  })

  it('records the reverse index so any node can resolve the socket', async () => {
    const roomId = uniqueRoomId()
    const alice = peer('Alice')

    await joinRoom(roomId, alice)

    assert.equal(
      await getSocketRoom(alice.socketId),
      roomId,
      'socket.data is per-process; Redis is the single source of truth',
    )
  })

  it('gives the room a TTL so a dead node cannot leave it full forever', async () => {
    const roomId = uniqueRoomId()
    await joinRoom(roomId, peer('Alice'))

    const ttl = await redis.ttl(keys.roomMembers(roomId))

    assert.ok(ttl > 0, `expected a positive TTL, got ${ttl}`)
    assert.ok(ttl <= ROOM_TTL_SECONDS)
  })

  it('refuses a socket that is already in the room', async () => {
    const roomId = uniqueRoomId()
    const alice = peer('Alice')

    await joinRoom(roomId, alice)

    assert.deepEqual(await joinRoom(roomId, alice), {
      ok: false,
      error: 'already-in-room',
    })
    assert.equal((await getMembers(roomId)).length, 1)
  })

  it('refuses the arrival that would exceed capacity', async () => {
    const roomId = uniqueRoomId()

    await joinRoom(roomId, peer('Alice'))
    await joinRoom(roomId, peer('Bob'))

    assert.deepEqual(await joinRoom(roomId, peer('Mallory')), {
      ok: false,
      error: 'room-full',
    })
    assert.equal((await getMembers(roomId)).length, ROOM_CAPACITY)
  })

  it('leaves a rejected joiner with no room recorded', async () => {
    const roomId = uniqueRoomId()
    await joinRoom(roomId, peer('Alice'))
    await joinRoom(roomId, peer('Bob'))

    const mallory = peer('Mallory')
    await joinRoom(roomId, mallory)

    assert.equal(
      await getSocketRoom(mallory.socketId),
      null,
      'a refused joiner must not be able to relay into the room',
    )
  })

  it('admits exactly the capacity when everyone arrives at once', async () => {
    const roomId = uniqueRoomId()
    const arrivals = Array.from({ length: 6 }, (_, index) => peer(`P${index}`))

    // Separate HLEN + HSET calls would let several of these observe the same
    // occupancy and all insert, putting three people in a two-person room.
    const results = await Promise.all(
      arrivals.map((entry) => joinRoom(roomId, entry)),
    )

    assert.equal(
      results.filter((result) => result.ok).length,
      ROOM_CAPACITY,
      'capacity must hold under a simultaneous rush',
    )
    assert.equal((await getMembers(roomId)).length, ROOM_CAPACITY)
  })
})

describe('membership order', () => {
  it('returns members in join order, not hash order', async () => {
    const roomId = uniqueRoomId()

    // Written newest-first on purpose. HVALS returns fields in whatever order
    // Redis feels like, so game seating would otherwise be a coin flip.
    const late = peer('Late', 2_000)
    const early = peer('Early', 1_000)

    await joinRoom(roomId, late)
    await joinRoom(roomId, early)

    assert.deepEqual(
      (await getMembers(roomId)).map((member) => member.nickname),
      ['Early', 'Late'],
      'whoever joined first is player one',
    )
  })

  it('reports an empty list for a room nobody is in', async () => {
    assert.deepEqual(await getMembers(uniqueRoomId()), [])
  })
})

describe('leaving', () => {
  it('reports the room, the peer and the remaining occupancy', async () => {
    const roomId = uniqueRoomId()
    const alice = peer('Alice')
    await joinRoom(roomId, alice)
    await joinRoom(roomId, peer('Bob'))

    const result = await leaveRoom(alice.socketId)

    assert.deepEqual(result, { roomId, peer: alice, remaining: 1 })
  })

  it('reports zero remaining for the last one out', async () => {
    const roomId = uniqueRoomId()
    const alice = peer('Alice')
    await joinRoom(roomId, alice)

    const result = await leaveRoom(alice.socketId)

    assert.equal(
      result?.remaining,
      0,
      'this is the signal the caller uses to purge the room game',
    )
  })

  it('clears the reverse index', async () => {
    const roomId = uniqueRoomId()
    const alice = peer('Alice')
    await joinRoom(roomId, alice)

    await leaveRoom(alice.socketId)

    assert.equal(await getSocketRoom(alice.socketId), null)
  })

  it('frees the slot for someone new', async () => {
    const roomId = uniqueRoomId()
    const alice = peer('Alice')
    await joinRoom(roomId, alice)
    await joinRoom(roomId, peer('Bob'))
    await leaveRoom(alice.socketId)

    assert.equal((await joinRoom(roomId, peer('Carol'))).ok, true)
  })

  it('does nothing for a socket that is not in a room', async () => {
    assert.equal(await leaveRoom(uniqueSocketId()), null)
  })

  it('is idempotent', async () => {
    const roomId = uniqueRoomId()
    const alice = peer('Alice')
    await joinRoom(roomId, alice)

    assert.notEqual(await leaveRoom(alice.socketId), null)
    assert.equal(
      await leaveRoom(alice.socketId),
      null,
      'a disconnect racing an explicit leave must not double-count',
    )
  })

  it('tells exactly one of two simultaneous leavers that the room is empty', async () => {
    const roomId = uniqueRoomId()
    const alice = peer('Alice')
    const bob = peer('Bob')
    await joinRoom(roomId, alice)
    await joinRoom(roomId, bob)

    const results = await Promise.all([
      leaveRoom(alice.socketId),
      leaveRoom(bob.socketId),
    ])

    const zeroes = results.filter((result) => result?.remaining === 0)
    assert.equal(
      zeroes.length,
      1,
      'two purges of the same game would be wasteful; zero would leak it',
    )
  })
})

describe('relay authorisation', () => {
  it('allows signalling between two members of the same room', async () => {
    const roomId = uniqueRoomId()
    const alice = peer('Alice')
    const bob = peer('Bob')
    await joinRoom(roomId, alice)
    await joinRoom(roomId, bob)

    assert.equal(await canRelay(alice.socketId, bob.socketId), true)
    assert.equal(await canRelay(bob.socketId, alice.socketId), true)
  })

  it('refuses a target in a different room', async () => {
    const alice = peer('Alice')
    const mallory = peer('Mallory')
    await joinRoom(uniqueRoomId(), alice)
    await joinRoom(uniqueRoomId(), mallory)

    assert.equal(
      await canRelay(mallory.socketId, alice.socketId),
      false,
      'guessing a socket id must not be enough to push an SDP offer at a stranger',
    )
  })

  it('refuses a sender who is in no room', async () => {
    const roomId = uniqueRoomId()
    const alice = peer('Alice')
    await joinRoom(roomId, alice)

    assert.equal(await canRelay(uniqueSocketId(), alice.socketId), false)
  })

  it('refuses a target who is in no room', async () => {
    const roomId = uniqueRoomId()
    const alice = peer('Alice')
    await joinRoom(roomId, alice)

    assert.equal(await canRelay(alice.socketId, uniqueSocketId()), false)
  })

  it('refuses a socket addressing itself', async () => {
    const roomId = uniqueRoomId()
    const alice = peer('Alice')
    await joinRoom(roomId, alice)

    assert.equal(
      await canRelay(alice.socketId, alice.socketId),
      false,
      'a self-addressed relay is a loop, never legitimate signalling',
    )
  })

  it('refuses a malformed target rather than throwing', async () => {
    const roomId = uniqueRoomId()
    const alice = peer('Alice')
    await joinRoom(roomId, alice)

    for (const target of [null, undefined, '', 42, {}, ['x']]) {
      assert.equal(
        await canRelay(alice.socketId, target),
        false,
        `${String(target)} should be refused`,
      )
    }
  })

  it('revokes authorisation the moment a peer leaves', async () => {
    const roomId = uniqueRoomId()
    const alice = peer('Alice')
    const bob = peer('Bob')
    await joinRoom(roomId, alice)
    await joinRoom(roomId, bob)
    await leaveRoom(bob.socketId)

    assert.equal(await canRelay(alice.socketId, bob.socketId), false)
  })
})
