import Link from 'next/link'

import { Clocks } from './clocks'

/**
 * Shared site chrome.
 *
 * Header, footer and the two shared blocks live here so the identity cannot
 * drift page to page. All of it is presentational and imports nothing
 * server-only, so client components may use it.
 */

/** Page shell width. Every route measures from the same gutter. */
export const SHELL = 'mx-auto w-full max-w-5xl px-5 sm:px-8'

/**
 * A link, highlighted.
 *
 * Fluorescent pink sits at 2.1:1 on paper and cannot legally carry small text,
 * so links are ink over a yellow fill instead — which is also just what a
 * marker on a noticeboard looks like.
 */
export const MARKED =
  'bg-yellow px-1 text-ink decoration-2 underline-offset-2 hover:underline'

export function SiteHeader() {
  return (
    <header className="border-b-2 border-ink">
      <div
        className={`${SHELL} flex flex-wrap items-end justify-between gap-x-6 gap-y-3 py-4`}
      >
        {/* Masthead. The name is long, so it is set as a stacked lockup
            rather than squeezed onto one line. */}
        <Link href="/" className="group leading-none">
          <span
            className="block font-display text-[1.0625rem] leading-none tracking-[-0.02em] group-hover:text-pink"
            style={{ fontVariationSettings: "'wght' 800, 'wdth' 90" }}
          >
            SOCIAL AACHEN
          </span>
          <span className="mt-1 block font-mono text-[0.625rem] uppercase tracking-[0.34em] text-ink-soft">
            website
          </span>
        </Link>

        <div className="flex flex-wrap items-end gap-x-5 gap-y-2">
          <nav className="flex items-baseline gap-4 font-mono text-xs">
            <Link href="/wall" className="hover:bg-yellow">
              mading
            </Link>
            <Link href="/rooms" className="hover:bg-yellow">
              ruang
            </Link>
          </nav>

          <Clocks />
        </div>
      </div>
    </header>
  )
}

export function SiteFooter() {
  return (
    <footer className="mt-auto border-t-2 border-ink">
      <div
        className={`${SHELL} flex flex-wrap items-baseline justify-between gap-3 py-6 font-mono text-[0.6875rem] text-ink-soft`}
      >
        <span>social aachen website</span>
        <span>cuma bisa dibuka dari Jerman · nur aus Deutschland</span>
      </div>
    </footer>
  )
}

/**
 * Something went wrong, or the system has something to say.
 *
 * Set as a typed notice with a fat pink rule down the side — the print
 * equivalent of a stamp. No new colour, and no apology in the wording.
 */
export function SystemNote({
  children,
  alert = false,
  className = '',
}: {
  children: React.ReactNode
  /** Announce to assistive tech. Use for anything the user did not expect. */
  alert?: boolean
  className?: string
}) {
  return (
    <p
      {...(alert ? { role: 'alert' as const } : {})}
      className={`border-l-4 border-pink bg-stock px-4 py-3 font-mono text-[0.8125rem] leading-relaxed text-ink ${className}`}
    >
      {children}
    </p>
  )
}

/** Live connection state, typed out like a status line. */
export function ConnectionStatus({
  connected,
  nickname,
  detail,
}: {
  connected: boolean
  nickname: string | null
  detail?: string
}) {
  return (
    <div className="flex flex-wrap items-center gap-x-3 gap-y-1 font-mono text-[0.6875rem] text-ink-soft">
      <span className="flex items-center gap-1.5">
        <span
          aria-hidden="true"
          className={`size-2 rounded-full ${connected ? 'bg-pink' : 'border border-ink-soft'}`}
        />
        {connected ? 'nyambung' : 'putus'}
      </span>

      {detail && <span>{detail}</span>}

      {nickname && <span className="bg-yellow px-1 text-ink">{nickname}</span>}
    </div>
  )
}
