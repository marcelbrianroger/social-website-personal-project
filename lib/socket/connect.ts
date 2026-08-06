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
 * Fetch a short-lived handshake ticket.
 *
 * Same-origin, so the HttpOnly session cookie is sent here even though it is
 * withheld from the cross-site socket handshake. Returns null on any failure;
 * callers still attempt the connection, because on a same-site deployment
 * (localhost in dev) the cookie alone is enough and a ticket is redundant.
 */
export async function fetchSocketTicket(): Promise<string | null> {
  try {
    const response = await fetch('/api/socket-ticket', {
      credentials: 'same-origin',
      cache: 'no-store',
    })

    if (!response.ok) return null

    const body: unknown = await response.json()
    const ticket = (body as { ticket?: unknown } | null)?.ticket

    return typeof ticket === 'string' && ticket.length > 0 ? ticket : null
  } catch {
    // Offline, region-blocked, or the route is unreachable. The handshake will
    // fail next and surface a real error to the user; nothing useful to say
    // here that would not be guesswork.
    return null
  }
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
