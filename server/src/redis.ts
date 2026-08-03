import { Redis } from 'ioredis'

import { env } from './env.js'

/**
 * Redis connections for the realtime server.
 *
 * Three separate connections, because Redis connection modes are exclusive:
 *  - `redis`  — ordinary commands (room registry, queue, DUDU store)
 *  - `pubClient` / `subClient` — owned by @socket.io/redis-adapter
 *
 * A connection that has issued SUBSCRIBE enters subscriber mode and Redis
 * rejects normal commands on it, so the adapter cannot share the command
 * client.
 */

function createClient(role: string): Redis {
  const client = new Redis(env.redisUrl, {
    maxRetriesPerRequest: 3,
    retryStrategy: (times) => Math.min(times * 200, 5_000),
  })

  client.on('error', (error: Error) => {
    console.error(`[redis:${role}] ${error.message}`)
  })

  return client
}

export const redis = createClient('commands')
export const pubClient = createClient('adapter-pub')
export const subClient = createClient('adapter-sub')

/**
 * A fresh connection for application-level pub/sub.
 *
 * `subClient` above belongs to the Socket.io adapter — subscribing to our own
 * channels on it would interleave with the adapter's protocol traffic. Callers
 * own the returned client and must `.quit()` it on shutdown.
 */
export function createSubscriber(role = 'app-sub'): Redis {
  return createClient(role)
}

/**
 * Key layout.
 *
 * Centralised so the room registry, matchmaking and DUDU modules cannot drift
 * apart, and so the Next.js app (lib/redis.ts) can mirror the DUDU keys.
 */
export const keys = {
  /** HASH socketId -> RoomPeer JSON. */
  roomMembers: (roomId: string) => `room:${roomId}:members`,
  /**
   * Reverse index socketId -> roomId.
   *
   * Needed because `socket.data` is per-process: once matchmaking can make a
   * socket on another node join a room, that node's local state is the only
   * place that would know, and relay authorisation would break. Redis is the
   * single source of truth instead.
   */
  socketRoom: (socketId: string) => `socket:${socketId}:room`,

  /** LIST of queued JSON entries, newest pushed on the left. */
  matchQueue: 'matchmaking:queue',

  /** STRING of StoredGame JSON. Purged when the room empties. */
  game: (roomId: string) => `game:${roomId}`,

  /** STRING of DuduMessage JSON, carrying its own 24h TTL. */
  duduMessage: (id: string) => `dudu:message:${id}`,
  /** ZSET of message ids scored by epoch-ms post time. */
  duduWall: 'dudu:wall',
  /** Pub/sub channel fanning approved messages to every node. */
  duduChannel: 'dudu:broadcast',
  /** Per-session post counter for rate limiting. */
  duduRateLimit: (sessionId: string) => `ratelimit:dudu:${sessionId}`,
} as const

/** DUDU messages auto-delete exactly 24 hours after posting. */
export const DUDU_TTL_SECONDS = 24 * 60 * 60

/**
 * Room keys expire as a safety net. If a node dies without running its
 * disconnect handlers, its members would otherwise occupy the room forever and
 * make it permanently "full".
 */
export const ROOM_TTL_SECONDS = 12 * 60 * 60

export async function closeRedis(): Promise<void> {
  await Promise.allSettled([redis.quit(), pubClient.quit(), subClient.quit()])
}
