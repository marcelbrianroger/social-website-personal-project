import type { Metadata } from 'next'

import { RoomClient } from './room-client'

export const metadata: Metadata = {
  title: 'Room test · DUDU',
  description: 'P2P video room test harness.',
}

/**
 * The session itself is read client-side: the socket handshake authenticates
 * with the same HttpOnly cookie, and `session:ready` returns the identity the
 * server actually accepted — which is the value worth displaying, since it
 * proves the handshake succeeded rather than just that a cookie exists.
 */
export default function RoomsPage() {
  return <RoomClient />
}
