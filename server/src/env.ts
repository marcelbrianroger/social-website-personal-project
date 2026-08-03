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

export const env = {
  /** Must match SESSION_JWT_SECRET used by the Next.js app. */
  sessionSecret: required('SESSION_JWT_SECRET'),
  port: Number(process.env.SOCKET_PORT ?? '4000'),
  corsOrigin: process.env.SOCKET_CORS_ORIGIN ?? 'http://localhost:3000',
  redisUrl: process.env.REDIS_URL ?? 'redis://localhost:6379',
  isProduction: process.env.NODE_ENV === 'production',
} as const
