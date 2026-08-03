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
 * PRODUCTION WARNING: the TURN credentials below come from NEXT_PUBLIC_ env
 * vars, which means they ship to the browser and anyone can read and reuse them
 * to relay their own traffic at your expense. Real deployments mint short-lived
 * HMAC credentials per user from a route handler instead. This is fine for
 * local testing only.
 */

const PUBLIC_STUN = [
  'stun:stun.l.google.com:19302',
  'stun:stun1.l.google.com:19302',
]

export function getIceServers(): RTCIceServer[] {
  const servers: RTCIceServer[] = [{ urls: PUBLIC_STUN }]

  const turnUrl = process.env.NEXT_PUBLIC_TURN_URL
  const turnUsername = process.env.NEXT_PUBLIC_TURN_USERNAME
  const turnCredential = process.env.NEXT_PUBLIC_TURN_CREDENTIAL

  if (turnUrl && turnUsername && turnCredential) {
    servers.push({
      urls: turnUrl,
      username: turnUsername,
      credential: turnCredential,
    })
  }

  return servers
}

export function hasTurnConfigured(): boolean {
  return Boolean(
    process.env.NEXT_PUBLIC_TURN_URL &&
      process.env.NEXT_PUBLIC_TURN_USERNAME &&
      process.env.NEXT_PUBLIC_TURN_CREDENTIAL,
  )
}

export const SOCKET_URL =
  process.env.NEXT_PUBLIC_SOCKET_URL ?? 'http://localhost:4000'
