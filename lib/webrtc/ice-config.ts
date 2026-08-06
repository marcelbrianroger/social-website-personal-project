/**
 * ICE server configuration for P2P connections.
 *
 * STUN alone lets two peers discover their public address and connect directly.
 * That works for most home networks, but fails behind symmetric NAT and many
 * corporate/mobile networks — roughly 10–20% of real-world pairs. Those need a
 * TURN relay, which is a server you must run (coturn) or rent.
 *
 * Without TURN configured, expect some connections to sit at "checking" and
 * never reach "connected". That is the network, not a bug in the signalling.
 *
 * TURN credentials are minted per visitor by `app/api/ice/route.ts` and expire
 * in minutes. They are deliberately NOT NEXT_PUBLIC_ env vars: those ship to
 * the browser, where anyone can read them and relay their own traffic at your
 * expense, forever.
 */

export const PUBLIC_STUN = [
  'stun:stun.l.google.com:19302',
  'stun:stun1.l.google.com:19302',
]

/**
 * The fallback every path degrades to.
 *
 * Used before the fetch resolves, and whenever it fails. Connections still work
 * for most pairs — the ones behind symmetric NAT are the ones that will not.
 */
export const STUN_ONLY: RTCIceServer[] = [{ urls: PUBLIC_STUN }]

export interface IceConfig {
  iceServers: RTCIceServer[]
  /**
   * Whether a relay is actually among the servers.
   *
   * Derived from the response rather than from env vars, because after this
   * refactor the browser cannot see the TURN settings at all.
   */
  turnAvailable: boolean
}

/**
 * Fetch ICE servers, including freshly minted TURN credentials.
 *
 * Same-origin so the session cookie is sent. Never throws — a peer connection
 * with STUN only is far better than a room that fails to open.
 */
export async function fetchIceConfig(): Promise<IceConfig> {
  try {
    const response = await fetch('/api/ice', {
      credentials: 'same-origin',
      cache: 'no-store',
    })

    if (!response.ok) return { iceServers: STUN_ONLY, turnAvailable: false }

    const body: unknown = await response.json()
    const servers = (body as { iceServers?: unknown } | null)?.iceServers

    if (!Array.isArray(servers) || servers.length === 0) {
      return { iceServers: STUN_ONLY, turnAvailable: false }
    }

    const iceServers = servers as RTCIceServer[]

    return {
      iceServers,
      turnAvailable: iceServers.some((server) =>
        urlsOf(server).some((url) => url.startsWith('turn:') || url.startsWith('turns:')),
      ),
    }
  } catch {
    return { iceServers: STUN_ONLY, turnAvailable: false }
  }
}

/** `urls` is a string or an array of them, per the WebRTC spec. */
function urlsOf(server: RTCIceServer): string[] {
  const { urls } = server
  if (typeof urls === 'string') return [urls]
  return Array.isArray(urls) ? urls : []
}
