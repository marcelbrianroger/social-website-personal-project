'use client'

import { DISPLAY_HEADING, EYEBROW, SECONDARY } from './controls'

/**
 * The lobby's masthead: which table you are at, and the way out.
 *
 * The id is set as a marker highlight because it is the one string a player
 * reads off the screen and types into a chat to invite four more people. It
 * needs to survive being photographed badly.
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

      <div className="flex flex-wrap items-center gap-x-5 gap-y-3">
        <p className="font-mono text-[0.6875rem] text-ink-soft">
          <span className="tabular-nums text-ink">{seated}</span> / {capacity}{' '}
          seated
        </p>

        <button type="button" onClick={onLeave} className={SECONDARY}>
          Leave room
        </button>
      </div>
    </header>
  )
}
