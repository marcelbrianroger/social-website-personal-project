'use client'

import { useRouter } from 'next/navigation'
import { useState } from 'react'

import { READING, SHELL } from '@/components/site-chrome'
import { GAMES } from '@/lib/game/catalogue'
import { useOpenLobbies } from '@/lib/lobby/use-open-lobbies'

/**
 * The way in to a table.
 *
 * WAS THE MR. WHITE PAGE, and only that: the headline, the metadata and every
 * line of copy named one game, so Werewolf was unreachable unless you already
 * knew a table URL. A table is not a game though — the host picks what to deal
 * once people are seated — so this page is about the ROOM, and the two games
 * are what you might play in it.
 *
 * Two doors, because these games need people who already know each other: one
 * person opens a table and shares the id, everyone else types it in. There is no
 * matchmaking queue here — pairing strangers into a six-person social deduction
 * game is a different problem from pairing two people into a video call, and it
 * gets its own design.
 */

/**
 * Ambiguous glyphs removed: i/l/1 and o/0 are the pairs people get wrong when
 * an id is read aloud in a voice call or copied off a photo of a screen.
 */
const ALPHABET = 'abcdefghjkmnpqrstuvwxyz23456789'
const ID_LENGTH = 6

/**
 * A fresh table id.
 *
 * Not a secret — anyone who guesses one can sit down — but 31^6 is about 887
 * million, which makes stumbling into someone else's game by chance
 * impractical at any scale this will ever see. Generated in the click handler
 * rather than during render, so nothing depends on the clock or the RNG while
 * the page is being hydrated.
 */
function newLobbyId(): string {
  const draws = new Uint32Array(ID_LENGTH)
  crypto.getRandomValues(draws)

  return Array.from(draws, (draw) => ALPHABET[draw % ALPHABET.length]).join('')
}

/** Matches `isValidLobbyId` on the server. Checked here only to explain early. */
const LOBBY_ID = /^[A-Za-z0-9_-]{3,32}$/

const PRIMARY =
  'border-2 border-ink bg-ink px-6 py-3 font-mono text-sm text-paper transition-colors hover:bg-pink hover:text-ink disabled:opacity-40 disabled:hover:bg-ink disabled:hover:text-paper'

const SECONDARY =
  'border-2 border-ink px-6 py-3 font-mono text-sm text-ink transition-colors hover:bg-yellow disabled:opacity-40 disabled:hover:bg-transparent'

const DISPLAY = { fontVariationSettings: "'wght' 800, 'wdth' 95" }

export function LobbyEntry() {
  const router = useRouter()
  const { lobbies, phase } = useOpenLobbies()
  const [input, setInput] = useState('')
  const [error, setError] = useState<string | null>(null)

  const trimmed = input.trim()
  const seatedNow = lobbies.reduce((total, lobby) => total + lobby.seated, 0)

  function open() {
    router.push(`/lobby/${newLobbyId()}`)
  }

  function join(event: React.FormEvent) {
    event.preventDefault()
    if (!trimmed) return

    if (!LOBBY_ID.test(trimmed)) {
      setError('Table IDs are 3–32 characters: letters, digits, dash, underscore.')
      return
    }

    router.push(`/lobby/${trimmed}`)
  }

  return (
    <div className={`${SHELL} py-12 sm:py-16`}>
      {/* ------------------------------------------------------------ head */}
      <div className="flex flex-wrap items-end justify-between gap-x-10 gap-y-4">
        <div>
          <p className="font-mono text-xs lowercase tracking-wide text-ink-soft">
            the tables
          </p>

          <h1
            className="mt-3 font-display text-[clamp(1.875rem,5.5vw,3.5rem)] leading-[1.02] tracking-[-0.02em]"
            style={{ fontVariationSettings: "'wght' 800, 'wdth' 92" }}
          >
            Sit down, then pick the game.
          </h1>
        </div>

        {/* Presence, from the same push that fills the list below. A room with
            nobody in it should say so rather than look broken. */}
        <p
          aria-live="polite"
          className="font-mono text-[0.6875rem] tabular-nums text-ink-soft"
        >
          {phase === 'connecting' ? (
            'looking…'
          ) : phase === 'error' ? (
            'table list unavailable'
          ) : lobbies.length === 0 ? (
            'nobody has a table open'
          ) : (
            <>
              <span className="bg-yellow px-1 text-ink">
                {lobbies.length} open
              </span>{' '}
              · {seatedNow} seated
            </>
          )}
        </p>
      </div>

      <p className={`${READING} mt-6 text-[1.0625rem] leading-relaxed text-ink`}>
        A table is just a room with a name. Whoever opens it chooses which of the
        two games to deal once everybody is seated, so you do not have to decide
        before people arrive.
      </p>

      {/* ------------------------------------------------------- the games */}
      <section className="mt-10" aria-label="Games you can play">
        <div className="grid gap-px border-2 border-ink bg-ink md:grid-cols-2">
          {GAMES.map((game) => (
            <article key={game.id} className="bg-stock p-6">
              <div className="flex items-baseline justify-between gap-4">
                <h2 className="font-display text-2xl leading-none" style={DISPLAY}>
                  {game.label}
                </h2>
                <p className="shrink-0 border-2 border-ink bg-paper px-2 py-0.5 font-mono text-[0.6875rem] tabular-nums text-ink">
                  {game.minPlayers}–{game.maxPlayers}
                </p>
              </div>

              <p className="mt-3 border-y-2 border-rule py-2 font-mono text-[0.6875rem] lowercase tracking-wide text-ink-soft">
                {game.spec}
              </p>

              <p className="mt-4 text-[0.9375rem] leading-relaxed text-ink">
                {game.pitch}
              </p>
            </article>
          ))}
        </div>
      </section>

      {/* --------------------------------------------------- the two doors */}
      <div className="mt-10 grid gap-6 lg:grid-cols-[minmax(0,1fr)_minmax(0,1.35fr)] lg:gap-10">
        {/* Door one: start something. */}
        <section className="border-2 border-ink bg-stock p-6">
          <h2 className="font-display text-xl leading-tight" style={DISPLAY}>
            Open a table
          </h2>
          <p className="mt-2 text-[0.9375rem] leading-relaxed text-ink">
            You get an ID. Send it to the others and they type it in. You pick
            the game and start it when everyone is seated.
          </p>

          <button type="button" onClick={open} className={`${PRIMARY} mt-5`}>
            Open a table
          </button>

          <h3 className="mt-8 font-mono text-xs lowercase tracking-wide text-ink-soft">
            or type an ID someone sent you
          </h3>

          <form className="mt-3 flex flex-wrap gap-3" onSubmit={join}>
            <label htmlFor="lobby-id" className="sr-only">
              Table ID
            </label>

            <input
              id="lobby-id"
              value={input}
              onChange={(event) => {
                setInput(event.target.value)
                setError(null)
              }}
              placeholder="k7m2xq"
              autoComplete="off"
              autoCapitalize="none"
              spellCheck={false}
              className="min-w-40 flex-1 border-2 border-ink bg-paper px-4 py-2.5 font-mono text-sm text-ink outline-none placeholder:text-ink-soft/70"
            />

            <button type="submit" disabled={!trimmed} className={SECONDARY}>
              Sit down
            </button>
          </form>

          {error && (
            <p
              role="alert"
              className="mt-4 border-l-4 border-pink bg-paper px-4 py-3 font-mono text-[0.8125rem] leading-relaxed text-ink"
            >
              {error}
            </p>
          )}
        </section>

        {/* Door two: join something already happening. Given the wider column
            because a list of live tables is the reason to be on this page. */}
        <section aria-label="Open tables">
          <h2 className="font-mono text-xs lowercase tracking-wide text-ink-soft">
            open tables
          </h2>

          {phase === 'error' && (
            <p className="mt-3 border-l-4 border-pink bg-stock px-4 py-3 font-mono text-[0.8125rem] leading-relaxed text-ink">
              Could not reach the realtime server, so the list is empty. Typing
              an ID still works.
            </p>
          )}

          {phase === 'ready' && lobbies.length === 0 && (
            <div className="mt-3 border-2 border-dashed border-rule px-5 py-10 text-center">
              <p className="font-mono text-[0.8125rem] text-ink-soft">
                Nobody has a table open.
              </p>
              <button
                type="button"
                onClick={open}
                className="mt-4 bg-yellow px-2 py-0.5 font-mono text-sm text-ink hover:underline"
              >
                Be the first
              </button>
            </div>
          )}

          <ul className="mt-3 space-y-2">
            {lobbies.map((lobby) => {
              const full = lobby.seated >= lobby.capacity

              return (
                <li
                  key={lobby.lobbyId}
                  className="flex flex-wrap items-center justify-between gap-x-5 gap-y-3 border-2 border-ink bg-stock px-4 py-3"
                >
                  <div className="min-w-0">
                    <p
                      className="font-display text-lg leading-none"
                      style={DISPLAY}
                    >
                      <span className="bg-yellow box-decoration-clone px-1.5">
                        {lobby.lobbyId}
                      </span>
                    </p>
                    <p className="mt-2 font-mono text-[0.6875rem] text-ink-soft">
                      <span className="tabular-nums text-ink">
                        {lobby.seated}/{lobby.capacity}
                      </span>
                      {lobby.host && ` · opened by ${lobby.host}`}
                      {/* Joining mid-game is allowed and lands you as a
                          spectator — the roster is fixed when cards are dealt,
                          so saying "playing" here would be a lie. */}
                      {lobby.inProgress && ' · in progress'}
                    </p>
                  </div>

                  <button
                    type="button"
                    onClick={() => router.push(`/lobby/${lobby.lobbyId}`)}
                    disabled={full}
                    className="shrink-0 border-2 border-ink px-5 py-2 font-mono text-sm text-ink transition-colors hover:bg-yellow disabled:opacity-40 disabled:hover:bg-transparent"
                  >
                    {full ? 'Full' : lobby.inProgress ? 'Watch' : 'Sit down'}
                  </button>
                </li>
              )
            })}
          </ul>
        </section>
      </div>

      <div
        className={`${READING} mt-14 space-y-3 border-t-2 border-ink pt-5 text-sm leading-relaxed text-ink-soft`}
      >
        <p>
          Nothing is kept. The table is deleted the moment the last person
          leaves, and chat is never stored at all, not even for the people
          still in the room.
        </p>
        <p>
          The board is held by the server. Your browser can only ask to move;
          it never decides what is legal, and it is never sent another
          player&rsquo;s role.
        </p>
      </div>
    </div>
  )
}
