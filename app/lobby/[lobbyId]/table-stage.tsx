'use client'

import type { TableSeat, TableSummary } from '@/lib/game/table-view'
import { toSeconds, useServerNow } from '@/lib/game/use-countdown'
import type { LobbyMember } from '@/lib/socket/events'

import { DISPLAY_HEADING } from './controls'
import { PhaseDial } from './phase-dial'

/**
 * The board: everybody at this game, pinned up as a card, with the clock above.
 *
 * WHY A BOARD AND NOT A TABLE. This used to be an octagonal table with chairs
 * on an ellipse round its rim. It made the room look like a diagram, it cut
 * every nickname in half to fit a chair, and on a phone it collapsed into a
 * plain list anyway. A deduction game is about PEOPLE — who is lying, who is
 * out, who everyone is pointing at — so each person now gets a card with a
 * face-sized portrait: their initial cut out of their own colour of paper, the
 * same scraps as the masthead on the home page. It reads as the wall of
 * suspects every detective story pins up, and that is what this game is.
 *
 * THE RULE IS UNCHANGED: POINT AT PEOPLE ON THE BOARD, PRESS THINGS IN YOUR
 * HAND. The cards are the control — roster and picker are one object — and a
 * card is a button only while there is something to pick.
 *
 * STILL GAME-AGNOSTIC. It reads `TableSummary`, which both Mr. White and
 * Werewolf project themselves down to, plus a `SeatTargeting` descriptor saying
 * which seats are live right now and what happens when one is clicked. The
 * board never learns which game built it — see `lib/game/table-view.ts`.
 *
 * NOTHING HERE DECIDES LEGALITY. `blockedFor` greys a card and says why, which
 * is a hint to a player and not enforcement; the server validates every intent
 * regardless.
 *
 * JOIN ORDER, NOT "YOU FIRST". Several phases walk the board in seat order, so
 * the cards stay in it and your own is marked rather than moved.
 */

export interface SeatTargeting {
  /** What the board is asking for, in words. Labels the card list. */
  label: string
  /** Session ids that are live targets. Everything else is just a card. */
  targets: readonly string[]
  /** Your current pick, or picks — Cupid commits two at once. */
  chosen: readonly string[]
  /** Why this seat cannot be picked, in two words, or null when it can. */
  blockedFor: (sessionId: string) => string | null
  onPick: (sessionId: string) => void
}

/**
 * Which plate the board is printed on.
 *
 * Werewolf is played in two lights. The night is the INK plate — the board goes
 * dark, its screen turns to paper dots, a moon comes up over the clock — and
 * the day is the ordinary stock. It is the one thing on this screen you can
 * read from across the room, and it tells you before anything else whether to
 * keep your mouth shut. Null is the plain stock every other game sits on.
 */
export type TablePlate = 'night' | 'day' | null

/**
 * Each person's paper. Chosen from their session id, so a player keeps the
 * same colour for the whole evening however the seats shuffle.
 */
const PORTRAIT_PAPER = [
  'bg-sheet-yellow',
  'bg-sheet-blue',
  'bg-sheet-pink',
  'bg-yellow',
  'bg-sheet-white',
] as const

function paperFor(id: string): string {
  let hash = 0
  for (let i = 0; i < id.length; i++) hash = (hash * 31 + id.charCodeAt(i)) | 0
  return PORTRAIT_PAPER[Math.abs(hash) % PORTRAIT_PAPER.length]!
}

/** The scrap's slight crookedness, also fixed per person. */
function tiltFor(id: string): number {
  let hash = 7
  for (let i = 0; i < id.length; i++) hash = (hash * 17 + id.charCodeAt(i)) | 0
  return ((Math.abs(hash) % 7) - 3) * 0.9
}

/** The letter on the portrait. Generated names start with a capital word. */
function initialOf(nickname: string): string {
  return nickname.trim().charAt(0).toUpperCase() || '?'
}

/**
 * One place on the board.
 *
 * Three kinds, because a place genuinely means three different things: someone
 * in this round, someone in the room who is not (they arrived after the deal),
 * and a place nobody has taken.
 */
type CardSlot =
  | { kind: 'seat'; seat: TableSeat }
  | { kind: 'waiting'; member: LobbyMember }
  | { kind: 'empty' }

function occupantOf(slot: CardSlot): string | null {
  if (slot.kind === 'seat') return slot.seat.sessionId
  if (slot.kind === 'waiting') return slot.member.sessionId
  return null
}

export function TableStage({
  summary,
  waiting,
  you,
  capacity,
  started,
  targeting = null,
  plate = null,
}: {
  summary: TableSummary
  /**
   * In the room, not in this round — see `waitingFor` in `table-view.ts`.
   * Empty before the deal, when everybody seated is a player.
   */
  waiting: readonly LobbyMember[]
  /** Your sessionId, so your card is marked. Null while connecting. */
  you: string | null
  /** `LOBBY_CAPACITY` — how many places to draw before the deal. */
  capacity: number
  /** False while the lobby is still filling: empty places, and no clock. */
  started: boolean
  targeting?: SeatTargeting | null
  /** Night, day, or the plain stock. See `TablePlate`. */
  plate?: TablePlate
}) {
  const { seats } = summary
  const night = plate === 'night'

  // One interval for the whole board. The phase clock and every reconnect
  // window are measured against the same server clock, so they share it rather
  // than opening a timer per card.
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
   * From the raw milliseconds rather than the rounded seconds, so the bar moves
   * continuously; the dial reads the rounded value, which is what a person
   * counting down out loud actually says.
   */
  const left =
    remainingMs !== null && summary.phaseSeconds
      ? Math.min(1, Math.max(0, remainingMs / (summary.phaseSeconds * 1000)))
      : null

  const filled: CardSlot[] = [
    ...seats.map((seat) => ({ kind: 'seat' as const, seat })),
    ...waiting.map((member) => ({ kind: 'waiting' as const, member })),
  ]

  // Before the deal the empty places are drawn too — "are we five yet" is the
  // question the lobby is asking. Once dealt, only the people.
  const places = started ? filled.length : Math.max(filled.length, capacity)

  /**
   * Whether one card alone holds the floor. During a vote every living player
   * is an actor, and eight cards all knocking for attention says nothing at
   * all. One is a signal.
   */
  const actors = seats.filter((seat) => seat.actor)
  const soleActor = actors.length === 1 ? actors[0]!.sessionId : null

  return (
    <section
      aria-label="The board"
      className={`border-2 border-ink p-3 transition-colors duration-700 ease-in-out motion-reduce:transition-none sm:p-4 ${
        night ? 'board-night' : 'board-ground'
      }`}
    >
      <PhaseDial
        phaseLabel={summary.phaseLabel}
        roundLabel={summary.roundLabel}
        seconds={seconds}
        fractionLeft={left}
        finished={summary.finished}
        night={night}
      />

      {/* Keyed on the deal so the cards are dealt out again when a game
          starts. Places persist across that transition, so without the remount
          the roles would simply appear on the board that was already there. */}
      <ul
        key={started ? 'dealt' : 'waiting'}
        aria-label={targeting?.label ?? 'Players'}
        className="mt-4 grid grid-cols-2 gap-3 sm:grid-cols-3 sm:gap-4 2xl:grid-cols-4"
      >
        {Array.from({ length: places }, (_, index) => {
          const slot = filled[index] ?? { kind: 'empty' as const }
          const occupant = occupantOf(slot)

          return (
            <li key={occupant ?? `empty-${index}`}>
              <div
                className="animate-deal h-full"
                style={{ animationDelay: `${index * 55}ms` }}
              >
                {slot.kind === 'seat' ? (
                  <PlayerCard
                    seat={slot.seat}
                    isYou={slot.seat.sessionId === you}
                    started={started}
                    now={now}
                    knocking={slot.seat.sessionId === soleActor}
                    targeting={targeting}
                  />
                ) : slot.kind === 'waiting' ? (
                  <WaitingCard
                    member={slot.member}
                    isYou={slot.member.sessionId === you}
                  />
                ) : (
                  <EmptyCard night={night} />
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
 * The portrait: an initial cut out of the player's paper.
 *
 * Decorative — the name under it is the real label — so it is hidden from
 * assistive tech, and the stamp laid over it when somebody is out is too.
 */
function Portrait({
  id,
  nickname,
  out = false,
}: {
  id: string
  nickname: string
  out?: boolean
}) {
  return (
    <span
      aria-hidden="true"
      className="relative grid aspect-[5/4] w-full place-items-center overflow-hidden bg-paper"
    >
      {/* Once somebody is out their scrap comes off the board and only the
          stamp is left — stamped over the letter, neither could be read. */}
      {!out && (
        <span
          className={`grid size-[62%] place-items-center font-display text-[clamp(2rem,4.2vw,3.25rem)] leading-none text-ink ${paperFor(id)}`}
          style={{
            ...DISPLAY_HEADING,
            transform: `rotate(${tiltFor(id)}deg)`,
          }}
        >
          {initialOf(nickname)}
        </span>
      )}

      {/* The pin holding the portrait up. */}
      <span className="absolute left-1/2 top-2 size-3 -translate-x-1/2 rounded-full border-2 border-ink bg-pink" />

      {out && (
        <span
          className="slip animate-stamp absolute inset-0 grid place-items-center"
        >
          <span
            // Its own patch of white with ink letters inside the pink frame:
            // stamped straight onto the initial, pink-on-ink read as neither.
            className="-rotate-12 border-[3px] border-pink bg-sheet-white px-3 py-0.5 font-display text-2xl uppercase leading-tight tracking-wide text-ink"
            style={DISPLAY_HEADING}
          >
            out
          </span>
        </span>
      )}
    </span>
  )
}

/** A place nobody has taken. Reads as a place to fill, not as a missing thing. */
function EmptyCard({ night }: { night: boolean }) {
  return (
    <p
      className={`grid h-full min-h-40 place-items-center border-2 border-dashed font-mono text-xs lowercase tracking-[0.2em] ${
        night ? 'border-paper/40 text-paper/75' : 'border-ink/30 text-ink-soft'
      }`}
    >
      empty seat
    </p>
  )
}

/**
 * Someone in the room who is not in this round.
 *
 * They arrived after the cards were dealt, so the game does not know them —
 * but the room does, and the next deal takes everyone seated. Drawn as a real
 * card with a dashed edge rather than left off the board: a person who cannot
 * see themselves on it assumes they failed to join.
 */
function WaitingCard({
  member,
  isYou,
}: {
  member: LobbyMember
  isYou: boolean
}) {
  return (
    <div className="flex h-full flex-col border-2 border-dashed border-ink bg-sheet-white p-2">
      <Portrait id={member.sessionId} nickname={member.nickname} />

      <span className="px-1 pt-2.5">
        <span
          className="block truncate font-display text-[0.9375rem] leading-tight text-ink sm:text-base"
          style={DISPLAY_HEADING}
          title={member.nickname}
        >
          {member.nickname}
        </span>

        <span className="mt-1 flex items-baseline gap-1.5 font-mono text-xs leading-snug text-ink-soft">
          <span className="min-w-0 flex-1 truncate">next round</span>
          {isYou && <YouTag />}
        </span>
      </span>
    </div>
  )
}

function YouTag() {
  return <span className="shrink-0 bg-ink px-1 lowercase text-paper">you</span>
}

/**
 * One player on the board.
 *
 * A BUTTON ONLY WHEN THERE IS SOMETHING TO CLICK. Outside a targeting phase
 * this is a plain card — a card that looks pressable but refuses every press
 * teaches a player to stop trusting the board.
 *
 * "Out" is the stamp across the portrait plus `text-ink-soft` and a strike on
 * the name, never `opacity`: fading ink toward paper drops it under 4.5:1 and
 * makes the roster unreadable for exactly the players who spend the rest of the
 * game re-reading it.
 */
function PlayerCard({
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
  /** True when this is the one card the board is waiting on. */
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

  // The card itself is white stock; picking it, or it holding the floor, turns
  // it yellow — the marker pass, the way everything chosen on this site looks.
  // A card you cannot pick drops to the plain stock rather than fading: an
  // opacity over the night plate turned a yellow card the colour of mud.
  const fill = !seat.alive
    ? 'border-dashed border-rule bg-paper'
    : blocked !== null
      ? 'border-ink/40 bg-stock'
      : picked || seat.actor
        ? 'border-ink bg-yellow'
        : 'border-ink bg-sheet-white'

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
      <Portrait id={seat.sessionId} nickname={seat.nickname} out={!seat.alive} />

      <span className="block px-1 pt-2.5">
        {/* One line and an ellipsis, full name on hover: on a phone card a
            generated nickname is wider than the card and broke mid-word. */}
        <span
          className={`block truncate font-display text-[0.9375rem] leading-tight sm:text-base ${
            seat.alive ? 'text-ink' : 'text-ink-soft line-through'
          }`}
          style={DISPLAY_HEADING}
          title={seat.nickname}
        >
          {seat.nickname}
        </span>

        {/* One status line per card, ranked and never doubled: out, then gone
            but not yet out, then why you cannot pick them, then picked, then
            holding the floor. "reconnecting" outranks "active" because a seat
            can be both — a player who drops while holding the floor keeps it
            until their window runs out, and the line has to say what is really
            blocking. */}
        <span className="mt-1 flex items-baseline gap-1.5 font-mono text-xs leading-snug text-ink-soft">
          <span aria-hidden="true" className="tabular-nums">
            {seat.seat + 1} ·
          </span>
          <span className="min-w-0 flex-1 truncate">
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
          {isYou && <YouTag />}
        </span>

        {seat.votes > 0 && <Tally count={seat.votes} />}

        {/* Whatever the game wanted this seat to say — a clue, a revealed role,
            a mark — arrives pre-worded. Set as a slip laid on the card, on
            white rather than a fill, so it survives the card going yellow. */}
        {seat.note && (
          <span
            className="mt-2 block break-words bg-sheet-white px-2 py-1 font-display text-sm leading-snug text-ink outline outline-1 outline-ink/30"
            style={DISPLAY_HEADING}
          >
            {seat.note}
          </span>
        )}
      </span>
    </>
  )

  const shell = `flex h-full w-full flex-col border-2 p-2 pb-3 text-left ${fill} ${ink}`

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
      className={`${shell} enabled:hover:bg-yellow disabled:cursor-not-allowed`}
    >
      {body}
    </button>
  )
}

/**
 * Votes standing against a player, counted the way a table actually counts
 * them: a tally somebody kept by hand, grouped in fives so it is countable at a
 * glance. The digits stay for screen readers, which cannot see the strokes.
 */
function Tally({ count }: { count: number }) {
  const groups = Math.ceil(count / 5)

  return (
    <span className="mt-2 flex items-center gap-1.5">
      <svg
        aria-hidden="true"
        height={16}
        width={groups * 20}
        viewBox={`0 0 ${groups * 17} 13`}
        className="shrink-0 stroke-pink"
        strokeWidth={2}
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

      <span className="font-mono text-xs tabular-nums text-ink">
        {count} vote{count === 1 ? '' : 's'}
      </span>
    </span>
  )
}
