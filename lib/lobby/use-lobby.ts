'use client'

import { useCallback, useEffect, useRef, useState } from 'react'
import { io } from 'socket.io-client'

import {
  LOBBY_JOIN_ERROR_TEXT,
  type AnonymousSession,
  type LobbyMember,
} from '@/lib/socket/events'
import { fetchSocketTicket, socketOptions } from '@/lib/socket/connect'
import { SOCKET_URL } from '@/lib/webrtc/ice-config'
import type { AppSocket } from '@/lib/webrtc/use-p2p-room'

/**
 * Membership in a social-game lobby.
 *
 * Deliberately NOT `useP2PRoom`. A lobby has no media: no getUserMedia prompt,
 * no RTCPeerConnection, no ICE. Reusing the room hook would ask eight people
 * for camera permission to play a text game.
 *
 * It opens its own socket, which is safe here because a socket may occupy only
 * one place at a time — the server's `lobby:join` detaches from any room or
 * queue first. Inside the lobby the SAME socket is shared with the game and
 * chat hooks: a second connection would have a different socket id and
 * therefore different membership, so the server would refuse its moves.
 */

export type LobbyPhase = 'connecting' | 'joining' | 'seated' | 'error'

export interface LobbyState {
  socket: AppSocket | null
  session: AnonymousSession | null
  phase: LobbyPhase
  error: string | null
  /** Everyone seated, in join order. Includes you. */
  members: LobbyMember[]
  /**
   * Whoever sat down first — the only person who may deal.
   *
   * Derived rather than stored, so it heals itself: if the host leaves, the
   * next-earliest seat inherits it instead of the table being stuck with
   * nobody able to start. Mirrors the server's own check, which is the one
   * that actually enforces it.
   */
  host: LobbyMember | null
  capacity: number
  leave: () => void
}

export function useLobby(lobbyId: string): LobbyState {
  const [socket, setSocket] = useState<AppSocket | null>(null)
  const [session, setSession] = useState<AnonymousSession | null>(null)
  const [phase, setPhase] = useState<LobbyPhase>('connecting')
  const [error, setError] = useState<string | null>(null)
  const [members, setMembers] = useState<LobbyMember[]>([])
  const [capacity, setCapacity] = useState(8)

  const socketRef = useRef<AppSocket | null>(null)

  useEffect(() => {
    let cancelled = false
    let socket: AppSocket | null = null

    void (async () => {
      // Authenticates the handshake. The session cookie alone is not enough
      // once the socket server is on another registrable domain — see
      // fetchSocketTicket.
      const ticket = await fetchSocketTicket()
      if (cancelled) return

      const connection: AppSocket = io(SOCKET_URL, socketOptions(ticket))
      socket = connection
      socketRef.current = connection

      /**
       * Join only once the handshake has completed.
       *
       * `session:ready` is the server confirming which identity it accepted,
       * and it is also the first moment the socket is usable. Emitting
       * `lobby:join` before it would race the auth middleware.
       *
       * This fires again after a reconnect, which is exactly what re-seats a
       * player whose connection dropped — their old socket id is already gone
       * from the members hash by then.
       */
      connection.on('session:ready', (incoming) => {
        setSession(incoming)
        setSocket(connection)
        setPhase('joining')

        connection.emit('lobby:join', lobbyId, (result) => {
          if (!result.ok) {
            setError(
              LOBBY_JOIN_ERROR_TEXT[result.error ?? ''] ??
                `Could not join this lobby (${result.error ?? 'unknown reason'}).`,
            )
            setPhase('error')
            return
          }

          setCapacity(result.capacity)

          // The ack carries who was already seated plus our own record; we are
          // not in `members`, so we add ourselves rather than waiting for an
          // echo that never comes. `result.you` is the server's copy —
          // inventing a local `joinedAt` here would sort the roster against a
          // browser clock and could name the wrong person host.
          setMembers(
            [...result.members, ...(result.you ? [result.you] : [])].sort(
              (a, b) => a.joinedAt - b.joinedAt,
            ),
          )
          setPhase('seated')
          setError(null)
        })
      })

      connection.on('connect_error', (cause) => {
        setError(
          cause.message === 'unauthorized'
            ? 'The socket server rejected your session. Reload the page to get a fresh one.'
            : `Could not reach the realtime server at ${SOCKET_URL}. Is it running?`,
        )
        setPhase('error')
      })

      connection.on('lobby:member-joined', (member) => {
        setMembers((current) =>
          current.some((seated) => seated.socketId === member.socketId)
            ? current
            : [...current, member].sort((a, b) => a.joinedAt - b.joinedAt),
        )
      })

      connection.on('lobby:member-left', ({ socketId }) => {
        setMembers((current) =>
          current.filter((seated) => seated.socketId !== socketId),
        )
      })
    })()

    return () => {
      // Guards the in-flight ticket fetch: without it a fast unmount leaves a
      // socket nothing disconnects.
      cancelled = true

      // Leaving explicitly rather than relying on the disconnect handler: it
      // frees the seat immediately instead of after the server notices the
      // socket died, which matters when the lobby is at capacity.
      socket?.emit('lobby:leave')
      socket?.removeAllListeners()
      socket?.disconnect()
      socketRef.current = null
    }
  }, [lobbyId])

  const leave = useCallback(() => {
    socketRef.current?.emit('lobby:leave')
  }, [])

  return {
    socket,
    session,
    phase,
    error,
    members,
    host: members[0] ?? null,
    capacity,
    leave,
  }
}
