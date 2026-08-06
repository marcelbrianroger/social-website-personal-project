import { createHmac } from 'node:crypto'

import { getCurrentSession } from '@/lib/session/current-session'
import { PUBLIC_STUN } from '@/lib/webrtc/ice-config'

/**
 * Mints per-visitor TURN credentials for WebRTC.
 *
 * Implements the coturn REST scheme (`use-auth-secret`): the credential is an
 * HMAC over an expiry timestamp, so the TURN server validates it without ever
 * being told about this visitor. Nothing is stored on either side.
 *
 *   username   = <unix-expiry>:<sessionId>
 *   credential = base64(HMAC-SHA1(username, TURN_STATIC_AUTH_SECRET))
 *
 * The static secret never leaves the server. That is the entire reason this
 * route exists: the previous NEXT_PUBLIC_TURN_* vars were readable by anyone
 * who opened devtools, and a relay credential is a bandwidth bill.
 *
 * Provider-agnostic by construction — self-hosted coturn and Metered both take
 * this scheme. A provider with its own credential API (Cloudflare Realtime)
 * would change only this file; the client contract is just
 * `GET /api/ice -> { iceServers }`.
 */

/** Per-visitor, time-bound credentials must never be cached or shared. */
export const dynamic = 'force-dynamic'

/** Matches the TURN server's own clock skew tolerance closely enough. */
const DEFAULT_TTL_SECONDS = 12 * 60 * 60

export async function GET(): Promise<Response> {
  const session = await getCurrentSession()

  if (!session) {
    return Response.json(
      { error: 'no_session' },
      { status: 401, headers: { 'cache-control': 'no-store' } },
    )
  }

  const iceServers: RTCIceServer[] = [{ urls: PUBLIC_STUN }]

  const turnUrls = parseList(process.env.TURN_URL)
  const secret = process.env.TURN_STATIC_AUTH_SECRET

  // No TURN configured is a supported state, not an error: local development
  // and the pre-TURN production deploy both run this way. Returning STUN alone
  // keeps rooms working instead of failing the request.
  if (turnUrls.length > 0 && secret) {
    const ttl = Number(process.env.TURN_TTL_SECONDS ?? DEFAULT_TTL_SECONDS)
    const expiry = Math.floor(Date.now() / 1000) + (Number.isFinite(ttl) ? ttl : DEFAULT_TTL_SECONDS)

    // The sessionId is only for attribution in the TURN server's logs — the
    // signature is what grants access, and it covers the expiry.
    const username = `${expiry}:${session.sessionId}`

    iceServers.push({
      urls: turnUrls,
      username,
      credential: createHmac('sha1', secret).update(username).digest('base64'),
    })
  }

  return Response.json(
    { iceServers },
    { status: 200, headers: { 'cache-control': 'no-store' } },
  )
}

/** Providers usually need several URLs (udp, tcp, tls) sharing one secret. */
function parseList(raw: string | undefined): string[] {
  if (!raw) return []
  return raw
    .split(',')
    .map((entry) => entry.trim())
    .filter(Boolean)
}
