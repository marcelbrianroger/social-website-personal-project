'use client'

import { SystemNote } from '@/app/chrome'
import { useCountdown, toSeconds } from '@/lib/game/use-countdown'
import { useGame } from '@/lib/game/use-game'
import {
  asQuestions,
  askerNickname,
  isMyTurn,
  isPerformer,
  nicknameOf,
  partnerOf,
  progressOf,
  vetosLeft,
  SET_LABEL,
  type QuestionsTable,
} from '@/lib/game/questions-view'
import type { AppSocket } from '@/lib/webrtc/use-p2p-room'

/**
 * 36 Questions, with Veto and Penalty.
 *
 * THE DARE TAKES OVER THE PANEL. When one is owed, the question card is
 * replaced rather than pushed down the page — the pair are meant to be doing
 * the dare, not reading ahead to the question they just bought their way out
 * of. It is also the only screen here with two genuinely different versions:
 * the performer is told what to do, the partner is told to watch and holds the
 * only button that ends it.
 *
 * As everywhere else in this app the UI only *disables* what it believes is
 * illegal. Every click is still sent, and the server is the sole judge.
 */

const PRIMARY =
  'border-2 border-ink bg-ink px-6 py-2.5 font-mono text-sm text-paper transition-colors hover:bg-pink hover:text-ink disabled:opacity-40 disabled:hover:bg-ink disabled:hover:text-paper'

const SECONDARY =
  'border-2 border-ink px-5 py-2.5 font-mono text-sm text-ink transition-colors hover:bg-yellow disabled:opacity-40 disabled:hover:bg-transparent'

function OutcomeLine({
  table,
  sessionId,
}: {
  table: QuestionsTable
  sessionId: string | null
}) {
  if (!table.result) return null

  if (table.result.reason === 'forfeit') {
    const stayed = table.result.winnerSessionIds[0] === sessionId
    return (
      <>{stayed ? 'Your partner left first.' : 'You walked out of this session.'}</>
    )
  }

  // Co-operative: finishing names both of them, so there is no loser to write
  // a line for.
  return <>Done. Thirty-six questions, the two of you.</>
}

/**
 * The question card, or the back of it.
 *
 * Only the card holder gets the text — and they get it because the SERVER sent
 * it to them and not to their partner. This component is not deciding anything;
 * `question` is genuinely absent from the listener's payload, so there is
 * nothing here to bypass.
 */
function QuestionCard({
  table,
  sessionId,
}: {
  table: QuestionsTable
  sessionId: string | null
}) {
  if (isMyTurn(table, sessionId)) {
    return (
      <div className="mt-6 border-2 border-ink bg-paper p-6">
        <p className="font-mono text-[0.6875rem] uppercase tracking-wide text-ink-soft">
          Your turn to read
        </p>
        <p
          className="mt-3 font-display text-2xl leading-snug text-ink"
          style={{ fontVariationSettings: "'wght' 800, 'wdth' 95" }}
        >
          {table.question}
        </p>
      </div>
    )
  }

  return (
    // Hatched rather than blank: an empty panel reads as something failing to
    // load, and this is a card lying face down on purpose.
    <div className="mt-6 border-2 border-dashed border-rule bg-stock p-6">
      <p className="font-mono text-[0.6875rem] uppercase tracking-wide text-ink-soft">
        {askerNickname(table)} is holding the card
      </p>
      <p className="mt-3 text-[0.9375rem] leading-relaxed text-ink-soft">
        {askerNickname(table)} reads the question out. You answer first, then
        they do.
      </p>
    </div>
  )
}

/** The dare screen. Two versions of the same state, by design. */
function DarePanel({
  table,
  sessionId,
  onResolve,
}: {
  table: QuestionsTable
  sessionId: string | null
  onResolve: () => void
}) {
  const dare = table.activeDare
  const remaining = useCountdown(dare?.endsAt ?? null, table.serverNow)
  const seconds = toSeconds(remaining)

  if (!dare) return null

  const mine = isPerformer(dare, sessionId)
  const performer = nicknameOf(table, dare.sessionId)
  // Only the partner may end it, so this is also exactly `table.actors`.
  const canResolve = sessionId !== null && table.actors.includes(sessionId)

  return (
    <div className="mt-6 border-2 border-ink bg-yellow p-6">
      <p className="font-mono text-[0.6875rem] uppercase tracking-wide text-ink">
        {mine ? 'Your penalty' : `Penalty for ${performer}`}
        {' · '}
        {/* Skipping is what the veto bought; naming it keeps the cost visible. */}
        question {dare.questionIndex + 1} skipped
      </p>

      <p
        className="mt-3 font-display text-xl leading-snug text-ink"
        style={{ fontVariationSettings: "'wght' 800, 'wdth' 95" }}
      >
        {dare.text}
      </p>

      <div className="mt-5 flex flex-wrap items-center gap-4">
        {canResolve ? (
          <button type="button" onClick={onResolve} className={PRIMARY}>
            They did it
          </button>
        ) : (
          <p className="font-mono text-sm text-ink">
            Waiting for {partnerOf(table, sessionId)?.nickname ?? 'your partner'} to confirm…
          </p>
        )}

        {!mine && (
          <p className="text-[0.9375rem] leading-relaxed text-ink">
            Watching {performer} do their penalty…
          </p>
        )}

        {seconds !== null && (
          // The partner holds the only button, so the clock is the promise that
          // the room cannot be frozen by one person wandering off.
          <span className="ml-auto font-mono text-[0.6875rem] text-ink">
            moves on automatically in {Math.floor(seconds / 60)}:
            {String(seconds % 60).padStart(2, '0')}
          </span>
        )}
      </div>
    </div>
  )
}

export function QuestionsBoard({
  socket,
  roomId,
  sessionId,
  peerCount,
}: {
  socket: AppSocket | null
  roomId: string | null
  sessionId: string | null
  peerCount: number
}) {
  const { view, rejection, rejectionNonce, starting, start, move } = useGame(
    socket,
    roomId,
  )

  if (!roomId) return null

  const table = asQuestions(view)
  // Another game is running in this room, so Start has to stay shut without
  // this panel pretending that game is ours.
  const busyElsewhere = Boolean(view && !view.finished && !table)

  const myVetos = table ? vetosLeft(table, sessionId) : 0
  const canAct = Boolean(table && !table.finished && sessionId && table.actors.includes(sessionId))
  const dare = table?.activeDare ?? null

  return (
    <section className="border-2 border-ink bg-stock p-6">
      <div className="flex flex-wrap items-center justify-between gap-4">
        <div>
          <h2
            className="font-display text-xl leading-tight"
            style={{ fontVariationSettings: "'wght' 800, 'wdth' 95" }}
          >
            36 Questions
          </h2>
          <p className="mt-2 text-[0.9375rem] leading-relaxed text-ink">
            {!table && peerCount === 0 && 'Needs one more person in this room.'}
            {!table && peerCount > 0 && !busyElsewhere && 'A real conversation, in thirty-six questions.'}
            {!table && busyElsewhere && 'Another game is already running.'}
            {table && table.finished && (
              <OutcomeLine table={table} sessionId={sessionId} />
            )}
            {table && !table.finished && table.set !== null && SET_LABEL[table.set]}
          </p>
        </div>

        <button
          type="button"
          onClick={() => start('thirty-six-questions')}
          disabled={starting || busyElsewhere || Boolean(table && !table.finished)}
          className={SECONDARY}
        >
          {table?.finished ? 'Go again' : starting ? 'Starting…' : 'Start'}
        </button>
      </div>

      {table && !table.finished && (
        <>
          {/* Progress reads as a printed rule filling up, not a loading bar. */}
          <div className="mt-6 flex items-center gap-3">
            <span className="font-mono text-[0.6875rem] text-ink-soft">
              {Math.min(table.questionIndex + 1, table.totalQuestions)}/
              {table.totalQuestions}
            </span>
            <span className="h-0.5 flex-1 bg-rule">
              <span
                className="block h-0.5 bg-ink transition-[width] duration-300"
                style={{ width: `${progressOf(table) * 100}%` }}
              />
            </span>
          </div>

          {dare ? (
            <DarePanel
              table={table}
              sessionId={sessionId}
              onResolve={() => move({ type: 'dare-resolved' })}
            />
          ) : (
            // Keyed on the question so a card swap is a fresh element rather
            // than text mutating in place.
            <QuestionCard
              key={table.questionIndex}
              table={table}
              sessionId={sessionId}
            />
          )}

          {!dare && (
            <div className="mt-5 flex flex-wrap items-center gap-3">
              <button
                type="button"
                onClick={() => move({ type: 'next' })}
                disabled={!canAct}
                className={PRIMARY}
              >
                Next
              </button>

              <button
                type="button"
                onClick={() => move({ type: 'veto' })}
                disabled={!canAct || myVetos <= 0}
                className={SECONDARY}
                title={
                  myVetos > 0
                    ? 'Refuse to answer (there is a penalty)'
                    : 'You have used up your vetoes'
                }
              >
                Veto
              </button>

              <span className="font-mono text-[0.6875rem] text-ink-soft">
                {myVetos > 0
                  ? `${myVetos} veto left · there is a penalty`
                  : 'your veto is spent'}
              </span>
            </div>
          )}
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
          v{table.version} ·{' '}
          {table.players.map((player) => player.nickname).join(' & ')}
        </p>
      )}
    </section>
  )
}
