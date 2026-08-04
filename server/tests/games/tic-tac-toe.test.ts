import assert from 'node:assert/strict'
import { describe, it } from 'node:test'

import {
  ticTacToe,
  type CellMove,
  type TicTacToeState,
} from '../../src/games/tic-tac-toe.js'
import type { GamePlayer } from '../../src/games/types.js'

/**
 * Tic-Tac-Toe rules.
 *
 * Seam: the GameDefinition contract. No Redis and no sockets — a definition is
 * a pure set of rules by design, and these tests hold it to that.
 *
 * The point of this file is not that noughts and crosses works. It is that the
 * *contract* Phase 5 will also implement behaves as the engine assumes:
 * validateMove is total over hostile input, applyMove does not mutate, and
 * result() is the single source of truth for "is it over".
 */

function player(nickname: string): GamePlayer {
  return {
    sessionId: `session-${nickname.toLowerCase()}`,
    socketId: `socket-${nickname.toLowerCase()}`,
    nickname,
  }
}

const alice = player('Alice')
const bob = player('Bob')

function opening(): TicTacToeState {
  return ticTacToe.createInitialState([alice, bob])
}

/** Play a sequence of cells, alternating turns, asserting each is legal. */
function play(cells: number[], from = opening()): TicTacToeState {
  let state = from

  for (const cell of cells) {
    const [mover] = ticTacToe.actors(state)
    assert.notEqual(mover, undefined, `no player may move at cell ${cell}`)

    const validation = ticTacToe.validateMove(state, mover as string, { cell })
    assert.equal(validation.ok, true, `cell ${cell} should have been legal`)

    state = ticTacToe.applyMove(
      state,
      mover as string,
      (validation as { ok: true; move: CellMove }).move,
    )
  }

  return state
}

const LINES = [
  [0, 1, 2],
  [3, 4, 5],
  [6, 7, 8],
  [0, 3, 6],
  [1, 4, 7],
  [2, 5, 8],
  [0, 4, 8],
  [2, 4, 6],
]

describe('the opening position', () => {
  it('is an empty board with the first-seated player to move', () => {
    const state = opening()

    assert.deepEqual(state.board, Array.from({ length: 9 }, () => null))
    assert.deepEqual(ticTacToe.actors(state), [alice.sessionId])
    assert.equal(ticTacToe.result(state), null, 'a fresh game is not over')
  })

  it('seats players in the order they were passed', () => {
    const reversed = ticTacToe.createInitialState([bob, alice])

    assert.deepEqual(
      ticTacToe.actors(reversed),
      [bob.sessionId],
      'seat order is the caller’s decision, not the definition’s',
    )
  })

  it('advertises the player count the engine enforces', () => {
    assert.equal(ticTacToe.minPlayers, 2)
    assert.equal(ticTacToe.maxPlayers, 2)
  })
})

describe('validating a move', () => {
  it('accepts an empty cell from the player to move', () => {
    const validation = ticTacToe.validateMove(opening(), alice.sessionId, {
      cell: 4,
    })

    assert.deepEqual(validation, { ok: true, move: { cell: 4 } })
  })

  it('refuses a player moving out of turn', () => {
    const validation = ticTacToe.validateMove(opening(), bob.sessionId, {
      cell: 0,
    })

    assert.deepEqual(validation, { ok: false, reason: 'not-your-turn' })
  })

  it('refuses a session that is not in the game', () => {
    const validation = ticTacToe.validateMove(opening(), 'session-mallory', {
      cell: 0,
    })

    assert.deepEqual(validation, { ok: false, reason: 'not-a-player' })
  })

  it('refuses a cell that is already taken', () => {
    const state = play([4])

    assert.deepEqual(ticTacToe.validateMove(state, bob.sessionId, { cell: 4 }), {
      ok: false,
      reason: 'cell-taken',
    })
  })

  it('refuses a cell off the board', () => {
    for (const cell of [-1, 9, 100, 1.5, Number.NaN, Number.POSITIVE_INFINITY]) {
      assert.deepEqual(
        ticTacToe.validateMove(opening(), alice.sessionId, { cell }),
        { ok: false, reason: 'cell-out-of-range' },
        `cell ${cell} should be refused`,
      )
    }
  })

  it('refuses input that is not a move at all', () => {
    // Clients submit intent over a socket, so `raw` is genuinely untrusted.
    for (const raw of [null, undefined, 'nope', 42, true, [], () => {}]) {
      const validation = ticTacToe.validateMove(opening(), alice.sessionId, raw)

      assert.equal(
        validation.ok,
        false,
        `${String(raw)} should not validate as a move`,
      )
    }
  })

  it('names malformed input separately from a bad cell', () => {
    assert.deepEqual(ticTacToe.validateMove(opening(), alice.sessionId, 'nope'), {
      ok: false,
      reason: 'malformed-move',
    })
    assert.deepEqual(ticTacToe.validateMove(opening(), alice.sessionId, {}), {
      ok: false,
      reason: 'cell-out-of-range',
    })
  })

  it('ignores extra properties rather than trusting them', () => {
    const validation = ticTacToe.validateMove(opening(), alice.sessionId, {
      cell: 0,
      mark: 'O',
      winner: alice.sessionId,
    })

    assert.deepEqual(
      validation,
      { ok: true, move: { cell: 0 } },
      'only the cell survives; a client cannot smuggle state through a move',
    )
  })

  it('refuses every move once the game is over', () => {
    const finished = play([0, 3, 1, 4, 2])

    assert.deepEqual(ticTacToe.validateMove(finished, bob.sessionId, { cell: 5 }), {
      ok: false,
      reason: 'game-finished',
    })
    assert.deepEqual(
      ticTacToe.validateMove(finished, alice.sessionId, { cell: 5 }),
      { ok: false, reason: 'game-finished' },
    )
  })
})

describe('applying a move', () => {
  it('does not mutate the state it was given', () => {
    const state = opening()
    const snapshot = structuredClone(state)

    ticTacToe.applyMove(state, alice.sessionId, { cell: 4 })

    assert.deepEqual(
      state,
      snapshot,
      'the engine stores the returned state; mutating the input would corrupt a CAS retry',
    )
  })

  it('marks the first player X and the second O', () => {
    const state = play([0, 1])

    assert.equal(state.board[0], 'X')
    assert.equal(state.board[1], 'O')
  })

  it('passes the turn', () => {
    assert.deepEqual(ticTacToe.actors(play([0])), [bob.sessionId])
    assert.deepEqual(ticTacToe.actors(play([0, 1])), [alice.sessionId])
  })
})

describe('finishing', () => {
  it('detects a win on every line', () => {
    for (const line of LINES) {
      const spare = [0, 1, 2, 3, 4, 5, 6, 7, 8].filter(
        (cell) => !line.includes(cell),
      )
      const state = play([
        line[0]!,
        spare[0]!,
        line[1]!,
        spare[1]!,
        line[2]!,
      ])

      assert.deepEqual(
        ticTacToe.result(state),
        { winnerSessionIds: [alice.sessionId], reason: 'win' },
        `line ${line.join('')} should win`,
      )
      assert.deepEqual(
        state.winningLine,
        line,
        'the winning line is published so the UI can highlight it',
      )
      assert.deepEqual(
        ticTacToe.actors(state),
        [],
        'nobody moves in a finished game',
      )
    }
  })

  it('detects a full board with no line as a draw', () => {
    const state = play([0, 4, 8, 2, 6, 3, 5, 7, 1])

    assert.equal(state.draw, true)
    assert.equal(state.winnerSessionId, null)
    assert.deepEqual(ticTacToe.result(state), {
      winnerSessionIds: [],
      reason: 'draw',
    })
    assert.deepEqual(ticTacToe.actors(state), [])
  })

  it('reports nothing while the game is still running', () => {
    assert.equal(ticTacToe.result(play([0, 1, 2])), null)
  })
})

describe('forfeiting', () => {
  it('awards the game to the player who stayed', () => {
    const state = ticTacToe.forfeit(play([0, 1]), alice.sessionId)

    assert.deepEqual(ticTacToe.result(state), {
      winnerSessionIds: [bob.sessionId],
      reason: 'forfeit',
    })
    assert.deepEqual(ticTacToe.actors(state), [])
  })

  it('leaves a decided game alone', () => {
    // Alice has already won. Bob rage-quitting must not convert her win into a
    // forfeit — the reason a player sees for the ending has to stay truthful.
    const won = play([0, 3, 1, 4, 2])

    const state = ticTacToe.forfeit(won, bob.sessionId)

    assert.equal(state, won, 'a finished state is returned untouched')
    assert.deepEqual(ticTacToe.result(state), {
      winnerSessionIds: [alice.sessionId],
      reason: 'win',
    })
  })

  it('does not mutate the state it was given', () => {
    const state = play([0])
    const snapshot = structuredClone(state)

    ticTacToe.forfeit(state, alice.sessionId)

    assert.deepEqual(state, snapshot)
  })
})

describe('viewFor', () => {
  it('hides nothing, because there is nothing to hide', () => {
    const state = play([0, 4])

    // Perfect information: both players and an observer see the same board.
    // The seam still exists so hidden state is the default shape for the games
    // that need it, rather than a retrofit.
    assert.deepEqual(ticTacToe.viewFor(state, alice.sessionId), state)
    assert.deepEqual(ticTacToe.viewFor(state, bob.sessionId), state)
    assert.deepEqual(ticTacToe.viewFor(state, null), state)
  })
})
