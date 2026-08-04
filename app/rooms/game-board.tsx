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

  const state = asTicTacToe(view)
  // `actors` is the generalised turn: a simultaneous game returns every player
  // who may act, but Tic-Tac-Toe is strictly sequential, so it is always empty
  // or a single id. `sessionId` may be null, and an empty list yields undefined
  // — which never equals null, so a spectator is correctly never "on turn".
  const myTurn = Boolean(view && !view.finished && view.actors[0] === sessionId)
  const myMark: Mark | null =
    state && sessionId ? (state.order[0] === sessionId ? 'X' : 'O') : null
  const finished = Boolean(view?.finished)
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
            {view?.label ?? 'Ultimate Tic-Tac-Toe'}
          </h2>
          <p className="mt-2 text-[0.9375rem] leading-relaxed text-ink">
            {!view && peerCount === 0 && 'Butuh satu orang lagi di ruang ini.'}
            {!view && peerCount > 0 && 'Siap kapan aja.'}
            {view && view.finished && outcomeText(view)}
            {view && !view.finished && state && turnText(state)}
            {view && !view.finished && myMark && (
              <span className="ml-2 bg-yellow px-1.5 font-mono text-[0.6875rem]">
                kamu {myMark}
              </span>
            )}
          </p>
        </div>

        <button
          type="button"
          onClick={() => start('tic-tac-toe')}
          disabled={starting || (Boolean(view) && !view?.finished)}
          className="border-2 border-ink px-5 py-2.5 font-mono text-sm text-ink transition-colors hover:bg-yellow disabled:opacity-40 disabled:hover:bg-transparent"
        >
          {view?.finished ? 'Main lagi' : starting ? 'Mulai…' : 'Mulai game'}
        </button>
      </div>

      {state && (
        <div
          // Remounting on each rejection replays the shake animation, even when
          // the same rejection repeats.
          key={rejectionNonce}
          className={`mt-6 grid w-full max-w-[26rem] grid-cols-3 gap-0.5 border-2 border-ink bg-ink ${
            rejection ? 'animate-reject' : ''
          }`}
        >
          {CELLS.map((board) => {
            const cells = state.boards[board] ?? []
            const outcome = state.globalBoard[board] ?? null
            const live = isLive(state, board)
            const winningBoard = state.winningLine?.includes(board) ?? false
            const localLine = state.localWinningLines[board]

            // Yellow is this system's only fill, so it has to do both jobs: the
            // board you must play in, and the three that won the game. They
            // never appear at once — a finished game pins nobody.
            const frame = winningBoard
              ? 'bg-yellow'
              : live && myTurn
                ? 'bg-yellow'
                : outcome
                  ? 'bg-rule'
                  : 'bg-stock'

            return (
              <div
                key={board}
                className={`relative p-1 transition-opacity ${frame} ${
                  live || finished ? '' : 'opacity-45'
                }`}
              >
                <div className="grid grid-cols-3 gap-px bg-rule">
                  {CELLS.map((cell) => {
                    const mark = cells[cell] ?? null
                    const winningCell = localLine?.includes(cell) ?? false
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
                        className={`grid aspect-square place-items-center font-display text-lg text-ink ${
                          winningCell ? 'bg-yellow' : 'bg-paper'
                        } ${
                          playable
                            ? 'cursor-pointer hover:bg-stock'
                            : 'cursor-not-allowed'
                        }`}
                        style={{ fontVariationSettings: "'wght' 800, 'wdth' 95" }}
                      >
                        {mark ?? ''}
                      </button>
                    )
                  })}
                </div>

                {outcome && (
                  // Overprinted rather than replacing the board: a riso second
                  // pass, and it keeps the cells that won it readable
                  // underneath. Decorative — the status line carries the fact.
                  <span
                    aria-hidden
                    className="slip pointer-events-none absolute inset-0 grid place-items-center font-display text-5xl leading-none text-pink"
                    style={{ fontVariationSettings: "'wght' 800, 'wdth' 95" }}
                  >
                    {outcomeGlyph(outcome)}
                  </span>
                )}
              </div>
            )
          })}
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

      {view && (
        <p className="mt-5 font-mono text-[0.6875rem] text-ink-soft">
          v{view.version} ·{' '}
          {view.players.map((player) => player.nickname).join(' vs ')}
        </p>
      )}
    </section>
  )
}
