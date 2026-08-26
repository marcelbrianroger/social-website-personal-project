'use client'

import { useEffect, useRef, useState } from 'react'

import type { ChatEntry } from '@/lib/game/mr-white-view'
import { MAX_MESSAGE_LENGTH } from '@/lib/socket/events'

import { EYEBROW, FIELD, PANEL, PRIMARY, Timestamp } from './controls'

/**
 * The table transcript.
 *
 * Three registers, deliberately distinct because confusing them loses games:
 *
 *   [STATE]   machine. Typed, uppercase, ruled off. Synthesised on the client
 *             from phase transitions — chat never enters game state, so the
 *             server does not send these.
 *   table     what living players said. The default.
 *   dead      what eliminated players said to each other. `chatAudience`
 *             scopes this server-side and emits per socket, so a living player
 *             never receives one; the styling is a second line of defence, not
 *             the mechanism.
 *
 * `onSend` returns nothing and clears the field optimistically. That is safe
 * because chat is not game state — unlike a move, a dropped message costs
 * nobody a round.
 */
export function ChatPanel({
  entries,
  you,
  phaseLabel,
  open,
  deadChannel = false,
  error,
  onSend,
}: {
  entries: ChatEntry[]
  /** Your sessionId, so your own lines can be marked. `null` when observing. */
  you: string | null
  /**
   * The phase name in words, or null before a game starts.
   *
   * A LABEL RATHER THAN A KEY, so this panel serves every game in the room
   * without importing any of their vocabularies.
   */
  phaseLabel: string | null
  /** False whenever `chatAudience` would return `chat-closed`. */
  open: boolean
  /** True once you are eliminated — you are on the `dead` channel from then on. */
  deadChannel?: boolean
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
      className={`${PANEL} flex h-full min-h-[28rem] flex-col`}
      aria-label="Table chat"
    >
      <div className="flex items-baseline justify-between gap-3 border-b-2 border-ink px-4 py-3">
        <h2 className={EYEBROW}>table chat</h2>
        {deadChannel && (
          <p className="border border-rule px-1.5 font-mono text-[0.5625rem] uppercase tracking-wide text-ink-soft">
            dead channel
          </p>
        )}
      </div>

      {/* -------------------------------------------------------- transcript */}
      <div
        role="log"
        aria-live="polite"
        aria-label="Messages"
        className="flex-1 space-y-3 overflow-y-auto px-4 py-4"
      >
        {entries.length === 0 && (
          <p className="font-mono text-[0.75rem] text-ink-soft">
            Nothing said yet.
          </p>
        )}

        {entries.map((entry) =>
          entry.kind === 'system' ? (
            <p
              key={entry.id}
              className="flex items-baseline gap-2 border-t border-rule pt-2 font-mono text-[0.6875rem] uppercase tracking-[0.12em] text-ink-soft"
            >
              <span className="text-ink">[STATE]</span>
              <span className="min-w-0 flex-1">{entry.text}</span>
              <Timestamp at={entry.at} />
            </p>
          ) : (
            <div
              key={entry.id}
              className={
                entry.channel === 'dead'
                  ? 'border-l-4 border-rule bg-paper py-1 pl-3'
                  : ''
              }
            >
              <p className="flex items-baseline gap-2">
                <span
                  className={`min-w-0 truncate font-mono text-[0.6875rem] ${
                    entry.from === you
                      ? 'bg-yellow px-1 text-ink'
                      : 'text-ink-soft'
                  }`}
                >
                  {entry.nickname}
                </span>

                {entry.channel === 'dead' && (
                  <span className="shrink-0 font-mono text-[0.5625rem] uppercase tracking-wide text-ink-soft">
                    dead
                  </span>
                )}

                <Timestamp at={entry.at} className="ml-auto shrink-0" />
              </p>

              <p
                className={`mt-0.5 text-[0.875rem] leading-relaxed ${
                  entry.channel === 'dead' ? 'text-ink-soft' : 'text-ink'
                }`}
              >
                {entry.body}
              </p>
            </div>
          ),
        )}

        <div ref={endRef} />
      </div>

      {/* ------------------------------------------------------------ compose */}
      <form onSubmit={submit} className="border-t-2 border-ink px-4 py-3">
        <div className="flex gap-2">
          <label htmlFor="chat-draft" className="sr-only">
            Message the table
          </label>

          <input
            id="chat-draft"
            value={draft}
            onChange={(event) => setDraft(event.target.value)}
            disabled={!open}
            placeholder={
              open
                ? deadChannel
                  ? 'the other eliminated players can hear you'
                  : phaseLabel
                    ? 'say something'
                    : 'say something while you wait'
                : `chat is closed during ${(phaseLabel ?? 'this phase').toLowerCase()}`
            }
            className={FIELD}
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
