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
const PRESS = 'border-2 font-mono transition-colors'

/**
 * The two skins, held apart from the register.
 *
 * Split so a control can wear the ink without the second pass. The offset is
 * rationed on purpose — see `reg-flat` in globals.css — and before this the only
 * way to drop it was to stop using these constants and hand-write the whole
 * button again, which is exactly the drift they exist to prevent.
 */
const INK =
  'border-ink bg-ink text-paper hover:bg-pink hover:text-ink disabled:opacity-40 disabled:hover:bg-ink disabled:hover:text-paper'

const PAPER =
  'border-ink bg-paper text-ink hover:bg-yellow disabled:opacity-40 disabled:hover:bg-paper'

/** The dark plate. What the page most wants you to do. */
export const PRESS_INK = `reg ${PRESS} ${INK}`

/** Paper. Everything that is a real choice, but not THE choice. */
export const PRESS_PAPER = `reg ${PRESS} ${PAPER}`

/**
 * Paper, printed in one pass.
 *
 * Identical to `PRESS_PAPER` minus the pink offset, for controls sitting inside
 * something that has already earned the eye — a card with its own border, a
 * panel on the dark plate. Keeps the press; drops the second impression.
 */
export const FLAT_PAPER = `reg-flat ${PRESS} ${PAPER}`

/**
 * The masthead.
 *
 * Three zones on one rule: who this is, where you can go, and who YOU are. The
 * third is new — the name used to live in a card halfway down the home page,
 * which meant it was invisible from every other route and the site never
 * greeted you anywhere else. A social place should say your name back to you on
 * every screen, so it sits in the chrome now.
 */
/** The three doors, in the order the home page argues for them. */
const NAV = [
  { href: '/wall', label: 'wall' },
  { href: '/rooms', label: 'video room' },
  { href: '/lobby', label: 'play' },
] as const

export function SiteHeader({ session }: { session: AnonymousSession | null }) {
  return (
    <header className="border-b-2 border-ink bg-paper">
      <div
        className={`${SHELL} flex flex-wrap items-center justify-between gap-x-8 gap-y-3 py-3.5`}
      >
        {/* Masthead. The name is long, so it is set as a stacked lockup
            rather than squeezed onto one line. */}
        {/* The lockup carries a pin, the same mark every note on the wall
            wears — the one shape this site owns, used as its signature. */}
        <Link
          href="/"
          className="group flex shrink-0 items-center gap-2.5 leading-none"
        >
          <span
            aria-hidden="true"
            className="size-3.5 rounded-full border-2 border-ink bg-pink transition-transform duration-150 group-hover:-rotate-12 group-hover:scale-110"
          />
          <span
            className="block font-display text-[1.1875rem] leading-none tracking-[-0.02em]"
            style={{ fontVariationSettings: "'wght' 800, 'wdth' 90" }}
          >
            Social Aachen
          </span>
        </Link>

        {/* Centre zone takes the slack, so the nav sits with the masthead and
            the identity stays pinned to the right edge at every width. */}
        {/* The highlight is DRAWN under the pointer rather than switched on —
            see `marker-hover`. The px-1 is permanent so the marker has a little
            bleed around the word; putting it on hover instead would shift the
            whole nav sideways every time the pointer crossed it. */}
        <nav className="order-3 -mx-1 flex items-center gap-2 font-mono text-sm sm:order-none sm:flex-1 sm:gap-4">
          {NAV.map((item) => (
            <Link
              key={item.href}
              href={item.href}
              className="marker-hover inline-flex min-h-11 items-center px-1.5"
            >
              {item.label}
            </Link>
          ))}
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
 * The foot of the board.
 *
 * It used to carry a colour bar, registration marks and a colophon naming the
 * typefaces — print furniture that spoke to whoever designed the page rather
 * than to whoever is reading it. What a visitor actually wants at the bottom is
 * the three doors again and the two facts that decide whether they trust the
 * place: where it works, and what it keeps.
 */
export function SiteFooter() {
  return (
    <footer className="mt-auto border-t-2 border-ink bg-ink text-paper">
      <div
        className={`${SHELL} grid gap-x-10 gap-y-8 py-10 sm:grid-cols-[1fr_auto] sm:items-end`}
      >
        <div>
          <p
            className="flex items-center gap-2.5 font-display text-2xl leading-none tracking-[-0.02em]"
            style={{ fontVariationSettings: "'wght' 800, 'wdth' 90" }}
          >
            <span
              aria-hidden="true"
              className="size-3.5 rounded-full border-2 border-paper bg-pink"
            />
            Social Aachen
          </p>
          <p className="mt-4 max-w-[46ch] text-[0.9375rem] leading-relaxed text-paper/85">
            Nothing here is kept: notes come down after 48 hours, tables are
            cleared when the last person leaves, and video never touches the
            server.
          </p>
        </div>

        <nav className="flex flex-wrap gap-x-5 gap-y-1 font-mono text-sm">
          {NAV.map((item) => (
            <Link
              key={item.href}
              href={item.href}
              className="inline-flex min-h-11 items-center underline decoration-paper/40 underline-offset-4 hover:decoration-yellow"
            >
              {item.label}
            </Link>
          ))}
        </nav>

        <p className="border-t border-paper/25 pt-5 font-mono text-xs text-paper/75 sm:col-span-2">
          only reachable from Germany · nur aus Deutschland · hanya dari Jerman
        </p>
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
    <div className="flex flex-wrap items-center gap-x-3 gap-y-1 font-mono text-xs text-ink-soft">
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
