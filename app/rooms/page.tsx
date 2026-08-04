import type { Metadata } from 'next'

import { RoomClient } from './room-client'

export const metadata: Metadata = {
  title: 'Video rooms · Social Aachen Website',
  description:
    'Two people to a room. Audio and video travel straight from one browser to the other.',
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
