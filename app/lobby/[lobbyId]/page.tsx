import type { Metadata } from 'next'
import { notFound } from 'next/navigation'

import { LobbyClient } from './lobby-client'

/**
 * Mr. White table.
 *
 * A shell only. The session is read client-side for the same reason
 * `app/rooms/page.tsx` does it: the socket handshake authenticates with the
 * same HttpOnly cookie, and `session:ready` returns the identity the server
 * actually accepted — which is the value worth rendering, since it proves the
 * handshake succeeded rather than just that a cookie exists.
 *
 * `params` is a Promise in this version of Next and must be awaited.
 */

/** Same shape the room ids already use — see JOIN_ERROR_TEXT in lib/socket/events.ts. */
const LOBBY_ID = /^[A-Za-z0-9_-]{3,32}$/

export async function generateMetadata({
  params,
}: {
  params: Promise<{ lobbyId: string }>
}): Promise<Metadata> {
  const { lobbyId } = await params

  return {
    title: `Mr. White · ${lobbyId} · DUDU`,
    description: 'Social deduction table. Four to eight players, no video.',
  }
}

export default async function LobbyPage({
  params,
}: {
  params: Promise<{ lobbyId: string }>
}) {
  const { lobbyId } = await params

  if (!LOBBY_ID.test(lobbyId)) notFound()

  return <LobbyClient lobbyId={lobbyId} />
}
