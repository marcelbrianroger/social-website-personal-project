'use client'

import Link from 'next/link'
import { useState } from 'react'

import { MARKED, SystemNote } from '@/components/site-chrome'
import { WallNote } from '@/components/wall-note'
import { BOARD, WallSlip } from '@/components/wall-slip'
import { useWall } from '@/lib/wall/use-wall'

/**
 * The board on the home page — the real one.
 *
 * This used to be a written-out mock-up, which made the most prominent thing on
 * the site the only thing on it that was not true. It now holds the same
 * messages /wall holds: the same socket, the same history, the same 48 hours.
 * If nobody has posted, the home page says so rather than inventing company.
 *
 * WHY THE NEWEST, NOT THE OLDEST: the server hands back the newest first, and a
 * new note pins itself up here the moment it is written anywhere. That live
 * arrival is the argument for the wall; a queue of notes about to expire would
 * just sit still.
 *
 * COST: every visit to the home page now opens a socket, where before only
 * /wall did. That is the price of the page being true.
 */

/** One full board — three across, two down — and no more. */
const VISIBLE = 6

export function LiveWall() {
  const {
    messages,
    connected,
    error,
    threads,
    replying,
    reply,
    loadReplies,
    clearError,
  } = useWall()

  /**
   * Which note is off the wall, by id — same reasoning as /wall: held by value
   * it would stop receiving replies and outlive its own expiry.
   */
  const [openId, setOpenId] = useState<string | null>(null)
  const openNote = messages.find((message) => message.id === openId) ?? null

  /**
   * Anything written after this moment went up while the visitor was watching,
   * so it swings in on its pin instead of just appearing.
   *
   * A note's timestamp is written by the socket server and this one by the
   * browser, so a few seconds of clock skew can misjudge it either way. Both
   * misjudgements cost exactly one animation, which is why this is not worth a
   * round trip to settle.
   *
   * State rather than a ref: it is read while rendering, and a ref read during
   * render is the one thing the compiler cannot reason about.
   */
  const [openedAt] = useState(() => Date.now())

  const visible = messages.slice(0, VISIBLE)
  const hidden = messages.length - visible.length
  const wentUp = messages.filter(
    (message) => new Date(message.createdAt).getTime() > openedAt,
  ).length

  // Only when there is nothing to show. A dropped connection raises an error on
  // every reconnect attempt, and blanking a board full of notes over a blip
  // would lose more than the message explains — the status dot covers that.
  if (visible.length === 0) {
    if (error) return <SystemNote>{error}</SystemNote>

    return (
      <div className="border-2 border-dashed border-rule px-5 py-14 text-center">
        <p className="text-ink-soft">
          {connected ? 'Nothing is up there right now.' : 'Reaching the wall…'}
        </p>

        {connected && (
          <Link href="/wall" className={`${MARKED} mt-5 inline-block py-0.5`}>
            pin up the first one
          </Link>
        )}
      </div>
    )
  }

  return (
    <div>
      {/* Padding so rotated corners and nudged slips never clip. */}
      <ul className={BOARD}>
        {visible.map((message, slot) => (
          <WallSlip
            key={message.id}
            message={message}
            slot={slot}
            arriving={new Date(message.createdAt).getTime() > openedAt}
            onOpen={() => {
              setOpenId(message.id)
              loadReplies(message.id)
              clearError()
            }}
          />
        ))}
      </ul>

      <div className="mt-6 flex flex-wrap items-baseline justify-between gap-x-6 gap-y-3 font-mono text-xs">
        <p className="text-ink-soft">
          <span className="inline-flex items-center gap-1.5">
            <span
              aria-hidden="true"
              className={`size-2 rounded-full ${
                connected ? 'animate-breathe bg-pink' : 'border border-ink-soft'
              }`}
            />
            {connected ? 'live' : 'reconnecting'}
          </span>
          {wentUp > 0 && (
            <>
              {' · '}
              <span className="bg-pink px-1.5 text-paper tabular-nums">
                {String(wentUp).padStart(2, '0')}
              </span>{' '}
              went up since you opened this page
            </>
          )}
        </p>

        <Link href="/wall" className="hover:bg-yellow">
          {hidden > 0
            ? `${hidden} more on the wall →`
            : 'open the wall and write one →'}
        </Link>
      </div>

      {openNote && (
        <WallNote
          note={openNote}
          replies={threads[openNote.id]}
          replying={replying}
          error={error}
          onReply={(body) => reply(openNote.id, body)}
          onClose={() => setOpenId(null)}
        />
      )}
    </div>
  )
}
