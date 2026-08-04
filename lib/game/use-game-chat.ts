'use client'

import { useCallback, useEffect, useState } from 'react'

import {
  PHASE_LOG,
  type ChatEntry,
  type MrWhitePhase,
} from '@/lib/game/mr-white-view'
import { CHAT_ERROR_TEXT } from '@/lib/socket/events'
import type { AppSocket } from '@/lib/webrtc/use-p2p-room'

/**
 * The table transcript: chat plus the `[STATE]` lines.
 *
 * Rides the lobby's existing socket rather than opening one — a second
 * connection would have a different socket id and therefore different lobby
 * membership, so the server would not consider it a player.
 *
 * TWO SOURCES, ONE LIST. Chat messages arrive over the wire; `[STATE]` lines do
 * not exist on the server at all and are synthesised here from phase
 * transitions. That split is deliberate: chat is not game state, so a synthetic
 * message must never reach moderation or the rate limiter.
 *
 * NO HISTORY. Nothing is persisted or replayed, so a player who drops during a
 * discussion loses the argument so far. That is the accepted cost of keeping
 * chat out of the state machine — see the Phase 5 design doc.
 */
export function useGameChat(
  socket: AppSocket | null,
  /** Current phase, or null before a game starts. Drives the `[STATE]` lines. */
  phase: MrWhitePhase | null,
  /**
   * Server epoch ms from the push that carried this phase.
   *
   * Used as the `[STATE]` line's timestamp rather than a local `Date.now()`.
   * Two reasons: reading the clock during render is impure, and the transition
   * happened on the server — stamping it with a skewed browser clock would put
   * the log line out of order against the chat around it.
   */
  serverNow: number,
) {
  const [entries, setEntries] = useState<ChatEntry[]>([])
  const [error, setError] = useState<string | null>(null)
  const [seenPhase, setSeenPhase] = useState<MrWhitePhase | null>(null)

  /**
   * Append a `[STATE]` line when the phase turns over.
   *
   * Done during render rather than in an effect: the effect version renders the
   * transcript once without the new line first, and trips
   * `react-hooks/set-state-in-effect`. Same idiom as `lib/game/use-game.ts:38`.
   */
  if (phase !== seenPhase) {
    setSeenPhase(phase)

    if (phase) {
      setEntries((current) => [
        ...current,
        {
          kind: 'system',
          // Phase plus server timestamp: a game re-enters `clue` every round,
          // so the phase alone would collide as a React key.
          id: `state-${phase}-${serverNow}`,
          text: PHASE_LOG[phase],
          at: serverNow,
        },
      ])
    }
  }

  useEffect(() => {
    if (!socket) return

    const onMessage = (message: {
      id: string
      from: string
      nickname: string
      body: string
      channel: string
      at: number
    }) => {
      setEntries((current) => [...current, { kind: 'message', ...message }])
    }

    socket.on('game:chat-message', onMessage)
    return () => {
      socket.off('game:chat-message', onMessage)
    }
  }, [socket])

  const send = useCallback(
    (body: string) => {
      if (!socket) return

      setError(null)

      // No optimistic append. The server echoes the message back to the sender
      // as part of the audience, so adding it here too would show it twice —
      // and a message that failed moderation would appear to have been sent.
      socket.emit('game:chat', body, (result) => {
        if (!result.ok) {
          setError(
            CHAT_ERROR_TEXT[result.error ?? ''] ??
              `That message was not sent (${result.error ?? 'unknown reason'}).`,
          )
        }
      })
    },
    [socket],
  )

  return { entries, error, send, clearError: () => setError(null) }
}
