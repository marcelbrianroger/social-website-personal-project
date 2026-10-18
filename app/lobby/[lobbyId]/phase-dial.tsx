'use client'

import { DISPLAY_HEADING } from './controls'

/**
 * What is happening, and how long is left of it — across the top of the board.
 *
 * It used to be a small box in the middle of a drawn table. It is now a strip
 * the full width of the board, because the phase and the seconds are the two
 * things every player looks for first and they should be readable from the
 * sofa: the phase name large on the left, the count larger on the right, and a
 * bar underneath draining toward zero.
 *
 * It does not own a timer of its own — `TableStage` runs one interval for the
 * whole board and hands the numbers down, because the cards are counting
 * reconnect windows against the same server clock.
 *
 * The countdown is advisory and says so. The server decides whether a move
 * arrived in time, and the ~1s deadline sweeper means a phase can legitimately
 * end a moment after this hits zero.
 *
 * Urgency is a marker highlight rather than red. There is no red in this
 * palette; yellow fill with ink on top clears 9.3:1. It outranks the night —
 * the last ten seconds go yellow either way, because running out of time
 * matters more than what time of day it is.
 */
export function PhaseDial({
  phaseLabel,
  roundLabel,
  seconds,
  fractionLeft,
  finished = false,
  night = false,
  className = '',
}: {
  /**
   * Already in words. Null before a game starts — the lobby is simply waiting.
   * A LABEL RATHER THAN A PHASE KEY, so this serves every game in the room
   * without knowing any of them. See `lib/game/table-view.ts`.
   */
  phaseLabel: string | null
  /** The eyebrow: `round 2`, `night 3`, or `lobby`. */
  roundLabel: string
  /** Whole seconds left, or null when nothing is being timed. */
  seconds: number | null
  /** Same countdown as a fraction of the phase, for the bar. Null with no clock. */
  fractionLeft: number | null
  /** Changes only the no-clock footnote. */
  finished?: boolean
  /** Printed on the ink plate, to match a board that has gone dark. */
  night?: boolean
  className?: string
}) {
  const urgent = seconds !== null && seconds <= 10
  const dark = night && !urgent
  const soft = dark ? 'text-paper/75' : 'text-ink-soft'

  return (
    <div
      className={`relative flex flex-wrap items-end justify-between gap-x-6 gap-y-2 border-2 px-4 pt-3.5 pb-4 transition-colors duration-700 motion-reduce:transition-none sm:px-5 ${
        urgent
          ? 'border-ink bg-yellow text-ink'
          : dark
            ? 'border-paper bg-ink text-paper'
            : 'border-ink bg-sheet-white text-ink'
      } ${className}`}
    >
      {/* The phase change is the news worth announcing. The ticking digits
          are not, which is why only this half is a live region. */}
      <p aria-live="polite" className="min-w-0">
        <span className={`flex items-center gap-2 font-mono text-xs lowercase tracking-wide ${soft}`}>
          {/* The moon: a pink disc with the ink plate printed over most of it,
              leaving the crescent — the same mark as the Werewolf drawing on
              the home page. */}
          {dark && (
            <svg aria-hidden="true" viewBox="0 0 16 16" className="animate-ink-in size-4">
              <circle cx="8" cy="8" r="7" className="fill-pink" />
              <circle cx="11" cy="5.5" r="6" className="fill-ink" />
            </svg>
          )}
          {roundLabel}
        </span>
        <span
          className="mt-1 block font-display text-[clamp(1.5rem,3vw,2.125rem)] leading-none tracking-[-0.015em]"
          style={DISPLAY_HEADING}
        >
          {phaseLabel ?? 'Waiting to start'}
        </span>
      </p>

      {seconds !== null ? (
        <p
          role="timer"
          // Explicitly off: a per-second announcement makes the page unusable
          // with a screen reader, and the phase name already carries the state
          // change that matters.
          aria-live="off"
          className="font-display text-[clamp(2.5rem,5vw,3.75rem)] leading-[0.8] tabular-nums"
          style={DISPLAY_HEADING}
        >
          {seconds}
          <span className={`ml-0.5 font-mono text-sm lowercase ${soft}`}>s</span>
        </p>
      ) : (
        <p className={`font-mono text-sm ${soft}`}>
          {finished ? 'the game is over' : 'no clock until the game starts'}
        </p>
      )}

      {/* The draining bar, flush along the bottom edge. Decorative — the
          number above is the accessible copy. */}
      {fractionLeft !== null && (
        <span aria-hidden="true" className="absolute inset-x-0 bottom-0 h-1.5">
          <span
            className={`block h-full transition-[width] duration-300 ease-linear ${
              dark ? 'bg-pink' : 'bg-ink'
            }`}
            style={{ width: `${fractionLeft * 100}%` }}
          />
        </span>
      )}
    </div>
  )
}
