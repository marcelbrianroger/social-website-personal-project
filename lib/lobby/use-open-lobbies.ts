'use client'

import { useEffect, useState } from 'react'
import { io } from 'socket.io-client'

import { fetchSocketTicket, socketOptions } from '@/lib/socket/connect'
import type { LobbySummary } from '@/lib/socket/events'
import { SOCKET_URL } from '@/lib/webrtc/ice-config'
import type { AppSocket } from '@/lib/webrtc/use-p2p-room'

/**
 * The live list of open tables.
 *
 * Its own short-lived socket, opened for the browse screen and closed on
 * navigation — by the time a table page mounts, this connection is gone and
 * `useLobby` opens its own. Two sockets never overlap, so nothing competes for
 * membership.
 *
 * Pushed rather than polled: the server re-sends the list on every seat taken
 * or freed and when a game starts, so a table filling up is visible without
 * anyone refreshing. A poll would have to be fast enough to catch the last seat
 * going, which is most of a push with none of the accuracy.
 */
export type BrowsePhase = 'connecting' | 'ready' | 'error'

export function useOpenLobbies() {
  const [lobbies, setLobbies] = useState<LobbySummary[]>([])
  const [phase, setPhase] = useState<BrowsePhase>('connecting')

  useEffect(() => {
    let cancelled = false
    let socket: AppSocket | null = null

    void (async () => {
      const ticket = await fetchSocketTicket()
      if (cancelled) return

      const connection: AppSocket = io(SOCKET_URL, socketOptions(ticket))
      socket = connection

      // `session:ready` is the handshake completing; watching before it would
      // race the auth middleware.
      connection.on('session:ready', () => {
        connection.emit('lobby:watch')
      })

      connection.on('lobby:open-tables', (open) => {
        setLobbies(open)
        setPhase('ready')
      })

      // The list is not worth an error screen — an empty browse view plus the
      // join-by-ID field below it is still a usable page.
      connection.on('connect_error', () => {
        setPhase('error')
      })
    })()

    return () => {
      // Guards the in-flight ticket fetch: without it a fast unmount leaves a
      // socket nothing disconnects.
      cancelled = true
      socket?.emit('lobby:unwatch')
      socket?.removeAllListeners()
      socket?.disconnect()
    }
  }, [])

  return { lobbies, phase }
}
