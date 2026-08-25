'use client'

import { useState } from 'react'
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
 * The visitor's name, as a printed label they can overwrite.
 *
 * The card was already the one piece of real data on the page; it now also owns
 * the only thing about an identity here that is anyone's to decide. Everything
 * else — the UUID, the 30 days, the cookie — is not up for negotiation, so this
 * stays a small label with a pen through it rather than a settings screen.
 *
 * The rename is a cookie swap on the server (`/api/session/nickname`), which is
 * why the whole thing is one fetch and a `router.refresh()`: there is no user
 * row anywhere to keep in step.
 */
export function NameCard({ session }: { session: AnonymousSession | null }) {
  const router = useRouter()

  const [nickname, setNickname] = useState(session?.nickname ?? '')
  const [editing, setEditing] = useState(false)
  const [draft, setDraft] = useState('')
  const [error, setError] = useState<string | null>(null)
  const [saving, setSaving] = useState(false)
  const [renamed, setRenamed] = useState(false)

  const shell = 'max-w-sm border-2 border-ink bg-stock px-5 py-4 md:w-72'
  const label =
    'font-mono text-[0.6875rem] lowercase tracking-wide text-ink-soft'

  if (!session) {
    return (
      <div className={shell}>
        <p className={label}>your name here</p>
        <p
          className="mt-1.5 font-display text-2xl leading-none"
          style={{ fontVariationSettings: "'wght' 800, 'wdth' 95" }}
        >
          not issued yet
        </p>
        <p className="mt-3 max-w-xs text-[0.8125rem] leading-relaxed text-ink-soft">
          The proxy does not run on this path, so there is no name yet. Check{' '}
          <code className="font-mono">matcher</code> in{' '}
          <code className="font-mono">proxy.ts</code>.
        </p>
      </div>
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

  function startEditing() {
    setDraft(nickname)
    setError(null)
    setRenamed(false)
    setEditing(true)
  }

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
      setEditing(false)
      setRenamed(true)

      // The name is rendered by a Server Component from a header proxy.ts sets
      // off the cookie, so the page has to be asked again to agree with itself.
      router.refresh()
    } catch {
      setError('Could not reach the server. Try again.')
    } finally {
      setSaving(false)
    }
  }

  if (editing) {
    return (
      <form
        className={shell}
        onSubmit={(event) => {
          event.preventDefault()
          if (canSave) void save()
        }}
      >
        <label className={`${label} block`} htmlFor="nickname">
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
          onKeyDown={(event) => {
            if (event.key === 'Escape') setEditing(false)
          }}
          disabled={saving}
          // Past the limit on purpose, so going over is something the counter
          // explains rather than something the field silently prevents.
          maxLength={NICKNAME_MAX_LENGTH + 16}
          autoComplete="off"
          spellCheck={false}
          className="mt-2 w-full border-2 border-ink bg-paper px-2 py-1.5 font-display text-lg leading-tight text-ink outline-none disabled:opacity-50"
          style={{ fontVariationSettings: "'wght' 700, 'wdth' 95" }}
        />

        <p className="mt-2 font-mono text-[0.6875rem] leading-relaxed text-ink-soft">
          {NICKNAME_MAX_LENGTH} at most — a slip truncates anything longer.
        </p>

        <div className="mt-3 flex items-center justify-between gap-2">
          <span
            className={`font-mono text-[0.6875rem] tabular-nums ${
              remaining < 0 ? 'bg-pink px-1 text-paper' : 'text-ink-soft'
            }`}
          >
            {remaining}
            <span className="sr-only"> characters left</span>
          </span>

          <div className="flex gap-2">
            <button
              type="button"
              onClick={() => setEditing(false)}
              className="border-2 border-ink px-3 py-1.5 font-mono text-xs text-ink transition-colors hover:bg-yellow"
            >
              cancel
            </button>
            <button
              type="submit"
              disabled={!canSave}
              className="border-2 border-ink bg-ink px-3 py-1.5 font-mono text-xs text-paper transition-colors hover:bg-pink hover:text-ink disabled:opacity-40 disabled:hover:bg-ink disabled:hover:text-paper"
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
    )
  }

  return (
    <div className={shell}>
      <p className={label}>your name here</p>

      <p
        className="mt-1.5 break-words font-display text-2xl leading-none"
        style={{ fontVariationSettings: "'wght' 800, 'wdth' 95" }}
      >
        {nickname}
      </p>

      <p className="mt-3 max-w-xs text-[0.8125rem] leading-relaxed text-ink-soft">
        {/* Only the first clause moves. Whether the site issued the name or the
            visitor chose it is exactly what `looksGenerated` can answer without
            storing anything, and the rest is true either way. */}
        {looksGenerated(nickname)
          ? 'This is the name the site issued to you.'
          : 'This is the name you chose.'}{' '}
        It is printed on every slip you pin up, beside a countdown, inside a box
        roughly one newspaper column wide.
      </p>

      {renamed && (
        <p className="mt-3 font-mono text-[0.6875rem] leading-relaxed text-ink-soft">
          Notes already on the wall keep the name you wrote them under.
        </p>
      )}

      <button
        type="button"
        onClick={startEditing}
        className="mt-4 border-2 border-ink px-3 py-1.5 font-mono text-xs text-ink transition-colors hover:bg-yellow"
      >
        change it
      </button>
    </div>
  )
}
