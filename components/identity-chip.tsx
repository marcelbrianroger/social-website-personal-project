'use client'

import { useEffect, useRef, useState } from 'react'
import { useRouter } from 'next/navigation'

import {
  NICKNAME_ERROR_TEXT,
  NICKNAME_MAX_LENGTH,
  NICKNAME_MIN_LENGTH,
  looksGenerated,
  normalizeNickname,
  type NicknameRejection,
} from '@/lib/session/nickname'
import type { AnonymousSession } from '@/lib/session/session'

/**
 * Your name, in the masthead, as a printed label you can overwrite.
 *
 * MOVED OUT OF THE HOME PAGE. It used to be a column-wide card in the hero,
 * which meant the only place the site ever said your name was the one screen
 * you leave first. Everywhere else you were anonymous to yourself. A place
 * people are meant to hang around in should know you on every route, so the
 * label lives in the chrome and the home page got its width back.
 *
 * SHRUNK, NOT SIMPLIFIED. The rename is still the full thing — the counter, the
 * server's own refusal wording, the note that old slips keep their old name —
 * because that was never decoration. It just happens in a panel under the chip
 * instead of taking a fifth of the front page.
 *
 * The rename is a cookie swap on the server (`/api/session/nickname`), which is
 * why saving is one fetch and a `router.refresh()`: there is no user row
 * anywhere to keep in step.
 */
export function IdentityChip({ session }: { session: AnonymousSession | null }) {
  const router = useRouter()

  const [nickname, setNickname] = useState(session?.nickname ?? '')
  const [open, setOpen] = useState(false)
  const [draft, setDraft] = useState('')
  const [error, setError] = useState<string | null>(null)
  const [saving, setSaving] = useState(false)
  const [renamed, setRenamed] = useState(false)

  const panel = useRef<HTMLDivElement>(null)

  /**
   * Close on Escape or a click elsewhere.
   *
   * `pointerdown` rather than `click`, so pressing the trigger again closes the
   * panel instead of the outside handler shutting it and the button reopening
   * it in the same gesture.
   */
  useEffect(() => {
    if (!open) return

    function onKey(event: KeyboardEvent) {
      if (event.key === 'Escape') setOpen(false)
    }

    function onDown(event: PointerEvent) {
      if (!panel.current?.contains(event.target as Node)) setOpen(false)
    }

    document.addEventListener('keydown', onKey)
    document.addEventListener('pointerdown', onDown)

    return () => {
      document.removeEventListener('keydown', onKey)
      document.removeEventListener('pointerdown', onDown)
    }
  }, [open])

  if (!session) {
    return (
      <span className="font-mono text-[0.6875rem] text-ink-soft">
        no name yet
      </span>
    )
  }

  /**
   * Counted after tidying, because that is the string that gets stored. Typing
   * is left alone though — rewriting the field under someone's cursor to strip
   * a space they are still typing past is its own small hell.
   */
  const cleaned = normalizeNickname(draft)
  const remaining = NICKNAME_MAX_LENGTH - cleaned.length
  const canSave =
    !saving &&
    cleaned.length >= NICKNAME_MIN_LENGTH &&
    remaining >= 0 &&
    cleaned !== nickname

  async function save() {
    setSaving(true)
    setError(null)

    try {
      const response = await fetch('/api/session/nickname', {
        method: 'POST',
        headers: { 'content-type': 'application/json' },
        credentials: 'same-origin',
        body: JSON.stringify({ nickname: cleaned }),
      })

      const body = (await response.json().catch(() => null)) as {
        nickname?: string
        error?: string
      } | null

      if (!response.ok || !body?.nickname) {
        // The server's reason, in the server's words — never the raw status.
        setError(
          NICKNAME_ERROR_TEXT[body?.error as NicknameRejection] ??
            'That name could not be saved. Try again.',
        )
        return
      }

      setNickname(body.nickname)
      setRenamed(true)
      setOpen(false)

      // The name is rendered by a Server Component from a header proxy.ts sets
      // off the cookie, so the page has to be asked again to agree with itself.
      router.refresh()
    } catch {
      setError('Could not reach the server. Try again.')
    } finally {
      setSaving(false)
    }
  }

  return (
    <div ref={panel} className="relative">
      <button
        type="button"
        aria-expanded={open}
        aria-haspopup="dialog"
        onClick={() => {
          setDraft(nickname)
          setError(null)
          setRenamed(false)
          setOpen((was) => !was)
        }}
        // `reg-flat` rather than the shared constants: site-chrome imports THIS
        // file, so importing back would close a cycle. The class in globals.css
        // is the shared thing; those constants are a convenience for files that
        // do not already spell their own button out.
        //
        // FLAT, because this one is on every screen. The offset is rationed for
        // things worth looking at, and a permanent pink block in the masthead
        // spends that ration on a name label — on every route, forever, beside
        // two clocks. It keeps the press and loses the second pass.
        className="reg-flat flex max-w-[9.5rem] items-baseline gap-1.5 border-2 border-ink bg-yellow px-2 py-1 text-ink transition-colors hover:bg-pink sm:max-w-[13rem]"
      >
        <span
          className="min-w-0 truncate font-display text-[0.8125rem] leading-none"
          style={{ fontVariationSettings: "'wght' 800, 'wdth' 95" }}
        >
          {nickname}
        </span>
        <span
          aria-hidden="true"
          className="shrink-0 font-mono text-[0.5625rem] uppercase tracking-wide"
        >
          edit
        </span>
        <span className="sr-only">— change your name</span>
      </button>

      {open && (
        <div
          role="dialog"
          aria-label="Your name"
          // Right-anchored: the chip sits at the page edge, so a
          // left-anchored panel would hang off the viewport on mobile. The
          // entry scales from that same top-right corner — see `pop-open` in
          // globals.css — so the panel visibly belongs to the chip above it.
          className="animate-pop-open absolute right-0 z-40 mt-2 w-[17rem] border-2 border-ink bg-stock p-4"
        >
          <form
            onSubmit={(event) => {
              event.preventDefault()
              if (canSave) void save()
            }}
          >
            <label
              htmlFor="nickname"
              className="block font-mono text-[0.6875rem] lowercase tracking-wide text-ink-soft"
            >
              your name here
            </label>

            <input
              id="nickname"
              autoFocus
              value={draft}
              onChange={(event) => {
                setDraft(event.target.value)
                if (error) setError(null)
              }}
              disabled={saving}
              // Past the limit on purpose, so going over is something the
              // counter explains rather than something the field prevents.
              maxLength={NICKNAME_MAX_LENGTH + 16}
              autoComplete="off"
              spellCheck={false}
              className="mt-2 w-full border-2 border-ink bg-paper px-2 py-1.5 font-display text-base leading-tight text-ink outline-none disabled:opacity-50"
              style={{ fontVariationSettings: "'wght' 700, 'wdth' 95" }}
            />

            <p className="mt-2 font-mono text-[0.625rem] leading-relaxed text-ink-soft">
              {looksGenerated(nickname)
                ? 'The site issued this one. It is yours to overwrite.'
                : 'You chose this one.'}{' '}
              It is printed on every slip you pin up.
            </p>

            <div className="mt-3 flex items-center justify-between gap-2">
              <span
                className={`font-mono text-[0.625rem] tabular-nums ${
                  remaining < 0 ? 'bg-pink px-1 text-paper' : 'text-ink-soft'
                }`}
              >
                {remaining}
                <span className="sr-only"> characters left</span>
              </span>

              <div className="flex gap-2">
                <button
                  type="button"
                  onClick={() => setOpen(false)}
                  className="reg border-2 border-ink bg-paper px-3 py-1.5 font-mono text-xs text-ink transition-colors hover:bg-yellow"
                >
                  cancel
                </button>
                <button
                  type="submit"
                  disabled={!canSave}
                  className="reg border-2 border-ink bg-ink px-3 py-1.5 font-mono text-xs text-paper transition-colors hover:bg-pink hover:text-ink disabled:opacity-40 disabled:hover:bg-ink disabled:hover:text-paper"
                >
                  {saving ? 'saving…' : 'save'}
                </button>
              </div>
            </div>

            {error && (
              <p
                role="alert"
                className="mt-3 border-l-4 border-pink bg-paper px-3 py-2 font-mono text-[0.6875rem] leading-relaxed text-ink"
              >
                {error}
              </p>
            )}
          </form>
        </div>
      )}

      {/* Announced after the panel shuts, because the consequence outlives the
          edit: notes already on the wall keep the name they were written
          under, and nothing on screen would otherwise say so. */}
      {renamed && (
        <p className="sr-only" role="status">
          Name changed. Notes already on the wall keep the name you wrote them
          under.
        </p>
      )}
    </div>
  )
}
