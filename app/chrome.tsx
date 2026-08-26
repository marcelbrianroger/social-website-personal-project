import Link from 'next/link'

import type { AnonymousSession } from '@/lib/session/session'

import { Clocks } from './clocks'
import { IdentityChip } from './identity-chip'

/**
 * Shared site chrome.
 *
 * Header, footer and the two shared blocks live here so the identity cannot
 * drift page to page. All of it is presentational and imports nothing
 * server-only, so client components may use it.
 */

/**
 * THE WIDTH SCALE. Three values, and every route measures from one of them.
 *
 * This used to be a single `SHELL` at 64rem, and it had already lost: the video
 * stage had privately grown a 110rem shell and the game table an 80rem one,
 * because 64rem genuinely cannot hold three live panes. Three widths defined in
 * three files is the drift this module exists to prevent, so they are named
 * here instead and the pages import them.
 *
 * The widening is not a taste call. A mading — the pinned-up wall magazine this
 * whole site is drawn from — is a BOARD, not a column: edge to edge, several
 * things across, read by a crowd standing in front of it. A 64rem strip floating
 * in the middle of a 1600px screen was arguing with its own metaphor.
 */

/** Prose. Long text stays at a readable measure whatever it sits inside. */
export const READING = 'max-w-[68ch]'

/** The standard page. Wide enough to be a board, gutters that hold at 1280. */
export const SHELL = 'mx-auto w-full max-w-[88rem] px-5 sm:px-8 lg:px-10'

/** Full stage: the video grid, and anything that wants the whole wall. */
export const WIDE = 'mx-auto w-full max-w-[110rem] px-3 sm:px-5 lg:px-8'

/**
 * A link, highlighted.
 *
 * Fluorescent pink sits at 2.1:1 on paper and cannot legally carry small text,
 * so links are ink over a yellow fill instead — which is also just what a
 * marker on a noticeboard looks like.
 */
export const MARKED =
  'bg-yellow px-1 text-ink decoration-2 underline-offset-2 hover:underline'

/**
 * The masthead.
 *
 * Three zones on one rule: who this is, where you can go, and who YOU are. The
 * third is new — the name used to live in a card halfway down the home page,
 * which meant it was invisible from every other route and the site never
 * greeted you anywhere else. A social place should say your name back to you on
 * every screen, so it sits in the chrome now.
 */
export function SiteHeader({ session }: { session: AnonymousSession | null }) {
  return (
    <header className="border-b-2 border-ink bg-paper">
      <div
        className={`${SHELL} flex flex-wrap items-center justify-between gap-x-8 gap-y-3 py-3.5`}
      >
        {/* Masthead. The name is long, so it is set as a stacked lockup
            rather than squeezed onto one line. */}
        <Link href="/" className="group shrink-0 leading-none">
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

        {/* Centre zone takes the slack, so the nav sits with the masthead and
            the identity stays pinned to the right edge at every width. */}
        <nav className="order-3 flex items-baseline gap-5 font-mono text-xs sm:order-none sm:flex-1">
          <Link href="/wall" className="hover:bg-yellow">
            wall
          </Link>
          <Link href="/rooms" className="hover:bg-yellow">
            video room
          </Link>
          <Link href="/lobby" className="hover:bg-yellow">
            play
          </Link>
        </nav>

        <div className="flex shrink-0 items-center gap-x-5 gap-y-2">
          <span className="hidden sm:block">
            <Clocks />
          </span>
          <IdentityChip session={session} />
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
        <span>only reachable from Germany · nur aus Deutschland</span>
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
        {connected ? 'connected' : 'dropped'}
      </span>

      {detail && <span>{detail}</span>}

      {nickname && <span className="bg-yellow px-1 text-ink">{nickname}</span>}
    </div>
  )
}
