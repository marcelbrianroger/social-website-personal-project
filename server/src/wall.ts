import type { Redis } from 'ioredis'

import type { DuduBroadcast } from './events.js'
import { moderateText } from './moderation.js'
import { DUDU_TTL_SECONDS, keys, redis } from './redis.js'

/**
 * The DUDU wall: a global, ephemeral, anonymous feed.
 *
 * STORAGE SHAPE
 *   dudu:message:{id}  STRING  the payload, carrying a native 48h TTL
 *   dudu:wall          ZSET    message ids scored by epoch-ms post time
 *
 * Redis expires the payloads on its own, which is what makes "auto-delete
 * exactly 48 hours after posting" true without a sweeper. ZSET members do NOT
 * expire though, so the index would grow forever — every read prunes entries
 * older than the TTL, which keeps it self-healing without a cron job.
 *
 * NOTE: the Phase 1 Postgres `dudu_messages` table is not written here. The
 * realtime server has no Prisma client, so the durable moderation audit trail
 * is currently unwritten — see README.
 */

/** Max posts per session inside the rate-limit window. */
const RATE_LIMIT_MAX = 5
const RATE_LIMIT_WINDOW_SECONDS = 60

/** Newest N messages returned to a client on load. */
export const WALL_PAGE_SIZE = 50

/** Stored form. `authorId` never leaves the server — see `toBroadcast`. */
interface StoredMessage extends DuduBroadcast {
  authorId: string
}

/**
 * Atomic fixed-window rate limit.
 *
 * INCR then EXPIRE as separate calls can lose the expiry if the process dies in
 * between, leaving a counter that never resets and locks the session out
 * permanently.
 */
redis.defineCommand('duduRateLimit', {
  numberOfKeys: 1,
  lua: `
    local count = redis.call('INCR', KEYS[1])
    if count == 1 then
      redis.call('EXPIRE', KEYS[1], tonumber(ARGV[1]))
    end
    return count
  `,
})

interface DuduScripts {
  duduRateLimit(key: string, windowSeconds: string): Promise<number>
}

const scripts = redis as Redis & DuduScripts

export type PostFailure =
  | 'rate-limited'
  | 'too-short'
  | 'too-long'
  | 'links-not-allowed'
  | 'character-spam'
  | 'excessive-caps'
  | 'blocked-language'
  | 'moderation-unavailable'

export type PostOutcome =
  | { ok: true; message: DuduBroadcast }
  | { ok: false; error: PostFailure }

function toBroadcast(stored: StoredMessage): DuduBroadcast {
  // authorId is deliberately dropped: the wall is anonymous, and leaking a
  // stable id would let anyone correlate every post by the same person.
  const { authorId: _authorId, ...broadcast } = stored
  return broadcast
}

/**
 * Moderate, store and publish a submission.
 *
 * Ordering matters: rate limit first (cheapest, and stops a flood from
 * hammering the classifier), then moderation, then storage. Nothing is written
 * or published until the verdict is `allowed`.
 */
export async function postMessage(
  author: { sessionId: string; nickname: string },
  body: unknown,
): Promise<PostOutcome> {
  if (typeof body !== 'string') {
    return { ok: false, error: 'too-short' }
  }

  const count = await scripts.duduRateLimit(
    keys.duduRateLimit(author.sessionId),
    String(RATE_LIMIT_WINDOW_SECONDS),
  )

  if (count > RATE_LIMIT_MAX) {
    return { ok: false, error: 'rate-limited' }
  }

  const verdict = await moderateText(body)

  if (!verdict.allowed) {
    return { ok: false, error: (verdict.reason ?? 'blocked-language') as PostFailure }
  }

  const now = Date.now()
  const stored: StoredMessage = {
    id: crypto.randomUUID(),
    authorId: author.sessionId,
    nickname: author.nickname,
    body: body.trim(),
    createdAt: new Date(now).toISOString(),
    expiresAt: new Date(now + DUDU_TTL_SECONDS * 1000).toISOString(),
  }

  const payload = JSON.stringify(stored)

  await redis
    .multi()
    .set(keys.duduMessage(stored.id), payload, 'EX', DUDU_TTL_SECONDS)
    .zadd(keys.duduWall, now, stored.id)
    .exec()

  const broadcast = toBroadcast(stored)

  // Published rather than emitted directly, so every socket node fans it out to
  // its own connections. This is what makes the wall work across nodes.
  await redis.publish(keys.duduChannel, JSON.stringify(broadcast))

  return { ok: true, message: broadcast }
}

/**
 * Newest messages, most recent first.
 *
 * Prunes index entries whose payload has expired, so the ZSET cannot outgrow
 * the data it points at.
 */
export async function getWall(limit = WALL_PAGE_SIZE): Promise<DuduBroadcast[]> {
  const cutoff = Date.now() - DUDU_TTL_SECONDS * 1000

  // Drop index entries older than the TTL before reading.
  await redis.zremrangebyscore(keys.duduWall, '-inf', cutoff)

  const ids = await redis.zrevrange(keys.duduWall, 0, limit - 1)
  if (ids.length === 0) return []

  const rows = await redis.mget(ids.map((id) => keys.duduMessage(id)))

  const messages: DuduBroadcast[] = []
  const orphaned: string[] = []

  rows.forEach((row, index) => {
    const id = ids[index]!

    if (!row) {
      // Payload expired but the index entry survived — clean it up.
      orphaned.push(id)
      return
    }

    try {
      messages.push(toBroadcast(JSON.parse(row) as StoredMessage))
    } catch {
      orphaned.push(id)
    }
  })

  if (orphaned.length > 0) {
    await redis.zrem(keys.duduWall, ...orphaned)
  }

  return messages
}

/** Diagnostics for the health endpoint. */
export async function wallSize(): Promise<number> {
  return redis.zcard(keys.duduWall)
}
