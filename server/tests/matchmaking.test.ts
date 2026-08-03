import assert from 'node:assert/strict'
import { after, beforeEach, describe, it } from 'node:test'

import {
  dequeue,
  enqueue,
  generateMatchRoomId,
  isQueued,
  popPair,
  queueLength,
  requeue,
  type QueueEntry,
} from '../src/matchmaking.js'
import { isValidRoomId } from '../src/rooms.js'
import { resetRedis, teardownRedis, uniqueSocketId } from './helpers/harness.js'

/**
 * Phase 4 — Redis matchmaking queue.
 *
 * Seam: the exported functions of src/matchmaking.ts, against real Redis.
 *
 * The properties worth testing here are the ones a single-threaded walkthrough
 * of the code cannot demonstrate: that the queue is genuinely FIFO through
 * LPUSH/RPOP, that a pair is indivisible under concurrency, and that a
 * double-click cannot get one socket matched against itself.
 */

function waiter(nickname: string, queuedAt = Date.now()): QueueEntry {
  return {
    socketId: uniqueSocketId(),
    sessionId: `session-${nickname.toLowerCase()}`,
    nickname,
    queuedAt,
  }
}

beforeEach(resetRedis)
after(teardownRedis)

describe('matchmaking queue', () => {
  it('reports nobody waiting on an empty queue', async () => {
    assert.equal(await queueLength(), 0)
    assert.equal(await popPair(), null)
  })

  it('holds a waiter until a partner arrives', async () => {
    const alice = waiter('Alice')

    await enqueue(alice)

    assert.equal(await queueLength(), 1)
    assert.equal(await isQueued(alice.socketId), true)
    assert.equal(
      await popPair(),
      null,
      'a lone waiter must not be paired with themselves',
    )
    assert.equal(
      await queueLength(),
      1,
      'a failed pairing must leave the waiter in the queue',
    )
  })

  it('pairs two waiters and empties the queue', async () => {
    const alice = waiter('Alice')
    const bob = waiter('Bob')

    await enqueue(alice)
    await enqueue(bob)

    const pair = await popPair()

    assert.notEqual(pair, null)
    assert.deepEqual(
      pair?.map((entry) => entry.nickname).sort(),
      ['Alice', 'Bob'],
      'both waiters must come back out',
    )
    assert.equal(await queueLength(), 0)
  })

  it('round-trips the full entry, not just an id', async () => {
    const alice = waiter('Alice', 1_700_000_000_000)
    await enqueue(alice)
    await enqueue(waiter('Bob'))

    const pair = await popPair()

    assert.deepEqual(
      pair?.[0],
      alice,
      'the matched socket, session and nickname are what the caller needs to build the room',
    )
  })

  it('serves the longest waiter first', async () => {
    const alice = waiter('Alice')
    const bob = waiter('Bob')
    const carol = waiter('Carol')

    await enqueue(alice)
    await enqueue(bob)
    await enqueue(carol)

    const pair = await popPair()

    assert.deepEqual(
      pair?.map((entry) => entry.nickname),
      ['Alice', 'Bob'],
      'FIFO: nobody starves behind a later arrival',
    )
    assert.equal(await isQueued(carol.socketId), true, 'Carol waits for a partner')
  })

  it('keeps a re-queued waiter at the front of the line', async () => {
    const alice = waiter('Alice')
    const bob = waiter('Bob')

    await enqueue(alice)
    await enqueue(bob)

    // The server pops a pair, then discovers one half has gone. The survivor
    // must not be sent to the back of the queue for someone else's disconnect.
    const [first] = (await popPair()) ?? []
    assert.equal(first?.nickname, 'Alice')

    await requeue(first as QueueEntry)
    await enqueue(waiter('Carol'))

    const pair = await popPair()

    assert.deepEqual(
      pair?.map((entry) => entry.nickname),
      ['Alice', 'Carol'],
      'the re-queued waiter is matched before the newcomer',
    )
  })

  describe('double entry', () => {
    it('does not queue the same socket twice', async () => {
      const alice = waiter('Alice')

      await enqueue(alice)
      await enqueue(alice)

      assert.equal(
        await queueLength(),
        1,
        'double-clicking Find Match must not create a second entry',
      )
      assert.equal(
        await popPair(),
        null,
        'and so must never pair a socket with itself',
      )
    })

    it('refreshes the entry rather than keeping the stale one', async () => {
      const alice = waiter('Alice', 1_000)
      await enqueue(alice)
      await enqueue({ ...alice, nickname: 'Alice2', queuedAt: 2_000 })
      await enqueue(waiter('Bob'))

      const pair = await popPair()

      assert.equal(pair?.[0]?.nickname, 'Alice2')
      assert.equal(pair?.[0]?.queuedAt, 2_000)
    })
  })

  describe('leaving the queue', () => {
    it('removes a waiter from the middle of the line', async () => {
      const alice = waiter('Alice')
      const bob = waiter('Bob')
      const carol = waiter('Carol')

      await enqueue(alice)
      await enqueue(bob)
      await enqueue(carol)

      assert.equal(await dequeue(bob.socketId), true)
      assert.equal(await isQueued(bob.socketId), false)
      assert.equal(await queueLength(), 2)

      const pair = await popPair()

      assert.deepEqual(
        pair?.map((entry) => entry.nickname),
        ['Alice', 'Carol'],
        'the survivors close ranks in order',
      )
    })

    it('reports nothing removed for a socket that never queued', async () => {
      await enqueue(waiter('Alice'))

      assert.equal(await dequeue(uniqueSocketId()), false)
      assert.equal(await queueLength(), 1, 'an unrelated cancel removes nobody')
    })

    it('is idempotent', async () => {
      const alice = waiter('Alice')
      await enqueue(alice)

      assert.equal(await dequeue(alice.socketId), true)
      assert.equal(
        await dequeue(alice.socketId),
        false,
        'a cancel racing a disconnect must not remove somebody else',
      )
    })
  })

  describe('concurrency', () => {
    it('never hands the same waiter to two matchers', async () => {
      const waiters = Array.from({ length: 10 }, (_, index) =>
        waiter(`P${index}`),
      )
      for (const entry of waiters) await enqueue(entry)

      // Ten simultaneous pair attempts against five available pairs. Without
      // the atomic Lua pop, two matchers could each RPOP one half of the same
      // pair and both fail, or worse, both claim the same partner.
      const results = await Promise.all(
        Array.from({ length: 10 }, () => popPair()),
      )

      const pairs = results.filter((pair) => pair !== null)
      assert.equal(pairs.length, 5, 'ten waiters make exactly five pairs')

      const claimed = pairs.flat().map((entry) => entry.socketId)
      assert.equal(
        new Set(claimed).size,
        10,
        'no socket may appear in two different matches',
      )
      assert.equal(await queueLength(), 0, 'nobody is left behind')
    })

    it('leaves an odd waiter queued when matchers outnumber pairs', async () => {
      const waiters = Array.from({ length: 5 }, (_, index) => waiter(`P${index}`))
      for (const entry of waiters) await enqueue(entry)

      const results = await Promise.all(
        Array.from({ length: 5 }, () => popPair()),
      )

      const pairs = results.filter((pair) => pair !== null)
      assert.equal(pairs.length, 2)
      assert.equal(
        await queueLength(),
        1,
        'the unpaired waiter stays queued rather than being dropped',
      )
    })
  })

  describe('generated room ids', () => {
    it('produces ids the room registry will accept', () => {
      const id = generateMatchRoomId()

      assert.equal(
        isValidRoomId(id),
        true,
        `matchmaking must not generate ids joinRoom rejects: ${id}`,
      )
    })

    it('does not repeat or count upwards', () => {
      const ids = Array.from({ length: 200 }, () => generateMatchRoomId())

      assert.equal(new Set(ids).size, 200, 'ids must be unique')

      // Sequential ids would let anyone guess the next match room and occupy a
      // stranger's slot before their partner arrives.
      const [first, second] = ids as [string, string]
      assert.notEqual(
        first.slice(2, 10),
        second.slice(2, 10),
        'ids must not share a predictable prefix',
      )
    })
  })
})
