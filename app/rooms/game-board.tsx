'use client'

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
  const myMark: Mark | null = state && sessionId ? (state.order[0] === sessionId ? 'X' : 'O') : null

  function outcomeText(current: GameView): string {
    if (!current.result) return ''
    const { winnerSessionId, reason } = current.result

    if (reason === 'draw') return 'Draw.'
    if (winnerSessionId === sessionId) {
      return reason === 'forfeit' ? 'You win — your opponent left.' : 'You win!'
    }
    return reason === 'forfeit' ? 'Game abandoned.' : 'You lose.'
  }

  return (
    <section className="mt-8 rounded-xl border border-black/10 p-4 dark:border-white/15">
      <div className="flex flex-wrap items-center justify-between gap-3">
        <div>
          <h2 className="text-sm font-medium text-black dark:text-zinc-100">
            {view?.label ?? 'Tic-Tac-Toe'}
          </h2>
          <p className="mt-0.5 text-sm text-zinc-500">
            {!view && peerCount === 0 && 'Waiting for a second player before a game can start.'}
            {!view && peerCount > 0 && 'Ready to play.'}
            {view && view.finished && outcomeText(view)}
            {view && !view.finished && (myTurn ? 'Your turn.' : "Opponent's turn.")}
            {view && !view.finished && myMark && (
              <span className="ml-1 font-mono text-zinc-400">(you are {myMark})</span>
            )}
          </p>
        </div>

        <button
          type="button"
          onClick={() => start('tic-tac-toe')}
          disabled={starting || (Boolean(view) && !view?.finished)}
          className="rounded-lg bg-amber-600 px-4 py-2 text-sm font-medium text-white hover:bg-amber-500 disabled:opacity-40"
        >
          {view?.finished ? 'Rematch' : starting ? 'Starting…' : 'Start game'}
        </button>
      </div>

      {state && (
        <div
          // Remounting on each rejection replays the shake animation, even when
          // the same rejection repeats.
          key={rejectionNonce}
          className={`mt-4 grid w-full max-w-64 grid-cols-3 gap-1.5 ${
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
                aria-label={`Square ${index + 1}${cell ? `, ${cell}` : ', empty'}`}
                className={`grid aspect-square place-items-center rounded-lg border text-2xl font-semibold transition-colors ${
                  winning
                    ? 'border-emerald-500 bg-emerald-500/15 text-emerald-600 dark:text-emerald-400'
                    : 'border-black/15 dark:border-white/15'
                } ${
                  playable
                    ? 'cursor-pointer hover:bg-black/[.04] dark:hover:bg-white/[.06]'
                    : 'cursor-not-allowed'
                } ${cell ? 'text-black dark:text-zinc-100' : 'text-zinc-400'}`}
              >
                {cell ?? ''}
              </button>
            )
          })}
        </div>
      )}

      {rejection && (
        <p
          role="alert"
          className="mt-3 rounded-lg border border-amber-500/30 bg-amber-500/10 px-3 py-2 text-sm text-amber-700 dark:text-amber-300"
        >
          {rejection}
        </p>
      )}

      {view && (
        <p className="mt-3 font-mono text-[11px] text-zinc-400">
          v{view.version} · {view.players.map((player) => player.nickname).join(' vs ')}
        </p>
      )}
    </section>
  )
}
