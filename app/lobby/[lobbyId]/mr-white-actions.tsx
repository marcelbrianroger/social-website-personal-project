'use client'

import { useState } from 'react'

import {
  isActor,
  isAlive,
  livingPlayers,
  readyThreshold,
  type MrWhitePhase,
  type MrWhiteTable,
} from '@/lib/game/mr-white-view'

import { DISPLAY_HEADING, EYEBROW, FIELD, PANEL, PRIMARY, SECONDARY } from './controls'

/** Mr. White's own limits, mirrored from `server/src/games/mr-white.ts`. */
const MIN_PLAYERS = 4
const MAX_PLAYERS = 8

/**
 * The one control that changes with the phase: start, clue, vote, or guess.
 *
 * Every branch renders *something*. A player who cannot act right now is told
 * who they are waiting for — an empty panel reads as a broken UI, and in a
 * timed game a player staring at a blank box will assume the connection died
 * rather than that it is not their turn.
 *
 * Nothing here decides legality. `onMove` sends intent and the server judges,
 * exactly as `app/rooms/game-board.tsx` does: disabling a control is a hint to
 * the player, never enforcement, because anything enforced in the browser can
 * be bypassed from devtools.
 */
export function MrWhiteActions({
  table,
  you,
  seated,
  isHost,
  hostNickname,
  starting,
  onStart,
  onMove,
  rejection,
}: {
  /** Null until a game starts. */
  table: MrWhiteTable | null
  you: string | null
  /** How many people are in the lobby, for the start gate. */
  seated: number
  /** Whether you opened this table. The server enforces it regardless. */
  isHost: boolean
  /** Who did, so everyone else knows who they are waiting on. */
  hostNickname: string | null
  starting: boolean
  onStart: () => void
  /** Move intent: clue | vote | guess | ready. */
  onMove: (intent: unknown) => void
  /** Server's reason for refusing the last move, already in words. */
  rejection?: string | null
}) {
  const [draft, setDraft] = useState('')
  /**
   * What you sent, so the panel can say so.
   *
   * NOT an optimistic game update — `votes` stays empty through the whole vote
   * phase by design, so your own choice is the one thing the server will not
   * echo back. Remembering it locally is the only way to show it, and it is
   * discarded the moment the phase turns over.
   */
  const [sent, setSent] = useState<string | null>(null)
  const [seenPhase, setSeenPhase] = useState<MrWhitePhase | null>(null)

  const phase = table?.phase ?? null

  // Reset on phase change. Adjusting state during render is React's documented
  // pattern for this — an effect would render the stale panel once first, and
  // trips react-hooks/set-state-in-effect. Same idiom as lib/game/use-game.ts.
  if (seenPhase !== phase) {
    setSeenPhase(phase)
    setDraft('')
    setSent(null)
  }

  const alive = table !== null && you !== null && isAlive(table, you)
  const yourTurn = table !== null && you !== null && isActor(table, you)

  function send(intent: unknown, record: string) {
    onMove(intent)
    setSent(record)
  }

  return (
    <section className={`${PANEL} p-4`} aria-label="Your move">
      <h2 className={EYEBROW}>{table ? 'your move' : 'the table'}</h2>

      <div className="mt-3">
        {/* ------------------------------------------------- no game yet */}
        {!table && (
          <div>
            <p className="font-mono text-[0.75rem] leading-relaxed text-ink-soft">
              {seated < MIN_PLAYERS
                ? `Mr. White needs ${MIN_PLAYERS} players. ${seated} here. Share the lobby ID above.`
                : seated > MAX_PLAYERS
                  ? `Too many for one table: ${MAX_PLAYERS} is the limit.`
                  : isHost
                    ? `${seated} seated. Ready when you are.`
                    : `${seated} seated. ${hostNickname ?? 'Whoever opened the table'} deals.`}
            </p>

            {/* Hidden rather than disabled for everyone else: a permanently
                dead button invites clicking. The server refuses it either way —
                this is a hint, not the enforcement. */}
            {isHost && (
              <button
                type="button"
                onClick={onStart}
                disabled={
                  starting || seated < MIN_PLAYERS || seated > MAX_PLAYERS
                }
                className={`${PRIMARY} mt-4 w-full`}
              >
                {starting ? 'Dealing…' : 'Start Mr. White'}
              </button>
            )}
          </div>
        )}

        {table?.phase === 'reveal' && (
          <Waiting>
            Roles are being dealt. Memorise what you were given: it is not
            shown again until the game ends.
          </Waiting>
        )}

        {table?.phase === 'clue' &&
          (yourTurn ? (
            <WordForm
              label="One word, out loud"
              hint="Exactly one word, no spaces. Prove you know the secret without handing it over."
              placeholder="one word"
              action="Give clue"
              value={draft}
              onChange={setDraft}
              onSubmit={(word) => send({ type: 'clue', word }, word)}
              sent={sent}
              sentLabel="Clue sent"
            />
          ) : (
            <Waiting>
              {nicknameOf(table, table.actors[0]) ?? 'Someone'} is giving a clue.
              {alive && ' You are next in seat order.'}
            </Waiting>
          ))}

        {table?.phase === 'discussion' &&
          (alive ? (
            <ReadyToVote
              table={table}
              you={you}
              onToggle={() => onMove({ type: 'ready' })}
            />
          ) : (
            <Waiting>
              You are out. The living are arguing; you can still talk to the
              other eliminated players.
            </Waiting>
          ))}

        {table?.phase === 'vote' &&
          (alive ? (
            <>
              <p className="font-mono text-[0.75rem] leading-relaxed text-ink-soft">
                {sent
                  ? 'Vote cast. Others are still deciding. Nobody sees a tally until the phase ends.'
                  : 'Accuse one player of being Mr. White. Votes stay hidden until everyone has cast.'}
              </p>

              <ul className="mt-3 space-y-2">
                {/* Yourself included. `validateMove` accepts a self-vote, and
                    the engine's own suite relies on it — the early-close test
                    has every player vote for seat one, including seat one. A
                    player cornered into throwing their own name in is making a
                    real choice, so the UI must not quietly remove it. */}
                {livingPlayers(table).map((player) => {
                  const chosen = sent === player.sessionId
                  const isYou = player.sessionId === you

                  return (
                    <li key={player.sessionId}>
                      <button
                        type="button"
                        aria-pressed={chosen}
                        onClick={() =>
                          send(
                            { type: 'vote', target: player.sessionId },
                            player.sessionId,
                          )
                        }
                        className={`w-full border-2 border-ink px-3 py-2 text-left font-mono text-[0.8125rem] text-ink transition-colors ${
                          chosen ? 'bg-yellow' : 'bg-paper hover:bg-yellow'
                        }`}
                      >
                        {player.nickname}
                        {isYou && (
                          <span className="ml-2 text-[0.625rem] uppercase tracking-wide text-ink-soft">
                            you
                          </span>
                        )}
                        {chosen && (
                          <span className="ml-2 text-[0.625rem] uppercase tracking-wide">
                            your vote
                          </span>
                        )}
                      </button>
                    </li>
                  )
                })}
              </ul>
            </>
          ) : (
            <Waiting>
              You are out. The living are voting; you can still talk to the
              other eliminated players.
            </Waiting>
          ))}

        {table?.phase === 'reveal-vote' && (
          <Waiting>
            Votes are on the table. Check the roster for who went for whom.
          </Waiting>
        )}

        {table?.phase === 'guess' &&
          (yourTurn ? (
            <WordForm
              label="Name the word"
              hint="You were voted out. Get it right and you take the game anyway."
              placeholder="the secret word"
              action="Guess"
              value={draft}
              onChange={setDraft}
              onSubmit={(word) => send({ type: 'guess', word }, word)}
              sent={sent}
              sentLabel="Guess submitted"
            />
          ) : (
            <Waiting>
              Mr. White was caught and is naming the word. A correct guess
              steals the game.
            </Waiting>
          ))}

        {table?.phase === 'finished' && (
          <div>
            <p
              className="font-display text-xl leading-tight"
              style={DISPLAY_HEADING}
            >
              <span className="bg-yellow box-decoration-clone px-2">
                {outcomeLabel(table)}
              </span>
            </p>

            {table.result && (
              <p className="mt-3 font-mono text-[0.75rem] leading-relaxed text-ink-soft">
                {you !== null && table.result.winnerSessionIds.includes(you)
                  ? 'You were on the winning side.'
                  : 'You were not.'}
                {table.guess && ` The guess was “${table.guess}”.`}
              </p>
            )}

            <button
              type="button"
              onClick={onStart}
              disabled={starting || seated < MIN_PLAYERS || seated > MAX_PLAYERS}
              className={`${SECONDARY} mt-4 w-full`}
            >
              {starting ? 'Dealing…' : 'Play again'}
            </button>
          </div>
        )}
      </div>

      {/* Written out rather than reusing site-chrome.tsx's SystemNote, which fills
          itself bg-stock and would disappear into this panel. */}
      {rejection && (
        <p
          role="alert"
          className="mt-4 border-l-4 border-pink bg-paper px-3 py-2.5 font-mono text-[0.75rem] leading-relaxed text-ink"
        >
          {rejection}
        </p>
      )}
    </section>
  )
}

function outcomeLabel(table: MrWhiteTable): string {
  if (!table.result) return 'Game over'
  if (table.result.reason === 'forfeit') return 'Abandoned'

  return table.result.team === 'mr-white' ? 'Mr. White wins' : 'Civilians win'
}

/**
 * Cut the discussion short.
 *
 * The count comes from the server, not from local state: readiness is public,
 * every player sees the same number, and a player who reconnects mid-discussion
 * sees the true tally rather than a fresh zero. Pressing again takes it back.
 */
function ReadyToVote({
  table,
  you,
  onToggle,
}: {
  table: MrWhiteTable
  you: string | null
  onToggle: () => void
}) {
  const ready = table.readyToVote.length
  const needed = readyThreshold(table)
  const youAreReady = you !== null && table.readyToVote.includes(you)

  return (
    <div>
      <p className="font-mono text-[0.75rem] leading-relaxed text-ink-soft">
        Argue it out in chat. No moves this phase, though you do not have to
        sit out the clock.
      </p>

      <button
        type="button"
        aria-pressed={youAreReady}
        onClick={onToggle}
        className={`mt-4 w-full border-2 border-ink px-4 py-2.5 font-mono text-sm text-ink transition-colors ${
          youAreReady ? 'bg-yellow' : 'bg-paper hover:bg-yellow'
        }`}
      >
        {youAreReady ? 'Ready (tap to undo)' : 'Ready to vote'}
      </button>

      <p
        aria-live="polite"
        className="mt-2 font-mono text-[0.6875rem] text-ink-soft"
      >
        <span className="tabular-nums text-ink">
          {ready} of {needed}
        </span>{' '}
        ready. {needed - ready > 0
          ? `${needed - ready} more ends the discussion early.`
          : 'Voting now.'}
      </p>
    </div>
  )
}

function Waiting({ children }: { children: React.ReactNode }) {
  return (
    <p className="font-mono text-[0.75rem] leading-relaxed text-ink-soft">
      {children}
    </p>
  )
}

/** Shared shell for the two single-word submissions: clue and guess. */
function WordForm({
  label,
  hint,
  placeholder,
  action,
  value,
  onChange,
  onSubmit,
  sent,
  sentLabel,
}: {
  label: string
  hint: string
  placeholder: string
  action: string
  value: string
  onChange: (next: string) => void
  onSubmit: (word: string) => void
  sent: string | null
  sentLabel: string
}) {
  const trimmed = value.trim()
  const fieldId = `word-${action.toLowerCase()}`

  if (sent) {
    return (
      <div>
        <p className={EYEBROW}>{sentLabel.toLowerCase()}</p>
        <p
          className="mt-1.5 break-words font-display text-xl leading-none"
          style={DISPLAY_HEADING}
        >
          <span className="bg-yellow box-decoration-clone px-2 py-0.5">
            {sent}
          </span>
        </p>
        <p className="mt-3 font-mono text-[0.6875rem] text-ink-soft">
          Waiting on the rest of the table.
        </p>
      </div>
    )
  }

  return (
    <form
      onSubmit={(event) => {
        event.preventDefault()
        if (trimmed) onSubmit(trimmed)
      }}
    >
      <label htmlFor={fieldId} className={EYEBROW}>
        {label.toLowerCase()}
      </label>

      <p className="mt-1 mb-2.5 font-mono text-[0.75rem] leading-relaxed text-ink-soft">
        {hint}
      </p>

      <input
        id={fieldId}
        value={value}
        onChange={(event) => onChange(event.target.value)}
        placeholder={placeholder}
        autoComplete="off"
        className={FIELD}
      />

      <button
        type="submit"
        disabled={!trimmed}
        className={`${PRIMARY} mt-2.5 w-full`}
      >
        {action}
      </button>
    </form>
  )
}

function nicknameOf(table: MrWhiteTable, sessionId: string | undefined) {
  if (!sessionId) return null
  return (
    table.players.find((player) => player.sessionId === sessionId)?.nickname ??
    null
  )
}
