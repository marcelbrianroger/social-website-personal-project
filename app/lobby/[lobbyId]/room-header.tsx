'use client'

import { useState } from 'react'

import { DISPLAY_HEADING, EYEBROW, PRIMARY, SECONDARY } from './controls'

/**
 * The lobby's masthead: which table you are at, how to get people to it, and
 * the way out.
 *
 * The id is set as a marker highlight because it is the one string a player
 * reads off the screen and types into a chat to invite four more people. It
 * needs to survive being photographed badly.
 *
 * Next to it, the invite itself. Every game here needs four to eight people and
 * the only way they arrive is somebody pasting a link into a group chat, so the
 * link is one press away rather than something to fish out of the address bar.
 *
 * `onLeave` is a prop rather than a `router.push` so this stays presentational:
 * the socket owner decides whether leaving means `lobby:leave`, a redirect, or
 * a confirm dialog when a game is mid-round.
 */
export function RoomHeader({
  lobbyId,
  gameLabel,
  seated,
  capacity,
  onLeave,
}: {
  lobbyId: string
  /**
   * The game running, or the one the host has picked — the eyebrow used to be
   * the string "mr. white" whatever was actually on the table.
   */
  gameLabel: string | null
  /** Players currently in the lobby, including you. */
  seated: number
  /** `LOBBY_CAPACITY` — 8, per the Phase 5 design. */
  capacity: number
  onLeave: () => void
}) {
  const [copied, setCopied] = useState(false)

  async function copyInvite() {
    try {
      await navigator.clipboard.writeText(window.location.href)
      setCopied(true)
      setTimeout(() => setCopied(false), 2000)
    } catch {
      // No clipboard (an insecure origin, or permission refused). The id is
      // still on screen in large type, which is what this falls back to.
      setCopied(false)
    }
  }

  return (
    <header className="flex flex-wrap items-end justify-between gap-x-6 gap-y-4 border-b-2 border-ink pb-5">
      <div>
        <p className={EYEBROW}>
          {gameLabel ? `${gameLabel.toLowerCase()} · table` : 'table'}
        </p>

        <h1
          className="mt-2 font-display text-[clamp(1.75rem,4.5vw,2.5rem)] leading-none tracking-[-0.02em]"
          style={DISPLAY_HEADING}
        >
          <span className="bg-yellow box-decoration-clone px-2">{lobbyId}</span>
        </h1>
      </div>

      <div className="flex flex-wrap items-center gap-x-4 gap-y-3">
        <p className="font-mono text-sm text-ink-soft">
          <span className="tabular-nums text-ink">{seated}</span> / {capacity}{' '}
          seated
        </p>

        <button type="button" onClick={copyInvite} className={PRIMARY}>
          {/* Announced, because the button's own label is the confirmation. */}
          <span aria-live="polite">{copied ? 'Link copied' : 'Copy invite link'}</span>
        </button>

        <button type="button" onClick={onLeave} className={SECONDARY}>
          Leave room
        </button>
      </div>
    </header>
  )
}
