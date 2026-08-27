'use client'

import { useEffect, useRef, useState } from 'react'

import { PRESS_INK } from '@/components/site-chrome'
import { timeLeft } from '@/components/wall-slip'
import {
  MAX_MESSAGE_LENGTH,
  type DuduBroadcast,
  type DuduReply,
} from '@/lib/socket/events'

/**
 * A note taken down off the board and read up close.
 *
 * The board is a grid of slips you take in at a glance, and a thread does not
 * belong on one: replies would stretch a slip past the measure it is drawn to
 * and shove every neighbour down the page. So the note comes off the wall
 * instead. This is the only place a thread is read or written.
 *
 * IT CLOSES ITSELF WHEN THE NOTE EXPIRES. The caller renders this from the live
 * message list, so a note reaching the end of its 48 hours simply stops being
 * found and the panel goes with it — which is the honest behaviour: the paper
 * is gone, and so is everything stapled to it.
 */
export function WallNote({
  note,
  replies,
  replying,
  error,
  onReply,
  onClose,
}: {
  note: DuduBroadcast
  /** Undefined while the thread is still on its way. */
  replies: DuduReply[] | undefined
  replying: boolean
  error: string | null
  onReply: (body: string) => Promise<boolean>
  onClose: () => void
}) {
  const [draft, setDraft] = useState('')
  const composer = useRef<HTMLTextAreaElement>(null)

  const remaining = MAX_MESSAGE_LENGTH - draft.length
  const canReply = !replying && draft.trim().length > 0 && remaining >= 0

  // Escape closes, and the scroll behind is locked: a page quietly scrolling
  // under an open panel is how you lose your place on a board of fifty notes.
  useEffect(() => {
    const onKey = (event: KeyboardEvent) => {
      if (event.key === 'Escape') onClose()
    }

    const restore = document.body.style.overflow
    document.body.style.overflow = 'hidden'
    window.addEventListener('keydown', onKey)

    return () => {
      document.body.style.overflow = restore
      window.removeEventListener('keydown', onKey)
    }
  }, [onClose])

  // The panel exists to be written in, so the cursor starts where the writing
  // happens rather than making everyone tab past the thread to reach it.
  useEffect(() => {
    composer.current?.focus()
  }, [])

  return (
    <div
      onClick={onClose}
      className="fixed inset-0 z-50 flex items-start justify-center overflow-y-auto bg-ink/70 p-4 sm:p-8"
    >
      <div
        role="dialog"
        aria-modal="true"
        aria-label={`Note by ${note.nickname}`}
        // The backdrop closes; the paper must not. Without this, every click
        // inside the panel would also land on the backdrop behind it.
        onClick={(event) => event.stopPropagation()}
        style={{ transformOrigin: 'center' }}
        className="animate-pop-open relative my-auto w-full max-w-xl border-2 border-ink bg-stock px-6 pt-10 pb-6 sm:px-8"
      >
        {/* The same printed pin the slip carries, so this reads as that note. */}
        <span
          aria-hidden="true"
          className="absolute left-[13px] top-[13px] size-2.5 rounded-full bg-pink"
        />

        <button
          type="button"
          onClick={onClose}
          aria-label="Put the note back"
          className="absolute right-3 top-3 px-1 font-mono text-[0.6875rem] text-ink-soft hover:bg-yellow hover:text-ink"
        >
          close
        </button>

        <p className="whitespace-pre-wrap break-words text-[1.1875rem] leading-snug text-ink">
          {note.body}
        </p>

        <div className="mt-5 flex items-baseline justify-between gap-3 border-t border-rule pt-3 font-mono text-[0.6875rem] text-ink-soft">
          <span className="truncate">{note.nickname}</span>
          <span className="shrink-0">{timeLeft(note.expiresAt)}</span>
        </div>

        {/* --- the thread ------------------------------------------------- */}

        {replies === undefined ? (
          <p className="mt-6 font-mono text-xs text-ink-soft">
            Reading the thread…
          </p>
        ) : replies.length === 0 ? (
          <p className="mt-6 font-mono text-xs text-ink-soft">
            Nobody has answered this one yet.
          </p>
        ) : (
          <ul className="mt-6 space-y-4">
            {replies.map((reply) => (
              <li key={reply.id} className="border-l-2 border-rule pl-4">
                <p className="whitespace-pre-wrap break-words text-[0.9375rem] leading-snug text-ink">
                  {reply.body}
                </p>
                <p className="mt-1.5 font-mono text-[0.6875rem] text-ink-soft">
                  {reply.nickname}
                </p>
              </li>
            ))}
          </ul>
        )}

        {/* --- writing one ------------------------------------------------ */}

        <form
          className="mt-6 border-2 border-ink bg-paper p-4"
          onSubmit={async (event) => {
            event.preventDefault()
            if (!canReply) return
            if (await onReply(draft)) setDraft('')
          }}
        >
          <textarea
            ref={composer}
            value={draft}
            onChange={(event) => setDraft(event.target.value)}
            rows={2}
            maxLength={MAX_MESSAGE_LENGTH + 40}
            placeholder="Write a reply…"
            aria-label="Your reply"
            className="w-full resize-none bg-transparent text-[0.9375rem] leading-relaxed text-ink outline-none placeholder:text-ink-soft/70"
          />

          <div className="mt-3 flex items-center justify-between gap-3 border-t border-rule pt-3">
            <span
              className={`font-mono text-[0.6875rem] tabular-nums ${
                remaining < 0 ? 'bg-pink px-1 text-paper' : 'text-ink-soft'
              }`}
            >
              {remaining}
              <span className="sr-only"> characters left</span>
            </span>

            <button
              type="submit"
              disabled={!canReply}
              className={`${PRESS_INK} px-5 py-2 text-xs`}
            >
              {replying ? 'Sending…' : 'Reply'}
            </button>
          </div>
        </form>

        {error && (
          <p className="mt-3 border-2 border-pink px-3 py-2 font-mono text-[0.6875rem] text-ink">
            {error}
          </p>
        )}

        <p className="mt-4 font-mono text-[0.6875rem] leading-relaxed text-ink-soft">
          Replies come down with the note.
        </p>
      </div>
    </div>
  )
}
