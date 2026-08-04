'use client'

import { SystemNote } from '@/app/chrome'
import { useGame } from '@/lib/game/use-game'
import type { GameView } from '@/lib/socket/events'
import type { AppSocket } from '@/lib/webrtc/use-p2p-room'

/**
 * Tic-Tac-Toe board.
 *
 * The UI only *disables* squares it believes are unplayable — it never decides
 * legality. Every click is still sent to the server, which is the sole judge.
 * Disabling is a hint to the player, not an enforcement mechanism, because
 * anything enforced in the browser can be bypassed from devtools.
 */

type Mark = 'X' | 'O'

interface TicTacToeState {
  board: (Mark | null)[]
  order: string[]
  turn: number
  winnerSessionId: string | null
  winningLine: number[] | null
  draw: boolean
  forfeitedBy: string | null
}

/** Narrow the engine's opaque `state` to this game's shape. */
function asTicTacToe(view: GameView | null): TicTacToeState | null {
  if (!view || view.gameId !== 'tic-tac-toe') return null

  const state = view.state as Partial<TicTacToeState> | null
  if (!state || !Array.isArray(state.board) || state.board.length !== 9) return null

  return state as TicTacToeState
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
  const myTurn = Boolean(view && !view.finished && view.currentTurn === sessionId)
  const myMark: Mark | null =
    state && sessionId ? (state.order[0] === sessionId ? 'X' : 'O') : null

  function outcomeText(current: GameView): string {
    if (!current.result) return ''
    const { winnerSessionId, reason } = current.result

    if (reason === 'draw') return 'Seri.'
    if (winnerSessionId === sessionId) {
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
            {view?.label ?? 'Tic-Tac-Toe'}
          </h2>
          <p className="mt-2 text-[0.9375rem] leading-relaxed text-ink">
            {!view && peerCount === 0 && 'Butuh satu orang lagi di ruang ini.'}
            {!view && peerCount > 0 && 'Siap kapan aja.'}
            {view && view.finished && outcomeText(view)}
            {view && !view.finished && (myTurn ? 'Giliran kamu.' : 'Giliran dia.')}
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
          className={`mt-6 grid w-full max-w-64 grid-cols-3 border-2 border-ink bg-ink ${
            rejection ? 'animate-reject' : ''
          }`}
        >
          {state.board.map((cell, index) => {
            const winning = state.winningLine?.includes(index) ?? false
            // A hint only — the click is sent regardless of what we think.
            const playable = myTurn && cell === null

            return (
              <button
                key={index}
                type="button"
                onClick={() => move({ cell: index })}
                disabled={!playable}
                aria-label={`Kotak ${index + 1}${cell ? `, ${cell}` : ', kosong'}`}
                className={`m-px grid aspect-square place-items-center font-display text-3xl text-ink transition-colors ${
                  winning ? 'bg-yellow' : 'bg-paper'
                } ${playable ? 'cursor-pointer hover:bg-stock' : 'cursor-not-allowed'}`}
                style={{ fontVariationSettings: "'wght' 800, 'wdth' 95" }}
              >
                {cell ?? ''}
              </button>
            )
          })}
        </div>
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
