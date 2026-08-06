import path from 'node:path'
import { fileURLToPath } from 'node:url'

import { config as loadEnv } from 'dotenv'

/**
 * Environment for the Socket.io process.
 *
 * The server shares the root `.env` with the Next.js app on purpose: the JWT
 * secret MUST be byte-identical in both, or every handshake fails. Two files
 * would drift.
 */

const here = path.dirname(fileURLToPath(import.meta.url))

// Both `server/src` (tsx dev) and `server/dist` (built) sit one level under
// `server/`, so the repo root is two levels up either way.
loadEnv({ path: path.resolve(here, '../../.env') })

function required(name: string): string {
  const value = process.env[name]

  if (!value) {
    throw new Error(
      `${name} is not set. Copy .env.example to .env in the repo root before starting the server.`,
    )
  }

  return value
}

/**
 * Browser origins allowed to open a handshake.
 *
 * A list rather than one string because Vercel mints a fresh URL for every
 * preview deployment, so a single origin means only production ever connects.
 *
 * This is not the security boundary — the handshake gate below still demands a
 * session JWT signed with `sessionSecret`. CORS only decides whose browser is
 * permitted to try.
 */
function parseOrigins(raw: string): string[] {
  return raw
    .split(',')
    .map((origin) => origin.trim().replace(/\/$/, ''))
    .filter(Boolean)
}

export const env = {
  /** Must match SESSION_JWT_SECRET used by the Next.js app. */
  sessionSecret: required('SESSION_JWT_SECRET'),
  /**
   * PORT comes first because that is what every managed host (Railway, Render,
   * Fly) injects, and it is not configurable there. Binding SOCKET_PORT instead
   * would leave the process listening on a port the platform router never
   * forwards to — the deploy goes green and every connection times out.
   */
  port: Number(process.env.PORT ?? process.env.SOCKET_PORT ?? '4000'),
  corsOrigin: parseOrigins(
    process.env.SOCKET_CORS_ORIGIN ?? 'http://localhost:3000',
  ),
  redisUrl: process.env.REDIS_URL ?? 'redis://localhost:6379',
  /**
   * How long a player who drops mid-game has to come back before the game
   * eliminates them and carries on without them.
   *
   * Tunable so the smoke script can drive a short window instead of waiting out
   * a real one. Long enough for a browser refresh or a phone changing cell,
   * short enough that a table is not held hostage by someone who has left.
   */
  disconnectGraceMs: Number(process.env.DISCONNECT_GRACE_MS ?? '30000'),
  isProduction: process.env.NODE_ENV === 'production',
} as const
