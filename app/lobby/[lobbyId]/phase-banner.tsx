'use client'

import {
  PHASE_LABEL,
  PHASE_SECONDS,
  type MrWhitePhase,
} from '@/lib/game/mr-white-view'
import { toSeconds, useCountdown } from '@/lib/game/use-countdown'

import { DISPLAY_HEADING, EYEBROW } from './controls'

/**
 * Phase name and the clock running against it.
 *
 * The countdown is advisory and says so: the server decides whether a move
 * arrived in time, and the ~1s deadline sweeper means a phase can legitimately
 * end up to a second after this hits zero. Rendering it as authoritative would
 * be a lie the player notices exactly once, badly.
 *
 * Urgency is expressed as a marker highlight rather than red — there is no red
 * in this palette, and inventing one for a countdown would be the first crack
 * in the ink discipline. Yellow fill with ink on top clears 9.3:1.
 */
export function PhaseBanner({
  phase,
  round,
  phaseEndsAt,
  serverNow,
}: {
  /** Null before a game starts — the lobby is simply waiting. */
  phase: MrWhitePhase | null
  round: number
  phaseEndsAt: number | null
  serverNow: number
}) {
  const remaining = useCountdown(phaseEndsAt, serverNow)
  const seconds = toSeconds(remaining)
  const total = phase ? PHASE_SECONDS[phase] : null

  const urgent = seconds !== null && seconds <= 10
  const elapsed =
    seconds !== null && total !== null
      ? Math.min(1, Math.max(0, 1 - seconds / total))
      : 0

  return (
    <section
      aria-label="Phase"
      className={`border-2 border-ink px-4 py-3.5 ${urgent ? 'bg-yellow' : 'bg-stock'}`}
    >
      <div className="flex items-baseline justify-between gap-3">
        {/* The phase change is the news worth announcing. The ticking digits
            below are not, which is why only this half is a live region. */}
        <p aria-live="polite" className="min-w-0">
          <span className={EYEBROW}>{phase ? `round ${round}` : 'lobby'}</span>
          <span
            className="mt-1 block truncate font-display text-lg leading-none"
            style={DISPLAY_HEADING}
          >
            {phase ? PHASE_LABEL[phase] : 'Waiting to start'}
          </span>
        </p>

        {seconds !== null && (
          <p
            role="timer"
            // Explicitly off: a per-second announcement makes the page
            // unusable with a screen reader, and the phase name already
            // carries the state change.
            aria-live="off"
            className="shrink-0 font-display text-3xl leading-none tabular-nums"
            style={DISPLAY_HEADING}
          >
            {seconds}
            <span className="ml-0.5 font-mono text-[0.625rem] text-ink-soft">
              s
            </span>
          </p>
        )}
      </div>

      {/* Depleting rule. Decorative — the number above is the accessible copy. */}
      {seconds !== null && (
        <div
          aria-hidden="true"
          className="mt-3 h-1.5 w-full border border-ink bg-paper"
        >
          <div
            className="h-full bg-ink transition-[width] duration-300 ease-linear"
            style={{ width: `${(1 - elapsed) * 100}%` }}
          />
        </div>
      )}

      {seconds === null && (
        <p className="mt-2 font-mono text-[0.6875rem] text-ink-soft">
          {phase === 'finished'
            ? 'no clock: the table is done'
            : 'no clock until the game starts'}
        </p>
      )}
    </section>
  )
}
