'use client'

import type { TableSummary } from '@/lib/game/table-view'
import { toSeconds, useServerNow } from '@/lib/game/use-countdown'

import { DISPLAY_HEADING, EYEBROW, PANEL } from './controls'

/**
 * The table: who is seated, who holds the floor, who is out.
 *
 * Renders in two situations. Before a game starts there is no phase, only lobby
 * membership — the rail still has to show who is here, because "are we five
 * yet" is the only question anyone has at that point. Once a game is running,
 * the roster comes from the game instead, so a player who joined mid-round is
 * not shown as a seat that can be voted for.
 *
 * GAME-AGNOSTIC BY CONSTRUCTION. It reads `TableSummary`, which both Mr. White
 * and Werewolf project themselves down to, so the rail has no idea which is
 * running — see `lib/game/table-view.ts` for why that seam is a shape rather
 * than a type parameter. Everything a seat wants to SAY about itself arrives
 * pre-worded in `note`.
 *
 * Seat order is not decoration. `joinedAt` fixes it and several phases walk it,
 * so showing the index is what lets a player work out who acts next.
 *
 * "Greyed out" for a dead player is `text-ink-soft` — the palette's actual grey
 * — plus a strike and a dashed rule. Deliberately NOT `opacity`: fading ink
 * toward paper drops it under 4.5:1 and makes the roster unreadable for exactly
 * the players who most need to re-read it.
 */
export function PlayerRail({
  summary,
  you,
  started,
}: {
  summary: TableSummary
  /** Your own sessionId, so "you" can be marked. Null while connecting. */
  you: string | null
  /** False while the lobby is still filling — changes the status wording. */
  started: boolean
}) {
  const { seats } = summary

  // One interval for the whole rail rather than one per seat: every reconnect
  // window is measured against the same server clock, so they can share it.
  const awaiting = seats.some((seat) => seat.droppedUntil !== null)
  const now = useServerNow(summary.serverNow, awaiting)

  return (
    <section className={`${PANEL} p-4`} aria-label="Players">
      <div className="flex items-baseline justify-between gap-3">
        <h2 className={EYEBROW}>players</h2>
        <p className="font-mono text-[0.625rem] tabular-nums text-ink-soft">
          {started ? `${summary.aliveCount} alive` : `${seats.length} seated`}
        </p>
      </div>

      {seats.length === 0 && (
        <p className="mt-3 font-mono text-[0.6875rem] text-ink-soft">
          Nobody here yet.
        </p>
      )}

      {/* Two up on a narrow screen, a single rail once there is a column for
          it. The list stays one element either way, so it reads in order. */}
      <ul className="mt-3 grid grid-cols-2 gap-2 lg:grid-cols-1">
        {seats.map((seat) => {
          const isYou = seat.sessionId === you
          const reconnectingIn =
            seat.droppedUntil === null
              ? null
              : toSeconds(Math.max(0, seat.droppedUntil - now))

          return (
            <li
              key={seat.sessionId}
              // ACTIVE is a flat yellow fill with ink on top — the palette's
              // one sanctioned way to make something loud. DEAD loses the solid
              // rule instead of gaining a colour.
              className={`border-2 px-2.5 py-2 ${
                !seat.alive
                  ? 'border-dashed border-rule bg-paper'
                  : seat.actor
                    ? 'border-ink bg-yellow'
                    : 'border-ink bg-paper'
              }`}
            >
              <div className="flex items-baseline gap-1.5">
                <span
                  aria-hidden="true"
                  className="font-mono text-[0.625rem] tabular-nums text-ink-soft"
                >
                  {seat.seat + 1}
                </span>

                <span
                  className={`min-w-0 flex-1 truncate font-display text-[0.9375rem] leading-tight ${
                    seat.alive ? 'text-ink' : 'text-ink-soft line-through'
                  }`}
                  style={DISPLAY_HEADING}
                >
                  {seat.nickname}
                </span>

                {isYou && (
                  <span className="shrink-0 font-mono text-[0.5625rem] uppercase tracking-wide text-ink-soft">
                    you
                  </span>
                )}
              </div>

              {/* One status line per seat. Ranked: out, then gone but not yet
                  out, then holding the floor, then whatever the game wanted
                  said about them. Never more than one.

                  "reconnecting" outranks "active" because a seat can be both:
                  a player who drops while holding the floor keeps it until
                  their window runs out. The yellow fill stays — the table IS
                  blocked on them — but the line has to say why. */}
              <p className="mt-1 font-mono text-[0.625rem] leading-snug text-ink-soft">
                {!started ? (
                  'waiting'
                ) : !seat.alive ? (
                  <span className="uppercase tracking-wide">out</span>
                ) : reconnectingIn !== null ? (
                  <span className="uppercase tracking-wide text-ink">
                    reconnecting {reconnectingIn}s
                  </span>
                ) : seat.actor ? (
                  <span className="uppercase tracking-wide text-ink">active</span>
                ) : (
                  'waiting'
                )}
              </p>

              {/* Votes are only ever non-zero once the game publishes the
                  tally, which neither game does during its own vote. */}
              {seat.votes > 0 && (
                <p className="mt-1 font-mono text-[0.625rem] text-ink">
                  <span className="bg-yellow px-1 tabular-nums">
                    {seat.votes} vote{seat.votes === 1 ? '' : 's'}
                  </span>
                </p>
              )}

              {/* Already in words, and already ranked, by the game's own
                  adapter. A clue, a revealed role, a mark — the rail does not
                  need to know which. */}
              {seat.note && (
                <p
                  className="mt-1 break-words font-display text-[0.8125rem] leading-snug text-ink"
                  style={DISPLAY_HEADING}
                >
                  {seat.note}
                </p>
              )}
            </li>
          )
        })}
      </ul>
    </section>
  )
}
