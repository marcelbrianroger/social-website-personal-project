import { getCurrentSession } from '@/lib/session/current-session'
import { SOCKET_TICKET_MAX_AGE_SECONDS, signSocketTicket } from '@/lib/session/session'

/**
 * Issues a short-lived token for the Socket.io handshake.
 *
 * The socket server lives on a different registrable domain in production
 * (Vercel vs Railway), so the browser withholds the SameSite=Lax session cookie
 * from the handshake and every connection would be rejected as unauthorized.
 * The client fetches a ticket here — same-origin, so the cookie *is* sent — and
 * passes it in the Socket.io `auth` payload instead.
 *
 * The identity comes from the headers proxy.ts injects, which it overwrites on
 * every request, so a client cannot forge one. proxy.ts deliberately matches
 * API routes; if that ever changes, this route would start handing tickets to
 * traffic that never passed the region lock.
 */

/**
 * Never cache. The response is per-visitor and expires in a minute; a shared
 * cache would hand one visitor's identity to the next.
 */
export const dynamic = 'force-dynamic'

/**
 * Where the browser should dial the socket server.
 *
 * Read per request, which is the point. `NEXT_PUBLIC_SOCKET_URL` is substituted
 * into the bundle during `next build`, so changing it in the host's dashboard
 * does nothing until something triggers a rebuild — and a deployment built
 * before it was ever set ships no address at all. Serving it from here, off a
 * plain variable, makes it take effect on save.
 *
 * `NEXT_PUBLIC_SOCKET_URL` stays as a fallback so existing setups and local
 * `.env` files keep working unchanged.
 */
function resolveSocketUrl(): string | null {
  const configured =
    process.env.SOCKET_URL ?? process.env.NEXT_PUBLIC_SOCKET_URL ?? ''

  // The trailing slash would survive into the Origin header the socket server
  // matches against SOCKET_CORS_ORIGIN, where it fails to compare equal.
  const trimmed = configured.trim().replace(/\/+$/, '')

  return trimmed.length > 0 ? trimmed : null
}

export async function GET(): Promise<Response> {
  const session = await getCurrentSession()

  if (!session) {
    return Response.json(
      { error: 'no_session' },
      { status: 401, headers: { 'cache-control': 'no-store' } },
    )
  }

  return Response.json(
    {
      ticket: await signSocketTicket(session),
      expiresIn: SOCKET_TICKET_MAX_AGE_SECONDS,
      socketUrl: resolveSocketUrl(),
    },
    {
      status: 200,
      // Belt and braces alongside `dynamic`: this one also binds CDNs and the
      // browser's own cache, which the route config does not.
      headers: { 'cache-control': 'no-store' },
    },
  )
}
