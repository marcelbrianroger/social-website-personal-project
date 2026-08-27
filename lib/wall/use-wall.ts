'use client'

import { useCallback, useEffect, useRef, useState } from 'react'
import { io, type Socket } from 'socket.io-client'

import {
  POST_ERROR_TEXT,
  type AnonymousSession,
  type ClientToServerEvents,
  type DuduBroadcast,
  type DuduReply,
  type ReplyResult,
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
 *
 * THREADS ARE FETCHED, NOT PUSHED. A note carries only its `replyCount`; the
 * replies themselves are asked for when a note is opened. Most notes are never
 * opened, and shipping fifty threads to render the one somebody reads is a
 * great deal of text for nothing. Once a thread is open it stays live — new
 * replies arrive on the same socket as new notes.
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

  /**
   * Loaded threads, by note id. A missing key means "not opened yet".
   *
   * NOT PRUNED when a note expires, deliberately. A thread only lands here
   * because somebody opened that note, nothing renders a thread for a note the
   * board no longer holds, and ids are UUIDs so a dead key can never be hit
   * again. Sweeping it would cost an effect that writes state on every change
   * to the message list — cascading renders, for a few kilobytes that die with
   * the page.
   */
  const [threads, setThreads] = useState<Record<string, DuduReply[]>>({})
  const [replying, setReplying] = useState(false)

  const socketRef = useRef<AppSocket | null>(null)

  /**
   * Reply ids already accounted for.
   *
   * The author of a reply receives it twice — once as the ack, once as the
   * broadcast every subscriber gets — and `replyCount` is a running tally, so
   * without this the writer's own note would climb by two. A ref rather than
   * state: it gates an update and is never rendered.
   */
  const seenReplies = useRef(new Set<string>())

  const addMessage = useCallback((incoming: DuduBroadcast) => {
    setMessages((current) => {
      // The author receives their own post twice — once as the ack to
      // `dudu:post`, once via the broadcast every subscriber gets.
      if (current.some((message) => message.id === incoming.id)) return current
      return [incoming, ...current]
    })
  }, [])

  const addReply = useCallback((incoming: DuduReply) => {
    if (seenReplies.current.has(incoming.id)) return
    seenReplies.current.add(incoming.id)

    setThreads((current) => {
      const thread = current[incoming.noteId]
      // Not open. Nothing to append to — it will arrive complete, and correct,
      // the moment somebody opens the note.
      if (!thread) return current
      return { ...current, [incoming.noteId]: [...thread, incoming] }
    })

    setMessages((current) =>
      current.map((message) =>
        message.id === incoming.noteId
          ? { ...message, replyCount: message.replyCount + 1 }
          : message,
      ),
    )
  }, [])

  /** Fetch one note's thread. Safe to call again — the server is the truth. */
  const loadReplies = useCallback((noteId: string) => {
    const socket = socketRef.current
    if (!socket) return

    socket.emit('dudu:replies', noteId, ({ replies }) => {
      for (const reply of replies) seenReplies.current.add(reply.id)

      setThreads((current) => ({ ...current, [noteId]: replies }))

      // The server just counted these for real. Trust that over the running
      // tally, which can drift across a reconnect or a missed broadcast.
      setMessages((current) =>
        current.map((message) =>
          message.id === noteId
            ? { ...message, replyCount: replies.length }
            : message,
        ),
      )
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
      connection.on('dudu:reply:new', addReply)

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
  }, [addMessage, addReply])

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

  /** Answer a note. Resolves true when the reply was accepted and broadcast. */
  const reply = useCallback(
    async (noteId: string, body: string): Promise<boolean> => {
      const socket = socketRef.current
      if (!socket) return false

      setReplying(true)
      setError(null)

      const result = await new Promise<ReplyResult>((resolve) => {
        socket.emit('dudu:reply', noteId, body, resolve)
        setTimeout(() => resolve({ ok: false, error: 'moderation-unavailable' }), 8000)
      })

      setReplying(false)

      if (!result.ok) {
        setError(
          POST_ERROR_TEXT[result.error ?? ''] ??
            `Your reply was rejected (${result.error ?? 'unknown reason'}).`,
        )
        return false
      }

      if (result.reply) addReply(result.reply)
      return true
    },
    [addReply],
  )

  return {
    messages,
    session,
    connected,
    error,
    posting,
    post,
    threads,
    replying,
    reply,
    loadReplies,
    clearError: () => setError(null),
  }
}
