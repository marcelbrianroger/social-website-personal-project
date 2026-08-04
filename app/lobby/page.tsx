import type { Metadata } from 'next'

import { LobbyEntry } from './lobby-entry'

export const metadata: Metadata = {
  title: 'Mr. White · DUDU',
  description:
    'Social deduction for four to eight players. Everyone shares a secret word except one.',
}

/**
 * Entry point for Mr. White.
 *
 * Purely presentational — no session is read here. The socket handshake
 * authenticates with the same HttpOnly cookie once a table is actually
 * entered, which is the first point at which identity matters.
 */
export default function LobbyIndexPage() {
  return <LobbyEntry />
}
