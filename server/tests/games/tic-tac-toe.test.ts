import assert from 'node:assert/strict'
import { describe, it } from 'node:test'

import {
  ticTacToe,
  type CellMove,
  type Mark,
  type TicTacToeState,
} from '../../src/games/tic-tac-toe.js'
import type { GamePlayer } from '../../src/games/types.js'

/**
 * Ultimate Tic-Tac-Toe rules.
 *
 * Seam: the GameDefinition contract. No Redis and no sockets — a definition is
 * a pure set of rules by design, and these tests hold it to that.
 *
 * What makes this game worth testing properly is the movement constraint: the
 * *cell* you take dictates the *local board* your opponent must play in next.
 * That single rule is where every interesting failure lives — a board that was
 * decided between the two halves of a turn, a target that is full but unwon, a
 * player who is suddenly free to go anywhere. So the drive helpers below play
 * genuinely legal games rather than stamping positions into place: a sequence
 * that the rules would refuse fails here, loudly, at the move that broke.
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

const INDICES = [0, 1, 2, 3, 4, 5, 6, 7, 8]

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

function opening(): TicTacToeState {
  return ticTacToe.createInitialState([alice, bob])
}

/** Whoever may move, or undefined once the game is over. */
function mover(state: TicTacToeState): string | undefined {
  return ticTacToe.actors(state)[0]
}

function sessionFor(mark: Mark): string {
  return mark === 'X' ? alice.sessionId : bob.sessionId
}

/** Play one move for whoever is to move, asserting the rules allow it. */
function step(
  state: TicTacToeState,
  board: number,
  cell: number,
): TicTacToeState {
  const sessionId = mover(state)
  assert.notEqual(sessionId, undefined, `nobody may play (${board}, ${cell})`)

  const validation = ticTacToe.validateMove(state, sessionId as string, {
    board,
    cell,
  })
  assert.equal(
    validation.ok,
    true,
    `(${board}, ${cell}) should have been legal, got ${
      (validation as { reason?: string }).reason
    }`,
  )

  return ticTacToe.applyMove(
    state,
    sessionId as string,
    (validation as { ok: true; move: CellMove }).move,
  )
}

function openBoards(state: TicTacToeState): number[] {
  return INDICES.filter((board) => state.globalBoard[board] === null)
}

// --- Driving a legal game --------------------------------------------------

/**
 * Play one move whose *cell* is `to`, which is what sends the opponent into
 * local board `to`.
 *
 * The movement rule used as a tool: when the mover is already pinned to a
 * board there is no choice about where to play from, and when they are free
 * we pick a board the plan is not relying on, so the relay never spends a cell
 * some later capture still needs.
 */
function relay(
  state: TicTacToeState,
  to: number,
  reserved: Set<number>,
): TicTacToeState {
  const free = openBoards(state).filter(
    (board) => state.boards[board]?.[to] === null,
  )
  const from =
    state.activeBoardIndex ??
    free.find((board) => !reserved.has(board)) ??
    free[0]

  assert.notEqual(from, undefined, `no board can relay to ${to}`)

  return step(state, from as number, to)
}

/**
 * Win local board `target` for whoever is to move, along `line`.
 *
 * Five moves: the mover takes the three cells of `line`, and in between the
 * opponent is bounced straight back by playing cell `target` from wherever it
 * landed.
 */
function capture(
  state: TicTacToeState,
  target: number,
  line: number[],
  reserved: Set<number>,
): TicTacToeState {
  let next = step(state, target, line[0] as number)
  next = relay(next, target, reserved)
  next = step(next, target, line[1] as number)
  next = relay(next, target, reserved)

  return step(next, target, line[2] as number)
}

/**
 * For each global line, a local line whose first two cells lie OUTSIDE it.
 *
 * Those two cells are the boards the opponent gets bounced into, so letting
 * them collide with a board X still has to win would strand the drive.
 */
const WIN_PLANS: Array<{ global: number[]; local: number[] }> = [
  { global: [0, 1, 2], local: [3, 4, 5] },
  { global: [3, 4, 5], local: [0, 1, 2] },
  { global: [6, 7, 8], local: [0, 1, 2] },
  { global: [0, 3, 6], local: [1, 4, 7] },
  { global: [1, 4, 7], local: [0, 3, 6] },
  { global: [2, 5, 8], local: [0, 3, 6] },
  { global: [0, 4, 8], local: [1, 2, 0] },
  { global: [2, 4, 6], local: [0, 1, 2] },
]

/** Play a whole legal game in which X takes the three boards of `global`. */
function winGlobalLine(global: number[], local: number[]): TicTacToeState {
  const reserved = new Set([...global, ...local])
  let state = opening()

  global.forEach((target, index) => {
    if (index > 0) state = relay(state, target, reserved)
    state = capture(state, target, local, reserved)
  })

  return state
}

// --- Stamping a position ---------------------------------------------------

/**
 * Build a position by stamping marks straight down, ignoring turn order — the
 * setup equivalent of a FEN string, for endings too far away to drive to.
 *
 * Goes through `applyMove` rather than hand-writing the state so every derived
 * field — who owns each local board, the local winning lines, the terminal
 * flags — is still computed by the rules under test rather than by this file.
 */
function layout(
  marks: Array<[number, number, Mark]>,
  { active, toMove = 'X' }: { active: number | null; toMove?: Mark },
): TicTacToeState {
  let state = opening()

  for (const [board, cell, mark] of marks) {
    state = ticTacToe.applyMove(state, sessionFor(mark), { board, cell })
  }

  return {
    ...state,
    activeBoardIndex: active,
    turn: toMove === 'X' ? 0 : 1,
  }
}

/** Marks giving `mark` the top row of `board`, with two for the opponent. */
function wonLocal(board: number, mark: Mark): Array<[number, number, Mark]> {
  const other: Mark = mark === 'X' ? 'O' : 'X'

  return [
    [board, 0, mark],
    [board, 1, mark],
    [board, 2, mark],
    [board, 3, other],
    [board, 4, other],
  ]
}

/** A full local board with no line anywhere in it. */
const DRAWN_LOCAL: Mark[] = ['X', 'X', 'O', 'O', 'O', 'X', 'X', 'O', 'X']

function drawnLocal(board: number): Array<[number, number, Mark]> {
  return DRAWN_LOCAL.map((mark, cell) => [board, cell, mark])
}

describe('the opening position', () => {
  it('is nine empty local boards with the first-seated player to move', () => {
    const state = opening()

    assert.equal(state.boards.length, 9)
    for (const board of state.boards) {
      assert.deepEqual(board, Array.from({ length: 9 }, () => null))
    }
    assert.deepEqual(ticTacToe.actors(state), [alice.sessionId])
    assert.equal(ticTacToe.result(state), null, 'a fresh game is not over')
  })

  it('owns no local board yet', () => {
    const state = opening()

    assert.deepEqual(
      state.globalBoard,
      Array.from({ length: 9 }, () => null),
      'the global board records who owns each local board, and nobody does',
    )
    assert.deepEqual(
      state.localWinningLines,
      Array.from({ length: 9 }, () => null),
    )
  })

  it('lets the opening move go anywhere', () => {
    assert.equal(
      opening().activeBoardIndex,
      null,
      'null means "any open board" — X is not pinned before anyone has moved',
    )
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
      board: 4,
      cell: 4,
    })

    assert.deepEqual(validation, { ok: true, move: { board: 4, cell: 4 } })
  })

  it('refuses a player moving out of turn', () => {
    const validation = ticTacToe.validateMove(opening(), bob.sessionId, {
      board: 0,
      cell: 0,
    })

    assert.deepEqual(validation, { ok: false, reason: 'not-your-turn' })
  })

  it('refuses a session that is not in the game', () => {
    const validation = ticTacToe.validateMove(opening(), 'session-mallory', {
      board: 0,
      cell: 0,
    })

    assert.deepEqual(validation, { ok: false, reason: 'not-a-player' })
  })

  it('refuses a cell that is already taken', () => {
    // X takes (0, 0), which sends O into board 0.
    const state = step(opening(), 0, 0)

    assert.deepEqual(
      ticTacToe.validateMove(state, bob.sessionId, { board: 0, cell: 0 }),
      { ok: false, reason: 'cell-taken' },
    )
  })

  it('refuses a board off the grid', () => {
    for (const board of [-1, 9, 100, 1.5, Number.NaN, Number.POSITIVE_INFINITY]) {
      assert.deepEqual(
        ticTacToe.validateMove(opening(), alice.sessionId, { board, cell: 0 }),
        { ok: false, reason: 'board-out-of-range' },
        `board ${board} should be refused`,
      )
    }
  })

  it('refuses a cell off the board', () => {
    for (const cell of [-1, 9, 100, 1.5, Number.NaN, Number.POSITIVE_INFINITY]) {
      assert.deepEqual(
        ticTacToe.validateMove(opening(), alice.sessionId, { board: 0, cell }),
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

  it('names malformed input separately from a bad coordinate', () => {
    assert.deepEqual(
      ticTacToe.validateMove(opening(), alice.sessionId, 'nope'),
      { ok: false, reason: 'malformed-move' },
    )
    assert.deepEqual(ticTacToe.validateMove(opening(), alice.sessionId, {}), {
      ok: false,
      reason: 'board-out-of-range',
    })
    assert.deepEqual(
      ticTacToe.validateMove(opening(), alice.sessionId, { board: 0 }),
      { ok: false, reason: 'cell-out-of-range' },
    )
  })

  it('ignores extra properties rather than trusting them', () => {
    const validation = ticTacToe.validateMove(opening(), alice.sessionId, {
      board: 0,
      cell: 0,
      mark: 'O',
      activeBoardIndex: 5,
      winner: alice.sessionId,
    })

    assert.deepEqual(
      validation,
      { ok: true, move: { board: 0, cell: 0 } },
      'only the coordinate survives; a client cannot smuggle state through a move',
    )
  })

  it('refuses every move once the game is over', () => {
    const plan = WIN_PLANS[0] as { global: number[]; local: number[] }
    const finished = winGlobalLine(plan.global, plan.local)

    assert.deepEqual(
      ticTacToe.validateMove(finished, bob.sessionId, { board: 8, cell: 8 }),
      { ok: false, reason: 'game-finished' },
    )
    assert.deepEqual(
      ticTacToe.validateMove(finished, alice.sessionId, { board: 8, cell: 8 }),
      { ok: false, reason: 'game-finished' },
    )
  })
})

describe('the movement constraint', () => {
  it('sends the next player into the local board named by the cell', () => {
    for (const cell of INDICES) {
      const state = step(opening(), 4, cell)

      assert.equal(
        state.activeBoardIndex,
        cell,
        `taking cell ${cell} must pin the opponent to local board ${cell}`,
      )
    }
  })

  it('refuses a move in any other local board', () => {
    // X takes (4, 2), so O is pinned to board 2.
    const state = step(opening(), 4, 2)

    for (const board of INDICES.filter((index) => index !== 2)) {
      assert.deepEqual(
        ticTacToe.validateMove(state, bob.sessionId, { board, cell: 0 }),
        { ok: false, reason: 'wrong-board' },
        `board ${board} is not the board O was sent to`,
      )
    }

    assert.deepEqual(
      ticTacToe.validateMove(state, bob.sessionId, { board: 2, cell: 0 }),
      { ok: true, move: { board: 2, cell: 0 } },
    )
  })

  it('can send a player straight back into the board just played in', () => {
    const state = step(opening(), 4, 4)

    assert.equal(state.activeBoardIndex, 4)
    assert.deepEqual(
      ticTacToe.validateMove(state, bob.sessionId, { board: 4, cell: 0 }),
      { ok: true, move: { board: 4, cell: 0 } },
    )
  })

  it('frees the next player when the target local board is already won', () => {
    // Board 3 belongs to O. X is pinned to board 0 and takes cell 3, which
    // would send O into a board there is nothing left to play for.
    const state = layout([...wonLocal(3, 'O'), [0, 8, 'X']], { active: 0 })

    const next = step(state, 0, 3)

    assert.equal(next.globalBoard[3], 'O', 'test setup: board 3 is decided')
    assert.equal(
      next.activeBoardIndex,
      null,
      'a won target board means the next move may go anywhere open',
    )
  })

  it('frees the next player when the target local board is full but unwon', () => {
    const state = layout([...drawnLocal(3), [0, 8, 'X']], { active: 0 })

    const next = step(state, 0, 3)

    assert.equal(next.globalBoard[3], 'draw', 'a full board with no line is a draw')
    assert.equal(
      next.activeBoardIndex,
      null,
      'nobody can move in a full board, so the constraint has to lift',
    )
  })

  it('lets a freed player choose any open board', () => {
    const state = layout([...wonLocal(3, 'O'), [0, 8, 'X']], { active: 0 })
    const freed = step(state, 0, 3)

    for (const board of INDICES.filter((index) => index !== 3)) {
      assert.equal(
        ticTacToe.validateMove(freed, bob.sessionId, { board, cell: 6 }).ok,
        true,
        `board ${board} should be open to a freed player`,
      )
    }
  })

  it('still refuses a decided board to a freed player', () => {
    const state = layout([...wonLocal(3, 'O'), [0, 8, 'X']], { active: 0 })
    const freed = step(state, 0, 3)

    assert.deepEqual(
      ticTacToe.validateMove(freed, bob.sessionId, { board: 3, cell: 6 }),
      { ok: false, reason: 'board-closed' },
      'free choice means any OPEN board, not the decided one they were sent to',
    )
  })

  it('calls a decided board the wrong board when the player was pinned elsewhere', () => {
    const state = layout([...wonLocal(3, 'O'), [0, 8, 'X'], [5, 0, 'O']], {
      active: 0,
    })

    assert.deepEqual(
      ticTacToe.validateMove(state, alice.sessionId, { board: 3, cell: 6 }),
      { ok: false, reason: 'wrong-board' },
      'being pinned is the more useful thing to be told, decided or not',
    )
  })

  it('stops pinning anyone once the game is over', () => {
    const plan = WIN_PLANS[0] as { global: number[]; local: number[] }
    const finished = winGlobalLine(plan.global, plan.local)

    assert.equal(finished.activeBoardIndex, null)
    assert.deepEqual(ticTacToe.actors(finished), [])
  })
})

describe('applying a move', () => {
  it('does not mutate the state it was given', () => {
    const state = opening()
    const snapshot = structuredClone(state)

    ticTacToe.applyMove(state, alice.sessionId, { board: 4, cell: 4 })

    assert.deepEqual(
      state,
      snapshot,
      'the engine stores the returned state; mutating the input would corrupt a CAS retry',
    )
  })

  it('does not mutate the local board it wrote into', () => {
    const state = step(opening(), 4, 4)
    const before = [...(state.boards[4] as (Mark | null)[])]

    ticTacToe.applyMove(state, bob.sessionId, { board: 4, cell: 0 })

    assert.deepEqual(
      state.boards[4],
      before,
      'the nested board has to be copied too, not just the outer array',
    )
  })

  it('marks the first player X and the second O', () => {
    const state = step(step(opening(), 0, 4), 4, 0)

    assert.equal(state.boards[0]?.[4], 'X')
    assert.equal(state.boards[4]?.[0], 'O')
  })

  it('passes the turn', () => {
    assert.deepEqual(ticTacToe.actors(step(opening(), 0, 4)), [bob.sessionId])
    assert.deepEqual(ticTacToe.actors(step(step(opening(), 0, 4), 4, 0)), [
      alice.sessionId,
    ])
  })

  it('leaves every other local board alone', () => {
    const state = step(opening(), 4, 4)

    for (const board of INDICES.filter((index) => index !== 4)) {
      assert.deepEqual(
        state.boards[board],
        Array.from({ length: 9 }, () => null),
        `board ${board} must not see a mark played in board 4`,
      )
    }
  })
})

describe('winning a local board', () => {
  it('records the mark on the global board', () => {
    const state = capture(opening(), 0, [3, 4, 5], new Set([0, 3, 4, 5]))

    assert.equal(state.globalBoard[0], 'X')
    assert.deepEqual(
      state.globalBoard.filter((owner) => owner !== null),
      ['X'],
      'winning one local board decides one local board and no others',
    )
  })

  it('publishes the local winning line for the UI', () => {
    const state = capture(opening(), 0, [3, 4, 5], new Set([0, 3, 4, 5]))

    assert.deepEqual(state.localWinningLines[0], [3, 4, 5])
    assert.equal(state.localWinningLines[1], null)
  })

  it('detects a local win on every line', () => {
    for (const line of LINES) {
      // The bounce cells are the line's own cells, so the board being fought
      // over has to sit outside the line it is won with.
      const target = INDICES.find((index) => !line.includes(index)) as number
      const state = capture(opening(), target, line, new Set([target, ...line]))

      assert.equal(
        state.globalBoard[target],
        'X',
        `local line ${line.join('')} should take the board`,
      )
      assert.deepEqual(state.localWinningLines[target], line)
      assert.equal(
        ticTacToe.result(state),
        null,
        'one local board is not the game',
      )
    }
  })

  it('accepts no further move in a decided board', () => {
    // Board 0 belongs to X and six of its cells are still empty. O is free to
    // pick any board — but empty is not the same as playable.
    const state = layout(wonLocal(0, 'X'), { active: null, toMove: 'O' })

    assert.deepEqual(
      ticTacToe.validateMove(state, bob.sessionId, { board: 0, cell: 8 }),
      { ok: false, reason: 'board-closed' },
      'an empty cell in a won board is still not a legal square',
    )
  })

  it('marks a full local board with no line as drawn', () => {
    // Eight of the nine cells are down; the ninth completes no line.
    const nearly = DRAWN_LOCAL.slice(0, 8).map(
      (mark, cell) => [3, cell, mark] as [number, number, Mark],
    )
    const state = layout(nearly, { active: 3, toMove: DRAWN_LOCAL[8] as Mark })

    const closed = step(state, 3, 8)

    assert.equal(closed.globalBoard[3], 'draw')
    assert.equal(
      closed.localWinningLines[3],
      null,
      'nobody won it, so there is no line to highlight',
    )
  })

  it('does not let a drawn local board count for either player', () => {
    // X owns boards 0 and 1; board 2 draws. The top row is not a global line.
    const nearly = DRAWN_LOCAL.slice(0, 8).map(
      (mark, cell) => [2, cell, mark] as [number, number, Mark],
    )
    const state = layout(
      [...wonLocal(0, 'X'), ...wonLocal(1, 'X'), ...nearly],
      { active: 2, toMove: DRAWN_LOCAL[8] as Mark },
    )

    const closed = step(state, 2, 8)

    assert.equal(closed.winnerSessionId, null)
    assert.equal(ticTacToe.result(closed), null, 'a draw is nobody’s square')
  })
})

describe('winning the game', () => {
  it('needs three local boards in a line, not three cells', () => {
    const state = capture(opening(), 0, [3, 4, 5], new Set([0, 3, 4, 5]))

    assert.equal(
      ticTacToe.result(state),
      null,
      'a line inside one local board wins that board and nothing more',
    )
  })

  it('detects a win on every global line', () => {
    for (const { global, local } of WIN_PLANS) {
      const state = winGlobalLine(global, local)

      assert.deepEqual(
        ticTacToe.result(state),
        { winnerSessionIds: [alice.sessionId], reason: 'win' },
        `global line ${global.join('')} should win`,
      )
      assert.deepEqual(
        state.winningLine,
        global,
        'the winning line is published as local-board indices so the UI can highlight them',
      )
      for (const board of global) {
        assert.equal(state.globalBoard[board], 'X')
      }
      assert.deepEqual(
        ticTacToe.actors(state),
        [],
        'nobody moves in a finished game',
      )
    }
  })

  it('reports nothing while boards are still being fought over', () => {
    const state = capture(opening(), 0, [3, 4, 5], new Set([0, 3, 4, 5]))

    assert.equal(ticTacToe.result(state), null)
    assert.equal(state.winningLine, null)
  })

  it('calls a decided global board with no line a draw', () => {
    // X takes 0, 1, 5, 6 and finishes on 8; O takes 2, 3, 7; board 4 draws.
    // No line for either — the ninth board closing is what ends it.
    const state = layout(
      [
        ...wonLocal(0, 'X'),
        ...wonLocal(1, 'X'),
        ...wonLocal(5, 'X'),
        ...wonLocal(6, 'X'),
        ...wonLocal(2, 'O'),
        ...wonLocal(3, 'O'),
        ...wonLocal(7, 'O'),
        ...drawnLocal(4),
        [8, 0, 'X'],
        [8, 1, 'X'],
        [8, 3, 'O'],
        [8, 4, 'O'],
      ],
      { active: 8 },
    )

    assert.equal(ticTacToe.result(state), null, 'test setup: still running')

    const finished = step(state, 8, 2)

    assert.equal(finished.globalBoard[8], 'X')
    assert.equal(finished.draw, true)
    assert.equal(finished.winnerSessionId, null)
    assert.deepEqual(ticTacToe.result(finished), {
      winnerSessionIds: [],
      reason: 'draw',
    })
    assert.deepEqual(ticTacToe.actors(finished), [])
    assert.equal(finished.activeBoardIndex, null)
  })

  it('prefers a line over a full grid', () => {
    // The last board closing both fills the grid and completes 0-4-8 for X.
    const state = layout(
      [
        ...wonLocal(0, 'X'),
        ...wonLocal(4, 'X'),
        ...wonLocal(1, 'O'),
        ...wonLocal(2, 'O'),
        ...wonLocal(3, 'O'),
        ...drawnLocal(5),
        ...drawnLocal(6),
        ...drawnLocal(7),
        [8, 0, 'X'],
        [8, 1, 'X'],
        [8, 3, 'O'],
        [8, 4, 'O'],
      ],
      { active: 8 },
    )

    const finished = step(state, 8, 2)

    assert.equal(finished.draw, false)
    assert.deepEqual(ticTacToe.result(finished), {
      winnerSessionIds: [alice.sessionId],
      reason: 'win',
    })
    assert.deepEqual(finished.winningLine, [0, 4, 8])
  })
})

describe('forfeiting', () => {
  it('awards the game to the player who stayed', () => {
    const state = ticTacToe.forfeit(step(opening(), 0, 4), alice.sessionId)

    assert.deepEqual(ticTacToe.result(state), {
      winnerSessionIds: [bob.sessionId],
      reason: 'forfeit',
    })
    assert.deepEqual(ticTacToe.actors(state), [])
  })

  it('leaves a decided game alone', () => {
    // Alice has already won. Bob rage-quitting must not convert her win into a
    // forfeit — the reason a player sees for the ending has to stay truthful.
    const plan = WIN_PLANS[0] as { global: number[]; local: number[] }
    const won = winGlobalLine(plan.global, plan.local)

    const state = ticTacToe.forfeit(won, bob.sessionId)

    assert.equal(state, won, 'a finished state is returned untouched')
    assert.deepEqual(ticTacToe.result(state), {
      winnerSessionIds: [alice.sessionId],
      reason: 'win',
    })
  })

  it('does not mutate the state it was given', () => {
    const state = step(opening(), 0, 4)
    const snapshot = structuredClone(state)

    ticTacToe.forfeit(state, alice.sessionId)

    assert.deepEqual(state, snapshot)
  })
})

describe('viewFor', () => {
  it('hides nothing, because there is nothing to hide', () => {
    const state = step(step(opening(), 0, 4), 4, 0)

    // Perfect information: both players and an observer see the same grid.
    // The seam still exists so hidden state is the default shape for the games
    // that need it, rather than a retrofit.
    assert.deepEqual(ticTacToe.viewFor(state, alice.sessionId), state)
    assert.deepEqual(ticTacToe.viewFor(state, bob.sessionId), state)
    assert.deepEqual(ticTacToe.viewFor(state, null), state)
  })
})
