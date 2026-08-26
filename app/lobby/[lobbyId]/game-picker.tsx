'use client'

import { DISPLAY_HEADING, EYEBROW, PANEL } from './controls'

/**
 * Which game this table is about to play.
 *
 * ONLY THE HOST SEES CONTROLS. The choice is not lobby state — nothing on the
 * server records a "selected game", because `game:start` already carries the id
 * and the server validates the seat count against that game's own limits. So
 * this is local to whoever is going to press start, and everyone else is simply
 * told who they are waiting on. Syncing a preview of the host's dropdown would
 * mean adding a lobby event, a new piece of Redis state and a race, to save one
 * sentence of copy.
 *
 * It disappears the moment a game exists. Re-picking mid-game is not a thing —
 * the running game IS the answer, and the host can deal again when it ends.
 */

export interface GameChoice {
  id: string
  label: string
  minPlayers: number
  maxPlayers: number
  /** One line on what the table is in for. */
  blurb: string
}

/**
 * Mirrored from `server/src/games/registry.ts`.
 *
 * The seat ranges are the server's, repeated here so the picker can grey out a
 * game the table cannot currently seat. As everywhere else that is a HINT — the
 * server refuses the start regardless, and this only saves the host a rejection.
 */
export const LOBBY_GAMES: readonly GameChoice[] = [
  {
    id: 'mr-white',
    label: 'Mr. White',
    minPlayers: 4,
    maxPlayers: 8,
    blurb: 'Everyone gets a word. One of you gets a blank, and has to bluff.',
  },
  {
    id: 'werewolf',
    label: 'Werewolf',
    minPlayers: 5,
    maxPlayers: 8,
    blurb: 'A pack eats one of you each night. Eight roles, and nobody admits theirs.',
  },
]

export function GamePicker({
  chosen,
  seated,
  isHost,
  hostNickname,
  onChoose,
}: {
  chosen: string
  seated: number
  isHost: boolean
  hostNickname: string | null
  onChoose: (gameId: string) => void
}) {
  const current = LOBBY_GAMES.find((game) => game.id === chosen)

  if (!isHost) {
    return (
      <section className={`${PANEL} p-4`} aria-label="Game">
        <p className={EYEBROW}>the game</p>
        <p
          className="mt-1 font-display text-lg leading-tight"
          style={DISPLAY_HEADING}
        >
          {current?.label ?? 'Not chosen yet'}
        </p>
        <p className="mt-2 font-mono text-[0.6875rem] leading-relaxed text-ink-soft">
          {hostNickname ?? 'Whoever opened this table'} picks, and starts it.
        </p>
      </section>
    )
  }

  return (
    <section className={`${PANEL} p-4`} aria-label="Game">
      <p className={EYEBROW}>pick the game</p>

      <ul className="mt-2 space-y-1.5">
        {LOBBY_GAMES.map((game) => {
          const fits = seated >= game.minPlayers && seated <= game.maxPlayers
          const picked = game.id === chosen

          return (
            <li key={game.id}>
              <button
                type="button"
                aria-pressed={picked}
                onClick={() => onChoose(game.id)}
                className={`w-full border-2 border-ink px-3 py-2 text-left transition-colors ${
                  picked ? 'bg-yellow' : 'bg-paper hover:bg-yellow'
                }`}
              >
                <span className="flex items-baseline gap-2">
                  <span
                    className="min-w-0 flex-1 truncate font-display text-[0.9375rem] leading-tight text-ink"
                    style={DISPLAY_HEADING}
                  >
                    {game.label}
                  </span>

                  {/* Says why, not just that it is unavailable — "needs 5" is
                      actionable, a greyed-out row is not. */}
                  <span className="shrink-0 font-mono text-[0.5625rem] uppercase tracking-wide text-ink-soft">
                    {fits
                      ? `${game.minPlayers}–${game.maxPlayers}`
                      : seated < game.minPlayers
                        ? `needs ${game.minPlayers}`
                        : `max ${game.maxPlayers}`}
                  </span>
                </span>

                <span className="mt-1 block font-mono text-[0.625rem] leading-relaxed text-ink-soft">
                  {game.blurb}
                </span>
              </button>
            </li>
          )
        })}
      </ul>
    </section>
  )
}
