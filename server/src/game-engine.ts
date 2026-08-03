import type { Redis } from 'ioredis'

import { getGameDefinition } from './games/registry.js'
import type {
  AnyGameDefinition,
  GamePlayer,
  GameView,
  StoredGame,
} from './games/types.js'
import { ROOM_TTL_SECONDS, keys, redis } from './redis.js'

/**
 * Redis-backed game state machine.
 *
 * The engine owns persistence, turn enforcement and concurrency. The rules live
 * in game definitions (games/*.ts) and know nothing about any of this.
 *
 * CONCURRENCY: a move is a read-modify-write. Two players clicking at the same
 * instant would both read version N, both compute a next state from it, and the
 * second write would silently erase the first. Every write therefore goes
 * through a compare-and-set on `version`, and a losing writer retries against
 * the state that actually won. Turn order makes this rare, but "rare" races are
 * exactly the ones that corrupt a board in production.
 *
 * EPHEMERALITY: state lives only in Redis, carries a TTL, and is deleted the
 * moment the room empties. Nothing about a game survives its room.
 */

const GAME_TTL_SECONDS = ROOM_TTL_SECONDS

/** Bounded so a pathological conflict loop cannot spin forever. */
const MAX_CAS_ATTEMPTS = 5

/**
 * Start a game, or return the one already running.
 *
 * Atomic so two players pressing Start simultaneously cannot each install their
 * own initial board. A *finished* game is replaced, which is what makes
 * "rematch" work.
 */
redis.defineCommand('gameStart', {
  numberOfKeys: 1,
  lua: `
    local current = redis.call('GET', KEYS[1])
    if current then
      local ok, decoded = pcall(cjson.decode, current)
      if ok and decoded.finished ~= true then
        return current
      end
    end
    redis.call('SET', KEYS[1], ARGV[1], 'EX', tonumber(ARGV[2]))
    return ARGV[1]
  `,
})

/** Write only if the stored version still matches the one we read. */
redis.defineCommand('gameCas', {
  numberOfKeys: 1,
  lua: `
    local current = redis.call('GET', KEYS[1])
    if not current then
      return -1
    end
    local ok, decoded = pcall(cjson.decode, current)
    if not ok then
      return -2
    end
    if tonumber(decoded.version) ~= tonumber(ARGV[1]) then
      return 0
    end
    redis.call('SET', KEYS[1], ARGV[2], 'EX', tonumber(ARGV[3]))
    return 1
  `,
})

interface GameScripts {
  gameStart(gameKey: string, payload: string, ttl: string): Promise<string>
  gameCas(
    gameKey: string,
    expectedVersion: string,
    payload: string,
    ttl: string,
  ): Promise<number>
}

const scripts = redis as Redis & GameScripts

export type StartFailure = 'unknown-game' | 'wrong-player-count'

export type MoveFailure =
  | 'no-game'
  | 'not-a-player'
  | 'conflict'
  | (string & {})

function parse(raw: string | null): StoredGame | null {
  if (!raw) return null
  try {
    return JSON.parse(raw) as StoredGame
  } catch {
    return null
  }
}

export async function loadGame(roomId: string): Promise<StoredGame | null> {
  return parse(await redis.get(keys.game(roomId)))
}

export async function purgeGame(roomId: string): Promise<void> {
  await redis.del(keys.game(roomId))
}

/**
 * Project a stored game for one viewer.
 *
 * Everything a client learns about a game passes through here, so redaction
 * cannot be forgotten at a call site.
 */
export function buildView(
  stored: StoredGame,
  definition: AnyGameDefinition,
  sessionId: string | null,
): GameView {
  return {
    gameId: stored.gameId,
    label: definition.label,
    version: stored.version,
    players: stored.players.map(({ sessionId: id, nickname }) => ({
      sessionId: id,
      nickname,
    })),
    currentTurn: stored.finished ? null : definition.currentTurn(stored.state),
    finished: stored.finished,
    result: stored.result,
    state: definition.viewFor(stored.state, sessionId),
  }
}

export async function startGame(
  roomId: string,
  gameId: unknown,
  players: GamePlayer[],
): Promise<
  | { ok: true; stored: StoredGame; definition: AnyGameDefinition }
  | { ok: false; error: StartFailure }
> {
  const definition = getGameDefinition(gameId)
  if (!definition) return { ok: false, error: 'unknown-game' }

  if (players.length < definition.minPlayers || players.length > definition.maxPlayers) {
    return { ok: false, error: 'wrong-player-count' }
  }

  const proposed: StoredGame = {
    gameId: definition.id,
    version: 1,
    players,
    state: definition.createInitialState(players),
    startedAt: new Date().toISOString(),
    finished: false,
    result: null,
  }

  // Returns whichever payload is authoritative: the freshly written one, or an
  // already-running game installed by the other player a moment earlier.
  const authoritative = await scripts.gameStart(
    keys.game(roomId),
    JSON.stringify(proposed),
    String(GAME_TTL_SECONDS),
  )

  const stored = parse(authoritative) ?? proposed
  const storedDefinition = getGameDefinition(stored.gameId) ?? definition

  return { ok: true, stored, definition: storedDefinition }
}

/**
 * Validate and apply a move.
 *
 * The full read-validate-apply cycle is retried on a version conflict, because
 * a move validated against a superseded board must not be applied to the new
 * one — the winning writer may have taken the very cell this move wanted.
 */
export async function submitMove(
  roomId: string,
  sessionId: string,
  raw: unknown,
): Promise<
  | { ok: true; stored: StoredGame; definition: AnyGameDefinition }
  | { ok: false; reason: MoveFailure }
> {
  for (let attempt = 0; attempt < MAX_CAS_ATTEMPTS; attempt += 1) {
    const stored = await loadGame(roomId)
    if (!stored) return { ok: false, reason: 'no-game' }

    const definition = getGameDefinition(stored.gameId)
    if (!definition) return { ok: false, reason: 'unknown-game' }

    if (!stored.players.some((player) => player.sessionId === sessionId)) {
      return { ok: false, reason: 'not-a-player' }
    }

    const validation = definition.validateMove(stored.state, sessionId, raw)
    if (!validation.ok) return { ok: false, reason: validation.reason }

    const nextState = definition.applyMove(stored.state, sessionId, validation.move)
    const result = definition.result(nextState)

    const next: StoredGame = {
      ...stored,
      version: stored.version + 1,
      state: nextState,
      finished: result !== null,
      result,
    }

    const written = await scripts.gameCas(
      keys.game(roomId),
      String(stored.version),
      JSON.stringify(next),
      String(GAME_TTL_SECONDS),
    )

    if (written === 1) return { ok: true, stored: next, definition }
    if (written === -1) return { ok: false, reason: 'no-game' }

    // written === 0 (version moved) or -2 (corrupt): re-read and try again.
  }

  return { ok: false, reason: 'conflict' }
}

/**
 * End a running game because a player left.
 *
 * The result is preserved rather than deleted so the remaining player sees why
 * the game stopped. Actual deletion happens when the room empties.
 */
export async function forfeitGame(
  roomId: string,
  quittingSessionId: string,
): Promise<{ stored: StoredGame; definition: AnyGameDefinition } | null> {
  for (let attempt = 0; attempt < MAX_CAS_ATTEMPTS; attempt += 1) {
    const stored = await loadGame(roomId)
    if (!stored || stored.finished) return null

    const definition = getGameDefinition(stored.gameId)
    if (!definition) return null

    if (!stored.players.some((player) => player.sessionId === quittingSessionId)) {
      return null
    }

    const nextState = definition.forfeit(stored.state, quittingSessionId)
    const result = definition.result(nextState)

    const next: StoredGame = {
      ...stored,
      version: stored.version + 1,
      state: nextState,
      finished: result !== null,
      result,
    }

    const written = await scripts.gameCas(
      keys.game(roomId),
      String(stored.version),
      JSON.stringify(next),
      String(GAME_TTL_SECONDS),
    )

    if (written === 1) return { stored: next, definition }
    if (written === -1) return null
  }

  return null
}
