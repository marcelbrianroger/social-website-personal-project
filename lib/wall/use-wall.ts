'use client'

import { useCallback, useEffect, useRef, useState } from 'react'
import { io, type Socket } from 'socket.io-client'

import {
  POST_ERROR_TEXT,
  type AnonymousSession,
  type ClientToServerEvents,
  type DuduBroadcast,
  type ServerToClientEvents,
} from '@/lib/socket/events'
import {
  SOCKET_UNCONFIGURED_MESSAGE,
  resolveSocketConnection,
  socketOptions,
} from '@/lib/socket/connect'

/**
 * The DUDU wall: a global anonymous feed where posts vanish 48 hours after
 * being written.
 *
 * Expiry is enforced by Redis on the server. This hook also drops expired
 * messages locally on a timer, so a tab left open overnight does not keep
 * showing posts the server has already forgotten.
 */

type AppSocket = Socket<ServerToClientEvents, ClientToServerEvents>

/** How often to re-check for messages that have aged out. */
const EXPIRY_SWEEP_MS = 30_000

function stillAlive(message: DuduBroadcast): boolean {
  return new Date(message.expiresAt).getTime() > Date.now()
}

export function useWall() {
  const [messages, setMessages] = useState<DuduBroadcast[]>([])
  const [session, setSession] = useState<AnonymousSession | null>(null)
  const [connected, setConnected] = useState(false)
  const [error, setError] = useState<string | null>(null)
  const [posting, setPosting] = useState(false)

  const socketRef = useRef<AppSocket | null>(null)

  const addMessage = useCallback((incoming: DuduBroadcast) => {
    setMessages((current) => {
      // The author receives their own post twice — once as the ack to
      // `dudu:post`, once via the broadcast every subscriber gets.
      if (current.some((message) => message.id === incoming.id)) return current
      return [incoming, ...current]
    })
  }, [])

  useEffect(() => {
    let cancelled = false
    let socket: AppSocket | null = null

    void (async () => {
      // Ticket before connecting. A handshake cannot be re-authenticated in
      // place — a rejected one has to be torn down and rebuilt — so waiting is
      // cheaper than connecting and hoping the cookie made it.
      const { url, ticket } = await resolveSocketConnection()
      if (cancelled) return

      if (!url) {
        setConnected(false)
        setError(SOCKET_UNCONFIGURED_MESSAGE)
        return
      }

      const connection: AppSocket = io(url, socketOptions(ticket))
      socket = connection
      socketRef.current = connection

      connection.on('session:ready', (incoming) => {
        setSession(incoming)
        setConnected(true)
        setError(null)

        connection.emit('dudu:subscribe')
        connection.emit('dudu:history', ({ messages: history }) => {
          setMessages(history.filter(stillAlive))
        })
      })

      connection.on('dudu:message', addMessage)

      connection.on('disconnect', () => setConnected(false))

      connection.on('connect_error', (cause) => {
        setConnected(false)
        setError(
          cause.message === 'unauthorized'
            ? 'The server rejected your session. Reload the page to get a fresh one.'
            : `Could not reach the realtime server at ${url}. Is it running?`,
        )
      })
    })()

    return () => {
      // Set before the socket may even exist: the ticket fetch can still be in
      // flight, and without this a fast unmount would leave an orphan socket
      // that nothing ever disconnects.
      cancelled = true
      socket?.removeAllListeners()
      socket?.disconnect()
      socketRef.current = null
    }
  }, [addMessage])

  // Drop messages that have aged past their 48h window.
  useEffect(() => {
    const timer = setInterval(() => {
      setMessages((current) => {
        const alive = current.filter(stillAlive)
        return alive.length === current.length ? current : alive
      })
    }, EXPIRY_SWEEP_MS)

    return () => clearInterval(timer)
  }, [])

  /** Submit a post. Resolves true when it was accepted and broadcast. */
  const post = useCallback(async (body: string): Promise<boolean> => {
    const socket = socketRef.current
    if (!socket) return false

    setPosting(true)
    setError(null)

    const result = await new Promise<{ ok: boolean; error?: string; message?: DuduBroadcast }>(
      (resolve) => {
        socket.emit('dudu:post', body, resolve)
        setTimeout(() => resolve({ ok: false, error: 'moderation-unavailable' }), 8000)
      },
    )

    setPosting(false)

    if (!result.ok) {
      setError(
        POST_ERROR_TEXT[result.error ?? ''] ??
          `Your post was rejected (${result.error ?? 'unknown reason'}).`,
      )
      return false
    }

    if (result.message) addMessage(result.message)
    return true
  }, [addMessage])

  return { messages, session, connected, error, posting, post, clearError: () => setError(null) }
}
