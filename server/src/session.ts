import { jwtVerify } from 'jose'

import { env } from './env.js'

/**
 * Session token verification for the Socket.io handshake.
 *
 * VERIFY ONLY — this process never mints tokens. Issuance lives in
 * `lib/session/session.ts` in the Next.js app.
 *
 * The constants below MIRROR that file. They are duplicated rather than
 * imported because `/server` is a separate npm package with its own
 * node_modules and build, and reaching across that boundary would couple the
 * two builds together. The tradeoff is that these five values must be kept in
 * sync by hand — if you change the algorithm, issuer, audience, cookie name or
 * the `nickname` claim there, change it here too.
 */

const JWT_ALGORITHM = 'HS256'
const JWT_ISSUER = 'dudu:web'
const JWT_AUDIENCE = 'dudu:client'

export const SESSION_COOKIE_NAME = 'dudu_session'

export interface AnonymousSession {
  sessionId: string
  nickname: string
}

const secret = new TextEncoder().encode(env.sessionSecret)

const UUID_PATTERN =
  /^[0-9a-f]{8}-[0-9a-f]{4}-[1-5][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i

/** Verify a session JWT. Returns null for anything not provably valid. */
export async function verifySession(
  token: string | undefined,
): Promise<AnonymousSession | null> {
  if (!token) return null

  try {
    const { payload } = await jwtVerify(token, secret, {
      issuer: JWT_ISSUER,
      audience: JWT_AUDIENCE,
      algorithms: [JWT_ALGORITHM],
    })

    const sessionId = payload.sub
    const nickname = payload['nickname']

    if (typeof sessionId !== 'string' || !UUID_PATTERN.test(sessionId)) return null
    if (typeof nickname !== 'string' || nickname.length === 0) return null
    if (nickname.length > 48) return null

    return { sessionId, nickname }
  } catch {
    return null
  }
}

/**
 * Pull a single cookie out of a raw `Cookie` header.
 *
 * The session cookie is HttpOnly, so browser JS cannot read it and pass it in
 * the Socket.io `auth` payload. For a same-site deployment the browser sends it
 * automatically on the handshake, which is what this parses.
 */
export function readCookie(
  cookieHeader: string | undefined,
  name: string,
): string | undefined {
  if (!cookieHeader) return undefined

  for (const part of cookieHeader.split(';')) {
    const separator = part.indexOf('=')
    if (separator === -1) continue

    if (part.slice(0, separator).trim() === name) {
      return decodeURIComponent(part.slice(separator + 1).trim())
    }
  }

  return undefined
}
