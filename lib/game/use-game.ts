'use client'

import { useCallback, useEffect, useState } from 'react'

import {
  MOVE_ERROR_TEXT,
  START_ERROR_TEXT,
  type GameView,
} from '@/lib/socket/events'
import type { AppSocket } from '@/lib/webrtc/use-p2p-room'

/**
 * Board-game session, riding on the room's existing socket.
 *
 * Deliberately takes a socket rather than opening one: a second connection
 * would have a different socket id and therefore different room membership, so
 * the server would refuse its moves.
 *
 * There is no local game logic here — not even an optimistic board update. The
 * server is the only writer, and `view` is always exactly what it last sent.
 * Predicting a move locally would let the two diverge, and the whole point of a
 * server-authoritative engine is that they cannot.
 */
export function useGame(socket: AppSocket | null, roomId: string | null) {
  const [view, setView] = useState<GameView | null>(null)
  const [rejection, setRejection] = useState<string | null>(null)
  const [starting, setStarting] = useState(false)
  /**
   * Bumped on every rejection so the UI can restart an animation even when the
   * same message repeats. A boolean would not change identity twice in a row.
   */
  const [rejectionNonce, setRejectionNonce] = useState(0)
  const [seenRoomId, setSeenRoomId] = useState(roomId)

  // Reset when the room changes. Adjusting state during render is React's
  // documented pattern for this — doing it in an effect renders the stale
  // board once first, and trips react-hooks/set-state-in-effect.
  if (seenRoomId !== roomId) {
    setSeenRoomId(roomId)
    setView(null)
    setRejection(null)
  }

  const reject = useCallback((message: string) => {
    setRejection(message)
    setRejectionNonce((current) => current + 1)
  }, [])

  useEffect(() => {
    if (!socket) return

    const onState = (incoming: GameView) => {
      setView(incoming)
      setRejection(null)
    }

    const onClosed = () => setView(null)

    socket.on('game:state', onState)
    socket.on('game:closed', onClosed)

    return () => {
      socket.off('game:state', onState)
      socket.off('game:closed', onClosed)
    }
  }, [socket])

  // Ask the server for current state on entering a room, so someone joining a
  // game already in progress is not left with a blank board. Talking to an
  // external system is exactly what effects are for.
  useEffect(() => {
    if (socket && roomId) socket.emit('game:sync', () => {})
  }, [socket, roomId])

  const start = useCallback(
    (gameId: string) => {
      if (!socket) return

      setStarting(true)
      setRejection(null)

      socket.emit('game:start', gameId, (result) => {
        setStarting(false)
        if (!result.ok) {
          reject(
            START_ERROR_TEXT[result.error ?? ''] ??
              `Could not start the game (${result.error ?? 'unknown reason'}).`,
          )
        }
      })
    },
    [socket, reject],
  )

  /**
   * Submit move intent.
   *
   * A rejection is surfaced rather than swallowed — an illegal move that simply
   * does nothing reads as a broken UI.
   */
  const move = useCallback(
    (intent: unknown) => {
      if (!socket) return

      setRejection(null)

      socket.emit('game:move', intent, (result) => {
        if (!result.ok) {
          reject(
            MOVE_ERROR_TEXT[result.reason ?? ''] ??
              `That move was rejected (${result.reason ?? 'unknown reason'}).`,
          )
        }
      })
    },
    [socket, reject],
  )

  return {
    view,
    rejection,
    rejectionNonce,
    starting,
    start,
    move,
    clearRejection: () => setRejection(null),
  }
}
