'use client'

import { useState } from 'react'

import { SystemNote } from '@/app/chrome'
import { toSeconds, useCountdown } from '@/lib/game/use-countdown'
import { useGame } from '@/lib/game/use-game'
import {
  asWerewolf,
  canBond,
  canPoison,
  canTargetTonight,
  collateralOf,
  isAlive,
  isRevenger,
  livingPlayers,
  nicknameOf,
  nicknamesOf,
  nightAction,
  nightChoice,
  packTally,
  readyThreshold,
  voteTally,
  witchOptions,
  PHASE_LABEL,
  PHASE_SECONDS,
  ROLE_BRIEF,
  ROLE_LABEL,
  type WerewolfPhase,
  type WerewolfPlayer,
  type WerewolfTable,
} from '@/lib/game/werewolf-view'
import type { AppSocket } from '@/lib/webrtc/use-p2p-room'

/**
 * Werewolf, at the table.
 *
 * EIGHT PLAYERS SEE EIGHT DIFFERENT SCREENS, and none of that is decided here.
 * The wolf's packmate list, the Seer's ledger, the Guard's shield, the Witch's
 * victim and the Lovers' bond are absent from everyone else's payload —
 * `werewolf.viewFor` on the server built each viewer their own. So this
 * component is not choosing what to hide; there is genuinely nothing here to
 * bypass. What it chooses is what to DRAW, which is a different question with
 * the same answer per role.
 *
 * As everywhere else in this app the UI only *disables* what it believes is
 * illegal. Every click is still sent, and the server is the sole judge —
 * anything enforced in the browser can be undone from devtools.
 *
 * NIGHT CHOICES ARE ECHOED, THE DAY VOTE IS NOT. A wolf gets `wolfVotes` back,
 * the Seer gets `seerTarget` and the Witch gets `witchPoison`, so those panels
 * read their own selection straight off the server. `votes` stays `{}` for the
 * whole voting phase by design, so the only way to show "you picked Rina" is to
 * remember it locally — hence `sent`, which is discarded the moment the phase
 * turns over.
 *
 * TWO PANELS BREAK THE "ONE CLICK, ONE MOVE" SHAPE, both for the same reason.
 * Cupid's bond needs TWO names and the server will not accept half of one, so
 * `NightZeroPanel` collects a pair locally before sending anything. The Witch
 * has two independent potions and may spend both in one night, so `WitchPanel`
 * stays open after each until she says she is done.
 */

/**
 * Outline control.
 *
 * The only button style on this panel that is fixed. Every other control here is
 * a target in a list, and those carry their own selected/blocked states — a
 * filled `PRIMARY` alongside them would claim a hierarchy the table does not
 * have, since picking a victim is not a lesser action than starting the game.
 */
const SECONDARY =
  'border-2 border-ink px-5 py-2.5 font-mono text-sm text-ink transition-colors hover:bg-yellow disabled:opacity-40 disabled:hover:bg-transparent'

const EYEBROW =
  'font-mono text-[0.6875rem] uppercase tracking-wide text-ink-soft'

const NOTE = 'font-mono text-[0.8125rem] leading-relaxed text-ink'

const DISPLAY: React.CSSProperties = {
  fontVariationSettings: "'wght' 800, 'wdth' 95",
}

/** Werewolf's own limits, mirrored from `server/src/games/werewolf.ts`. */
const MIN_PLAYERS = 5
const MAX_PLAYERS = 8

/** The action verb on each night panel's buttons. */
const NIGHT_VERB = {
  kill: 'Eat',
  inspect: 'Read',
  protect: 'Cover',
} as const

// --- Pieces ----------------------------------------------------------------

function Waiting({ children }: { children: React.ReactNode }) {
  return (
    <p className="font-mono text-[0.75rem] leading-relaxed text-ink-soft">
      {children}
    </p>
  )
}

/**
 * The phase clock.
 *
 * Counts against `serverNow`, never a raw `Date.now()` — a browser clock minutes
 * out would render a negative number, which reads as "time's up" while the
 * server is still happily accepting moves.
 */
function PhaseClock({ table }: { table: WerewolfTable }) {
  const remaining = useCountdown(
    table.finished ? null : table.phaseEndsAt,
    table.serverNow,
  )
  const seconds = toSeconds(remaining)
  const total = PHASE_SECONDS[table.phase]

  if (seconds === null || total === null) return null

  return (
    <div className="mt-6 flex items-center gap-3">
      <span className="font-mono text-[0.6875rem] tabular-nums text-ink-soft">
        {seconds}s
      </span>
      <span className="h-0.5 flex-1 bg-rule">
        <span
          className="block h-0.5 bg-ink transition-[width] duration-300"
          style={{ width: `${Math.min(100, (seconds / total) * 100)}%` }}
        />
      </span>
    </div>
  )
}

/**
 * Your role, and whatever private knowledge comes with it.
 *
 * Every branch below renders from a field that is simply ABSENT for the wrong
 * viewer, so a villager reading this component's source learns nothing they
 * could act on — `packmates` is `[]` in their payload, and `yourLover` is null,
 * neither of them filtered here.
 */
function RolePanel({
  table,
  sessionId,
}: {
  table: WerewolfTable
  sessionId: string | null
}) {
  const role = table.yourRole
  const dead = sessionId !== null && !isAlive(table, sessionId)

  return (
    <div className="mt-6 border-2 border-ink bg-paper p-5">
      <div className="flex items-baseline justify-between gap-3">
        <p className={EYEBROW}>your role</p>
        {dead && (
          <p className="border border-ink px-1.5 font-mono text-[0.625rem] uppercase tracking-wide text-ink-soft">
            dead
          </p>
        )}
      </div>

      <p className="mt-1.5 font-display text-2xl leading-none" style={DISPLAY}>
        <span className="bg-yellow box-decoration-clone px-2 py-0.5">
          {role === null ? 'Watching' : ROLE_LABEL[role]}
        </span>
      </p>

      <p className="mt-4 border-l-4 border-pink bg-stock px-3 py-2.5 font-mono text-[0.75rem] leading-relaxed text-ink">
        {role === null
          ? 'You are not playing at this table. You see exactly what the room sees, and nothing more.'
          : ROLE_BRIEF[role]}
      </p>

      {/* ------------------------------------------------------- the pack */}
      {table.packmates.length > 0 && (
        <div className="mt-4">
          <p className={EYEBROW}>your pack</p>
          <p className="mt-1 font-mono text-[0.8125rem] text-ink">
            {nicknamesOf(table, table.packmates)}
          </p>
        </div>
      )}

      {/* ------------------------------------------------------- the bond */}
      {table.yourLover && (
        <div className="mt-4">
          <p className={EYEBROW}>you are in love with</p>
          <p className="mt-1 font-mono text-[0.8125rem] text-ink">
            <span className="bg-pink px-1 font-semibold">
              {nicknameOf(table, table.yourLover) ?? 'someone'}
            </span>
          </p>
          <p className="mt-1 font-mono text-[0.75rem] leading-relaxed text-ink-soft">
            Whichever of you dies first, the other goes in the same breath. No
            potion, shield or vote interrupts it.
          </p>
        </div>
      )}

      {/* Cupid sees the pair they made, whether or not they are in it. */}
      {table.yourRole === 'cupid' && table.lovers.length === 2 && (
        <div className="mt-4">
          <p className={EYEBROW}>you tied together</p>
          <p className="mt-1 font-mono text-[0.8125rem] text-ink">
            {nicknamesOf(table, table.lovers)}
          </p>
        </div>
      )}

      {/* --------------------------------------------- the seer's ledger */}
      {Object.keys(table.inspections).length > 0 && (
        <div className="mt-4">
          <p className={EYEBROW}>what you have read</p>
          <ul className="mt-1 space-y-1">
            {Object.entries(table.inspections).map(([id, alignment]) => (
              <li key={id} className="font-mono text-[0.8125rem] text-ink">
                {nicknameOf(table, id) ?? id}
                {' · '}
                <span
                  className={
                    alignment === 'werewolf'
                      ? 'bg-yellow px-1 font-semibold'
                      : 'text-ink-soft'
                  }
                >
                  {alignment === 'werewolf' ? 'WEREWOLF' : 'not a werewolf'}
                </span>
              </li>
            ))}
          </ul>
        </div>
      )}

      {/* ------------------------------------------------- the guard's log */}
      {table.yourRole === 'guard' && table.lastProtected && (
        <p className="mt-4 font-mono text-[0.75rem] text-ink-soft">
          Last night you covered{' '}
          <span className="text-ink">
            {nicknameOf(table, table.lastProtected) ?? '-'}
          </span>
          . Tonight it has to be somebody else.
        </p>
      )}

      {/* ---------------------------------------------- the witch's shelf */}
      {table.yourRole === 'witch' && (
        <div className="mt-4">
          <p className={EYEBROW}>your potions</p>
          <ul className="mt-1 space-y-1">
            <li className="font-mono text-[0.8125rem] text-ink">
              Heal{' · '}
              <span className={table.healUsed ? 'text-ink-soft line-through' : 'bg-yellow px-1'}>
                {table.healUsed ? 'spent' : 'ready'}
              </span>
            </li>
            <li className="font-mono text-[0.8125rem] text-ink">
              Poison{' · '}
              <span className={table.poisonUsed ? 'text-ink-soft line-through' : 'bg-yellow px-1'}>
                {table.poisonUsed ? 'spent' : 'ready'}
              </span>
            </li>
          </ul>
        </div>
      )}

      {/* --------------------------------------------- the hunter's promise */}
      {table.yourRole === 'hunter' && (
        <p className="mt-4 font-mono text-[0.75rem] leading-relaxed text-ink-soft">
          Nothing to do at night. Keep watching anyway — the moment you die you
          get one shot, and twenty seconds to decide who it is for.
        </p>
      )}
    </div>
  )
}

/**
 * The roster.
 *
 * Doubles as the vote tally once votes are public, and as the graveyard: a dead
 * player's role is printed next to their name because the server revealed it,
 * for everyone, the moment they died. Lovers are flagged the same way — once
 * the bond has cost somebody their life it is public, so marking it here tells
 * nobody anything the bodies did not already.
 */
function Roster({
  table,
  sessionId,
}: {
  table: WerewolfTable
  sessionId: string | null
}) {
  const tally = voteTally(table)
  const pack = packTally(table)

  return (
    <ul className="mt-6 space-y-1.5">
      {table.players.map((player) => {
        const alive = isAlive(table, player.sessionId)
        const revealed = table.revealedRoles[player.sessionId]
        const dayVotes = tally[player.sessionId] ?? 0
        const packVotes = pack[player.sessionId] ?? 0
        const missing = table.disconnected[player.sessionId] !== undefined
        const inLove = table.lovers.includes(player.sessionId)

        return (
          <li
            key={player.sessionId}
            className={`flex flex-wrap items-baseline gap-x-2 border-2 px-3 py-2 font-mono text-[0.8125rem] ${
              alive
                ? 'border-ink bg-paper text-ink'
                : 'border-dashed border-rule bg-stock text-ink-soft line-through'
            }`}
          >
            <span>{player.nickname}</span>

            {player.sessionId === sessionId && (
              <span className="text-[0.625rem] uppercase tracking-wide text-ink-soft no-underline">
                you
              </span>
            )}

            {/* The server publishes a role only once its owner is out of the
                game — or once the game itself is over. */}
            {revealed && (
              <span className="text-[0.625rem] uppercase tracking-wide no-underline">
                {ROLE_LABEL[revealed]}
              </span>
            )}

            {/* `lovers` is `[]` in the payload of anyone not entitled to it. */}
            {inLove && (
              <span className="bg-pink px-1 text-[0.625rem] uppercase tracking-wide no-underline">
                lover
              </span>
            )}

            {/* The Hunter, dead, still holding the gun. Public by design. */}
            {table.revengeBy === player.sessionId && (
              <span className="border border-ink px-1 text-[0.625rem] uppercase tracking-wide no-underline">
                taking aim
              </span>
            )}

            {missing && alive && (
              <span className="text-[0.625rem] uppercase tracking-wide text-ink-soft no-underline">
                dropped, waiting
              </span>
            )}

            {/* Only ever non-zero once `votes` is public, which is never during
                the vote itself. */}
            {dayVotes > 0 && (
              <span className="ml-auto bg-yellow px-1.5 tabular-nums no-underline">
                {dayVotes} vote{dayVotes === 1 ? '' : 's'}
              </span>
            )}

            {/* Wolves only: `wolfVotes` is `{}` in everyone else's payload. */}
            {packVotes > 0 && (
              <span className="ml-auto border border-ink px-1.5 tabular-nums no-underline">
                {packVotes} from the pack
              </span>
            )}
          </li>
        )
      })}
    </ul>
  )
}

/** A pickable list of players. Shared by every targeting panel in the game. */
function TargetList({
  targets,
  chosen,
  disabledFor,
  onPick,
  label,
}: {
  targets: WerewolfPlayer[]
  /** The single current pick, or several — Cupid picks two at once. */
  chosen: string | readonly string[] | null
  /** Why this target is not pickable, or null when it is. A hint, not a gate. */
  disabledFor: (sessionId: string) => string | null
  onPick: (sessionId: string) => void
  label: string
}) {
  const picks = chosen === null ? [] : typeof chosen === 'string' ? [chosen] : chosen

  return (
    <ul className="mt-3 space-y-2" aria-label={label}>
      {targets.map((player) => {
        const blocked = disabledFor(player.sessionId)
        const picked = picks.includes(player.sessionId)

        return (
          <li key={player.sessionId}>
            <button
              type="button"
              aria-pressed={picked}
              disabled={blocked !== null}
              onClick={() => onPick(player.sessionId)}
              title={blocked ?? undefined}
              className={`w-full border-2 border-ink px-3 py-2 text-left font-mono text-[0.8125rem] text-ink transition-colors disabled:opacity-40 ${
                picked ? 'bg-yellow' : 'bg-paper enabled:hover:bg-yellow'
              }`}
            >
              {player.nickname}
              {blocked && (
                <span className="ml-2 text-[0.625rem] uppercase tracking-wide text-ink-soft">
                  {blocked}
                </span>
              )}
              {picked && (
                <span className="ml-2 text-[0.625rem] uppercase tracking-wide">
                  your pick
                </span>
              )}
            </button>
          </li>
        )
      })}
    </ul>
  )
}

/**
 * Night zero. Cupid, once, and nobody else ever.
 *
 * COLLECTS BOTH NAMES BEFORE SENDING ANYTHING. The server takes `bond` with a
 * pair and refuses anything else, because a one-sided bond is not a state the
 * rules have — so the half-finished selection lives here, in local state, and
 * never as a move. Toggling a name off again is free right up until the second
 * one lands.
 */
function NightZeroPanel({
  table,
  sessionId,
  onMove,
}: {
  table: WerewolfTable
  sessionId: string | null
  onMove: (intent: unknown) => void
}) {
  const [picks, setPicks] = useState<string[]>([])

  if (!canBond(table, sessionId)) {
    return (
      <Waiting>
        {table.lovers.length > 0
          ? 'Cupid has chosen. Two people at this table are now bound to each other, and neither of them can outlive the other.'
          : 'The first night. Cupid is awake, choosing two people to tie together. Everyone else is asleep — even the pack does not hunt tonight.'}
      </Waiting>
    )
  }

  const toggle = (id: string) => {
    if (picks.includes(id)) {
      setPicks(picks.filter((pick) => pick !== id))
      return
    }

    // The second name commits the pair. There is no confirm step: the choice
    // IS the two names, and a button asking "are you sure" after them would add
    // a click without adding a decision.
    const next = [...picks, id]
    if (next.length < 2) {
      setPicks(next)
      return
    }

    onMove({ type: 'bond', targets: next })
    setPicks(next)
  }

  return (
    <div>
      <p className="font-mono text-[0.75rem] leading-relaxed text-ink-soft">
        {picks.length === 0
          ? 'Pick two people. From tonight they live and die together — kill either one and the other goes with them. You may tie yourself in.'
          : `${nicknameOf(table, picks[0] ?? '') ?? 'Somebody'} is chosen. Pick the second, and the bond is made.`}
      </p>

      <TargetList
        label="Tie together"
        targets={livingPlayers(table)}
        chosen={picks}
        disabledFor={(id) =>
          picks.length >= 2 && !picks.includes(id) ? 'bond made' : null
        }
        onPick={toggle}
      />
    </div>
  )
}

/**
 * The night.
 *
 * Three roles act at once and everyone else acts not at all — which is why this
 * renders a real panel for the sleeping majority too. In a timed game a player
 * staring at a blank box assumes the connection died rather than that they have
 * nothing to do. The Witch is among the sleepers HERE: her phase comes next,
 * and it is the whole point of her that she sees the kill first.
 */
function NightPanel({
  table,
  sessionId,
  onMove,
}: {
  table: WerewolfTable
  sessionId: string | null
  onMove: (intent: unknown) => void
}) {
  const action = nightAction(table, sessionId)
  const chosen = nightChoice(table, sessionId)

  if (!action) {
    return (
      <Waiting>
        {sessionId !== null && !isAlive(table, sessionId)
          ? 'You are dead. The night carries on without you, but you can still talk to the others who are out.'
          : table.yourRole === 'witch'
            ? 'Night. The pack is choosing. Stay asleep — you wake up after them, and you get to see what they did.'
            : 'Night. You are asleep. The wolves, the Seer and the Guard are moving. Wait for dawn.'}
      </Waiting>
    )
  }

  const hint = {
    kill: 'Pick one person to eat tonight. If the pack splits, whoever gets the most votes is taken.',
    inspect: 'Pick one person to read. All you are told is whether they are a werewolf.',
    protect:
      'Pick one person to cover. If the pack attacks them tonight, they survive.',
  }[action]

  return (
    <div>
      <p className="font-mono text-[0.75rem] leading-relaxed text-ink-soft">
        {chosen
          ? `Picked: ${nicknameOf(table, chosen) ?? '-'}. You can still change it until the night is over.`
          : hint}
      </p>

      <TargetList
        label={`${NIGHT_VERB[action]} who`}
        targets={livingPlayers(table)}
        chosen={chosen}
        disabledFor={(id) =>
          canTargetTonight(table, sessionId, id)
            ? null
            : id === sessionId
              ? 'yourself'
              : action === 'kill'
                ? 'your pack'
                : action === 'inspect'
                  ? 'already read'
                  : 'covered last night'
        }
        onPick={(target) => onMove({ type: action, target })}
      />
    </div>
  )
}

/**
 * The Witch, awake after the pack.
 *
 * THE ONLY PANEL THAT SHOWS A KILL BEFORE IT HAPPENS. `pendingKill` reaches
 * exactly one browser and only while this phase is open — outside it the server
 * sends null, so there is no window in which it sits in anyone's payload waiting
 * to be read.
 *
 * Two independent decisions, so the panel does not close on the first. She may
 * heal and then poison, poison and then heal, or do neither — `pass` is what
 * says she is finished, and the server closes the phase by itself only once both
 * potions are gone.
 */
function WitchPanel({
  table,
  sessionId,
  onMove,
}: {
  table: WerewolfTable
  sessionId: string | null
  onMove: (intent: unknown) => void
}) {
  const options = witchOptions(table, sessionId)
  const isWitch = table.yourRole === 'witch'

  if (!isWitch || (sessionId !== null && !isAlive(table, sessionId))) {
    return (
      <Waiting>
        {sessionId !== null && !isAlive(table, sessionId)
          ? 'You are dead. The Witch is awake, and whatever she does you will read about at dawn.'
          : 'The Witch is awake. She has seen what the pack did, and she is deciding whether to undo it.'}
      </Waiting>
    )
  }

  const victim = nicknameOf(table, table.pendingKill)

  return (
    <div>
      {/* -------------------------------------------- what the pack did */}
      <p className={NOTE}>
        {table.pendingKill ? (
          <>
            The pack went for{' '}
            <span className="bg-yellow px-1 font-semibold">{victim}</span>{' '}
            tonight.
          </>
        ) : table.pendingSaved ? (
          'The pack attacked, and it came to nothing — somebody else got there first. Nobody is dying tonight, so keep your heal.'
        ) : (
          'The pack never settled on anybody tonight. There is nothing to undo.'
        )}
      </p>

      {/* ------------------------------------------------------ the heal */}
      {table.witchHealed ? (
        <p className="mt-4 border-l-4 border-pink bg-stock px-3 py-2.5 font-mono text-[0.75rem] leading-relaxed text-ink">
          You spent the heal. They wake up in the morning like nothing happened,
          and the table will be told only that nobody died.
        </p>
      ) : (
        <button
          type="button"
          onClick={() => onMove({ type: 'heal' })}
          disabled={!options.heal}
          className={`${SECONDARY} mt-4 w-full`}
        >
          {table.healUsed
            ? 'Heal — already spent'
            : table.pendingKill
              ? `Save ${victim ?? 'them'} (uses your only heal)`
              : 'Heal — nobody to save tonight'}
        </button>
      )}

      {/* ---------------------------------------------------- the poison */}
      <div className="mt-5">
        <p className={EYEBROW}>the other bottle</p>

        {table.witchPoison ? (
          <p className="mt-2 border-l-4 border-pink bg-stock px-3 py-2.5 font-mono text-[0.75rem] leading-relaxed text-ink">
            You poisoned{' '}
            <span className="font-semibold">
              {nicknameOf(table, table.witchPoison) ?? 'somebody'}
            </span>
            . They will be found at dawn, and nothing about the body says it was
            you rather than the pack.
          </p>
        ) : table.poisonUsed ? (
          <p className="mt-2 font-mono text-[0.75rem] leading-relaxed text-ink-soft">
            The poison is gone. You used it on an earlier night.
          </p>
        ) : (
          <>
            <p className="mt-2 font-mono text-[0.75rem] leading-relaxed text-ink-soft">
              You may kill one person tonight, once in the whole game. Nobody is
              told it was poison.
            </p>
            <TargetList
              label="Poison who"
              targets={livingPlayers(table)}
              chosen={null}
              disabledFor={(id) =>
                canPoison(table, sessionId, id)
                  ? null
                  : id === sessionId
                    ? 'yourself'
                    : 'not tonight'
              }
              onPick={(target) => onMove({ type: 'poison', target })}
            />
          </>
        )}
      </div>

      {/* -------------------------------------------------------- finish */}
      <button
        type="button"
        onClick={() => onMove({ type: 'pass' })}
        className={`${SECONDARY} mt-5 w-full`}
      >
        Done for tonight
      </button>
    </div>
  )
}

/**
 * The Hunter's shot.
 *
 * THE ONE PANEL A DEAD PLAYER DRIVES. Everywhere else in this game dying ends
 * your turn, so this checks `isRevenger` rather than `isAlive` — asking the
 * usual question here would lock the Hunter out of the only phase that exists
 * for them.
 */
function RevengePanel({
  table,
  sessionId,
  onMove,
}: {
  table: WerewolfTable
  sessionId: string | null
  onMove: (intent: unknown) => void
}) {
  const hunter = nicknameOf(table, table.revengeBy) ?? 'The Hunter'

  if (!isRevenger(table, sessionId)) {
    return (
      <p className={NOTE}>
        <span className="bg-yellow px-1 font-semibold">{hunter}</span> was the
        Hunter — and a dying Hunter does not go alone. They are choosing who
        follows them right now.
      </p>
    )
  }

  return (
    <div>
      <p className={NOTE}>
        You are dead. Take one person with you.
      </p>
      <p className="mt-2 font-mono text-[0.75rem] leading-relaxed text-ink-soft">
        One shot, and the clock is short. Let it run out and nobody goes with
        you.
      </p>

      <TargetList
        label="Shoot who"
        targets={livingPlayers(table)}
        chosen={null}
        disabledFor={() => null}
        onPick={(target) => onMove({ type: 'shoot', target })}
      />
    </div>
  )
}

/**
 * What the Hunter's shot did, carried into the phase that follows it.
 *
 * NOT PART OF ANY PANEL, because the shot is the one death in this game that
 * lands between phases rather than inside one. `revenge` closes the instant the
 * trigger is pulled — there is nobody left to wait for — so the phase that would
 * have narrated it never opens, and without this the victim simply turns up dead
 * in the roster with no line of text anywhere explaining it.
 *
 * The server clears `lastShot` at the next resolution in either direction
 * (`closeWitch` heading into dawn, `resolveVote` heading into a verdict), so
 * this shows for exactly one day or one night and then goes quiet on its own.
 */
function HuntersShotNote({ table }: { table: WerewolfTable }) {
  if (!table.lastShot || table.phase === 'revenge') return null

  const hunter = nicknameOf(table, table.revengeBy)
  const shot = nicknameOf(table, table.lastShot) ?? 'somebody'
  const also = collateralOf(table, [table.lastShot])

  return (
    <p className={`${NOTE} mb-5 border-l-4 border-pink bg-stock px-3 py-2.5`}>
      {hunter ? `${hunter}, dying, ` : 'The dying Hunter '}took{' '}
      <span className="bg-yellow px-1 font-semibold">{shot}</span> with them.
      {also.length > 0 && (
        <>
          {' '}
          <span className="font-semibold">{nicknamesOf(table, also)}</span> went
          too — the shot found somebody who was not free to die alone.
        </>
      )}
    </p>
  )
}

/** Cut the discussion short. The count is the server's, so everyone sees one. */
function ReadyToVote({
  table,
  sessionId,
  onToggle,
}: {
  table: WerewolfTable
  sessionId: string | null
  onToggle: () => void
}) {
  const ready = table.readyToVote.length
  const needed = readyThreshold(table)
  const youAreReady = sessionId !== null && table.readyToVote.includes(sessionId)

  return (
    <div>
      <p className="font-mono text-[0.75rem] leading-relaxed text-ink-soft">
        Argue it out in chat. There is no move to make in this phase, though
        you do not have to wait the clock out.
      </p>

      <button
        type="button"
        aria-pressed={youAreReady}
        onClick={onToggle}
        className={`mt-4 w-full border-2 border-ink px-4 py-2.5 font-mono text-sm text-ink transition-colors ${
          youAreReady ? 'bg-yellow' : 'bg-paper hover:bg-yellow'
        }`}
      >
        {youAreReady ? 'Ready to vote (press again to take it back)' : 'Ready to vote'}
      </button>

      <p aria-live="polite" className="mt-2 font-mono text-[0.6875rem] text-ink-soft">
        <span className="tabular-nums text-ink">
          {ready} of {needed}
        </span>{' '}
        ready.{' '}
        {needed - ready > 0
          ? `${needed - ready} more and voting opens.`
          : 'Voting is open.'}
      </p>
    </div>
  )
}

/**
 * Whoever the bond dragged down, on top of the death everyone was expecting.
 *
 * Its own component because both `dawn` and `verdict` need it and the reason is
 * the same in each: the roster grows a corpse nobody voted for or ate, and
 * without a line of text the table has no idea where it came from.
 */
function Collateral({
  table,
  headlines,
}: {
  table: WerewolfTable
  headlines: ReadonlyArray<string | null>
}) {
  const also = collateralOf(table, headlines)
  if (also.length === 0) return null

  return (
    <p className="mt-3 border-l-4 border-pink bg-stock px-3 py-2.5 font-mono text-[0.75rem] leading-relaxed text-ink">
      <span className="font-semibold">{nicknamesOf(table, also)}</span> died in
      the same moment. Somebody at this table was tied to a person who was not
      going to live through it.
    </p>
  )
}

/** What the night did. Written for the whole table — this part is public. */
function DawnPanel({ table }: { table: WerewolfTable }) {
  const poisoned = nicknameOf(table, table.lastPoisoned)

  return (
    <div>
      {table.lastHealed ? (
        <p className={NOTE}>
          The pack attacked last night, and{' '}
          <span className="bg-yellow px-1">it did not take</span>. Someone was
          already awake with a bottle in their hand.
        </p>
      ) : table.lastSaved ? (
        <p className={NOTE}>
          The pack attacked last night, but{' '}
          <span className="bg-yellow px-1">nobody died</span>. The Guard covered
          exactly the right person.
        </p>
      ) : table.lastKilled ? (
        <p className={NOTE}>
          <span className="bg-yellow px-1 font-semibold">
            {nicknameOf(table, table.lastKilled) ?? 'Somebody'}
          </span>{' '}
          did not wake up this morning. Their role is open in the list below.
        </p>
      ) : (
        <p className={NOTE}>Nobody was taken by the pack last night.</p>
      )}

      {/* The poison is announced, but never attributed. As far as the table can
          tell from the body, this is another kill. */}
      {poisoned && (
        <p className={`${NOTE} mt-3`}>
          <span className="bg-yellow px-1 font-semibold">{poisoned}</span> was
          found dead as well. Nothing about it says who did it.
        </p>
      )}

      <Collateral table={table} headlines={[table.lastKilled, table.lastPoisoned]} />

      {table.lastDeaths.length === 0 && !table.lastSaved && !table.lastHealed && (
        <p className="mt-3 font-mono text-[0.75rem] leading-relaxed text-ink-soft">
          A quiet night. That is worth exactly as much suspicion as a loud one.
        </p>
      )}
    </div>
  )
}

/** What the vote did — including the two cases where it backfired. */
function VerdictPanel({ table }: { table: WerewolfTable }) {
  if (!table.lastLynched) {
    return (
      <p className={NOTE}>
        The vote was a <span className="bg-yellow px-1">tie</span>. Nobody
        hangs today. A day thrown away.
      </p>
    )
  }

  const hanged = nicknameOf(table, table.lastLynched) ?? 'somebody'

  // The Jester's win is the one outcome the table hands over by doing exactly
  // what it set out to do, so the panel says so plainly rather than burying it
  // under the usual "their role is open below".
  if (table.winningTeam === 'jester') {
    return (
      <div>
        <p className={NOTE}>
          The table hanged{' '}
          <span className="bg-pink px-1 font-semibold">{hanged}</span> — and{' '}
          <span className="bg-yellow px-1 font-semibold">
            they were the Jester
          </span>
          . That was the entire plan, and it worked. The game is over and they
          have won it alone.
        </p>
        <Collateral table={table} headlines={[table.lastLynched]} />
      </div>
    )
  }

  return (
    <div>
      <p className={NOTE}>
        The table chose{' '}
        <span className="bg-yellow px-1 font-semibold">{hanged}</span>. Their
        role is open in the list below.
      </p>
      <Collateral table={table} headlines={[table.lastLynched]} />
    </div>
  )
}

function outcomeLabel(table: WerewolfTable): string {
  if (!table.result) return 'Finished'
  if (table.result.reason === 'forfeit') return 'Broke up part way through'

  switch (table.result.team) {
    case 'werewolves':
      return 'The wolves win'
    case 'jester':
      return 'The Jester wins alone'
    default:
      return 'The village wins'
  }
}

// --- Board -----------------------------------------------------------------

export function WerewolfBoard({
  socket,
  roomId,
  sessionId,
  seated,
}: {
  socket: AppSocket | null
  roomId: string | null
  sessionId: string | null
  /**
   * How many people are in this room right now, for the start gate.
   *
   * A count rather than a roster because that is all the gate needs, and it
   * lets this panel sit in a two-person room or an eight-seat lobby without
   * knowing which it is in.
   */
  seated: number
}) {
  const { view, rejection, rejectionNonce, starting, start, move } = useGame(
    socket,
    roomId,
  )

  /**
   * The day vote you cast, so the panel can say so.
   *
   * NOT an optimistic game update — `votes` stays `{}` through the whole vote
   * phase by design, so your own choice is the one thing the server will not
   * echo back. Night choices need no equivalent: those ARE echoed, and so are
   * the Witch's two potions.
   */
  const [sent, setSent] = useState<string | null>(null)
  const [seenPhase, setSeenPhase] = useState<WerewolfPhase | null>(null)

  const table = asWerewolf(view)
  const phase = table?.phase ?? null

  // Reset on phase change. Adjusting state during render is React's documented
  // pattern for this — an effect renders the stale panel once first, and trips
  // react-hooks/set-state-in-effect. Same idiom as lib/game/use-game.ts.
  if (seenPhase !== phase) {
    setSeenPhase(phase)
    setSent(null)
  }

  if (!roomId) return null

  // Another game is running in this room, so Start has to stay shut without
  // this panel pretending that game is ours.
  const busyElsewhere = Boolean(view && !view.finished && !table)
  const running = Boolean(table && !table.finished)
  const alive = table !== null && sessionId !== null && isAlive(table, sessionId)
  const wrongSize = seated < MIN_PLAYERS || seated > MAX_PLAYERS

  return (
    <section className="mt-10 border-2 border-ink bg-stock p-6">
      <div className="flex flex-wrap items-center justify-between gap-4">
        <div>
          <h2 className="font-display text-xl leading-tight" style={DISPLAY}>
            Werewolf
          </h2>

          <p className="mt-2 text-[0.9375rem] leading-relaxed text-ink">
            {!table && busyElsewhere && 'Another game is already running.'}
            {!table && !busyElsewhere && seated < MIN_PLAYERS &&
              `Needs ${MIN_PLAYERS} people. Only ${seated} here so far.`}
            {!table && !busyElsewhere && seated > MAX_PLAYERS &&
              `Too many players. ${MAX_PLAYERS} is the limit.`}
            {!table && !busyElsewhere && !wrongSize &&
              `${seated} seated. The first night is waiting on you.`}
            {table && table.finished && outcomeLabel(table)}
            {table && !table.finished && (
              <>
                {PHASE_LABEL[table.phase]}
                {table.night > 0 && ` · night ${table.night}`}
              </>
            )}
          </p>
        </div>

        <button
          type="button"
          onClick={() => start('werewolf')}
          disabled={starting || busyElsewhere || running || wrongSize}
          className={SECONDARY}
        >
          {table?.finished ? 'Play again' : starting ? 'Dealing…' : 'Start'}
        </button>
      </div>

      {table && (
        <>
          {!table.finished && <PhaseClock table={table} />}

          <RolePanel table={table} sessionId={sessionId} />

          {/* ------------------------------------------------ the phase */}
          <div className="mt-6">
            {/* Sits above the panel, not inside one: the shot happened between
                phases, and it is the first thing the table needs to read. */}
            <HuntersShotNote table={table} />

            {table.phase === 'reveal' && (
              <Waiting>
                Roles are being dealt. Remember yours: it is not shown again
                until the game is over.
              </Waiting>
            )}

            {table.phase === 'nightZero' && (
              <NightZeroPanel
                table={table}
                sessionId={sessionId}
                onMove={move}
              />
            )}

            {table.phase === 'night' && (
              <NightPanel
                table={table}
                sessionId={sessionId}
                onMove={move}
              />
            )}

            {table.phase === 'witch' && (
              <WitchPanel table={table} sessionId={sessionId} onMove={move} />
            )}

            {table.phase === 'dawn' && <DawnPanel table={table} />}

            {/* Checked on `isRevenger`, not `alive`. The actor here is dead. */}
            {table.phase === 'revenge' && (
              <RevengePanel table={table} sessionId={sessionId} onMove={move} />
            )}

            {table.phase === 'day' &&
              (alive ? (
                <ReadyToVote
                  table={table}
                  sessionId={sessionId}
                  onToggle={() => move({ type: 'ready' })}
                />
              ) : (
                <Waiting>
                  You are dead. The living are arguing it out. You can only
                  talk to the others who are out.
                </Waiting>
              ))}

            {table.phase === 'vote' &&
              (alive ? (
                <div>
                  <p className="font-mono text-[0.75rem] leading-relaxed text-ink-soft">
                    {sent
                      ? 'Your vote is in. The others are still choosing. Nobody sees the count until this phase is over.'
                      : 'Point at whoever you suspect. Votes stay hidden until everyone has chosen, and a tie hangs nobody.'}
                  </p>

                  <TargetList
                    label="Vote for who"
                    targets={livingPlayers(table)}
                    chosen={sent}
                    // Voting for yourself is legal — the server accepts it, and
                    // a player cornered into it is making a real choice. For a
                    // Jester it is the whole strategy.
                    disabledFor={() => null}
                    onPick={(target) => {
                      move({ type: 'vote', target })
                      setSent(target)
                    }}
                  />
                </div>
              ) : (
                <Waiting>
                  You are dead. The living are voting. You are not part of it.
                </Waiting>
              ))}

            {table.phase === 'verdict' && <VerdictPanel table={table} />}

            {table.finished && (
              <div>
                <p className="font-display text-xl leading-tight" style={DISPLAY}>
                  <span className="bg-yellow box-decoration-clone px-2">
                    {outcomeLabel(table)}
                  </span>
                </p>

                {table.result && (
                  <p className="mt-3 font-mono text-[0.75rem] leading-relaxed text-ink-soft">
                    {sessionId !== null &&
                    table.result.winnerSessionIds.includes(sessionId)
                      ? 'You were on the winning side.'
                      : 'You were not on the winning side.'}{' '}
                    Every role is open in the list below.
                  </p>
                )}

                {table.lovers.length === 2 && (
                  <p className="mt-3 font-mono text-[0.75rem] leading-relaxed text-ink-soft">
                    Cupid tied{' '}
                    <span className="text-ink">
                      {nicknamesOf(table, table.lovers)}
                    </span>{' '}
                    together on the first night.
                  </p>
                )}
              </div>
            )}
          </div>

          <Roster table={table} sessionId={sessionId} />
        </>
      )}

      {rejection && (
        // Keyed so the same rejection twice in a row still re-announces itself.
        <SystemNote key={rejectionNonce} alert className="mt-5">
          {rejection}
        </SystemNote>
      )}

      {table && (
        <p className="mt-5 font-mono text-[0.6875rem] text-ink-soft">
          v{table.version} · {table.players.length} players ·{' '}
          {table.dead.length} dead
        </p>
      )}
    </section>
  )
}
