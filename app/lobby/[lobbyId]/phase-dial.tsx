'use client'

import { DISPLAY_HEADING, EYEBROW } from './controls'

/**
 * What is happening, and how long is left of it — in the middle of the table.
 *
 * This is where a board game keeps its state: the middle, face up, readable
 * from every chair. It replaces the phase banner that used to sit in a side
 * column, and it does not own a timer of its own — `TableStage` runs one
 * interval for the whole board and hands the numbers down, because the seats
 * are counting reconnect windows against the same server clock.
 *
 * The countdown is advisory and says so. The server decides whether a move
 * arrived in time, and the ~1s deadline sweeper means a phase can legitimately
 * end a moment after this hits zero. Rendering it as authoritative would be a
 * lie a player notices exactly once, badly.
 *
 * Urgency is a marker highlight rather than red. There is no red in this
 * palette, and inventing one for a countdown would be the first crack in the
 * ink discipline; yellow fill with ink on top clears 9.3:1.
 */
export function PhaseDial({
  phaseLabel,
  roundLabel,
  seconds,
  fractionLeft,
  finished = false,
  className = '',
}: {
  /**
   * Already in words. Null before a game starts — the lobby is simply waiting.
   *
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
  className?: string
}) {
  const urgent = seconds !== null && seconds <= 10

  return (
    <div
      className={`reg flex flex-col justify-center border-2 border-ink px-4 py-3.5 text-center ${
        urgent ? 'bg-yellow' : 'bg-paper'
      } ${className}`}
    >
      {/* The phase change is the news worth announcing. The ticking digits
          below are not, which is why only this half is a live region. */}
      <p aria-live="polite">
        <span className={EYEBROW}>{roundLabel}</span>
        <span
          className="mt-1 block truncate font-display text-lg leading-none"
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
          className="mt-2 font-display text-[2.75rem] leading-none tabular-nums"
          style={DISPLAY_HEADING}
        >
          {seconds}
          <span className="ml-0.5 font-mono text-[0.625rem] text-ink-soft">s</span>
        </p>
      ) : (
        <p className="mt-2 font-mono text-[0.6875rem] leading-snug text-ink-soft">
          {finished
            ? 'no clock: the table is done'
            : 'no clock until the game starts'}
        </p>
      )}

      {/* Depleting rule, for the layout where the table's own rim is not drawn.
          Decorative either way — the number above is the accessible copy. */}
      {fractionLeft !== null && (
        <div
          aria-hidden="true"
          className="mt-3 h-1.5 w-full border border-ink bg-paper lg:hidden"
        >
          <div
            className="h-full bg-ink transition-[width] duration-300 ease-linear"
            style={{ width: `${fractionLeft * 100}%` }}
          />
        </div>
      )}
    </div>
  )
}
