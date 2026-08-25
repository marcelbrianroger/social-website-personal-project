'use client'

import { useRouter } from 'next/navigation'
import { useState } from 'react'

import { SHELL } from '@/app/chrome'
import { useOpenLobbies } from '@/lib/lobby/use-open-lobbies'

/**
 * The way in to a Mr. White table.
 *
 * Two doors, because the game needs four people who already know each other:
 * one person opens a table and shares the id, everyone else types it in. There
 * is no matchmaking queue here — pairing strangers into a four-person social
 * deduction game is a different problem from pairing two people into a video
 * call, and it gets its own design.
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

export function LobbyEntry() {
  const router = useRouter()
  const { lobbies, phase } = useOpenLobbies()
  const [input, setInput] = useState('')
  const [error, setError] = useState<string | null>(null)

  const trimmed = input.trim()

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
      <p className="font-mono text-xs lowercase tracking-wide text-ink-soft">
        mr. white
      </p>

      <h1
        className="mt-3 max-w-3xl font-display text-[clamp(1.875rem,5vw,3rem)] leading-[1.02] tracking-[-0.02em]"
        style={{ fontVariationSettings: "'wght' 800, 'wdth' 92" }}
      >
        Everyone gets the word. One of you doesn&rsquo;t.
      </h1>

      <p className="mt-6 max-w-2xl text-[1.0625rem] leading-relaxed text-ink">
        Four to eight players, no video. Everyone is given the same secret word
        except one, Mr. White, who has to work it out from what everyone else
        says without giving themselves away.
      </p>

      <section className="mt-10 border-2 border-ink bg-stock p-6">
        <h2
          className="font-display text-xl leading-tight"
          style={{ fontVariationSettings: "'wght' 800, 'wdth' 95" }}
        >
          Open a table
        </h2>
        <p className="mt-2 max-w-md text-[0.9375rem] leading-relaxed text-ink">
          You get an ID. Send it to three or more people and they type it in
          below. The game starts when everyone is seated.
        </p>

        <button type="button" onClick={open} className={`${PRIMARY} mt-5`}>
          Open a table
        </button>
      </section>

      <div className="mt-8 flex items-center gap-4 font-mono text-xs lowercase text-ink-soft">
        <span className="h-0.5 flex-1 bg-ink" />
        or sit down at one
        <span className="h-0.5 flex-1 bg-ink" />
      </div>

      {/* ------------------------------------------------------ open tables */}
      <section className="mt-8" aria-label="Open tables">
        <div className="flex items-baseline justify-between gap-3">
          <h2 className="font-mono text-xs lowercase tracking-wide text-ink-soft">
            open tables
          </h2>
          <p
            aria-live="polite"
            className="font-mono text-[0.625rem] tabular-nums text-ink-soft"
          >
            {phase === 'connecting'
              ? 'looking…'
              : `${lobbies.length} open`}
          </p>
        </div>

        {phase === 'error' && (
          <p className="mt-3 border-l-4 border-pink bg-stock px-4 py-3 font-mono text-[0.8125rem] leading-relaxed text-ink">
            Could not reach the realtime server, so the list is empty. Typing an
            ID below still works.
          </p>
        )}

        {phase === 'ready' && lobbies.length === 0 && (
          <p className="mt-3 border-2 border-dashed border-rule px-4 py-6 text-center font-mono text-[0.75rem] text-ink-soft">
            Nobody has a table open. Be the first.
          </p>
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
                    style={{ fontVariationSettings: "'wght' 800, 'wdth' 95" }}
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

      <h2 className="mt-9 font-mono text-xs lowercase tracking-wide text-ink-soft">
        or type an ID someone sent you
      </h2>

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
          className="min-w-52 flex-1 border-2 border-ink bg-stock px-4 py-2.5 font-mono text-sm text-ink outline-none placeholder:text-ink-soft/70"
        />

        <button type="submit" disabled={!trimmed} className={SECONDARY}>
          Sit down
        </button>
      </form>

      {error && (
        <p
          role="alert"
          className="mt-5 max-w-xl border-l-4 border-pink bg-stock px-4 py-3 font-mono text-[0.8125rem] leading-relaxed text-ink"
        >
          {error}
        </p>
      )}

      <div className="mt-12 max-w-2xl space-y-3 border-t-2 border-ink pt-5 text-sm leading-relaxed text-ink-soft">
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
