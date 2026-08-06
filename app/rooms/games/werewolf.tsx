'use client'

import { useState } from 'react'

import { SystemNote } from '@/app/chrome'
import { toSeconds, useCountdown } from '@/lib/game/use-countdown'
import { useGame } from '@/lib/game/use-game'
import {
  asWerewolf,
  canTargetTonight,
  isAlive,
  livingPlayers,
  nicknameOf,
  nightAction,
  nightChoice,
  packTally,
  readyThreshold,
  voteTally,
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
 * FOUR PLAYERS SEE FOUR DIFFERENT SCREENS, and none of that is decided here.
 * The wolf's packmate list, the Seer's ledger and the Guard's shield are absent
 * from everyone else's payload — `werewolf.viewFor` on the server built each
 * viewer their own. So this component is not choosing what to hide; there is
 * genuinely nothing here to bypass. What it chooses is what to DRAW, which is a
 * different question with the same answer per role.
 *
 * As everywhere else in this app the UI only *disables* what it believes is
 * illegal. Every click is still sent, and the server is the sole judge —
 * anything enforced in the browser can be undone from devtools.
 *
 * NIGHT CHOICES ARE ECHOED, THE DAY VOTE IS NOT. A wolf gets `wolfVotes` back
 * and the Seer gets `seerTarget` back, so those panels read their own selection
 * straight off the server. `votes` stays `{}` for the whole voting phase by
 * design, so the only way to show "you picked Rina" is to remember it locally —
 * hence `sent`, which is discarded the moment the phase turns over.
 */

/**
 * Outline control.
 *
 * The only button on this panel with a fixed style. Every other control here is
 * a target in a list, and those carry their own selected/blocked states — a
 * filled `PRIMARY` alongside them would claim a hierarchy the table does not
 * have, since picking a victim is not a lesser action than starting the game.
 */
const SECONDARY =
  'border-2 border-ink px-5 py-2.5 font-mono text-sm text-ink transition-colors hover:bg-yellow disabled:opacity-40 disabled:hover:bg-transparent'

const EYEBROW =
  'font-mono text-[0.6875rem] uppercase tracking-wide text-ink-soft'

const DISPLAY: React.CSSProperties = {
  fontVariationSettings: "'wght' 800, 'wdth' 95",
}

/** Werewolf's own limits, mirrored from `server/src/games/werewolf.ts`. */
const MIN_PLAYERS = 5
const MAX_PLAYERS = 8

/** The action verb on each night panel's buttons. */
const NIGHT_VERB = {
  kill: 'Makan',
  inspect: 'Ramal',
  protect: 'Jaga',
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
 * could act on — `packmates` is `[]` in their payload, not filtered here.
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
        <p className={EYEBROW}>peran kamu</p>
        {dead && (
          <p className="border border-ink px-1.5 font-mono text-[0.625rem] uppercase tracking-wide text-ink-soft">
            udah mati
          </p>
        )}
      </div>

      <p className="mt-1.5 font-display text-2xl leading-none" style={DISPLAY}>
        <span className="bg-yellow box-decoration-clone px-2 py-0.5">
          {role === null ? 'Nonton' : ROLE_LABEL[role]}
        </span>
      </p>

      <p className="mt-4 border-l-4 border-pink bg-stock px-3 py-2.5 font-mono text-[0.75rem] leading-relaxed text-ink">
        {role === null
          ? 'Kamu nggak ikut main di meja ini. Yang kamu lihat sama persis kayak yang dilihat ruangan.'
          : ROLE_BRIEF[role]}
      </p>

      {/* ------------------------------------------------------- the pack */}
      {table.packmates.length > 0 && (
        <div className="mt-4">
          <p className={EYEBROW}>temen sekawanan</p>
          <p className="mt-1 font-mono text-[0.8125rem] text-ink">
            {table.packmates
              .map((id) => nicknameOf(table, id) ?? 'entah siapa')
              .join(', ')}
          </p>
        </div>
      )}

      {/* --------------------------------------------- the seer's ledger */}
      {Object.keys(table.inspections).length > 0 && (
        <div className="mt-4">
          <p className={EYEBROW}>hasil ramalan</p>
          <ul className="mt-1 space-y-1">
            {Object.entries(table.inspections).map(([id, alignment]) => (
              <li key={id} className="font-mono text-[0.8125rem] text-ink">
                {nicknameOf(table, id) ?? id}
                {' — '}
                <span
                  className={
                    alignment === 'werewolf'
                      ? 'bg-yellow px-1 font-semibold'
                      : 'text-ink-soft'
                  }
                >
                  {alignment === 'werewolf' ? 'WEREWOLF' : 'bukan werewolf'}
                </span>
              </li>
            ))}
          </ul>
        </div>
      )}

      {/* ------------------------------------------------- the guard's log */}
      {table.yourRole === 'guard' && table.lastProtected && (
        <p className="mt-4 font-mono text-[0.75rem] text-ink-soft">
          Semalam kamu jagain{' '}
          <span className="text-ink">
            {nicknameOf(table, table.lastProtected) ?? '—'}
          </span>
          . Malam ini harus orang lain.
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
 * for everyone, the moment they died.
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
                kamu
              </span>
            )}

            {/* The server publishes a role only once its owner is out of the
                game — or once the game itself is over. */}
            {revealed && (
              <span className="text-[0.625rem] uppercase tracking-wide no-underline">
                {ROLE_LABEL[revealed]}
              </span>
            )}

            {missing && alive && (
              <span className="text-[0.625rem] uppercase tracking-wide text-ink-soft no-underline">
                putus — nunggu balik
              </span>
            )}

            {/* Only ever non-zero once `votes` is public, which is never during
                the vote itself. */}
            {dayVotes > 0 && (
              <span className="ml-auto bg-yellow px-1.5 tabular-nums no-underline">
                {dayVotes} suara
              </span>
            )}

            {/* Wolves only: `wolfVotes` is `{}` in everyone else's payload. */}
            {packVotes > 0 && (
              <span className="ml-auto border border-ink px-1.5 tabular-nums no-underline">
                {packVotes} kawanan
              </span>
            )}
          </li>
        )
      })}
    </ul>
  )
}

/** A pickable list of players. Shared by the night actions and the day vote. */
function TargetList({
  targets,
  chosen,
  disabledFor,
  onPick,
  label,
}: {
  targets: WerewolfPlayer[]
  chosen: string | null
  /** Why this target is not pickable, or null when it is. A hint, not a gate. */
  disabledFor: (sessionId: string) => string | null
  onPick: (sessionId: string) => void
  label: string
}) {
  return (
    <ul className="mt-3 space-y-2" aria-label={label}>
      {targets.map((player) => {
        const blocked = disabledFor(player.sessionId)
        const picked = chosen === player.sessionId

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
                  pilihan kamu
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
 * The night.
 *
 * Three roles act at once and a villager acts not at all — which is why this
 * renders a real panel for the sleeping majority too. In a timed game a player
 * staring at a blank box assumes the connection died rather than that they have
 * nothing to do.
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
          ? 'Kamu udah mati. Malam jalan terus tanpa kamu — tapi kamu masih bisa ngobrol sama yang udah mati.'
          : 'Malam. Kamu tidur — werewolf, peramal sama penjaga lagi gerak. Tungguin pagi.'}
      </Waiting>
    )
  }

  const hint = {
    kill: 'Pilih satu orang buat dimakan malam ini. Kalau kawanan kamu milih beda-beda, yang paling banyak dipilih yang kena.',
    inspect: 'Pilih satu orang buat diintip. Kamu cuma dikasih tahu dia werewolf atau bukan.',
    protect:
      'Pilih satu orang buat dijagain. Kalau werewolf nyerang dia malam ini, dia selamat.',
  }[action]

  return (
    <div>
      <p className="font-mono text-[0.75rem] leading-relaxed text-ink-soft">
        {chosen
          ? `Udah kepilih: ${nicknameOf(table, chosen) ?? '—'}. Masih bisa diganti sampai malam habis.`
          : hint}
      </p>

      <TargetList
        label={`${NIGHT_VERB[action]} siapa`}
        targets={livingPlayers(table)}
        chosen={chosen}
        disabledFor={(id) =>
          canTargetTonight(table, sessionId, id)
            ? null
            : id === sessionId
              ? 'kamu sendiri'
              : action === 'kill'
                ? 'sekawanan'
                : action === 'inspect'
                  ? 'udah diramal'
                  : 'semalam udah'
        }
        onPick={(target) => onMove({ type: action, target })}
      />
    </div>
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
        Debat di chat. Nggak ada gerakan di fase ini — tapi kalian nggak harus
        nunggu jamnya habis.
      </p>

      <button
        type="button"
        aria-pressed={youAreReady}
        onClick={onToggle}
        className={`mt-4 w-full border-2 border-ink px-4 py-2.5 font-mono text-sm text-ink transition-colors ${
          youAreReady ? 'bg-yellow' : 'bg-paper hover:bg-yellow'
        }`}
      >
        {youAreReady ? 'Siap voting — pencet lagi buat batal' : 'Siap voting'}
      </button>

      <p aria-live="polite" className="mt-2 font-mono text-[0.6875rem] text-ink-soft">
        <span className="tabular-nums text-ink">
          {ready} dari {needed}
        </span>{' '}
        siap.{' '}
        {needed - ready > 0
          ? `${needed - ready} lagi, voting langsung dibuka.`
          : 'Voting dibuka.'}
      </p>
    </div>
  )
}

/** What the night did. Written for the whole table — this part is public. */
function DawnPanel({ table }: { table: WerewolfTable }) {
  if (table.lastSaved) {
    return (
      <p className="font-mono text-[0.8125rem] leading-relaxed text-ink">
        Werewolf nyerang semalam, tapi <span className="bg-yellow px-1">nggak ada yang mati</span>.
        Penjaga nutupin orang yang tepat.
      </p>
    )
  }

  if (!table.lastKilled) {
    return (
      <p className="font-mono text-[0.8125rem] leading-relaxed text-ink">
        Semalam nggak ada yang mati.
      </p>
    )
  }

  return (
    <p className="font-mono text-[0.8125rem] leading-relaxed text-ink">
      <span className="bg-yellow px-1 font-semibold">
        {nicknameOf(table, table.lastKilled) ?? 'Seseorang'}
      </span>{' '}
      nggak bangun pagi ini. Perannya udah kebuka di daftar bawah.
    </p>
  )
}

/** What the vote did — including the case where it did nothing. */
function VerdictPanel({ table }: { table: WerewolfTable }) {
  if (!table.lastLynched) {
    return (
      <p className="font-mono text-[0.8125rem] leading-relaxed text-ink">
        Suaranya <span className="bg-yellow px-1">seri</span> — nggak ada yang
        digantung hari ini. Satu hari kebuang.
      </p>
    )
  }

  return (
    <p className="font-mono text-[0.8125rem] leading-relaxed text-ink">
      Meja milih{' '}
      <span className="bg-yellow px-1 font-semibold">
        {nicknameOf(table, table.lastLynched) ?? 'seseorang'}
      </span>
      . Perannya udah kebuka di daftar bawah.
    </p>
  )
}

function outcomeLabel(table: WerewolfTable): string {
  if (!table.result) return 'Selesai'
  if (table.result.reason === 'forfeit') return 'Bubar di tengah jalan'

  return table.result.team === 'werewolves' ? 'Werewolf menang' : 'Warga menang'
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
   * echo back. Night choices need no equivalent: those ARE echoed.
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
            {!table && busyElsewhere && 'Ada game lain yang lagi jalan.'}
            {!table && !busyElsewhere && seated < MIN_PLAYERS &&
              `Butuh ${MIN_PLAYERS} orang. Baru ${seated} di sini.`}
            {!table && !busyElsewhere && seated > MAX_PLAYERS &&
              `Kebanyakan — ${MAX_PLAYERS} orang batasnya.`}
            {!table && !busyElsewhere && !wrongSize &&
              `${seated} orang duduk. Malam pertama nunggu kamu.`}
            {table && table.finished && outcomeLabel(table)}
            {table && !table.finished && (
              <>
                {PHASE_LABEL[table.phase]}
                {table.night > 0 && ` · malam ke-${table.night}`}
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
          {table?.finished ? 'Main lagi' : starting ? 'Bagi peran…' : 'Mulai'}
        </button>
      </div>

      {table && (
        <>
          {!table.finished && <PhaseClock table={table} />}

          <RolePanel table={table} sessionId={sessionId} />

          {/* ------------------------------------------------ the phase */}
          <div className="mt-6">
            {table.phase === 'reveal' && (
              <Waiting>
                Peran lagi dibagi. Inget baik-baik — nggak ditunjukin lagi
                sampai permainan selesai.
              </Waiting>
            )}

            {table.phase === 'night' && (
              <NightPanel
                table={table}
                sessionId={sessionId}
                onMove={move}
              />
            )}

            {table.phase === 'dawn' && <DawnPanel table={table} />}

            {table.phase === 'day' &&
              (alive ? (
                <ReadyToVote
                  table={table}
                  sessionId={sessionId}
                  onToggle={() => move({ type: 'ready' })}
                />
              ) : (
                <Waiting>
                  Kamu udah mati. Yang hidup lagi berdebat — kamu cuma bisa
                  ngobrol sama sesama yang udah mati.
                </Waiting>
              ))}

            {table.phase === 'vote' &&
              (alive ? (
                <div>
                  <p className="font-mono text-[0.75rem] leading-relaxed text-ink-soft">
                    {sent
                      ? 'Suara kamu udah masuk. Yang lain masih milih — nggak ada yang lihat hitungannya sampai fase ini kelar.'
                      : 'Tunjuk satu orang yang kamu curigai. Suara disembunyiin sampai semua milih, dan kalau seri nggak ada yang digantung.'}
                  </p>

                  <TargetList
                    label="Voting siapa"
                    targets={livingPlayers(table)}
                    chosen={sent}
                    // Voting for yourself is legal — the server accepts it, and
                    // a player cornered into it is making a real choice.
                    disabledFor={() => null}
                    onPick={(target) => {
                      move({ type: 'vote', target })
                      setSent(target)
                    }}
                  />
                </div>
              ) : (
                <Waiting>
                  Kamu udah mati. Yang hidup lagi voting — kamu nggak ikut.
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
                      ? 'Kamu di pihak yang menang.'
                      : 'Kamu nggak di pihak yang menang.'}{' '}
                    Semua peran udah kebuka di daftar bawah.
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
          v{table.version} · {table.players.length} pemain ·{' '}
          {table.dead.length} mati
        </p>
      )}
    </section>
  )
}
