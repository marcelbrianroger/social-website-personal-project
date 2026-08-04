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

  /** HASH socketId -> LobbyMember JSON. The 8-seat social-game primitive. */
  lobbyMembers: (lobbyId: string) => `lobby:${lobbyId}:members`,
  /**
   * SET of lobby ids with at least one person in them.
   *
   * Lobbies are otherwise implicit — the members hash springs into existence on
   * the first join and vanishes on the last leave — so without this there is no
   * way to answer "what tables are open right now" short of scanning the
   * keyspace, which is exactly the operation Redis asks you not to do.
   */
  openLobbies: 'lobbies:open',
  /** Reverse index socketId -> lobbyId, mirroring socketRoom. */
  socketLobby: (socketId: string) => `socket:${socketId}:lobby`,

  /** STRING of StoredGame JSON. Purged when its room or lobby empties. */
  game: (scope: string) => `game:${scope}`,
  /**
   * ZSET of game scopes scored by `phaseEndsAt`.
   *
   * The deadline sweeper reads `ZRANGEBYSCORE games:deadlines 0 now`, so its
   * cost is proportional to games actually due rather than games running. An
   * untimed game (Tic-Tac-Toe) never appears here at all.
   */
  gameDeadlines: 'games:deadlines',

  /** STRING of DuduMessage JSON, carrying its own 24h TTL. */
  duduMessage: (id: string) => `dudu:message:${id}`,
  /** ZSET of message ids scored by epoch-ms post time. */
  duduWall: 'dudu:wall',
  /** Pub/sub channel fanning approved messages to every node. */
  duduChannel: 'dudu:broadcast',
  /** Per-session post counter for rate limiting. */
  duduRateLimit: (sessionId: string) => `ratelimit:dudu:${sessionId}`,
  /** Per-session in-game chat counter. Separate budget from the wall. */
  chatRateLimit: (sessionId: string) => `ratelimit:chat:${sessionId}`,
} as const

/**
 * Namespacing for the game key.
 *
 * Rooms and lobbies are separate primitives with separate id spaces, and both
 * id patterns allow the same characters — so a room "aachen-1" and a lobby
 * "aachen-1" would otherwise collide on `game:aachen-1` and one would silently
 * overwrite the other's board. The room id pattern forbids a colon, so this
 * prefix cannot be forged from a lobby id.
 */
export const gameScope = {
  room: (roomId: string) => roomId,
  lobby: (lobbyId: string) => `lobby:${lobbyId}`,
  /** Which primitive a scope came from, for the sweeper's fan-out. */
  isLobby: (scope: string) => scope.startsWith('lobby:'),
  lobbyIdOf: (scope: string) => scope.slice('lobby:'.length),
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
