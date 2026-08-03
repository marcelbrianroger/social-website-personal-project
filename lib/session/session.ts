import { SignJWT, jwtVerify } from 'jose'

import { generateNickname } from '@/lib/session/nickname'

/**
 * Anonymous session tokens.
 *
 * A visitor gets an identity on first request: a UUID plus a random nickname,
 * signed into a JWT and stored in an HttpOnly cookie. There is no login, no
 * password and no user row — the signature is the only thing making the
 * identity tamper-proof.
 *
 * TOKEN CONTRACT — mirrored by `server/src/session.ts`, which verifies these
 * tokens at the Socket.io handshake. Changing the algorithm, issuer, audience
 * or claim names here REQUIRES the same change there, or every socket
 * connection will be rejected.
 */

export const SESSION_COOKIE_NAME = 'dudu_session'

/**
 * Request headers that proxy.ts injects so Server Components can read the
 * identity on the first visit, before the Set-Cookie has round-tripped.
 *
 * These are set on the *inbound* request only. They are not response headers
 * and never reach the browser.
 */
export const SESSION_HEADER_ID = 'x-dudu-session-id'
export const SESSION_HEADER_NICKNAME = 'x-dudu-session-nickname'

export const SESSION_MAX_AGE_SECONDS = 30 * 24 * 60 * 60 // 30 days

const JWT_ALGORITHM = 'HS256'
const JWT_ISSUER = 'dudu:web'
const JWT_AUDIENCE = 'dudu:client'

/** Minimum secret length. HS256 keys shorter than 32 bytes are brute-forceable. */
const MIN_SECRET_BYTES = 32

export interface AnonymousSession {
  /** Stable anonymous identity. Matches `author_id` / `session_id` in Postgres. */
  sessionId: string
  /** Cosmetic display name. Never treat as unique. */
  nickname: string
}

let cachedSecret: Uint8Array | undefined

function getSecret(): Uint8Array {
  if (cachedSecret) return cachedSecret

  const raw = process.env.SESSION_JWT_SECRET

  if (!raw) {
    throw new Error(
      'SESSION_JWT_SECRET is not set. Copy .env.example to .env and set it to a random 32+ byte value.',
    )
  }

  const encoded = new TextEncoder().encode(raw)

  if (encoded.byteLength < MIN_SECRET_BYTES) {
    throw new Error(
      `SESSION_JWT_SECRET must be at least ${MIN_SECRET_BYTES} bytes (got ${encoded.byteLength}).`,
    )
  }

  cachedSecret = encoded
  return cachedSecret
}

/** Mint a brand new anonymous identity. */
export function createAnonymousSession(): AnonymousSession {
  return {
    sessionId: crypto.randomUUID(),
    nickname: generateNickname(),
  }
}

/** Sign a session into a compact JWT. */
export async function signSession(session: AnonymousSession): Promise<string> {
  return new SignJWT({ nickname: session.nickname })
    .setProtectedHeader({ alg: JWT_ALGORITHM })
    .setSubject(session.sessionId)
    .setIssuedAt()
    .setIssuer(JWT_ISSUER)
    .setAudience(JWT_AUDIENCE)
    .setExpirationTime(`${SESSION_MAX_AGE_SECONDS}s`)
    .sign(getSecret())
}

/**
 * Verify a session token.
 *
 * Returns `null` for anything untrustworthy — bad signature, wrong issuer or
 * audience, expired, or structurally malformed. Callers treat `null` as
 * "no session" and mint a fresh one.
 */
export async function verifySession(
  token: string | undefined,
): Promise<AnonymousSession | null> {
  if (!token) return null

  try {
    const { payload } = await jwtVerify(token, getSecret(), {
      issuer: JWT_ISSUER,
      audience: JWT_AUDIENCE,
      algorithms: [JWT_ALGORITHM],
    })

    const sessionId = payload.sub
    const nickname = payload.nickname

    if (typeof sessionId !== 'string' || !isUuid(sessionId)) return null
    if (typeof nickname !== 'string' || nickname.length === 0) return null
    if (nickname.length > 48) return null

    return { sessionId, nickname }
  } catch {
    // Invalid signature / expired / malformed. Deliberately not logged: a
    // stale cookie after a secret rotation is routine, not an incident.
    return null
  }
}

const UUID_PATTERN =
  /^[0-9a-f]{8}-[0-9a-f]{4}-[1-5][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i

function isUuid(value: string): boolean {
  return UUID_PATTERN.test(value)
}

/**
 * Cookie attributes for the session token.
 *
 * `httpOnly` keeps the token out of reach of XSS — which also means page JS
 * cannot read it to put in a Socket.io `auth` payload. The handshake therefore
 * relies on the browser attaching this cookie automatically, which `sameSite:
 * 'lax'` permits only while the socket server is same-site (localhost:3000 ->
 * localhost:4000 in dev, or one domain behind a shared reverse proxy in prod).
 *
 * If you ever host the socket server on a different registrable domain, the
 * cookie will NOT be sent and every handshake will fail. Fix that by adding a
 * route handler that issues a short-lived socket ticket for the client to pass
 * in `auth` — not by switching to `sameSite: 'none'`, which would expose the
 * session cookie to cross-site requests.
 */
export const sessionCookieOptions = {
  httpOnly: true,
  sameSite: 'lax',
  secure: process.env.NODE_ENV === 'production',
  path: '/',
  maxAge: SESSION_MAX_AGE_SECONDS,
} as const
