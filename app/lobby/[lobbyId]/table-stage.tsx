'use client'

import type { TableSeat, TableSummary } from '@/lib/game/table-view'
import { toSeconds, useServerNow } from '@/lib/game/use-countdown'

import { DISPLAY_HEADING } from './controls'
import { PhaseDial } from './phase-dial'

/**
 * The table itself: chairs round the rim, a clock in the middle, and the board
 * as the thing you point at.
 *
 * WHY THIS REPLACED THE RAIL. The room used to draw its players as a list down
 * the left-hand side while every choice — vote, eat, read, cover, poison — was
 * made in a separate panel on the right. That works, and it reads as a form. A
 * social deduction game is played by pointing at a person, so the seats are the
 * control now: roster and picker are one object, and the rule for the whole
 * room is POINT AT PEOPLE ON THE BOARD, PRESS THINGS IN YOUR HAND.
 *
 * STILL GAME-AGNOSTIC. It reads `TableSummary`, which both Mr. White and
 * Werewolf project themselves down to, plus a `SeatTargeting` descriptor saying
 * which seats are live right now and what happens when one is clicked. The
 * board never learns which game built it — see `lib/game/table-view.ts`.
 *
 * NOTHING HERE DECIDES LEGALITY. `blockedFor` greys a seat and says why, which
 * is a hint to a player and not enforcement; the server validates every intent
 * regardless, exactly as it does for the panels.
 *
 * YOU SIT AT THE BOTTOM. Chairs are rotated so your own is always at six
 * o'clock, the way you are always at the near edge of a real table. Seat
 * NUMBERS survive that rotation untouched and are still shown, because several
 * phases walk the table in join order and reading who acts next depends on it.
 */

export interface SeatTargeting {
  /** What the board is asking for, in words. Labels the seat list. */
  label: string
  /** Session ids that are live targets. Everything else is just a seat. */
  targets: readonly string[]
  /** Your current pick, or picks — Cupid commits two at once. */
  chosen: readonly string[]
  /** Why this seat cannot be picked, in two words, or null when it can. */
  blockedFor: (sessionId: string) => string | null
  onPick: (sessionId: string) => void
}

/** Ellipse the chairs sit on, as a percentage of the board box. */
const SEAT_RX = 39
const SEAT_RY = 38

/**
 * The table top: a regular octagon, rotated so its edges are flat at the top,
 * bottom and sides rather than standing on a point.
 *
 * Drawn small enough that the chairs straddle its rim, which is what makes them
 * read as people sitting AT it rather than as counters lying ON it.
 */
const TABLE_R = 34

const OCTAGON = Array.from({ length: 8 }, (_, corner) => {
  const angle = Math.PI / 8 + (corner * Math.PI) / 4
  const x = 50 + TABLE_R * Math.cos(angle)
  const y = 50 + TABLE_R * Math.sin(angle)

  return `${x.toFixed(2)},${y.toFixed(2)}`
}).join(' ')

/** Where chair `index` of `total` sits. Index 0 is bottom-centre, then clockwise. */
function chairAt(index: number, total: number) {
  const angle = Math.PI / 2 + (index * 2 * Math.PI) / total

  return {
    left: `${(50 + SEAT_RX * Math.cos(angle)).toFixed(3)}%`,
    top: `${(50 + SEAT_RY * Math.sin(angle)).toFixed(3)}%`,
  }
}

export function TableStage({
  summary,
  you,
  capacity,
  started,
  targeting = null,
}: {
  summary: TableSummary
  /** Your sessionId, so your chair goes to the near edge. Null while connecting. */
  you: string | null
  /** `LOBBY_CAPACITY` — how many chairs to draw before the deal. */
  capacity: number
  /** False while the lobby is still filling: empty chairs, and no clock. */
  started: boolean
  targeting?: SeatTargeting | null
}) {
  const { seats } = summary

  // One interval for the whole board. The phase clock and every reconnect
  // window are measured against the same server clock, so they share it rather
  // than opening a timer per seat.
  const dropped = seats.some((seat) => seat.droppedUntil !== null)
  const now = useServerNow(
    summary.serverNow,
    summary.phaseEndsAt !== null || dropped,
  )

  const remainingMs =
    summary.phaseEndsAt === null ? null : Math.max(0, summary.phaseEndsAt - now)
  const seconds = toSeconds(remainingMs)

  /**
   * Fraction of the phase still to run, or null when nothing is being timed.
   * Drives the rim; the digits in the dial are the accessible copy.
   */
  const left =
    seconds !== null && summary.phaseSeconds
      ? Math.min(1, Math.max(0, seconds / summary.phaseSeconds))
      : null

  const ordered = rotateToYou(seats, you)
  const chairs = started ? ordered.length : Math.max(ordered.length, capacity)

  /**
   * Whether one seat alone holds the floor.
   *
   * During a vote every living player is an actor, and eight cards all knocking
   * for attention says nothing at all. One is a signal.
   */
  const actors = seats.filter((seat) => seat.actor)
  const soleActor = actors.length === 1 ? actors[0]!.sessionId : null

  return (
    <section
      className="table-board relative lg:aspect-[6/5]"
      aria-label="The table"
    >
      {/* ------------------------------------------------------ the table top */}
      {/* Decorative twice over: the shape is furniture, and the depleting rim
          only restates the countdown the dial reads out in digits. */}
      <svg
        aria-hidden="true"
        viewBox="0 0 100 100"
        preserveAspectRatio="none"
        className="pointer-events-none absolute inset-0 hidden size-full lg:block"
      >
        <polygon
          points={OCTAGON}
          className="fill-stock stroke-ink"
          strokeWidth={2}
          vectorEffect="non-scaling-stroke"
        />

        {/* The clock, printed round the edge of the table. `pathLength` is
            normalised so one dash length works whatever shape this becomes. */}
        {left !== null && (
          <polygon
            points={OCTAGON}
            fill="none"
            className="stroke-pink"
            strokeWidth={4}
            pathLength={1}
            strokeDasharray={1}
            strokeDashoffset={1 - left}
            vectorEffect="non-scaling-stroke"
          />
        )}
      </svg>

      {/* First in the DOM so a phone gets the clock before the roster — under a
          forty-five second deadline that is what is being looked for. On a wide
          screen it is lifted into the middle of the table instead. */}
      <PhaseDial
        phaseLabel={summary.phaseLabel}
        roundLabel={summary.roundLabel}
        seconds={seconds}
        fractionLeft={left}
        finished={summary.finished}
        className="mb-4 lg:absolute lg:left-[28%] lg:top-[32%] lg:mb-0 lg:h-[36%] lg:w-[44%]"
      />

      {/* ---------------------------------------------------------- the chairs */}
      {/* Keyed on the deal so the cards go round the table again when a game
          starts. Seats persist across that transition, so without the remount
          the roles would simply appear on the board that was already there. */}
      <ul
        key={started ? 'dealt' : 'waiting'}
        aria-label={targeting?.label ?? 'Players'}
        className="grid grid-cols-2 gap-2 lg:block"
      >
        {Array.from({ length: chairs }, (_, index) => {
          const seat = ordered[index]

          return (
            <li
              key={seat?.sessionId ?? `empty-${index}`}
              className="table-seat"
              style={chairAt(index, chairs)}
            >
              <div
                className="animate-deal"
                style={{ animationDelay: `${index * 55}ms` }}
              >
                {seat ? (
                  <Chair
                    seat={seat}
                    isYou={seat.sessionId === you}
                    started={started}
                    now={now}
                    knocking={seat.sessionId === soleActor}
                    targeting={targeting}
                  />
                ) : (
                  <EmptyChair />
                )}
              </div>
            </li>
          )
        })}
      </ul>
    </section>
  )
}

/**
 * Put your own chair at the near edge.
 *
 * A rotation, never a sort: the seats keep their join order relative to each
 * other, so "whoever is next clockwise" stays true on the board for the phases
 * that walk the table in order.
 */
function rotateToYou(seats: TableSeat[], you: string | null): TableSeat[] {
  const mine =
    you === null ? -1 : seats.findIndex((seat) => seat.sessionId === you)
  if (mine <= 0) return seats

  return [...seats.slice(mine), ...seats.slice(0, mine)]
}

/** A chair nobody has taken. Reads as a place to fill, not as a missing thing. */
function EmptyChair() {
  return (
    <p className="grid h-[3.25rem] place-items-center border-2 border-dashed border-rule font-mono text-[0.625rem] lowercase tracking-[0.2em] text-ink-soft">
      empty
    </p>
  )
}

/**
 * One player at the table.
 *
 * A BUTTON ONLY WHEN THERE IS SOMETHING TO CLICK. Outside a targeting phase
 * this is a plain card — a seat that looks pressable but refuses every press
 * teaches a player to stop trusting the board.
 *
 * "Out" is `text-ink-soft` — the palette's actual grey — plus a strike and a
 * dashed rule, never `opacity`. Fading ink toward paper drops it under 4.5:1
 * and makes the roster unreadable for exactly the players who spend the rest of
 * the game re-reading it.
 */
function Chair({
  seat,
  isYou,
  started,
  now,
  knocking,
  targeting,
}: {
  seat: TableSeat
  isYou: boolean
  started: boolean
  /** Server clock, shared by the whole board, for the reconnect window. */
  now: number
  /** True when this is the one seat the table is waiting on. */
  knocking: boolean
  targeting: SeatTargeting | null
}) {
  const live = targeting !== null && targeting.targets.includes(seat.sessionId)
  const blocked = live ? targeting.blockedFor(seat.sessionId) : null
  const picked = targeting !== null && targeting.chosen.includes(seat.sessionId)

  const reconnectingIn =
    seat.droppedUntil === null
      ? null
      : toSeconds(Math.max(0, seat.droppedUntil - now))

  const fill = !seat.alive
    ? 'border-dashed border-rule bg-paper -rotate-3'
    : picked || seat.actor
      ? 'border-ink bg-yellow'
      : 'border-ink bg-paper'

  // Out of register while it is yours to press; snapped flush once you commit.
  const ink = picked
    ? 'reg reg-set'
    : live && blocked === null
      ? 'reg'
      : knocking
        ? 'animate-tap'
        : ''

  const body = (
    <>
      <span className="flex items-baseline gap-1.5">
        <span
          aria-hidden="true"
          className="font-mono text-[0.625rem] tabular-nums text-ink-soft"
        >
          {seat.seat + 1}
        </span>

        <span
          className={`min-w-0 flex-1 truncate font-display text-[0.9375rem] leading-tight ${
            seat.alive ? 'text-ink' : 'text-ink-soft line-through'
          }`}
          style={DISPLAY_HEADING}
        >
          {seat.nickname}
        </span>

        {isYou && (
          <span className="shrink-0 font-mono text-[0.5625rem] uppercase tracking-wide text-ink-soft">
            you
          </span>
        )}
      </span>

      {/* One status line per seat, ranked and never doubled: out, then gone but
          not yet out, then why you cannot pick them, then picked, then holding
          the floor. "reconnecting" outranks "active" because a seat can be
          both — a player who drops while holding the floor keeps it until their
          window runs out, and the line has to say what is really blocking. */}
      <span className="mt-1 block font-mono text-[0.625rem] leading-snug text-ink-soft">
        {!started ? (
          'seated'
        ) : !seat.alive ? (
          <span className="uppercase tracking-wide">out</span>
        ) : reconnectingIn !== null ? (
          <span className="uppercase tracking-wide text-ink">
            reconnecting {reconnectingIn}s
          </span>
        ) : blocked ? (
          <span className="uppercase tracking-wide">{blocked}</span>
        ) : picked ? (
          <span className="uppercase tracking-wide text-ink">your pick</span>
        ) : seat.actor ? (
          <span className="uppercase tracking-wide text-ink">active</span>
        ) : (
          'waiting'
        )}
      </span>

      {seat.votes > 0 && <Tally count={seat.votes} />}

      {/* Whatever the game wanted this seat to say — a clue, a revealed role, a
          mark — arrives pre-worded. Set as a slip laid down in front of them,
          on paper rather than a fill, so it survives the chair going yellow. */}
      {seat.note && (
        <span
          className="mt-1 block truncate border border-ink bg-paper px-1.5 py-0.5 font-display text-[0.8125rem] leading-snug text-ink"
          style={DISPLAY_HEADING}
          title={seat.note}
        >
          {seat.note}
        </span>
      )}
    </>
  )

  const shell = `block w-full border-2 px-2.5 py-2 text-left transition-transform duration-300 ${fill} ${ink}`

  if (!live) {
    return <div className={shell}>{body}</div>
  }

  return (
    <button
      type="button"
      aria-pressed={picked}
      disabled={blocked !== null}
      title={blocked ?? undefined}
      onClick={() => targeting.onPick(seat.sessionId)}
      className={`${shell} enabled:hover:bg-yellow disabled:opacity-40`}
    >
      {body}
    </button>
  )
}

/**
 * Votes standing against a seat, counted the way a table actually counts them.
 *
 * A tally is a running total somebody kept by hand, which is what a vote count
 * is — and grouping in fives is what makes it countable at a glance, so the
 * digits would only be saying the same thing twice. They stay for screen
 * readers, which cannot see the strokes at all.
 */
function Tally({ count }: { count: number }) {
  const groups = Math.ceil(count / 5)

  return (
    <span className="mt-1 flex items-center gap-1.5">
      <svg
        aria-hidden="true"
        height={13}
        width={groups * 17}
        viewBox={`0 0 ${groups * 17} 13`}
        className="shrink-0 stroke-ink"
        strokeWidth={1.5}
        strokeLinecap="round"
      >
        {Array.from({ length: count }, (_, mark) => {
          const x = Math.floor(mark / 5) * 17 + (mark % 5) * 3 + 2

          // Every fifth stroke is the one drawn back across the other four.
          return mark % 5 === 4 ? (
            <line key={mark} x1={x - 12} y1={11} x2={x} y2={2} />
          ) : (
            <line key={mark} x1={x} y1={1} x2={x} y2={12} />
          )
        })}
      </svg>

      <span className="sr-only">
        {count} vote{count === 1 ? '' : 's'}
      </span>
    </span>
  )
}
