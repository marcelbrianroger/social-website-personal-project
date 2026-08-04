import { randomUUID } from 'node:crypto'

import type { Redis } from 'ioredis'

import type { ChatMessage } from './events.js'
import { loadGame } from './game-engine.js'
import { getGameDefinition } from './games/registry.js'
import type { AnonymousSession } from './session.js'
import { moderateText } from './moderation.js'
import { keys, redis } from './redis.js'

/**
 * In-game chat.
 *
 * Chat is NOT game state. It never bumps the version, is never persisted, and
 * is never replayed on reconnect — which is why it lives here rather than
 * inside the engine. What it does borrow from the engine is the state, because
 * the *audience* is a rule: the same sentence is public during discussion,
 * restricted to the dead after elimination, and refused outright mid-clue.
 *
 * The audience is resolved to sessionIds by the game definition, then to
 * sockets by the caller, and emitted per recipient. A room-wide broadcast would
 * defeat the entire point of the `dead` channel.
 */

/**
 * Chat budget per session.
 *
 * Deliberately looser than the wall's 5/minute. A 90-second discussion phase
 * with eight players is a real conversation — five messages a minute would
 * throttle honest play, and the wall's limit exists to stop public spam, which
 * is a different threat from a lobby of eight people who chose to be there.
 */
const RATE_LIMIT_MAX = 20
const RATE_LIMIT_WINDOW_SECONDS = 60

/**
 * Atomic fixed-window rate limit.
 *
 * INCR and EXPIRE as separate calls can lose the expiry if the process dies in
 * between, leaving a counter that never resets and locks the session out for
 * good. Same script as dudu.ts, against a separate key.
 */
redis.defineCommand('chatRateLimit', {
  numberOfKeys: 1,
  lua: `
    local count = redis.call('INCR', KEYS[1])
    if count == 1 then
      redis.call('EXPIRE', KEYS[1], tonumber(ARGV[1]))
    end
    return count
  `,
})

interface ChatScripts {
  chatRateLimit(key: string, windowSeconds: string): Promise<number>
}

const scripts = redis as Redis & ChatScripts

export type ChatFailure =
  | 'no-game'
  | 'unknown-game'
  | 'not-a-player'
  | 'chat-closed'
  | 'rate-limited'
  /** Anything moderation.ts refused it for. */
  | (string & {})

export type ChatOutcome =
  | { ok: true; message: ChatMessage; to: string[] }
  | { ok: false; error: ChatFailure }

/**
 * Who may hear a message when NO game is running.
 *
 * A lobby waiting for its fourth player has no game, so there is no
 * `chatAudience` to ask — and a room full of people who cannot talk to each
 * other until someone presses Start is a dead end. The caller supplies the
 * seated members; passing `null` keeps chat closed, which is what the
 * two-person video rooms do (they have actual voice).
 */
export interface WaitingRoom {
  channel: string
  to: string[]
}

/**
 * Turn a submission into a message plus its audience.
 *
 * Order matters. The audience check runs first so a player typing during a
 * closed phase does not burn rate-limit budget on a message that was never
 * going anywhere. Moderation runs last because it is the most expensive — and,
 * once a real classifier is wired in, the only step that can be slow.
 */
export async function composeChat(
  scope: string,
  session: AnonymousSession,
  body: unknown,
  waitingRoom: WaitingRoom | null = null,
): Promise<ChatOutcome> {
  if (typeof body !== 'string') return { ok: false, error: 'malformed-message' }

  const stored = await loadGame(scope)

  // No game, or one that has already ended: the lobby is back to waiting, and
  // the same people should be able to keep talking — about a rematch, or about
  // who was obviously bluffing. A finished game's `chatAudience` would say
  // `chat-closed`, which is right *during* play and wrong once it is over.
  const idle = !stored || stored.finished

  let audience: WaitingRoom

  if (idle) {
    if (!waitingRoom) return { ok: false, error: 'no-game' }
    audience = waitingRoom
  } else {
    const definition = getGameDefinition(stored.gameId)
    if (!definition) return { ok: false, error: 'unknown-game' }

    const resolved = definition.chatAudience(stored.state, session.sessionId)
    if (!resolved.ok) return { ok: false, error: resolved.reason }

    audience = { channel: resolved.channel, to: resolved.to }
  }

  const count = await scripts.chatRateLimit(
    keys.chatRateLimit(session.sessionId),
    String(RATE_LIMIT_WINDOW_SECONDS),
  )

  if (count > RATE_LIMIT_MAX) return { ok: false, error: 'rate-limited' }

  const verdict = await moderateText(body)
  if (!verdict.allowed) {
    return { ok: false, error: verdict.reason ?? 'blocked-language' }
  }

  return {
    ok: true,
    message: {
      id: randomUUID(),
      from: session.sessionId,
      nickname: session.nickname,
      body: body.trim(),
      channel: audience.channel,
      at: Date.now(),
    },
    to: audience.to,
  }
}
