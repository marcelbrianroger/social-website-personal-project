import { getCurrentSession } from '@/lib/session/current-session'
import { PUBLIC_STUN } from '@/lib/webrtc/ice-config'

/**
 * Mints per-visitor TURN credentials for WebRTC via Cloudflare Realtime.
 *
 * STUN alone cannot connect peers behind symmetric NAT or carrier-grade NAT —
 * DS-Lite, which a large share of German consumer lines run, has no reachable
 * IPv4 path at all. Those pairs sit at "connecting" and then fail. A TURN relay
 * is the only fix, and this route is where one gets attached.
 *
 * Cloudflare mints the credential rather than this server deriving it: unlike
 * coturn's REST scheme (an HMAC over an expiry, which anyone holding the static
 * secret can forge), the secret here is an API token that never leaves the
 * server and is exchanged for a short-lived username/credential pair.
 *
 * Deliberately NOT NEXT_PUBLIC_ env vars: those ship to the browser, where
 * anyone can read them and relay their own traffic on your quota, forever.
 *
 * The client contract is just `GET /api/ice -> { iceServers }`, so swapping
 * providers — or going back to self-hosted coturn — changes only this file.
 */

/** Per-visitor, time-bound credentials must never be cached or shared. */
export const dynamic = 'force-dynamic'

const DEFAULT_TTL_SECONDS = 12 * 60 * 60

/**
 * The room open blocks on this request, so it must not hang.
 *
 * `use-p2p-room` awaits the ICE config before it opens the socket, precisely so
 * the first peer is never built with STUN only. That makes a stalled provider
 * call a stalled room — better to give up quickly and degrade to STUN.
 */
const CREDENTIAL_TIMEOUT_MS = 4_000

export async function GET(): Promise<Response> {
  const session = await getCurrentSession()

  if (!session) {
    return Response.json(
      { error: 'no_session' },
      { status: 401, headers: { 'cache-control': 'no-store' } },
    )
  }

  // Public STUN stays alongside the relay: it costs nothing, and it keeps
  // direct connections working for the majority of pairs even if Cloudflare is
  // having a bad day. Relayed media is the fallback, not the default path.
  const iceServers: RTCIceServer[] = [
    { urls: PUBLIC_STUN },
    ...(await fetchRelayServers()),
  ]

  return Response.json(
    { iceServers },
    { status: 200, headers: { 'cache-control': 'no-store' } },
  )
}

/**
 * Exchange the API token for short-lived relay credentials.
 *
 * Returns an empty list on every failure path. No TURN configured is a
 * supported state — local development runs that way — and a provider outage
 * must degrade to STUN rather than fail the request, because a room that opens
 * and connects most of the time beats a room that will not open at all.
 */
async function fetchRelayServers(): Promise<RTCIceServer[]> {
  const keyId = process.env.CLOUDFLARE_TURN_KEY_ID
  const token = process.env.CLOUDFLARE_TURN_API_TOKEN

  if (!keyId || !token) return []

  const configured = Number(process.env.TURN_TTL_SECONDS ?? DEFAULT_TTL_SECONDS)
  const ttl = Number.isFinite(configured) ? configured : DEFAULT_TTL_SECONDS

  try {
    const response = await fetch(
      `https://rtc.live.cloudflare.com/v1/turn/keys/${encodeURIComponent(keyId)}/credentials/generate-ice-servers`,
      {
        method: 'POST',
        headers: {
          authorization: `Bearer ${token}`,
          'content-type': 'application/json',
        },
        body: JSON.stringify({ ttl }),
        cache: 'no-store',
        signal: AbortSignal.timeout(CREDENTIAL_TIMEOUT_MS),
      },
    )

    if (!response.ok) {
      // Logged, not thrown: a 401 here means the token is wrong, and silently
      // serving STUN would look exactly like the bug this route exists to fix.
      console.error(
        `[ice] Cloudflare refused TURN credentials (${response.status}). Check CLOUDFLARE_TURN_KEY_ID and CLOUDFLARE_TURN_API_TOKEN.`,
      )
      return []
    }

    const body: unknown = await response.json()
    const servers = (body as { iceServers?: unknown } | null)?.iceServers

    // `generate-ice-servers` returns an array; the older `generate` endpoint
    // returned a bare object. Accepting both means a provider-side change
    // cannot silently drop the relay and reintroduce the original bug.
    if (Array.isArray(servers)) return servers as RTCIceServer[]
    if (servers && typeof servers === 'object') return [servers as RTCIceServer]

    console.error('[ice] Cloudflare returned no iceServers.')
    return []
  } catch (cause) {
    console.error(
      `[ice] Cloudflare TURN credentials unreachable: ${(cause as Error).message}`,
    )
    return []
  }
}
