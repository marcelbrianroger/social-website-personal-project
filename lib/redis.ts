import { Redis, type RedisOptions } from 'ioredis'

/**
 * Redis client configuration.
 *
 * Two distinct roles, and they cannot share a connection:
 *  - the command client (`getRedis`) for reads/writes
 *  - subscriber connections (`createRedisSubscriber`) — once a connection issues
 *    SUBSCRIBE it enters subscriber mode and Redis rejects ordinary commands on
 *    it, so every subscriber needs its own socket.
 */

const REDIS_URL = process.env.REDIS_URL ?? 'redis://localhost:6379'

const baseOptions: RedisOptions = {
  // Surface a failed connection instead of queueing commands forever.
  maxRetriesPerRequest: 3,
  // Cap the backoff so a downed Redis doesn't retry-storm.
  retryStrategy: (times) => Math.min(times * 200, 5_000),
  lazyConnect: false,
}

const globalForRedis = globalThis as unknown as {
  redis: Redis | undefined
}

function createRedisClient(): Redis {
  const client = new Redis(REDIS_URL, baseOptions)

  client.on('error', (error) => {
    // ioredis emits on every reconnect attempt; an unhandled 'error' would
    // otherwise take the process down.
    console.error('[redis] connection error:', error.message)
  })

  return client
}

/** Shared command client. Reused across hot reloads in development. */
export function getRedis(): Redis {
  const client = globalForRedis.redis ?? createRedisClient()

  if (process.env.NODE_ENV !== 'production') {
    globalForRedis.redis = client
  }

  return client
}

/**
 * A dedicated connection for pub/sub. Callers own the returned client and are
 * responsible for calling `.quit()` on shutdown.
 */
export function createRedisSubscriber(): Redis {
  return createRedisClient()
}

/** Key layout. Centralised so the Next app and /server cannot drift apart. */
export const redisKeys = {
  /** Sorted set of approved DUDU message ids, scored by epoch-ms post time. */
  duduWall: 'dudu:wall',
  /** Individual message payload; carries its own 48h TTL. */
  duduMessage: (id: string) => `dudu:message:${id}`,
  /** Pub/sub channel that fans approved messages out to every socket node. */
  duduChannel: 'dudu:broadcast',
  /** LIST of replies on one note. Expires with the note itself. */
  duduReplies: (noteId: string) => `dudu:replies:${noteId}`,
  /** Pub/sub channel that fans new replies out to every socket node. */
  duduReplyChannel: 'dudu:reply',
  /** Per-session post rate limiting. */
  rateLimit: (sessionId: string) => `ratelimit:dudu:${sessionId}`,
} as const

/** The DUDU wall's fixed lifetime: messages auto-delete exactly 48h after posting. */
export const DUDU_TTL_SECONDS = 48 * 60 * 60
