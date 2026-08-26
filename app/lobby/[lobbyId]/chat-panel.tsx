'use client'

import { useEffect, useRef, useState } from 'react'

import type { ChatEntry, ChatEntryMessage } from '@/lib/game/mr-white-view'
import type { TableSeat } from '@/lib/game/table-view'
import { MAX_MESSAGE_LENGTH } from '@/lib/socket/events'

import { DISPLAY_HEADING, PANEL, PRIMARY, Timestamp } from './controls'

/**
 * The table transcript.
 *
 * WHY THIS IS NOT A CHAT BOX. In Werewolf and Mr. White the talking IS the
 * game — the board is where you point, and this is where the round is actually
 * won. It used to be a narrow column of grey monospace beside a large drawn
 * board, which is the treatment you give a log nobody reads, so it read as
 * exiled from the room it is the centre of.
 *
 * So it is made of the same material as the table. A chair on the board is a
 * paper card on stock; a line said at the table is a paper SLIP on the same
 * stock, tilted, laid down as it arrives. Two surfaces, one print job — the
 * transcript stops being a sidebar and becomes the other half of the board.
 *
 * FOUR REGISTERS, deliberately distinct because confusing them loses games:
 *
 *   phase   machine. A ruled band across the transcript, like a chapter break
 *           in the record. Synthesised on the client from phase transitions —
 *           chat never enters game state, so the server does not send these.
 *   table   what living players said. Paper, on the left; yours on the right.
 *   pack    the wolves' private line at night. Pink rule and a tag, because a
 *           wolf who mistakes this for the table channel loses on the spot.
 *   dead    what eliminated players said to each other. `chatAudience` scopes
 *           this server-side and emits per socket, so a living player never
 *           receives one; the styling is a second line of defence, not the
 *           mechanism.
 *
 * `onSend` returns nothing and clears the field optimistically. That is safe
 * because chat is not game state — unlike a move, a dropped message costs
 * nobody a round.
 */

/**
 * Deterministic per message rather than random, so the tilt survives a
 * re-render and does not reshuffle the whole transcript when one line arrives.
 */
const TILTS = [-0.9, 0.7, -0.5, 1, -0.7, 0.4]

function tiltOf(id: string): number {
  let hash = 0
  for (let index = 0; index < id.length; index += 1) {
    hash = (hash * 31 + id.charCodeAt(index)) >>> 0
  }

  return TILTS[hash % TILTS.length]!
}

export function ChatPanel({
  entries,
  you,
  seats,
  phaseLabel,
  open,
  audience,
  deadChannel = false,
  waiting = false,
  error,
  onSend,
}: {
  entries: ChatEntry[]
  /** Your sessionId, so your own lines can be marked. `null` when observing. */
  you: string | null
  /**
   * The roster, only so a slip can carry the same seat number as its chair.
   *
   * That number is the whole reason the board and the transcript are legible
   * together: "seat 4 said that" is a claim you can check by looking at the
   * table, and nicknames alone are three syllables of German nobody retains.
   */
  seats: TableSeat[]
  /**
   * The phase name in words, or null before a game starts.
   *
   * A LABEL RATHER THAN A KEY, so this panel serves every game in the room
   * without importing any of their vocabularies.
   */
  phaseLabel: string | null
  /** False whenever `chatAudience` would return `chat-closed`. */
  open: boolean
  /** Who hears the next thing you send, in words. Null when the field is shut. */
  audience: string | null
  /** True once you are eliminated — you are on the `dead` channel from then on. */
  deadChannel?: boolean
  /**
   * True when you are in the room but not in this round.
   *
   * The server answers `not-a-player` to anything a non-player sends, so the
   * field is shut either way — this only decides whether the closed field
   * explains itself as a phase rule or as your own situation.
   */
  waiting?: boolean
  /** Server's reason for refusing the last message, already in words. */
  error?: string | null
  onSend: (body: string) => void
}) {
  const [draft, setDraft] = useState('')
  const endRef = useRef<HTMLDivElement>(null)

  // Follow the transcript. `block: 'nearest'` keeps the page itself from
  // jumping when the panel is already in view.
  useEffect(() => {
    endRef.current?.scrollIntoView({ block: 'nearest' })
  }, [entries.length])

  const trimmed = draft.trim()
  const over = draft.length > MAX_MESSAGE_LENGTH

  function submit(event: React.FormEvent) {
    event.preventDefault()
    if (!open || !trimmed || over) return

    onSend(trimmed)
    setDraft('')
  }

  return (
    <section
      className={`${PANEL} flex h-full min-h-[30rem] flex-col`}
      aria-label="Table talk"
    >
      <div className="flex items-baseline justify-between gap-3 border-b-2 border-ink px-4 py-3">
        <h2
          className="font-display text-base leading-none"
          style={DISPLAY_HEADING}
        >
          Table talk
        </h2>

        <Channel
          open={open}
          audience={audience}
          deadChannel={deadChannel}
          waiting={waiting}
          phaseLabel={phaseLabel}
        />
      </div>

      {/* -------------------------------------------------------- transcript */}
      {/* Halftone on the ground, so the gaps between slips read as the surface
          they are lying on rather than as an empty box. */}
      {/* `role="log"` sits on the wrapper rather than the list: putting it on
          the `ol` replaces the list semantics, and the `li` children are left
          without a list to belong to. `overflow-x-hidden` because the slips are
          rotated, and a degree of tilt is enough to raise a scrollbar. */}
      <div
        role="log"
        aria-live="polite"
        aria-label="Messages"
        className="halftone flex-1 overflow-y-auto overflow-x-hidden px-4 py-4"
      >
        {entries.length === 0 ? (
          <div className="pt-6 text-center">
            <p
              className="font-display text-base leading-tight text-ink-soft"
              style={DISPLAY_HEADING}
            >
              Nothing said yet
            </p>
            <p className="mt-1.5 font-mono text-[0.6875rem] text-ink-soft">
              Somebody has to go first.
            </p>
          </div>
        ) : (
          <ol className="space-y-2.5">
            {entries.map((entry) =>
              entry.kind === 'system' ? (
                <PhaseBreak key={entry.id} text={entry.text} />
              ) : (
                <Slip
                  key={entry.id}
                  entry={entry}
                  mine={entry.from === you}
                  seat={seats.find((row) => row.sessionId === entry.from)?.seat}
                />
              ),
            )}
          </ol>
        )}

        <div ref={endRef} />
      </div>

      {/* ----------------------------------------------------------- compose */}
      <form onSubmit={submit} className="border-t-2 border-ink px-4 py-3">
        {/* Said above the field, not inside it: a placeholder disappears the
            moment you start typing, which is exactly when getting the audience
            wrong costs you the game. */}
        <p
          className={`mb-2 font-mono text-[0.625rem] leading-snug ${
            audience === 'your pack only'
              ? 'border-l-2 border-pink pl-2 text-ink'
              : 'text-ink-soft'
          }`}
        >
          {open && audience ? (
            <>
              heard by <span className="text-ink">{audience}</span>
            </>
          ) : waiting ? (
            'you are watching this round'
          ) : (
            `closed during ${(phaseLabel ?? 'this phase').toLowerCase()}`
          )}
        </p>

        <div className="flex gap-2">
          <label htmlFor="chat-draft" className="sr-only">
            Message the table
          </label>

          <input
            id="chat-draft"
            value={draft}
            onChange={(event) => setDraft(event.target.value)}
            disabled={!open}
            placeholder={open ? 'say something' : '—'}
            autoComplete="off"
            className="w-full border-2 border-ink bg-paper px-3 py-2.5 font-mono text-sm text-ink outline-none placeholder:text-ink-soft/70 disabled:border-rule disabled:bg-stock disabled:placeholder:text-ink-soft/40"
          />

          <button
            type="submit"
            disabled={!open || !trimmed || over}
            className={`${PRIMARY} shrink-0 px-4`}
          >
            Send
          </button>
        </div>

        {/* Only shown once it matters — a permanent counter is noise. */}
        {draft.length > MAX_MESSAGE_LENGTH - 40 && (
          <p
            className={`mt-2 font-mono text-[0.625rem] tabular-nums ${
              over ? 'bg-yellow px-1 text-ink' : 'text-ink-soft'
            }`}
          >
            {draft.length} / {MAX_MESSAGE_LENGTH}
          </p>
        )}

        {/* Moderation and rate limiting both refuse server-side, so the only
            honest place to learn a message did not send is here. */}
        {error && (
          <p
            role="alert"
            className="mt-2 border-l-4 border-pink bg-paper px-3 py-2 font-mono text-[0.6875rem] leading-relaxed text-ink"
          >
            {error}
          </p>
        )}
      </form>
    </section>
  )
}

/** Which line you are on, in the header. One badge, never two. */
function Channel({
  open,
  audience,
  deadChannel,
  waiting,
  phaseLabel,
}: {
  open: boolean
  audience: string | null
  deadChannel: boolean
  waiting: boolean
  phaseLabel: string | null
}) {
  const [label, loud] = waiting
    ? ['watching', false]
    : deadChannel
      ? ['dead channel', false]
      : audience === 'your pack only'
        ? ['pack line', true]
        : open
          ? ['open', false]
          : [`closed · ${(phaseLabel ?? 'this phase').toLowerCase()}`, false]

  return (
    <p
      className={`shrink-0 truncate px-1.5 font-mono text-[0.5625rem] uppercase tracking-wide ${
        loud
          ? 'border border-ink bg-pink text-ink'
          : 'border border-rule text-ink-soft'
      }`}
    >
      {label}
    </p>
  )
}

/**
 * A phase turning over, ruled across the transcript.
 *
 * The old treatment was a dim `[STATE]` prefix on a line of small caps, which
 * scrolled past looking like another message. A round is a sequence of scenes
 * and this is the break between them, so it is drawn as one.
 */
function PhaseBreak({ text }: { text: string }) {
  return (
    <li className="flex items-center gap-2.5 py-1.5">
      <span aria-hidden="true" className="h-px flex-1 bg-rule" />
      <span className="shrink-0 font-mono text-[0.5625rem] uppercase tracking-[0.18em] text-ink-soft">
        {text}
      </span>
      <span aria-hidden="true" className="h-px flex-1 bg-rule" />
    </li>
  )
}

/**
 * One thing somebody said, on paper.
 *
 * Yours sit on the right in yellow — the palette's one sanctioned way to mark
 * something as yours — and everyone else's on the left in plain paper, so the
 * transcript can be skimmed for your own voice without reading it.
 *
 * The dead and the pack keep their rules rather than gaining a colour: dashed
 * for the dead, because they are off the board, and a pink rule for the pack,
 * because it is the one channel where saying it to the wrong room is fatal.
 */
function Slip({
  entry,
  mine,
  seat,
}: {
  entry: ChatEntryMessage
  mine: boolean
  /** Their chair on the board, so the two can be read against each other. */
  seat: number | undefined
}) {
  const tilt = tiltOf(entry.id)
  const dead = entry.channel === 'dead'
  const pack = entry.channel === 'pack'

  const paper = dead
    ? 'border-dashed border-rule bg-paper'
    : pack
      ? 'border-ink border-l-4 border-l-pink bg-paper'
      : mine
        ? 'border-ink bg-yellow'
        : 'border-ink bg-paper'

  return (
    <li className={`flex flex-col ${mine ? 'items-end' : 'items-start'}`}>
      <div
        // Read by the lay-down keyframes, which land on exactly this resting
        // transform — a keyframe that ended anywhere else would snap the slip
        // straight the moment its animation finished.
        style={
          {
            '--tilt': `${tilt}deg`,
            transform: `rotate(${tilt}deg)`,
          } as React.CSSProperties
        }
        className={`animate-lay-down max-w-[85%] min-w-0 border-2 px-3 py-2 ${paper}`}
      >
        <p className="flex items-baseline gap-1.5">
          {seat !== undefined && (
            <span
              aria-hidden="true"
              className="shrink-0 font-mono text-[0.625rem] tabular-nums text-ink-soft"
            >
              {seat + 1}
            </span>
          )}

          <span
            className={`min-w-0 truncate font-mono text-[0.6875rem] ${
              dead ? 'text-ink-soft' : 'text-ink'
            }`}
          >
            {entry.nickname}
          </span>

          {(dead || pack) && (
            <span className="shrink-0 font-mono text-[0.5625rem] uppercase tracking-wide text-ink-soft">
              {dead ? 'dead' : 'pack'}
            </span>
          )}
        </p>

        <p
          className={`mt-0.5 break-words text-[0.9375rem] leading-snug ${
            dead ? 'text-ink-soft' : 'text-ink'
          }`}
        >
          {entry.body}
        </p>
      </div>

      <Timestamp at={entry.at} className="mt-0.5 px-1" />
    </li>
  )
}
