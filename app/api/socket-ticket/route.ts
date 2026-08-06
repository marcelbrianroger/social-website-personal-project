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
    },
    {
      status: 200,
      // Belt and braces alongside `dynamic`: this one also binds CDNs and the
      // browser's own cache, which the route config does not.
      headers: { 'cache-control': 'no-store' },
    },
  )
}
