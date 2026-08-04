'use client'

import { useSyncExternalStore } from 'react'

/**
 * Control styling for the Mr. White table.
 *
 * Lifted verbatim from `app/rooms/room-client.tsx` so the two routes cannot
 * drift. Five components share these, which is the only reason they live in a
 * module rather than being repeated inline.
 *
 * The palette rules from `globals.css` are load-bearing here:
 *   - `ink` / `ink-soft` carry every piece of text. Nothing else does.
 *   - `yellow` is a flat fill, always with ink on top. That is what a marker on
 *     a noticeboard looks like, and it clears 9.3:1.
 *   - `pink` is rules and marks only. At 2.1:1 on paper it fails AA even at
 *     display sizes, so it never carries a letterform in this tree.
 */

/** Filled control. One per view, at most. */
export const PRIMARY =
  'border-2 border-ink bg-ink px-6 py-2.5 font-mono text-sm text-paper transition-colors hover:bg-pink hover:text-ink disabled:opacity-40 disabled:hover:bg-ink disabled:hover:text-paper'

/** Outline control, for everything that is not the main action. */
export const SECONDARY =
  'border-2 border-ink px-5 py-2.5 font-mono text-sm text-ink transition-colors hover:bg-yellow disabled:opacity-40 disabled:hover:bg-transparent'

/** Text entry. Square, typed, no focus ring of its own — `:focus-visible` is global. */
export const FIELD =
  'w-full border-2 border-ink bg-paper px-3 py-2.5 font-mono text-sm text-ink outline-none placeholder:text-ink-soft/70 disabled:opacity-50'

/** Small caps label above a block. The mono face does the "typed" work. */
export const EYEBROW =
  'font-mono text-[0.6875rem] lowercase tracking-wide text-ink-soft'

/** Panel. Square corners, fat rule, second paper stock — never a shadow. */
export const PANEL = 'border-2 border-ink bg-stock'

/** Display heading, at the weight and width the rest of the site uses. */
export const DISPLAY_HEADING: React.CSSProperties = {
  fontVariationSettings: "'wght' 800, 'wdth' 95",
}

const noopSubscribe = () => () => {}

/**
 * True on the client, false during SSR — without a `setState` in an effect,
 * which this repo's lint config rejects (`react-hooks/set-state-in-effect`).
 *
 * Both snapshots are constants, so `getSnapshot` is referentially stable and
 * cannot loop. React swaps `false` for `true` as part of hydration itself.
 */
function useMounted(): boolean {
  return useSyncExternalStore(
    noopSubscribe,
    () => true,
    () => false,
  )
}

/**
 * A wall-clock time that survives hydration.
 *
 * `Intl.DateTimeFormat` resolves to the *host's* timezone, and the server runs
 * UTC while the visitor does not — so formatting during SSR and again on the
 * client produces two different strings for the same instant. Rendering a
 * placeholder first and filling it in once mounted is the cheap, correct fix.
 *
 * The machine-readable `dateTime` is ISO UTC, stable on both passes.
 */
export function Timestamp({ at, className = '' }: { at: number; className?: string }) {
  const label = useMounted()
    ? new Intl.DateTimeFormat(undefined, {
        hour: '2-digit',
        minute: '2-digit',
      }).format(at)
    : '--:--'

  return (
    <time
      dateTime={new Date(at).toISOString()}
      className={`font-mono text-[0.625rem] tabular-nums text-ink-soft ${className}`}
    >
      {label}
    </time>
  )
}
