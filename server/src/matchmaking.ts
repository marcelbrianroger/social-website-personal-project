import type { Redis } from 'ioredis'

import { keys, redis } from './redis.js'

/**
 * Redis-backed matchmaking queue.
 *
 * Users press "Find Match" instead of naming a room. They join a queue, and the
 * first moment two people are waiting, the server pairs them into a freshly
 * generated room.
 *
 * The queue is a LIST: newest pushed on the left, taken from the right, so it
 * is FIFO and nobody starves behind later arrivals.
 */

export interface QueueEntry {
  socketId: string
  sessionId: string
  nickname: string
  queuedAt: number
}

/**
 * Take two waiters in one atomic step.
 *
 * Two separate RPOPs from different nodes could interleave and hand the same
 * partner to two different people, or split a pair across two failed matches.
 * Popping both inside one script makes a pair indivisible.
 */
redis.defineCommand('matchPopPair', {
  numberOfKeys: 1,
  lua: `
    if redis.call('LLEN', KEYS[1]) < 2 then
      return {}
    end
    local a = redis.call('RPOP', KEYS[1])
    local b = redis.call('RPOP', KEYS[1])
    return {a, b}
  `,
})

/**
 * Remove a socket's entry wherever it sits in the queue.
 *
 * LREM needs the exact stored string, which the caller does not have (it
 * contains a timestamp), so the script decodes entries to match on socketId.
 */
redis.defineCommand('matchRemove', {
  numberOfKeys: 1,
  lua: `
    local items = redis.call('LRANGE', KEYS[1], 0, -1)
    for _, item in ipairs(items) do
      local ok, decoded = pcall(cjson.decode, item)
      if ok and decoded.socketId == ARGV[1] then
        redis.call('LREM', KEYS[1], 1, item)
        return 1
      end
    end
    return 0
  `,
})

interface MatchScripts {
  matchPopPair(queueKey: string): Promise<string[]>
  matchRemove(queueKey: string, socketId: string): Promise<number>
}

const scripts = redis as Redis & MatchScripts

function parseEntry(raw: string): QueueEntry | null {
  try {
    return JSON.parse(raw) as QueueEntry
  } catch {
    return null
  }
}

/**
 * Put a socket in the queue.
 *
 * Removes any existing entry first, so double-clicking "Find Match" cannot get
 * the same socket queued twice and paired with itself.
 */
export async function enqueue(entry: QueueEntry): Promise<void> {
  await scripts.matchRemove(keys.matchQueue, entry.socketId)
  await redis.lpush(keys.matchQueue, JSON.stringify(entry))
}

export async function dequeue(socketId: string): Promise<boolean> {
  return (await scripts.matchRemove(keys.matchQueue, socketId)) === 1
}

/** Return the next two waiters, or null if fewer than two are queued. */
export async function popPair(): Promise<[QueueEntry, QueueEntry] | null> {
  const raw = await scripts.matchPopPair(keys.matchQueue)
  if (raw.length < 2) return null

  const a = parseEntry(raw[0]!)
  const b = parseEntry(raw[1]!)

  // A corrupt entry is dropped rather than retried — it would never decode.
  if (!a || !b) return null

  return [a, b]
}

/** Return a waiter to the queue, keeping their original position priority. */
export async function requeue(entry: QueueEntry): Promise<void> {
  await redis.rpush(keys.matchQueue, JSON.stringify(entry))
}

export async function queueLength(): Promise<number> {
  return redis.llen(keys.matchQueue)
}

export async function isQueued(socketId: string): Promise<boolean> {
  const items = await redis.lrange(keys.matchQueue, 0, -1)
  return items.some((item) => parseEntry(item)?.socketId === socketId)
}

/**
 * Room id for a matched pair.
 *
 * Must satisfy the room-id pattern in rooms.ts (3-32 chars, alphanumeric plus
 * dash/underscore). Random rather than sequential so ids are not guessable —
 * a guessable id would let someone occupy a stranger's match slot.
 */
export function generateMatchRoomId(): string {
  return `m-${crypto.randomUUID().replace(/-/g, '').slice(0, 20)}`
}
