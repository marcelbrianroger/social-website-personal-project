import type { ManagerOptions, SocketOptions } from 'socket.io-client'

/**
 * Shared handshake setup for every socket the app opens.
 *
 * Four hooks connect independently (wall, lobby, open-lobbies, p2p room). They
 * all need the same ticket dance, and getting it wrong in one of them fails
 * only that feature — the kind of bug that hides until someone opens that one
 * page in production.
 */

/**
 * Build-time fallback for the socket server's address.
 *
 * `NEXT_PUBLIC_` values are substituted into the bundle during `next build`, so
 * this is frozen at whatever was set when the deployment was compiled. That is
 * the trap it exists to soften: a Vercel project built before the variable was
 * added ships `undefined` here and, historically, silently dialled localhost —
 * which on a phone means the phone itself, so every connection failed with a
 * message pointing at a machine the user does not own.
 *
 * The authoritative value now arrives at runtime from `/api/socket-ticket`.
 * This is only consulted when that call could not be made.
 */
const BUILD_TIME_SOCKET_URL = normalizeSocketUrl(process.env.NEXT_PUBLIC_SOCKET_URL)

/**
 * Local development runs both processes on one machine, so localhost is a
 * genuinely correct guess there. In production it never is, and guessing it
 * turns a missing configuration into a confusing network error.
 */
const DEV_FALLBACK_SOCKET_URL =
  process.env.NODE_ENV === 'production' ? null : 'http://localhost:4000'

/**
 * Shown when no socket address is configured anywhere.
 *
 * Deliberately names the deployment rather than the network: nothing is
 * unreachable, nothing was ever addressed. Pointing the user at a connection
 * problem would send them looking for a fault that does not exist.
 */
export const SOCKET_UNCONFIGURED_MESSAGE =
  'This deployment has no realtime server configured, so live features are off. ' +
  'Chat, the wall and games need one; set SOCKET_URL on the web host.'

export interface SocketConnection {
  /** Where to dial, or null when the deployment configured nothing. */
  url: string | null
  /** Handshake ticket, or null when one could not be obtained. */
  ticket: string | null
}

/**
 * Resolve everything needed to open a socket: where to dial, and proof of who
 * is dialling.
 *
 * Both come from the same same-origin request, so this costs no more round
 * trips than fetching the ticket alone did.
 */
export async function resolveSocketConnection(): Promise<SocketConnection> {
  const session = await fetchSocketSession()

  return {
    url: session.socketUrl ?? BUILD_TIME_SOCKET_URL ?? DEV_FALLBACK_SOCKET_URL,
    ticket: session.ticket,
  }
}

/**
 * Fetch a short-lived handshake ticket and the socket server's address.
 *
 * Same-origin, so the HttpOnly session cookie is sent here even though it is
 * withheld from the cross-site socket handshake.
 *
 * The address rides along because this route already runs per request on the
 * server, where a plain (non-`NEXT_PUBLIC_`) variable is read at runtime. That
 * makes the socket URL editable in the host's dashboard without a rebuild —
 * `NEXT_PUBLIC_SOCKET_URL` alone requires a redeploy to take effect, which is
 * easy to set, easy to forget, and gives no feedback when forgotten.
 *
 * Never throws. Callers still attempt the connection on failure, because on a
 * same-site deployment the cookie alone authenticates and a ticket is
 * redundant.
 */
async function fetchSocketSession(): Promise<{
  ticket: string | null
  socketUrl: string | null
}> {
  try {
    const response = await fetch('/api/socket-ticket', {
      credentials: 'same-origin',
      cache: 'no-store',
    })

    if (!response.ok) return { ticket: null, socketUrl: null }

    const body = (await response.json()) as {
      ticket?: unknown
      socketUrl?: unknown
    } | null

    return {
      ticket:
        typeof body?.ticket === 'string' && body.ticket.length > 0
          ? body.ticket
          : null,
      socketUrl: normalizeSocketUrl(body?.socketUrl),
    }
  } catch {
    // Offline, region-blocked, or the route is unreachable. The handshake will
    // fail next and surface a real error to the user; nothing useful to say
    // here that would not be guesswork.
    return { ticket: null, socketUrl: null }
  }
}

/**
 * Trim a configured address to something `io()` accepts.
 *
 * The trailing slash matters: it survives into the `Origin` the socket server
 * compares against `SOCKET_CORS_ORIGIN`, and `https://x.app/` does not match
 * `https://x.app`. That produces a CORS rejection whose message says nothing
 * about the slash that caused it.
 */
function normalizeSocketUrl(value: unknown): string | null {
  if (typeof value !== 'string') return null

  const trimmed = value.trim().replace(/\/+$/, '')

  return trimmed.length > 0 ? trimmed : null
}

/**
 * Options every `io()` call in the app should use.
 *
 * `withCredentials` is kept alongside the ticket rather than replaced by it:
 * same-site deployments still authenticate by cookie, and it costs nothing to
 * let both paths work. The server checks `auth.token` first and falls back to
 * the cookie.
 */
export function socketOptions(
  ticket: string | null,
): Partial<ManagerOptions & SocketOptions> {
  return {
    withCredentials: true,
    transports: ['websocket'],
    autoConnect: true,
    ...(ticket ? { auth: { token: ticket } } : {}),
  }
}
