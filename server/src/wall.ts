import type { Redis } from 'ioredis'

import type { DuduBroadcast, DuduReply } from './events.js'
import { moderateText } from './moderation.js'
import { DUDU_TTL_SECONDS, keys, redis } from './redis.js'

/**
 * The DUDU wall: a global, ephemeral, anonymous feed.
 *
 * STORAGE SHAPE
 *   dudu:message:{id}  STRING  the payload, carrying a native 48h TTL
 *   dudu:wall          ZSET    message ids scored by epoch-ms post time
 *   dudu:replies:{id}  LIST    replies on one note, oldest first
 *
 * Redis expires the payloads on its own, which is what makes "auto-delete
 * exactly 48 hours after posting" true without a sweeper. ZSET members do NOT
 * expire though, so the index would grow forever — every read prunes entries
 * older than the TTL, which keeps it self-healing without a cron job.
 *
 * A thread takes its expiry from its note's REMAINING life rather than a fresh
 * 48h, so it comes down with the paper it is stapled to and can never outlive
 * it. That is also why a reply carries no expiry of its own: one clock per
 * note, and reading the parent's is always right.
 *
 * The reply count is DERIVED (an LLEN at read time), never stored on the note.
 * Storing it would mean rewriting the note's payload on every reply, and every
 * rewrite is a chance to reset the very TTL the wall's promise rests on.
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

/**
 * Ceiling on one note's thread.
 *
 * Rate limiting is per session, so enough people can still push a busy note
 * past any sane length. The trim drops the OLDEST replies, losing the top of a
 * very long conversation — acceptable on a board that forgets everything inside
 * two days, and far more likely to stay theoretical than to ever fire.
 */
const MAX_REPLIES_PER_NOTE = 200

/**
 * A note id as this server issues them: `crypto.randomUUID()`, nothing else.
 *
 * Checked before the id is ever interpolated into a key. A client picks this
 * value, and without the pattern it could name any key in the database —
 * `dudu:replies:` is only a prefix, and a colon in the id would walk straight
 * out of the namespace it is supposed to be confined to.
 */
const NOTE_ID =
  /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i

/**
 * Stored form. `authorId` never leaves the server — see `toBroadcast`.
 *
 * `replyCount` is deliberately absent: it is counted at read time, so the
 * stored payload is written exactly once and its TTL is never disturbed.
 */
interface StoredMessage extends Omit<DuduBroadcast, 'replyCount'> {
  authorId: string
}

/** Stored form of a reply. `authorId` is stripped on the way out, as above. */
interface StoredReply extends DuduReply {
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

/** Everything a post can fail with, plus the one failure only a reply has. */
export type ReplyFailure = PostFailure | 'unknown-note'

export type ReplyOutcome =
  | { ok: true; reply: DuduReply }
  | { ok: false; error: ReplyFailure }

function toBroadcast(stored: StoredMessage, replyCount: number): DuduBroadcast {
  // authorId is deliberately dropped: the wall is anonymous, and leaking a
  // stable id would let anyone correlate every post by the same person.
  const { authorId: _authorId, ...broadcast } = stored
  return { ...broadcast, replyCount }
}

/** Same reasoning as `toBroadcast`: the correlatable id stays on the server. */
function toReply(stored: StoredReply): DuduReply {
  const { authorId: _authorId, ...reply } = stored
  return reply
}

/**
 * Reply counts for a batch of notes, in the order the ids came in.
 *
 * One pipeline rather than N round trips — the wall reads fifty notes at a
 * time, and fifty sequential LLENs would be fifty times the latency for a
 * number that decorates a footer.
 */
async function countReplies(ids: string[]): Promise<number[]> {
  if (ids.length === 0) return []

  const pipeline = redis.pipeline()
  for (const id of ids) pipeline.llen(keys.duduReplies(id))
  const results = await pipeline.exec()

  return ids.map((_, index) => {
    const entry = results?.[index]
    // Each entry is [error, value]. A failed count must not sink the read: a
    // note showing zero replies beats a blank wall.
    if (!entry || entry[0]) return 0
    return typeof entry[1] === 'number' ? entry[1] : 0
  })
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

  // A note nobody has answered yet. Counting would be a round trip to learn 0.
  const broadcast = toBroadcast(stored, 0)

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

  const live: StoredMessage[] = []
  const orphaned: string[] = []

  rows.forEach((row, index) => {
    const id = ids[index]!

    if (!row) {
      // Payload expired but the index entry survived — clean it up.
      orphaned.push(id)
      return
    }

    try {
      live.push(JSON.parse(row) as StoredMessage)
    } catch {
      orphaned.push(id)
    }
  })

  if (orphaned.length > 0) {
    await redis.zrem(keys.duduWall, ...orphaned)
  }

  // Counted against the surviving notes, not the ids we asked for: an expired
  // note drops out above, and counting by position would then hang every
  // remaining thread on the wrong piece of paper.
  const counts = await countReplies(live.map((message) => message.id))

  return live.map((message, index) => toBroadcast(message, counts[index] ?? 0))
}

/**
 * Moderate, store and publish a reply.
 *
 * Ordered the way `postMessage` is, with the note check slotted in before
 * moderation: there is no sense classifying an answer to a note that already
 * came down.
 */
export async function postReply(
  author: { sessionId: string; nickname: string },
  noteId: unknown,
  body: unknown,
): Promise<ReplyOutcome> {
  if (typeof noteId !== 'string' || !NOTE_ID.test(noteId)) {
    return { ok: false, error: 'unknown-note' }
  }

  if (typeof body !== 'string') {
    return { ok: false, error: 'too-short' }
  }

  // The same counter posts use, on purpose: a reply is exactly as cheap to
  // flood as a note, so one budget per session covers both.
  const count = await scripts.duduRateLimit(
    keys.duduRateLimit(author.sessionId),
    String(RATE_LIMIT_WINDOW_SECONDS),
  )

  if (count > RATE_LIMIT_MAX) {
    return { ok: false, error: 'rate-limited' }
  }

  const remainingMs = await redis.pttl(keys.duduMessage(noteId))

  // PTTL answers -2 for "no such key" and -1 for "key with no expiry". Neither
  // can be a live note — every note is written with an EX — so both mean the
  // paper is no longer on the wall.
  if (remainingMs <= 0) {
    return { ok: false, error: 'unknown-note' }
  }

  const verdict = await moderateText(body)

  if (!verdict.allowed) {
    return { ok: false, error: (verdict.reason ?? 'blocked-language') as ReplyFailure }
  }

  const stored: StoredReply = {
    id: crypto.randomUUID(),
    noteId,
    authorId: author.sessionId,
    nickname: author.nickname,
    body: body.trim(),
    createdAt: new Date().toISOString(),
  }

  const thread = keys.duduReplies(noteId)

  await redis
    .multi()
    .rpush(thread, JSON.stringify(stored))
    .ltrim(thread, -MAX_REPLIES_PER_NOTE, -1)
    // Re-stated on every write, not just the first. The note's remaining life
    // is the authority, and copying it here each time is what keeps the thread
    // from drifting past the paper it hangs on.
    .pexpire(thread, remainingMs)
    .exec()

  const reply = toReply(stored)

  // Same reasoning as a post: published, not emitted, so every socket node
  // hands it to its own connections.
  await redis.publish(keys.duduReplyChannel, JSON.stringify(reply))

  return { ok: true, reply }
}

/**
 * One note's whole thread, oldest first — the order it was written in.
 *
 * Fetched when a note is opened rather than shipped with the wall: most notes
 * are never opened, and a board of fifty threads is a great deal of text to
 * send for the one somebody actually reads.
 */
export async function getReplies(noteId: unknown): Promise<DuduReply[]> {
  if (typeof noteId !== 'string' || !NOTE_ID.test(noteId)) return []

  const rows = await redis.lrange(keys.duduReplies(noteId), 0, -1)
  const replies: DuduReply[] = []

  for (const row of rows) {
    try {
      replies.push(toReply(JSON.parse(row) as StoredReply))
    } catch {
      // One unreadable row must not blank the thread around it.
    }
  }

  return replies
}

/** Diagnostics for the health endpoint. */
export async function wallSize(): Promise<number> {
  return redis.zcard(keys.duduWall)
}
