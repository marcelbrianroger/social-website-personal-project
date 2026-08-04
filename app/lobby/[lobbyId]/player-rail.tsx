'use client'

import {
  isActor,
  isAlive,
  voteTally,
  type MrWhitePlayer,
  type MrWhiteTable,
} from '@/lib/game/mr-white-view'
import type { LobbyMember } from '@/lib/socket/events'

import { DISPLAY_HEADING, EYEBROW, PANEL } from './controls'

/**
 * The table: who is seated, who holds the floor, who is out.
 *
 * Renders in two situations. Before a game starts there is no `table`, only
 * lobby membership — the rail still has to show who is here, because "are we
 * four yet" is the only question anyone has at that point. Once a game is
 * running, the roster comes from the game instead, so a player who joined
 * mid-round is not shown as a seat that can be voted for.
 *
 * Seat order is not decoration. `joinedAt` fixes it and the clue phase walks
 * it, so showing the index is what lets a player work out who speaks next.
 *
 * "Greyed out" for an eliminated player is `text-ink-soft` — the palette's
 * actual grey — plus a strike and a dashed rule. Deliberately NOT `opacity`:
 * fading ink toward paper drops it under 4.5:1 and makes the roster unreadable
 * for exactly the players who most need to re-read it.
 */
export function PlayerRail({
  table,
  members,
  you,
}: {
  /** Null until a game starts. */
  table: MrWhiteTable | null
  /** Lobby membership, used for the roster before a game exists. */
  members: LobbyMember[]
  /** Your own sessionId, so "you" can be marked. Null while connecting. */
  you: string | null
}) {
  const seats: MrWhitePlayer[] =
    table?.players ??
    members.map((member, seat) => ({
      sessionId: member.sessionId,
      nickname: member.nickname,
      seat,
    }))

  const tally = table ? voteTally(table) : {}

  return (
    <section className={`${PANEL} p-4`} aria-label="Players">
      <div className="flex items-baseline justify-between gap-3">
        <h2 className={EYEBROW}>players</h2>
        <p className="font-mono text-[0.625rem] tabular-nums text-ink-soft">
          {table
            ? `${seats.filter((seat) => isAlive(table, seat.sessionId)).length} alive`
            : `${seats.length} seated`}
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
        {seats.map((player) => {
          const alive = table ? isAlive(table, player.sessionId) : true
          const active = table ? alive && isActor(table, player.sessionId) : false
          const isYou = player.sessionId === you
          const clue = table?.clues[player.sessionId]
          const spoke = table ? player.sessionId in table.clues : false
          const votes = tally[player.sessionId] ?? 0
          const revealedRole = table?.roles?.[player.sessionId]

          return (
            <li
              key={player.sessionId}
              // ACTIVE is a flat yellow fill with ink on top — the palette's
              // one sanctioned way to make something loud. ELIMINATED loses
              // the solid rule instead of gaining a colour.
              className={`border-2 px-2.5 py-2 ${
                !alive
                  ? 'border-dashed border-rule bg-paper'
                  : active
                    ? 'border-ink bg-yellow'
                    : 'border-ink bg-paper'
              }`}
            >
              <div className="flex items-baseline gap-1.5">
                <span
                  aria-hidden="true"
                  className="font-mono text-[0.625rem] tabular-nums text-ink-soft"
                >
                  {player.seat + 1}
                </span>

                <span
                  className={`min-w-0 flex-1 truncate font-display text-[0.9375rem] leading-tight ${
                    alive ? 'text-ink' : 'text-ink-soft line-through'
                  }`}
                  style={DISPLAY_HEADING}
                >
                  {player.nickname}
                </span>

                {isYou && (
                  <span className="shrink-0 font-mono text-[0.5625rem] uppercase tracking-wide text-ink-soft">
                    you
                  </span>
                )}
              </div>

              {/* One status line per seat. Ranked: out, then holding the
                  floor, then the clue they gave. Never more than one. */}
              <p className="mt-1 font-mono text-[0.625rem] leading-snug text-ink-soft">
                {!table ? (
                  'waiting'
                ) : !alive ? (
                  <span className="uppercase tracking-wide">eliminated</span>
                ) : active ? (
                  <span className="uppercase tracking-wide text-ink">
                    {table.phase === 'vote' ? 'voting' : 'active'}
                  </span>
                ) : clue ? (
                  <>said &ldquo;{clue}&rdquo;</>
                ) : spoke ? (
                  'timed out'
                ) : (
                  'waiting'
                )}
              </p>

              {/* Votes are only ever non-zero from `reveal-vote` onward — the
                  server sends an empty map during the vote itself. */}
              {votes > 0 && (
                <p className="mt-1 font-mono text-[0.625rem] text-ink">
                  <span className="bg-yellow px-1 tabular-nums">
                    {votes} vote{votes === 1 ? '' : 's'}
                  </span>
                </p>
              )}

              {revealedRole && (
                <p
                  className="mt-1 font-display text-[0.8125rem] leading-none text-ink"
                  style={DISPLAY_HEADING}
                >
                  {revealedRole === 'mr-white' ? 'was Mr. White' : 'civilian'}
                </p>
              )}
            </li>
          )
        })}
      </ul>
    </section>
  )
}
