'use client'

import { useState } from 'react'

import { SystemNote } from '@/components/site-chrome'
import {
  canBond,
  canPoison,
  canTargetTonight,
  collateralOf,
  isRevenger,
  livingPlayers,
  nicknameOf,
  nicknamesOf,
  nightAction,
  nightChoice,
  packTally,
  readyThreshold,
  witchOptions,
  type WerewolfPhase,
  type WerewolfPlayer,
  type WerewolfTable,
} from '@/lib/game/werewolf-view'

import { DISPLAY_HEADING, EYEBROW, PANEL, PRIMARY, SECONDARY } from './controls'

/** Werewolf's own limits, mirrored from `server/src/games/werewolf.ts`. */
const MIN_PLAYERS = 5
const MAX_PLAYERS = 8

/**
 * The one control that changes with the phase — all nine of them.
 *
 * EVERY BRANCH RENDERS SOMETHING. A player who cannot act is told who they are
 * waiting for, because an empty panel reads as a broken UI: in a timed game a
 * player staring at a blank box assumes the connection dropped rather than that
 * they are asleep. Werewolf leans on this harder than Mr. White does — a plain
 * villager has no night action at all, three nights running.
 *
 * NOTHING HERE DECIDES LEGALITY. `onMove` sends intent and the server judges.
 * Disabling a control is a hint to the player, never enforcement, because
 * anything enforced in the browser can be undone from devtools. The `canX`
 * helpers mirror the server's rules precisely so the hint is usually right, and
 * the server is still the only thing that is always right.
 *
 * TWO PANELS BREAK THE "ONE CLICK, ONE MOVE" SHAPE. Cupid's bond needs two
 * names and the server refuses half of one, so the pair is collected locally
 * before anything is sent. The Witch has two independent potions and may spend
 * both in a night, so her panel stays open until she says she is done.
 */
export function WerewolfActions({
  table,
  you,
  seated,
  isHost,
  hostNickname,
  starting,
  onStart,
  onMove,
  rejection,
}: {
  /** Null until a game starts. */
  table: WerewolfTable | null
  you: string | null
  /** How many people are in the lobby, for the start gate. */
  seated: number
  /** Whether you opened this table. The server enforces it regardless. */
  isHost: boolean
  /** Who did, so everyone else knows who they are waiting on. */
  hostNickname: string | null
  starting: boolean
  onStart: () => void
  onMove: (intent: unknown) => void
  /** Server's reason for refusing the last move, already in words. */
  rejection?: string | null
}) {
  /**
   * The day vote you cast, so the panel can say so.
   *
   * NOT an optimistic game update — `votes` stays `{}` through the whole vote
   * phase by design, so your own choice is the one thing the server will not
   * echo back. Night choices need no equivalent: those ARE echoed.
   */
  const [sent, setSent] = useState<string | null>(null)
  const [seenPhase, setSeenPhase] = useState<WerewolfPhase | null>(null)

  const phase = table?.phase ?? null

  // Reset on phase change. Adjusting state during render is React's documented
  // pattern for this — an effect renders the stale panel once first, and trips
  // `react-hooks/set-state-in-effect`.
  if (seenPhase !== phase) {
    setSeenPhase(phase)
    setSent(null)
  }

  const body = () => {
    if (!table) {
      return (
        <StartGate
          seated={seated}
          isHost={isHost}
          hostNickname={hostNickname}
          starting={starting}
          onStart={onStart}
        />
      )
    }

    if (table.finished) {
      return <Finished table={table} you={you} onStart={onStart} isHost={isHost} />
    }

    switch (table.phase) {
      case 'reveal':
        return (
          <Waiting>
            Roles are being dealt. Remember yours — it is not shown again until
            the game is over.
          </Waiting>
        )

      case 'nightZero':
        return <NightZero table={table} you={you} onMove={onMove} />

      case 'night':
        return <Night table={table} you={you} onMove={onMove} />

      case 'witch':
        return <Witch table={table} you={you} onMove={onMove} />

      case 'dawn':
        return <Dawn table={table} />

      case 'revenge':
        return <Revenge table={table} you={you} onMove={onMove} />

      case 'day':
        return <Day table={table} you={you} onMove={onMove} />

      case 'vote':
        return <Vote table={table} you={you} sent={sent} onPick={setSent} onMove={onMove} />

      case 'verdict':
        return <Verdict table={table} />

      default:
        return null
    }
  }

  return (
    <section className={`${PANEL} p-4`} aria-label="Your move">
      {/* The shot happened BETWEEN phases — `revenge` closes the instant the
          trigger is pulled, so the phase that would have narrated it never
          opens. Without this the victim just turns up dead in the rail. */}
      {table && <ShotNote table={table} />}

      {body()}

      {rejection && (
        <SystemNote alert className="mt-4">
          {rejection}
        </SystemNote>
      )}
    </section>
  )
}

// --- Shared pieces ---------------------------------------------------------

function Waiting({ children }: { children: React.ReactNode }) {
  return (
    <p className="font-mono text-[0.6875rem] leading-relaxed text-ink-soft">
      {children}
    </p>
  )
}

function Lede({ children }: { children: React.ReactNode }) {
  return (
    <p className="font-mono text-[0.6875rem] leading-relaxed text-ink">
      {children}
    </p>
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
  /** The current pick, or several — Cupid picks two at once. */
  chosen: string | readonly string[] | null
  /** Why this target is not pickable, or null when it is. A hint, not a gate. */
  disabledFor: (sessionId: string) => string | null
  onPick: (sessionId: string) => void
  label: string
}) {
  const picks = chosen === null ? [] : typeof chosen === 'string' ? [chosen] : chosen

  return (
    <ul className="mt-3 space-y-1.5" aria-label={label}>
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
              className={`flex w-full items-baseline gap-2 border-2 border-ink px-2.5 py-1.5 text-left font-mono text-[0.75rem] text-ink transition-colors disabled:opacity-40 ${
                picked ? 'bg-yellow' : 'bg-paper enabled:hover:bg-yellow'
              }`}
            >
              <span className="min-w-0 flex-1 truncate">{player.nickname}</span>

              {blocked && (
                <span className="shrink-0 text-[0.5625rem] uppercase tracking-wide text-ink-soft">
                  {blocked}
                </span>
              )}
              {picked && (
                <span className="shrink-0 text-[0.5625rem] uppercase tracking-wide">
                  picked
                </span>
              )}
            </button>
          </li>
        )
      })}
    </ul>
  )
}

// --- Before the deal -------------------------------------------------------

function StartGate({
  seated,
  isHost,
  hostNickname,
  starting,
  onStart,
}: {
  seated: number
  isHost: boolean
  hostNickname: string | null
  starting: boolean
  onStart: () => void
}) {
  const short = seated < MIN_PLAYERS
  const crowded = seated > MAX_PLAYERS

  return (
    <div>
      <p className={EYEBROW}>the deal</p>
      <p
        className="mt-1 font-display text-lg leading-tight"
        style={DISPLAY_HEADING}
      >
        {short
          ? `${MIN_PLAYERS - seated} more to go`
          : crowded
            ? 'Too many for one table'
            : 'Ready when you are'}
      </p>

      <p className="mt-2 font-mono text-[0.6875rem] leading-relaxed text-ink-soft">
        {short
          ? `Werewolf needs ${MIN_PLAYERS}. ${seated} here so far.`
          : crowded
            ? `${MAX_PLAYERS} is the limit, and there are ${seated} of you.`
            : `${seated} seated. Roles are dealt at random the moment this starts.`}
      </p>

      {isHost ? (
        <button
          type="button"
          onClick={onStart}
          disabled={starting || short || crowded}
          className={`${PRIMARY} mt-4 w-full`}
        >
          {starting ? 'Dealing…' : 'Deal the roles'}
        </button>
      ) : (
        <p className="mt-4 font-mono text-[0.6875rem] leading-relaxed text-ink-soft">
          {hostNickname ?? 'Whoever opened this table'} starts it.
        </p>
      )}
    </div>
  )
}

// --- Night zero ------------------------------------------------------------

/**
 * Cupid, once, and nobody else ever.
 *
 * COLLECTS BOTH NAMES BEFORE SENDING ANYTHING. A one-sided bond is not a state
 * the rules have, so the half-finished selection lives here in local state and
 * never as a move. Toggling a name off is free right up until the second lands.
 */
function NightZero({
  table,
  you,
  onMove,
}: {
  table: WerewolfTable
  you: string | null
  onMove: (intent: unknown) => void
}) {
  const [picks, setPicks] = useState<string[]>([])

  if (!canBond(table, you)) {
    return (
      <Waiting>
        {table.lovers.length > 0
          ? 'Cupid has chosen. Two people here are bound to each other now, and neither can outlive the other.'
          : 'The first night. Cupid is awake, tying two people together. Everyone else is asleep — even the pack does not hunt tonight.'}
      </Waiting>
    )
  }

  const toggle = (id: string) => {
    if (picks.includes(id)) {
      setPicks(picks.filter((pick) => pick !== id))
      return
    }

    // The second name commits the pair. No confirm step: the choice IS the two
    // names, and an "are you sure" after them adds a click, not a decision.
    const next = [...picks, id]
    setPicks(next)
    if (next.length === 2) onMove({ type: 'bond', targets: next })
  }

  return (
    <div>
      <p className={EYEBROW}>tie two people together</p>
      <Lede>
        {picks.length === 0
          ? 'From tonight they live and die as one. You may tie yourself in.'
          : `${nicknameOf(table, picks[0] ?? '') ?? 'Somebody'} is chosen. Pick the second and the bond is made.`}
      </Lede>

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

// --- Night -----------------------------------------------------------------

const NIGHT_VERB = {
  kill: 'Eat',
  inspect: 'Read',
  protect: 'Cover',
} as const

function Night({
  table,
  you,
  onMove,
}: {
  table: WerewolfTable
  you: string | null
  onMove: (intent: unknown) => void
}) {
  const action = nightAction(table, you)
  const chosen = nightChoice(table, you)
  const pack = packTally(table)

  if (!action) {
    return (
      <Waiting>
        {you !== null && table.dead.includes(you)
          ? 'You are dead. The night carries on without you, but you can still talk to the others who are out.'
          : table.yourRole === 'witch'
            ? 'Night. The pack is choosing. Stay asleep — you wake after them, and you get to see what they did.'
            : 'Night. You are asleep. The wolves, the Seer and the Guard are moving. Wait for dawn.'}
      </Waiting>
    )
  }

  const hint = {
    kill: 'Pick one person to eat. If the pack splits, whoever draws the most votes is taken.',
    inspect: 'Pick one person to read. All you are told is whether they are a werewolf.',
    protect: 'Pick one person to cover. If the pack attacks them tonight, they live.',
  }[action]

  return (
    <div>
      <p className={EYEBROW}>{NIGHT_VERB[action].toLowerCase()} who</p>
      <Lede>
        {chosen
          ? `Picked ${nicknameOf(table, chosen) ?? '-'}. You can still change it until the night is over.`
          : hint}
      </Lede>

      <TargetList
        label={`${NIGHT_VERB[action]} who`}
        targets={livingPlayers(table)}
        chosen={chosen}
        disabledFor={(id) =>
          canTargetTonight(table, you, id)
            ? null
            : id === you
              ? 'yourself'
              : action === 'kill'
                ? 'your pack'
                : action === 'inspect'
                  ? 'already read'
                  : 'covered last night'
        }
        onPick={(target) => onMove({ type: action, target })}
      />

      {/* Wolves only: `wolfVotes` is `{}` in everyone else's payload, so this
          is empty for them rather than something hidden in the UI. */}
      {action === 'kill' && Object.keys(pack).length > 0 && (
        <p className="mt-3 font-mono text-[0.625rem] leading-relaxed text-ink-soft">
          the pack so far ·{' '}
          {Object.entries(pack)
            .map(([id, count]) => `${nicknameOf(table, id) ?? '?'} ${count}`)
            .join(' · ')}
        </p>
      )}
    </div>
  )
}

// --- The Witch -------------------------------------------------------------

/**
 * The only panel that shows a kill before it happens.
 *
 * `pendingKill` reaches exactly one browser and only while this phase is open —
 * outside it the server sends null, so there is no window in which it sits in
 * anyone's payload waiting to be read.
 */
function Witch({
  table,
  you,
  onMove,
}: {
  table: WerewolfTable
  you: string | null
  onMove: (intent: unknown) => void
}) {
  const options = witchOptions(table, you)
  const dead = you !== null && table.dead.includes(you)

  if (table.yourRole !== 'witch' || dead) {
    return (
      <Waiting>
        {dead
          ? 'You are dead. The Witch is awake, and whatever she does you will read about at dawn.'
          : 'The Witch is awake. She has seen what the pack did, and she is deciding whether to undo it.'}
      </Waiting>
    )
  }

  const victim = nicknameOf(table, table.pendingKill)

  return (
    <div>
      <p className={EYEBROW}>what the pack did</p>
      <Lede>
        {table.pendingKill ? (
          <>
            They went for{' '}
            <span className="bg-yellow px-1 font-semibold">{victim}</span>.
          </>
        ) : table.pendingSaved ? (
          'They attacked, and it came to nothing — somebody else got there first. Keep your heal.'
        ) : (
          'They never settled on anybody tonight. There is nothing to undo.'
        )}
      </Lede>

      {/* ------------------------------------------------------------- heal */}
      {table.witchHealed ? (
        <p className="mt-3 border-l-4 border-pink bg-paper px-3 py-2 font-mono text-[0.625rem] leading-relaxed text-ink">
          You spent the heal. They wake in the morning, and the table is told
          only that nobody died.
        </p>
      ) : (
        <button
          type="button"
          onClick={() => onMove({ type: 'heal' })}
          disabled={!options.heal}
          className={`${SECONDARY} mt-3 w-full`}
        >
          {table.healUsed
            ? 'Heal — spent'
            : table.pendingKill
              ? `Save ${victim ?? 'them'}`
              : 'Heal — nobody to save'}
        </button>
      )}

      {/* ----------------------------------------------------------- poison */}
      <div className="mt-4">
        <p className={EYEBROW}>the other bottle</p>

        {table.witchPoison ? (
          <p className="mt-1.5 border-l-4 border-pink bg-paper px-3 py-2 font-mono text-[0.625rem] leading-relaxed text-ink">
            You poisoned{' '}
            <span className="font-semibold">
              {nicknameOf(table, table.witchPoison) ?? 'somebody'}
            </span>
            . Nothing about the body says it was you rather than the pack.
          </p>
        ) : table.poisonUsed ? (
          <Waiting>The poison is gone. You used it on an earlier night.</Waiting>
        ) : (
          <>
            <Waiting>Kill one person, once in the whole game.</Waiting>
            <TargetList
              label="Poison who"
              targets={livingPlayers(table)}
              chosen={null}
              disabledFor={(id) =>
                canPoison(table, you, id) ? null : id === you ? 'yourself' : 'not tonight'
              }
              onPick={(target) => onMove({ type: 'poison', target })}
            />
          </>
        )}
      </div>

      <button
        type="button"
        onClick={() => onMove({ type: 'pass' })}
        className={`${SECONDARY} mt-4 w-full`}
      >
        Done for tonight
      </button>
    </div>
  )
}

// --- The Hunter ------------------------------------------------------------

/**
 * The one panel a dead player drives.
 *
 * Everywhere else dying ends your turn, so this asks `isRevenger` rather than
 * whether you are alive — the usual question would lock the Hunter out of the
 * only phase that exists for them.
 */
function Revenge({
  table,
  you,
  onMove,
}: {
  table: WerewolfTable
  you: string | null
  onMove: (intent: unknown) => void
}) {
  const hunter = nicknameOf(table, table.revengeBy) ?? 'The Hunter'

  if (!isRevenger(table, you)) {
    return (
      <Lede>
        <span className="bg-yellow px-1 font-semibold">{hunter}</span> was the
        Hunter — and a dying Hunter does not go alone. They are choosing who
        follows them.
      </Lede>
    )
  }

  return (
    <div>
      <p className={EYEBROW}>take one with you</p>
      <Lede>
        One shot, and the clock is short. Let it run out and nobody goes with
        you.
      </Lede>

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

// --- Day and vote ----------------------------------------------------------

function Day({
  table,
  you,
  onMove,
}: {
  table: WerewolfTable
  you: string | null
  onMove: (intent: unknown) => void
}) {
  if (you !== null && table.dead.includes(you)) {
    return (
      <Waiting>
        You are dead. The living are arguing it out. You can only talk to the
        others who are out.
      </Waiting>
    )
  }

  const ready = table.readyToVote.length
  const needed = readyThreshold(table)
  const youAreReady = you !== null && table.readyToVote.includes(you)

  return (
    <div>
      <p className={EYEBROW}>the argument</p>
      <Lede>
        Nothing to click while you talk. You do not have to wait the clock out,
        though.
      </Lede>

      <button
        type="button"
        aria-pressed={youAreReady}
        onClick={() => onMove({ type: 'ready' })}
        className={`mt-3 w-full border-2 border-ink px-4 py-2 font-mono text-[0.75rem] text-ink transition-colors ${
          youAreReady ? 'bg-yellow' : 'bg-paper hover:bg-yellow'
        }`}
      >
        {youAreReady ? 'Ready — press to take it back' : 'Ready to vote'}
      </button>

      <p
        aria-live="polite"
        className="mt-2 font-mono text-[0.625rem] text-ink-soft"
      >
        <span className="tabular-nums text-ink">
          {ready} of {needed}
        </span>{' '}
        ready.{' '}
        {needed - ready > 0
          ? `${needed - ready} more opens the vote.`
          : 'Voting is open.'}
      </p>
    </div>
  )
}

function Vote({
  table,
  you,
  sent,
  onPick,
  onMove,
}: {
  table: WerewolfTable
  you: string | null
  sent: string | null
  onPick: (target: string) => void
  onMove: (intent: unknown) => void
}) {
  if (you !== null && table.dead.includes(you)) {
    return <Waiting>You are dead. The living are voting. You are not part of it.</Waiting>
  }

  return (
    <div>
      <p className={EYEBROW}>vote for who</p>
      <Lede>
        {sent
          ? 'Your vote is in. Nobody sees the count until this phase is over.'
          : 'Point at whoever you suspect. Votes stay hidden until then, and a tie hangs nobody.'}
      </Lede>

      <TargetList
        label="Vote for who"
        targets={livingPlayers(table)}
        chosen={sent}
        // Voting for yourself is legal — the server accepts it, and for a
        // Jester it is the entire strategy.
        disabledFor={() => null}
        onPick={(target) => {
          onMove({ type: 'vote', target })
          onPick(target)
        }}
      />
    </div>
  )
}

// --- Narration -------------------------------------------------------------

/** Whoever the bond dragged down, on top of the death everyone expected. */
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
    <p className="mt-2 border-l-4 border-pink bg-paper px-3 py-2 font-mono text-[0.625rem] leading-relaxed text-ink">
      <span className="font-semibold">{nicknamesOf(table, also)}</span> died in
      the same moment — somebody here was tied to a person who was not going to
      live through it.
    </p>
  )
}

function Dawn({ table }: { table: WerewolfTable }) {
  const poisoned = nicknameOf(table, table.lastPoisoned)

  return (
    <div>
      <p className={EYEBROW}>dawn</p>

      {table.lastHealed ? (
        <Lede>
          The pack attacked, and{' '}
          <span className="bg-yellow px-1">it did not take</span>. Someone was
          awake with a bottle in their hand.
        </Lede>
      ) : table.lastSaved ? (
        <Lede>
          The pack attacked, but{' '}
          <span className="bg-yellow px-1">nobody died</span>. The Guard covered
          exactly the right person.
        </Lede>
      ) : table.lastKilled ? (
        <Lede>
          <span className="bg-yellow px-1 font-semibold">
            {nicknameOf(table, table.lastKilled) ?? 'Somebody'}
          </span>{' '}
          did not wake up.
        </Lede>
      ) : (
        <Lede>Nobody was taken by the pack last night.</Lede>
      )}

      {/* Announced, never attributed. From the body this is another kill. */}
      {poisoned && (
        <p className="mt-2 font-mono text-[0.6875rem] leading-relaxed text-ink">
          <span className="bg-yellow px-1 font-semibold">{poisoned}</span> was
          found dead as well. Nothing says who did it.
        </p>
      )}

      <Collateral table={table} headlines={[table.lastKilled, table.lastPoisoned]} />
    </div>
  )
}

function Verdict({ table }: { table: WerewolfTable }) {
  if (!table.lastLynched) {
    return (
      <div>
        <p className={EYEBROW}>the verdict</p>
        <Lede>
          A <span className="bg-yellow px-1">tie</span>. Nobody hangs today — a
          day thrown away.
        </Lede>
      </div>
    )
  }

  const hanged = nicknameOf(table, table.lastLynched) ?? 'somebody'

  return (
    <div>
      <p className={EYEBROW}>the verdict</p>

      {table.winningTeam === 'jester' ? (
        <Lede>
          The table hanged{' '}
          <span className="bg-pink px-1 font-semibold">{hanged}</span> — and{' '}
          <span className="bg-yellow px-1 font-semibold">
            they were the Jester
          </span>
          . That was the entire plan, and it worked.
        </Lede>
      ) : (
        <Lede>
          The table chose{' '}
          <span className="bg-yellow px-1 font-semibold">{hanged}</span>.
        </Lede>
      )}

      <Collateral table={table} headlines={[table.lastLynched]} />
    </div>
  )
}

/**
 * What the Hunter's shot did, carried into the phase that follows it.
 *
 * The server clears `lastShot` at the next resolution in either direction, so
 * this shows for exactly one day or one night and then goes quiet on its own.
 */
function ShotNote({ table }: { table: WerewolfTable }) {
  if (!table.lastShot || table.phase === 'revenge') return null

  const hunter = nicknameOf(table, table.revengeBy)
  const shot = nicknameOf(table, table.lastShot) ?? 'somebody'

  return (
    <p className="mb-3 border-l-4 border-pink bg-paper px-3 py-2 font-mono text-[0.625rem] leading-relaxed text-ink">
      {hunter ? `${hunter}, dying, ` : 'The dying Hunter '}took{' '}
      <span className="bg-yellow px-1 font-semibold">{shot}</span> with them.
    </p>
  )
}

// --- The end ---------------------------------------------------------------

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

function Finished({
  table,
  you,
  isHost,
  onStart,
}: {
  table: WerewolfTable
  you: string | null
  isHost: boolean
  onStart: () => void
}) {
  const won =
    you !== null && (table.result?.winnerSessionIds.includes(you) ?? false)

  return (
    <div>
      <p className={EYEBROW}>result</p>
      <p
        className="mt-1 font-display text-lg leading-tight"
        style={DISPLAY_HEADING}
      >
        <span className="bg-yellow box-decoration-clone px-1.5">
          {outcomeLabel(table)}
        </span>
      </p>

      {table.result && (
        <p className="mt-3 font-mono text-[0.6875rem] leading-relaxed text-ink-soft">
          {won ? 'You were on the winning side.' : 'You were not on the winning side.'}{' '}
          Every role is open in the rail.
        </p>
      )}

      {table.lovers.length === 2 && (
        <p className="mt-2 font-mono text-[0.625rem] leading-relaxed text-ink-soft">
          Cupid tied{' '}
          <span className="text-ink">{nicknamesOf(table, table.lovers)}</span>{' '}
          together on the first night.
        </p>
      )}

      {isHost && (
        <button type="button" onClick={onStart} className={`${PRIMARY} mt-4 w-full`}>
          Deal again
        </button>
      )}
    </div>
  )
}
