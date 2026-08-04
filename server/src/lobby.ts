import type { Redis } from 'ioredis'

import type { LobbyMember, LobbySummary } from './events.js'
import { ROOM_TTL_SECONDS, gameScope, keys, redis } from './redis.js'

/**
 * Redis-backed lobby registry — the membership primitive for social games.
 *
 * WHY THIS IS NOT `rooms.ts` WITH A BIGGER NUMBER:
 * A room is a P2P video call. Its capacity is 2 because WebRTC is a full mesh
 * and every participant uploads to every other one. A lobby carries no media at
 * all — Mr. White is text and state — so it can hold eight people on the same
 * hardware, and it needs no signalling relay, which means no `canRelay`
 * equivalent and nothing to authorise. Overloading `ROOM_CAPACITY` would have
 * meant raising it for video too.
 *
 * The Lua-atomic patterns below are lifted from `rooms.ts` deliberately: the
 * race they close (two nodes both observing "7 members" and both inserting) is
 * identical, and having the two files diverge in how they do it would make the
 * next reader wonder which one is right.
 */

/**
 * Max players in one lobby.
 *
 * Mr. White's own ceiling is 8 (`mrWhite.maxPlayers`). The lobby is the
 * narrower of the two constraints today; a game wanting fewer is rejected by
 * `startGame`'s player-count check rather than here.
 */
export const LOBBY_CAPACITY = 8

const LOBBY_ID_PATTERN = /^[A-Za-z0-9_-]{3,32}$/

export function isValidLobbyId(lobbyId: unknown): lobbyId is string {
  return typeof lobbyId === 'string' && LOBBY_ID_PATTERN.test(lobbyId)
}

/**
 * Atomic join.
 *
 * Capacity check and insert in one script. As separate HLEN + HSET calls, two
 * nodes could both read "7" and both insert, seating nine.
 */
redis.defineCommand('lobbyJoin', {
  numberOfKeys: 3,
  lua: `
    local membersKey = KEYS[1]
    local socketLobbyKey = KEYS[2]
    local openKey = KEYS[3]
    local socketId = ARGV[1]
    local memberJson = ARGV[2]
    local capacity = tonumber(ARGV[3])
    local ttl = tonumber(ARGV[4])
    local lobbyId = ARGV[5]

    if redis.call('HEXISTS', membersKey, socketId) == 1 then
      return {-1, {}}
    end

    if redis.call('HLEN', membersKey) >= capacity then
      return {-2, {}}
    end

    -- Snapshot before inserting so the joiner never sees itself.
    local existing = redis.call('HVALS', membersKey)

    redis.call('HSET', membersKey, socketId, memberJson)
    redis.call('EXPIRE', membersKey, ttl)
    redis.call('SET', socketLobbyKey, lobbyId, 'EX', ttl)

    -- Listed in the same atomic step as the insert, so a table can never be
    -- occupied but invisible to the browser.
    redis.call('SADD', openKey, lobbyId)

    return {0, existing}
  `,
})

/** Atomic leave: resolves the lobby from the reverse index and removes the member. */
redis.defineCommand('lobbyLeave', {
  numberOfKeys: 2,
  lua: `
    local socketLobbyKey = KEYS[1]
    local openKey = KEYS[2]
    local socketId = ARGV[1]

    local lobbyId = redis.call('GET', socketLobbyKey)
    if not lobbyId then
      return {'', '', 0}
    end

    local membersKey = 'lobby:' .. lobbyId .. ':members'
    local member = redis.call('HGET', membersKey, socketId)

    redis.call('HDEL', membersKey, socketId)
    redis.call('DEL', socketLobbyKey)

    local remaining = redis.call('HLEN', membersKey)

    -- Delisted the moment it empties, in the same step as the removal — an
    -- empty table left in the browser is one people click and bounce off.
    if remaining == 0 then
      redis.call('SREM', openKey, lobbyId)
    end

    -- Remaining occupancy comes back in the same atomic step, so the caller can
    -- decide whether to purge the game without a second round trip that another
    -- leave could interleave with.
    return {lobbyId, member or '', remaining}
  `,
})

interface LobbyScripts {
  lobbyJoin(
    membersKey: string,
    socketLobbyKey: string,
    openKey: string,
    socketId: string,
    memberJson: string,
    capacity: string,
    ttl: string,
    lobbyId: string,
  ): Promise<[number, string[]]>

  lobbyLeave(
    socketLobbyKey: string,
    openKey: string,
    socketId: string,
  ): Promise<[string, string, number]>
}

const scripts = redis as Redis & LobbyScripts

export type LobbyJoinFailure = 'invalid-lobby-id' | 'lobby-full' | 'already-in-lobby'

export type LobbyJoinOutcome =
  | { ok: true; members: LobbyMember[] }
  | { ok: false; error: LobbyJoinFailure }

function parseMembers(raw: string[]): LobbyMember[] {
  const members: LobbyMember[] = []

  for (const entry of raw) {
    try {
      members.push(JSON.parse(entry) as LobbyMember)
    } catch {
      // A corrupt entry should not take the whole lobby down.
    }
  }

  return members
}

/** Add a member. Returns whoever was already seated. */
export async function joinLobby(
  lobbyId: string,
  member: LobbyMember,
): Promise<LobbyJoinOutcome> {
  if (!isValidLobbyId(lobbyId)) {
    return { ok: false, error: 'invalid-lobby-id' }
  }

  const [status, existing] = await scripts.lobbyJoin(
    keys.lobbyMembers(lobbyId),
    keys.socketLobby(member.socketId),
    keys.openLobbies,
    member.socketId,
    JSON.stringify(member),
    String(LOBBY_CAPACITY),
    String(ROOM_TTL_SECONDS),
    lobbyId,
  )

  if (status === -1) return { ok: false, error: 'already-in-lobby' }
  if (status === -2) return { ok: false, error: 'lobby-full' }

  return { ok: true, members: parseMembers(existing) }
}

/**
 * Remove a socket from whatever lobby it is in.
 *
 * `remaining` is occupancy *after* the removal, so the caller can purge the
 * game once the lobby empties.
 */
export async function leaveLobby(
  socketId: string,
): Promise<{ lobbyId: string; member: LobbyMember; remaining: number } | null> {
  const [lobbyId, memberJson, remaining] = await scripts.lobbyLeave(
    keys.socketLobby(socketId),
    keys.openLobbies,
    socketId,
  )

  if (!lobbyId || !memberJson) return null

  try {
    return { lobbyId, member: JSON.parse(memberJson) as LobbyMember, remaining }
  } catch {
    return null
  }
}

/**
 * Lobby members in join order.
 *
 * Sorted explicitly. HVALS returns hash fields in whatever order Redis feels
 * like, and Mr. White's clue rotation walks this list — an unstable sort would
 * make the seat order change between reads, so "who speaks next" would differ
 * per node.
 */
export async function getLobbyMembers(lobbyId: string): Promise<LobbyMember[]> {
  const members = parseMembers(await redis.hvals(keys.lobbyMembers(lobbyId)))
  return members.sort((a, b) => a.joinedAt - b.joinedAt)
}

/** Which lobby a socket currently occupies, or null. */
export async function getSocketLobby(socketId: string): Promise<string | null> {
  return redis.get(keys.socketLobby(socketId))
}

/**
 * Every table currently open, for the browser on `/lobby`.
 *
 * SELF-HEALING. The members hash carries a TTL as a safety net for a node that
 * dies without running its disconnect handlers, and the id in `lobbies:open`
 * would outlive it — so anything found empty here is delisted on the spot
 * rather than advertised as a table you can join and then bounce off. Same
 * prune-on-read approach the DUDU wall uses for its index.
 *
 * One pipeline rather than N round trips. The list is small by nature (a
 * handful of tables at a time), but it is read on every membership change.
 */
export async function listOpenLobbies(): Promise<LobbySummary[]> {
  const ids = await redis.smembers(keys.openLobbies)
  if (ids.length === 0) return []

  const pipeline = redis.pipeline()
  for (const id of ids) {
    pipeline.hvals(keys.lobbyMembers(id))
    pipeline.exists(keys.game(gameScope.lobby(id)))
  }

  const replies = (await pipeline.exec()) ?? []
  const summaries: LobbySummary[] = []
  const stale: string[] = []

  ids.forEach((lobbyId, index) => {
    const members = parseMembers(
      (replies[index * 2]?.[1] as string[] | undefined) ?? [],
    ).sort((a, b) => a.joinedAt - b.joinedAt)

    if (members.length === 0) {
      stale.push(lobbyId)
      return
    }

    summaries.push({
      lobbyId,
      seated: members.length,
      capacity: LOBBY_CAPACITY,
      // Joining mid-game is allowed, but you watch rather than play: the
      // roster is fixed when the cards are dealt.
      inProgress: (replies[index * 2 + 1]?.[1] as number | undefined) === 1,
      host: members[0]?.nickname ?? null,
    })
  })

  if (stale.length > 0) await redis.srem(keys.openLobbies, ...stale)

  // Fullest first: a table needing one more player is the one worth joining.
  return summaries.sort((a, b) => b.seated - a.seated)
}
