import type { Redis } from 'ioredis'

import type { RoomPeer } from './events.js'
import { ROOM_TTL_SECONDS, keys, redis } from './redis.js'

/**
 * Redis-backed room registry.
 *
 * Rooms are ephemeral and implicit: the first person to join an id creates it,
 * the last to leave destroys it.
 *
 * WHY REDIS AND NOT `socket.data`: matchmaking can make a socket on *another*
 * node join a room (via `io.in(id).socketsJoin(...)`). That node's local state
 * would be the only place recording it, so relay authorisation on any other
 * node would fail. Redis is the single source of truth for membership.
 *
 * NOTE ON CLUSTER: the scripts below build key names inside Lua, which Redis
 * Cluster forbids (all keys must be declared up front). That is fine for the
 * single instance in docker-compose; moving to Cluster would mean passing the
 * room key in explicitly or splitting into two round trips.
 */

/**
 * Max participants per room.
 *
 * P2P video is a full mesh: every participant holds a connection to every other
 * one, so upload bandwidth grows with N-1. Going beyond ~4 needs an SFU rather
 * than a bigger number here.
 */
export const ROOM_CAPACITY = 2

const ROOM_ID_PATTERN = /^[A-Za-z0-9_-]{3,32}$/

export function isValidRoomId(roomId: unknown): roomId is string {
  return typeof roomId === 'string' && ROOM_ID_PATTERN.test(roomId)
}

/**
 * Atomic join.
 *
 * Capacity is checked and the member inserted in a single script. Doing this as
 * separate HLEN + HSET calls would let two nodes both observe "1 member" and
 * both insert, putting three people in a two-person room.
 */
redis.defineCommand('roomJoin', {
  numberOfKeys: 2,
  lua: `
    local membersKey = KEYS[1]
    local socketRoomKey = KEYS[2]
    local socketId = ARGV[1]
    local peerJson = ARGV[2]
    local capacity = tonumber(ARGV[3])
    local ttl = tonumber(ARGV[4])
    local roomId = ARGV[5]

    if redis.call('HEXISTS', membersKey, socketId) == 1 then
      return {-1, {}}
    end

    if redis.call('HLEN', membersKey) >= capacity then
      return {-2, {}}
    end

    -- Snapshot before inserting so the joiner never sees itself.
    local existing = redis.call('HVALS', membersKey)

    redis.call('HSET', membersKey, socketId, peerJson)
    redis.call('EXPIRE', membersKey, ttl)
    redis.call('SET', socketRoomKey, roomId, 'EX', ttl)

    return {0, existing}
  `,
})

/** Atomic leave: resolves the room from the reverse index and removes the member. */
redis.defineCommand('roomLeave', {
  numberOfKeys: 1,
  lua: `
    local socketRoomKey = KEYS[1]
    local socketId = ARGV[1]

    local roomId = redis.call('GET', socketRoomKey)
    if not roomId then
      return {'', '', 0}
    end

    local membersKey = 'room:' .. roomId .. ':members'
    local peer = redis.call('HGET', membersKey, socketId)

    redis.call('HDEL', membersKey, socketId)
    redis.call('DEL', socketRoomKey)

    -- Remaining occupancy is returned in the same atomic step so the caller can
    -- decide whether to purge room-scoped state (the game) without a second
    -- round trip that another leave could interleave with.
    return {roomId, peer or '', redis.call('HLEN', membersKey)}
  `,
})

/**
 * Relay authorisation in one round trip.
 *
 * SECURITY: this is the check that stops the signalling relay being an open
 * message bus. Without it any client could push an SDP offer or ICE candidate
 * at any connected socket just by guessing its id, hijacking or disrupting a
 * call it was never part of.
 */
redis.defineCommand('roomCanRelay', {
  numberOfKeys: 1,
  lua: `
    local roomId = redis.call('GET', KEYS[1])
    if not roomId then
      return 0
    end
    return redis.call('HEXISTS', 'room:' .. roomId .. ':members', ARGV[1])
  `,
})

interface RoomScripts {
  roomJoin(
    membersKey: string,
    socketRoomKey: string,
    socketId: string,
    peerJson: string,
    capacity: string,
    ttl: string,
    roomId: string,
  ): Promise<[number, string[]]>

  roomLeave(
    socketRoomKey: string,
    socketId: string,
  ): Promise<[string, string, number]>

  roomCanRelay(socketRoomKey: string, targetSocketId: string): Promise<number>
}

const scripts = redis as Redis & RoomScripts

export type JoinFailure = 'invalid-room-id' | 'room-full' | 'already-in-room'

export type JoinOutcome =
  | { ok: true; peers: RoomPeer[] }
  | { ok: false; error: JoinFailure }

function parsePeers(raw: string[]): RoomPeer[] {
  const peers: RoomPeer[] = []

  for (const entry of raw) {
    try {
      peers.push(JSON.parse(entry) as RoomPeer)
    } catch {
      // A corrupt entry should not take the whole room down.
    }
  }

  return peers
}

/**
 * Add a peer to a room. Returns the peers already present — the caller uses
 * that to decide who initiates WebRTC offers.
 */
export async function joinRoom(
  roomId: string,
  peer: RoomPeer,
): Promise<JoinOutcome> {
  if (!isValidRoomId(roomId)) {
    return { ok: false, error: 'invalid-room-id' }
  }

  const [status, existing] = await scripts.roomJoin(
    keys.roomMembers(roomId),
    keys.socketRoom(peer.socketId),
    peer.socketId,
    JSON.stringify(peer),
    String(ROOM_CAPACITY),
    String(ROOM_TTL_SECONDS),
    roomId,
  )

  if (status === -1) return { ok: false, error: 'already-in-room' }
  if (status === -2) return { ok: false, error: 'room-full' }

  return { ok: true, peers: parsePeers(existing) }
}

/**
 * Remove a socket from whatever room it is in.
 *
 * `remaining` is the occupancy *after* the removal — callers use it to purge
 * room-scoped state once the room is empty.
 */
export async function leaveRoom(
  socketId: string,
): Promise<{ roomId: string; peer: RoomPeer; remaining: number } | null> {
  const [roomId, peerJson, remaining] = await scripts.roomLeave(
    keys.socketRoom(socketId),
    socketId,
  )

  if (!roomId || !peerJson) return null

  try {
    return { roomId, peer: JSON.parse(peerJson) as RoomPeer, remaining }
  } catch {
    return null
  }
}

/** Whether `senderSocketId` may send signalling to `targetSocketId`. */
export async function canRelay(
  senderSocketId: string,
  targetSocketId: unknown,
): Promise<boolean> {
  if (typeof targetSocketId !== 'string' || targetSocketId.length === 0) {
    return false
  }

  // A socket must never be able to address itself into a loop.
  if (targetSocketId === senderSocketId) return false

  const allowed = await scripts.roomCanRelay(
    keys.socketRoom(senderSocketId),
    targetSocketId,
  )

  return allowed === 1
}

/**
 * Room occupants in join order.
 *
 * Sorted explicitly: HVALS returns hash fields in whatever order Redis feels
 * like, so anything deriving seating or turn order from this needs a stable
 * sort or player one becomes random.
 */
export async function getMembers(roomId: string): Promise<RoomPeer[]> {
  const peers = parsePeers(await redis.hvals(keys.roomMembers(roomId)))
  return peers.sort((a, b) => a.joinedAt - b.joinedAt)
}

/** Which room a socket currently occupies, or null. */
export async function getSocketRoom(socketId: string): Promise<string | null> {
  return redis.get(keys.socketRoom(socketId))
}
