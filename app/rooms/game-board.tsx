'use client'

import { SystemNote } from '@/app/chrome'
import { useGame } from '@/lib/game/use-game'
import type {
  BoardOutcome,
  GameView,
  Mark,
  TicTacToeState,
} from '@/lib/socket/events'
import type { AppSocket } from '@/lib/webrtc/use-p2p-room'

/**
 * Ultimate Tic-Tac-Toe board — nine local boards inside one global board.
 *
 * The UI only *disables* squares it believes are unplayable — it never decides
 * legality. Every click is still sent to the server, which is the sole judge.
 * Disabling is a hint to the player, not an enforcement mechanism, because
 * anything enforced in the browser can be bypassed from devtools.
 *
 * WHAT THE HIGHLIGHT IS FOR: the rule that the cell you take names the board
 * your opponent must answer in is the one thing new players cannot hold in
 * their head. So `activeBoardIndex` is rendered as the loudest thing on the
 * page — a yellow frame around the one board that is live, everything else
 * knocked back — and when it is null, every open board lights up instead. A
 * player should never have to work out where they are allowed to play.
 */

const CELLS = [0, 1, 2, 3, 4, 5, 6, 7, 8]

/** Narrow the engine's opaque `state` to this game's shape. */
function asTicTacToe(view: GameView | null): TicTacToeState | null {
  if (!view || view.gameId !== 'tic-tac-toe') return null

  const state = view.state as Partial<TicTacToeState> | null
  if (!state || !Array.isArray(state.boards) || state.boards.length !== 9) {
    return null
  }
  if (!Array.isArray(state.globalBoard) || state.globalBoard.length !== 9) {
    return null
  }

  return state as TicTacToeState
}

/** What gets stamped across a local board once it is settled. */
function outcomeGlyph(outcome: BoardOutcome): string {
  if (outcome === 'draw') return '—'
  return outcome ?? ''
}

/**
 * The stroke drawn through a winning line.
 *
 * ONE COMPONENT FOR BOTH SCALES, because both are 3×3: `line` is cell indices
 * inside a local board, or local-board indices across the global one, and the
 * arithmetic does not care which. The viewBox is three units square so the
 * geometry is written in grid squares rather than pixels, and
 * `non-scaling-stroke` keeps the ink a constant weight however large the grid
 * is rendered.
 *
 * It animates on MOUNT and only on mount — which is exactly the moment the line
 * was completed, since the server only publishes a winning line once there is
 * one. No effect, no timer, nothing to keep in sync with the game state.
 */
function WinStroke({
  line,
  width,
  ink = 'var(--color-ink)',
  delayMs = 0,
}: {
  line: number[]
  width: number
  ink?: string
  delayMs?: number
}) {
  const from = line[0] ?? 0
  const to = line[line.length - 1] ?? 0

  const start = { x: (from % 3) + 0.5, y: Math.floor(from / 3) + 0.5 }
  const end = { x: (to % 3) + 0.5, y: Math.floor(to / 3) + 0.5 }

  // Run past the outer two marks rather than stopping dead on their centres —
  // a struck-through line that stops short reads as an underline.
  const overshootX = (end.x - start.x) * 0.14
  const overshootY = (end.y - start.y) * 0.14

  return (
    <svg
      viewBox="0 0 3 3"
      aria-hidden
      className="pointer-events-none absolute inset-0 h-full w-full"
    >
      <line
        x1={start.x - overshootX}
        y1={start.y - overshootY}
        x2={end.x + overshootX}
        y2={end.y + overshootY}
        pathLength={1}
        stroke={ink}
        strokeWidth={width}
        strokeLinecap="round"
        vectorEffect="non-scaling-stroke"
        className="animate-strike"
        style={delayMs ? { animationDelay: `${delayMs}ms` } : undefined}
      />
    </svg>
  )
}

export function GameBoard({
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

  // The room hosts more than one game now, and `useGame` reports whichever is
  // running. Everything this panel DISPLAYS has to come from `mine`, or a
  // 36 Questions game would show its label and its result in the Tic-Tac-Toe
  // header. Raw `view` survives for one job only: knowing the room is busy.
  const mine = view?.gameId === 'tic-tac-toe' ? view : null
  const busyElsewhere = Boolean(view && !view.finished && !mine)

  const state = asTicTacToe(mine)
  // `actors` is the generalised turn: a simultaneous game returns every player
  // who may act, but Tic-Tac-Toe is strictly sequential, so it is always empty
  // or a single id. `sessionId` may be null, and an empty list yields undefined
  // — which never equals null, so a spectator is correctly never "on turn".
  const myTurn = Boolean(mine && !mine.finished && mine.actors[0] === sessionId)
  const myMark: Mark | null =
    state && sessionId ? (state.order[0] === sessionId ? 'X' : 'O') : null
  const finished = Boolean(mine?.finished)
  /** Free choice: the board the last cell pointed at was already settled. */
  const anywhere = Boolean(state && !finished && state.activeBoardIndex === null)

  /**
   * Whether this local board is one the mover may play in.
   *
   * Mirrors the server's rule rather than guessing at it: pinned means exactly
   * one board, free means every board still open.
   */
  function isLive(current: TicTacToeState, board: number): boolean {
    if (finished) return false
    if (current.activeBoardIndex === null) return current.globalBoard[board] === null
    return current.activeBoardIndex === board
  }

  function turnText(current: TicTacToeState): string {
    if (!myTurn) return 'Giliran dia.'
    return anywhere
      ? 'Giliran kamu — bebas pilih papan mana aja.'
      : `Giliran kamu — main di papan ${(current.activeBoardIndex ?? 0) + 1}.`
  }

  function outcomeText(current: GameView): string {
    if (!current.result) return ''
    const { winnerSessionIds, reason } = current.result

    // A draw returns before this, so the list is never empty by the time it is
    // read — Tic-Tac-Toe wins and forfeits both name exactly one survivor.
    if (reason === 'draw') return 'Seri.'
    if (winnerSessionIds[0] === sessionId) {
      return reason === 'forfeit' ? 'Kamu menang — lawannya keluar.' : 'Kamu menang.'
    }
    return reason === 'forfeit' ? 'Gamenya ditinggal.' : 'Kamu kalah.'
  }

  return (
    <section className="mt-10 border-2 border-ink bg-stock p-6">
      <div className="flex flex-wrap items-center justify-between gap-4">
        <div>
          <h2
            className="font-display text-xl leading-tight"
            style={{ fontVariationSettings: "'wght' 800, 'wdth' 95" }}
          >
            {mine?.label ?? 'Ultimate Tic-Tac-Toe'}
          </h2>
          <p className="mt-2 text-[0.9375rem] leading-relaxed text-ink">
            {!mine && peerCount === 0 && 'Butuh satu orang lagi di ruang ini.'}
            {!mine && peerCount > 0 && !busyElsewhere && 'Siap kapan aja.'}
            {!mine && busyElsewhere && 'Ada game lain yang lagi jalan.'}
            {mine && mine.finished && outcomeText(mine)}
            {mine && !mine.finished && state && turnText(state)}
            {mine && !mine.finished && myMark && (
              <span className="ml-2 bg-yellow px-1.5 font-mono text-[0.6875rem]">
                kamu {myMark}
              </span>
            )}
          </p>
        </div>

        <button
          type="button"
          onClick={() => start('tic-tac-toe')}
          disabled={starting || busyElsewhere || Boolean(mine && !mine.finished)}
          className="border-2 border-ink px-5 py-2.5 font-mono text-sm text-ink transition-colors hover:bg-yellow disabled:opacity-40 disabled:hover:bg-transparent"
        >
          {mine?.finished ? 'Main lagi' : starting ? 'Mulai…' : 'Mulai game'}
        </button>
      </div>

      {state && (
        <div
          // Alternating class rather than a changing key: the shake has to
          // replay even when the same rejection repeats, but remounting would
          // re-draw every win stroke on the grid along with it. The nonce only
          // ever increments, so consecutive rejections always flip the parity.
          className={`relative mt-6 grid w-full max-w-[26rem] grid-cols-3 gap-0.5 border-2 border-ink bg-ink ${
            rejection
              ? rejectionNonce % 2 === 0
                ? 'animate-reject'
                : 'animate-reject-alt'
              : ''
          }`}
        >
          {CELLS.map((board) => {
            const cells = state.boards[board] ?? []
            const outcome = state.globalBoard[board] ?? null
            const live = isLive(state, board)
            const winningBoard = state.winningLine?.includes(board) ?? false
            const localLine = state.localWinningLines[board]

            // Yellow is this system's only fill, so it has to do both jobs: the
            // board in play, and the three that won the game. They never appear
            // at once — a finished game pins nobody.
            //
            // Lit on the opponent's turn too, not just yours. Watching them be
            // forced somewhere is half of what makes the constraint legible,
            // and gating it on `myTurn` left half of every game with nothing
            // highlighted at all.
            const frame = winningBoard || live ? 'bg-yellow' : outcome ? 'bg-rule' : 'bg-stock'

            // KNOCKED BACK WITH INK, NOT OPACITY. These boards sit on an
            // ink-coloured grid, so fading them composites toward the dark
            // backing and turns the paper slate-grey — the board reads broken
            // rather than out of play. Switching to the second stock is how a
            // riso actually de-emphasises something: another flat colour.
            const cellTone = live || finished ? 'bg-paper' : 'bg-stock'

            return (
              <div key={board} className={`relative p-1 ${frame}`}>
                <div className="relative grid grid-cols-3 gap-px bg-rule">
                  {CELLS.map((cell) => {
                    const mark = cells[cell] ?? null
                    // A hint only — the click is sent regardless.
                    const playable = myTurn && live && mark === null

                    return (
                      <button
                        key={cell}
                        type="button"
                        onClick={() => move({ board, cell })}
                        disabled={!playable}
                        aria-label={`Papan ${board + 1}, kotak ${cell + 1}${
                          mark ? `, ${mark}` : ', kosong'
                        }`}
                        className={`grid aspect-square place-items-center font-display text-lg text-ink ${cellTone} ${
                          playable
                            ? 'cursor-pointer hover:bg-yellow'
                            : 'cursor-not-allowed'
                        }`}
                        style={{ fontVariationSettings: "'wght' 800, 'wdth' 95" }}
                      >
                        {mark ?? ''}
                      </button>
                    )
                  })}

                  {/* The three cells that took this board, struck through. */}
                  {localLine && <WinStroke line={localLine} width={3} />}
                </div>

                {outcome && (
                  // Overprinted rather than replacing the board: a riso second
                  // pass, and it keeps the cells that won it readable
                  // underneath. Decorative — the status line carries the fact.
                  <span
                    aria-hidden
                    className="slip animate-stamp pointer-events-none absolute inset-0 grid place-items-center font-display text-5xl leading-none text-pink"
                    style={{ fontVariationSettings: "'wght' 800, 'wdth' 95" }}
                  >
                    {outcomeGlyph(outcome)}
                  </span>
                )}
              </div>
            )
          })}

          {/*
           * The game-winning line, drawn across whole boards.
           *
           * PINK, AND THAT IS NOT DECORATION. A global line and the local lines
           * that built it are frequently collinear — win three boards along
           * their middle rows and both strokes lie on the same axis — so an ink
           * stroke over ink strokes merges into one thick smear. A second
           * colour separates the two scales, and pink is what this system keeps
           * for its loudest rules.
           *
           * Held back a beat so it lands AFTER the stamp on the board that just
           * fell. The last local win and the game ending arrive in the same
           * state push, and playing them together reads as one muddled flicker
           * instead of a conclusion.
           */}
          {state.winningLine && (
            <WinStroke
              line={state.winningLine}
              width={9}
              ink="var(--color-pink)"
              delayMs={260}
            />
          )}
        </div>
      )}

      {state && !finished && (
        <p className="mt-3 font-mono text-[0.6875rem] text-ink-soft">
          {anywhere
            ? 'Papan tujuan udah selesai — giliran ini bebas.'
            : 'Kotak yang kamu ambil nentuin papan lawan berikutnya.'}
        </p>
      )}

      {rejection && (
        <SystemNote alert className="mt-5">
          {rejection}
        </SystemNote>
      )}

      {mine && (
        <p className="mt-5 font-mono text-[0.6875rem] text-ink-soft">
          v{mine.version} ·{' '}
          {mine.players.map((player) => player.nickname).join(' vs ')}
        </p>
      )}
    </section>
  )
}
