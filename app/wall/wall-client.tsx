'use client'

import { useState } from 'react'

import { useDuduWall } from '@/lib/dudu/use-dudu-wall'
import { MAX_MESSAGE_LENGTH } from '@/lib/socket/events'

/** "in 23h", "in 41m", "in 30s" — how long until this post disappears. */
function timeLeft(expiresAt: string): string {
  const remaining = new Date(expiresAt).getTime() - Date.now()
  if (remaining <= 0) return 'gone'

  const hours = Math.floor(remaining / 3_600_000)
  if (hours >= 1) return `${hours}h left`

  const minutes = Math.floor(remaining / 60_000)
  if (minutes >= 1) return `${minutes}m left`

  return `${Math.floor(remaining / 1000)}s left`
}

export function WallClient() {
  const { messages, session, connected, error, posting, post, clearError } = useDuduWall()
  const [draft, setDraft] = useState('')

  const remaining = MAX_MESSAGE_LENGTH - draft.length
  const canPost = connected && !posting && draft.trim().length > 0 && remaining >= 0

  return (
    <div className="mx-auto w-full max-w-2xl px-6 py-12">
      <header className="flex flex-wrap items-baseline justify-between gap-3">
        <div>
          <p className="font-mono text-xs uppercase tracking-[0.2em] text-zinc-500">
            DUDU · Wall
          </p>
          <h1 className="mt-2 text-2xl font-semibold tracking-tight text-black dark:text-zinc-50">
            Everything here disappears in 24 hours
          </h1>
        </div>

        <div className="text-right text-xs">
          <div className={connected ? 'text-emerald-600 dark:text-emerald-400' : 'text-zinc-500'}>
            {connected ? 'connected' : 'offline'}
          </div>
          <div className="font-mono text-zinc-500">{session?.nickname ?? '…'}</div>
        </div>
      </header>

      <form
        className="mt-8"
        onSubmit={async (event) => {
          event.preventDefault()
          if (!canPost) return
          if (await post(draft)) setDraft('')
        }}
      >
        <textarea
          value={draft}
          onChange={(event) => {
            setDraft(event.target.value)
            if (error) clearError()
          }}
          disabled={!connected}
          rows={3}
          maxLength={MAX_MESSAGE_LENGTH + 40}
          placeholder="Say something to everyone online…"
          aria-label="Your message"
          className="w-full resize-none rounded-xl border border-black/15 bg-white px-4 py-3 text-sm outline-none placeholder:text-zinc-400 focus:border-emerald-500 disabled:opacity-50 dark:border-white/15 dark:bg-zinc-900 dark:text-zinc-100"
        />

        <div className="mt-2 flex items-center justify-between gap-3">
          <span
            className={`font-mono text-xs ${
              remaining < 0 ? 'text-red-500' : 'text-zinc-500'
            }`}
          >
            {remaining}
          </span>

          <button
            type="submit"
            disabled={!canPost}
            className="rounded-lg bg-emerald-600 px-4 py-2 text-sm font-medium text-white hover:bg-emerald-500 disabled:opacity-40"
          >
            {posting ? 'Posting…' : 'Post'}
          </button>
        </div>
      </form>

      {error && (
        <p
          role="alert"
          className="mt-3 rounded-lg border border-red-500/30 bg-red-500/10 px-4 py-3 text-sm text-red-700 dark:text-red-300"
        >
          {error}
        </p>
      )}

      <ul className="mt-8 space-y-3">
        {messages.length === 0 && (
          <li className="rounded-xl border border-dashed border-black/15 px-4 py-10 text-center text-sm text-zinc-500 dark:border-white/15">
            The wall is empty. Be the first.
          </li>
        )}

        {messages.map((message) => (
          <li
            key={message.id}
            className="rounded-xl border border-black/10 bg-white px-4 py-3 dark:border-white/10 dark:bg-zinc-900"
          >
            <div className="flex items-baseline justify-between gap-3">
              <span className="font-mono text-xs text-emerald-600 dark:text-emerald-400">
                {message.nickname}
              </span>
              <span className="shrink-0 font-mono text-[11px] text-zinc-500">
                {timeLeft(message.expiresAt)}
              </span>
            </div>
            <p className="mt-1.5 whitespace-pre-wrap break-words text-sm text-black dark:text-zinc-100">
              {message.body}
            </p>
          </li>
        ))}
      </ul>

      <p className="mt-10 text-sm leading-6 text-zinc-500">
        Posts pass a moderation filter before they appear. Links are not allowed,
        and there is a limit of five posts per minute.
      </p>
    </div>
  )
}
