'use client'

import type { DuduBroadcast } from '@/lib/socket/events'
import { useSlipDrag } from '@/lib/wall/use-slip-drag'

/**
 * One slip of paper on the board.
 *
 * The wall now appears twice — the full board at /wall and the live excerpt on
 * the home page — and the two have to be the same object rather than two things
 * that happen to look alike. Tilt, overprint, pin mark and the countdown all
 * live here, so changing the paper is a change in one place.
 */

/**
 * Grid the slips are pinned to. `board` isolates the multiply blend.
 *
 * Four across at the top end, because the page shell went from 64rem to 88rem
 * and three columns in that much width stretches a slip past the newspaper
 * measure it is meant to hold — a note you can read in one glance is the whole
 * unit here.
 */
export const BOARD =
  'board grid grid-cols-1 items-start p-3 sm:grid-cols-2 lg:grid-cols-3 xl:grid-cols-4'

/**
 * Deterministic per slot rather than random, so the server and the first client
 * render agree on the markup.
 */
const TILTS = [-1.6, 1.1, -0.7, 1.4, -1.2, 0.6]

/**
 * The nudge is what makes slips genuinely overlap — that overprint is the whole
 * point of the board — and it is a translate rather than a negative margin so
 * it cannot push the grid out of its container.
 */
const NUDGES = [
  [0, 0],
  [-5, 3],
  [4, -2],
  [-3, -4],
  [5, 3],
  [-4, 2],
] as const

/** How long until this slip comes down. */
export function timeLeft(expiresAt: string): string {
  const remaining = new Date(expiresAt).getTime() - Date.now()
  if (remaining <= 0) return 'gone'

  const hours = Math.floor(remaining / 3_600_000)
  if (hours >= 1) return `${hours}h left`

  const minutes = Math.floor(remaining / 60_000)
  if (minutes >= 1) return `${minutes}m left`

  return `${Math.floor(remaining / 1000)}s left`
}

/** How the reply control reads at each count. Singular matters at one. */
function replyLabel(count: number): string {
  if (count === 0) return 'reply'
  if (count === 1) return '1 reply'
  return `${count} replies`
}

/** Under an hour, it is close enough to the end to mark. */
function isSoon(expiresAt: string): boolean {
  return new Date(expiresAt).getTime() - Date.now() < 3_600_000
}

export function WallSlip({
  message,
  slot,
  arriving = false,
  onOpen,
}: {
  message: DuduBroadcast
  /** Position on the board. Decides tilt, nudge and overlap order. */
  slot: number
  /** Went up while the visitor was watching, so it plays its entry. */
  arriving?: boolean
  /** Take this note down and read it up close. Omitted: the slip is inert. */
  onOpen?: () => void
}) {
  const tilt = TILTS[slot % TILTS.length]!
  const [nudgeX, nudgeY] = NUDGES[slot % NUDGES.length]!

  /*
   * The slip owns its position from here on. `paint` composes the same
   * rotate/translate this element renders with, so a slip that has never been
   * touched sits exactly where the markup put it — the drag only ever adds to
   * the resting transform, it never replaces the idea of one.
   */
  const { ref, dragging, wasDrag, handlers } = useSlipDrag({ tilt, nudgeX, nudgeY })

  /*
   * Anywhere on the paper opens it — except at the end of a throw, which also
   * lands a click. `wasDrag` reads and clears, so it suppresses exactly the one
   * click that belongs to the drag and no other.
   *
   * This is the convenience path. The keyboard's way in is the real control in
   * the footer, which is a button and carries the label.
   */
  const open = () => {
    if (wasDrag()) return
    onOpen?.()
  }

  return (
    <li
      ref={ref}
      {...handlers}
      data-dragging={dragging}
      style={
        {
          // Also read by the pin-up keyframes, which have to land on exactly
          // the resting transform or the slip would jump when the entry ends.
          '--tilt': `${tilt}deg`,
          '--nudge-x': `${nudgeX}px`,
          '--nudge-y': `${nudgeY}px`,
          transform: `rotate(${tilt}deg) translate(${nudgeX}px, ${nudgeY}px)`,
          /*
           * A slip in hand is on top of every slip it is crossing. This has to
           * be set HERE rather than in the stylesheet: the resting value is an
           * inline style, and an inline declaration outranks a class, so a
           * `z-index` rule keyed off `data-dragging` would lose to the very
           * value it was trying to override and the picked-up note would slide
           * underneath its neighbours.
           */
          zIndex: dragging ? 30 : slot % 2 === 0 ? 2 : 1,
        } as React.CSSProperties
      }
      onClick={onOpen ? open : undefined}
      className={`slip slip-drag relative flex min-h-44 flex-col justify-between border-2 border-ink bg-stock px-6 pt-10 pb-5 ${
        arriving ? 'animate-pin-up' : ''
      }`}
    >
      {/* The pin. A printed mark, not a picture of a pushpin. */}
      <span
        aria-hidden="true"
        className="absolute left-[13px] top-[13px] size-2.5 rounded-full bg-pink"
      />

      <p className="whitespace-pre-wrap break-words text-[1.0625rem] leading-snug text-ink">
        {message.body}
      </p>

      <div className="mt-6 flex items-baseline justify-between gap-3 font-mono text-[0.6875rem]">
        <span className="truncate text-ink-soft">{message.nickname}</span>

        <div className="flex shrink-0 items-baseline gap-3">
          {onOpen && (
            <button
              type="button"
              // The click already bubbles to the slip, which opens it too —
              // stopped here so one press cannot count as two.
              onClick={(event) => {
                event.stopPropagation()
                onOpen()
              }}
              aria-label={`Open the note by ${message.nickname} — ${replyLabel(
                message.replyCount,
              )}`}
              className="text-ink underline decoration-dotted underline-offset-2 hover:bg-yellow"
            >
              {replyLabel(message.replyCount)}
            </button>
          )}

          <span
            className={`${
              isSoon(message.expiresAt)
                ? 'bg-pink px-1 text-paper'
                : 'text-ink-soft'
            }`}
          >
            {timeLeft(message.expiresAt)}
          </span>
        </div>
      </div>
    </li>
  )
}
