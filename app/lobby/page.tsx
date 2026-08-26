import type { Metadata } from 'next'

import { LobbyEntry } from './lobby-entry'

export const metadata: Metadata = {
  title: 'Play · Social Aachen Website',
  description:
    'Werewolf and Mr. White, for four to eight players. Open a table, share the ID, pick the game once everyone is seated.',
}

/**
 * Entry point for the tables.
 *
 * Names both games rather than one: the metadata used to say "Mr. White",
 * which was the only place a search result or a shared link could have
 * mentioned Werewolf and did not.
 *
 * Purely presentational — no session is read here. The socket handshake
 * authenticates with the same HttpOnly cookie once a table is actually
 * entered, which is the first point at which identity matters.
 */
export default function LobbyIndexPage() {
  return <LobbyEntry />
}
