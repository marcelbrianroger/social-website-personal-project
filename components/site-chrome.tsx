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
 * A control you can press.
 *
 * OUT OF REGISTER UNTIL YOU COMMIT. `reg` is defined in `globals.css` and was
 * built for the game table: a hard pink offset behind the control, which grows
 * on hover and SNAPS FLUSH when pressed — a second ink pass sliding home.
 *
 * It stayed on the table for exactly as long as nobody noticed it had. Every
 * other route redeclared the same button as colour-only, so the site had one
 * genuinely tactile screen and five flat ones, and pressing anything on the
 * home page produced no acknowledgement at all until the next route painted.
 * These two live here now because the alternative is what was already
 * happening — the same string written out in five files, drifting.
 *
 * PADDING IS DELIBERATELY ABSENT. A hero door and the masthead's save button
 * want very different sizes, and Tailwind resolves conflicting utilities by CSS
 * source order rather than by their order in the string, so `px-6` appended to
 * a constant that already says `px-3` is a coin toss. Each call site sizes
 * itself; only the ink, the border and the press belong to everyone.
 */
const PRESS = 'reg border-2 font-mono transition-colors'

/** The dark plate. What the page most wants you to do. */
export const PRESS_INK = `${PRESS} border-ink bg-ink text-paper hover:bg-pink hover:text-ink disabled:opacity-40 disabled:hover:bg-ink disabled:hover:text-paper`

/** Paper. Everything that is a real choice, but not THE choice. */
export const PRESS_PAPER = `${PRESS} border-ink bg-paper text-ink hover:bg-yellow disabled:opacity-40 disabled:hover:bg-paper`

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
        {/* The highlight is DRAWN under the pointer rather than switched on —
            see `marker-hover`. The px-1 is permanent so the marker has a little
            bleed around the word; putting it on hover instead would shift the
            whole nav sideways every time the pointer crossed it. */}
        <nav className="order-3 flex items-baseline gap-5 font-mono text-xs sm:order-none sm:flex-1">
          <Link href="/wall" className="marker-hover px-1">
            wall
          </Link>
          <Link href="/rooms" className="marker-hover px-1">
            video room
          </Link>
          <Link href="/lobby" className="marker-hover px-1">
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

/**
 * The inks this site is printed in, in the order the stylesheet declares them.
 *
 * This is the colour bar a real print job carries out in the trim area so the
 * operator can see, at a glance, that every plate is inking correctly. Here it
 * does the same job for a different reader: it says the palette was SPECIFIED —
 * five inks, chosen, not a theme's defaults — to someone who would never think
 * to open a stylesheet.
 */
const INKS = [
  { name: 'paper', swatch: 'bg-paper' },
  { name: 'stock', swatch: 'bg-stock' },
  { name: 'ink', swatch: 'bg-ink' },
  { name: 'pink', swatch: 'bg-pink' },
  { name: 'yellow', swatch: 'bg-yellow' },
] as const

/**
 * A registration target — the crosshair-in-a-circle printed outside the trim so
 * the plates can be lined up against each other. It is the single most legible
 * mark in all of printing: nobody needs it explained, and nothing else looks
 * remotely like it.
 */
function RegistrationMark() {
  return (
    <svg
      width="15"
      height="15"
      viewBox="0 0 16 16"
      fill="none"
      stroke="currentColor"
      strokeWidth="1"
      className="shrink-0 text-ink-soft"
    >
      <circle cx="8" cy="8" r="4.5" />
      <path d="M8 0v16M0 8h16" />
    </svg>
  )
}

/**
 * The trim edge.
 *
 * Everything in the top row is print furniture: marks that belong to the SHEET
 * rather than to the message, and which a printer would guillotine off. Keeping
 * them is the joke and the point — this is a printed object that never gets
 * trimmed, so its furniture stays visible.
 *
 * All of it is `aria-hidden`. A screen reader announcing "paper stock ink pink
 * yellow" is noise; the marks carry their meaning entirely by looking like
 * themselves.
 */
export function SiteFooter() {
  return (
    <footer className="mt-auto border-t-2 border-ink">
      <div className={`${SHELL} py-6`}>
        <div
          aria-hidden="true"
          className="flex items-center gap-x-5 gap-y-3 border-b border-rule pb-4"
        >
          <RegistrationMark />

          <ul className="flex items-end gap-2">
            {INKS.map((ink) => (
              <li key={ink.name} className="flex flex-col items-center gap-1.5">
                <span
                  className={`block size-3.5 border border-rule ${ink.swatch}`}
                />
                <span className="font-mono text-[0.5rem] lowercase tracking-wide text-ink-soft">
                  {ink.name}
                </span>
              </li>
            ))}
          </ul>

          <span className="ml-auto hidden font-mono text-[0.5625rem] uppercase tracking-[0.3em] text-ink-soft sm:block">
            five inks · one sheet
          </span>

          <RegistrationMark />
        </div>

        {/*
          The colophon — the note at the back of a book saying how it was made.
          Every claim in it is checkable, and the favicon caveat is not padding:
          the first draft said "no image files at all", which `app/favicon.ico`
          makes false on every single page load. A colophon that overstates is
          worse than no colophon, because the whole reason it earns any trust is
          that a reader could go and check it.
        */}
        <p className="mt-4 max-w-[64ch] font-mono text-[0.6875rem] leading-relaxed text-ink-soft">
          Set in Bricolage Grotesque, Karla and Courier Prime. The paper grain
          and the halftone are drawn in CSS rather than photographed — apart
          from the favicon, this page loads no images.
        </p>

        <div className="mt-4 flex flex-wrap items-baseline justify-between gap-3 font-mono text-[0.6875rem] text-ink-soft">
          <span>social aachen website</span>
          <span>only reachable from Germany · nur aus Deutschland</span>
        </div>
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
        {/* Breathing only while connected. A dropped connection must read as
            STOPPED — an indicator that keeps moving after the socket has gone
            is worse than no indicator at all. */}
        <span
          aria-hidden="true"
          className={`size-2 rounded-full ${
            connected ? 'animate-breathe bg-pink' : 'border border-ink-soft'
          }`}
        />
        {connected ? 'connected' : 'dropped'}
      </span>

      {detail && <span>{detail}</span>}

      {nickname && <span className="bg-yellow px-1 text-ink">{nickname}</span>}
    </div>
  )
}
