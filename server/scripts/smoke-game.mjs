/**
 * Smoke test for the board-game state machine.
 *
 * Focus is server authority: every illegal move must be refused by the server
 * regardless of what a client believes, and game state must not outlive its
 * room.
 *
 * Usage: start the server (`npm run dev`), then `npm run smoke:game`.
 */

import path from 'node:path'
import { fileURLToPath } from 'node:url'

import { config as loadEnv } from 'dotenv'
import { Redis } from 'ioredis'
import { SignJWT } from 'jose'
import { io } from 'socket.io-client'

const here = path.dirname(fileURLToPath(import.meta.url))
loadEnv({ path: path.resolve(here, '../../.env') })

const URL = `http://localhost:${process.env.SOCKET_PORT ?? '4000'}`
const secret = new TextEncoder().encode(process.env.SESSION_JWT_SECRET)
const redis = new Redis(process.env.REDIS_URL ?? 'redis://localhost:6379')

let failures = 0
let checks = 0

function check(label, actual, expected) {
  checks += 1
  const ok = JSON.stringify(actual) === JSON.stringify(expected)
  if (!ok) failures += 1
  console.log(
    `  ${ok ? 'PASS' : 'FAIL'}  ${label.padEnd(52)} ${
      ok ? JSON.stringify(actual) : `got ${JSON.stringify(actual)}, expected ${JSON.stringify(expected)}`
    }`,
  )
}

const sockets = []

async function connect(nickname) {
  const token = await new SignJWT({ nickname })
    .setProtectedHeader({ alg: 'HS256' })
    .setSubject(crypto.randomUUID())
    .setIssuedAt()
    .setIssuer('dudu:web')
    .setAudience('dudu:client')
    .setExpirationTime('5m')
    .sign(secret)

  const socket = io(URL, { auth: { token }, transports: ['websocket'], reconnection: false })

  const session = await new Promise((resolve, reject) => {
    socket.once('session:ready', resolve)
    socket.once('connect_error', reject)
    setTimeout(() => reject(new Error('never connected')), 5000)
  })

  socket.session = session

  // A persistent listener rather than one-shot waiters: every move broadcasts
  // to BOTH players, so a freshly attached one-shot listener frequently catches
  // the *previous* move's broadcast still in flight and every assertion ends up
  // one version behind.
  socket.latestView = null
  socket.on('game:state', (view) => {
    socket.latestView = view
  })

  sockets.push(socket)
  return socket
}

/** Wait until this socket has seen a view at or beyond `minVersion`. */
function waitForVersion(socket, minVersion, ms = 2500) {
  return new Promise((resolve) => {
    const deadline = Date.now() + ms
    const tick = () => {
      if (socket.latestView && socket.latestView.version >= minVersion) {
        resolve(socket.latestView)
        return
      }
      if (Date.now() > deadline) {
        resolve(null)
        return
      }
      setTimeout(tick, 25)
    }
    tick()
  })
}

function emitAck(socket, event, ...args) {
  return new Promise((resolve) => {
    socket.emit(event, ...args, resolve)
    setTimeout(() => resolve(null), 3000)
  })
}

/** Play a move and wait for the broadcast that move produced. */
async function move(socket, board, cell) {
  const before = socket.latestView?.version ?? 0
  const ack = await emitAck(socket, 'game:move', { board, cell })
  const view = ack?.ok ? await waitForVersion(socket, before + 1) : null
  return { ack, view }
}

/**
 * A complete legal game: X takes local boards 0, 1 and 2 along their middle
 * rows, winning the top row of the global board on the seventeenth move.
 *
 * Scripted rather than improvised because the movement constraint means the
 * cell each player takes dictates the board the other must answer in — five
 * arbitrary moves no longer win anything. X plays the odd-numbered entries.
 */
const X_WINS_TOP_ROW = [
  [0, 3], [3, 0], [0, 4], [4, 0], [0, 5], [5, 1],
  [1, 3], [3, 1], [1, 4], [4, 1], [1, 5], [5, 2],
  [2, 3], [3, 2], [2, 4], [4, 2], [2, 5],
]

const ROOM = `game-${Date.now().toString(36)}`

try {
  console.log('\nGame setup')

  const alice = await connect('Alice')
  const bob = await connect('Bob')

  check('starting with no room is refused', (await emitAck(alice, 'game:start', 'tic-tac-toe'))?.error, 'not-in-a-room')

  await emitAck(alice, 'room:join', ROOM)
  check('unknown game id is refused', (await emitAck(alice, 'game:start', 'chess'))?.error, 'unknown-game')
  check(
    'starting with one player is refused',
    (await emitAck(alice, 'game:start', 'tic-tac-toe'))?.error,
    'wrong-player-count',
  )

  await emitAck(bob, 'room:join', ROOM)

  const started = await emitAck(alice, 'game:start', 'tic-tac-toe')

  check('start succeeds with two players', started?.ok, true)

  const initial = await waitForVersion(alice, 1)
  const bobInitial = await waitForVersion(bob, 1)

  check('both players receive state', Boolean(initial && bobInitial), true)
  check(
    'every local board starts empty',
    initial?.state?.boards?.every((b) => b.every((c) => c === null)),
    true,
  )
  check('no local board is owned yet', initial?.state?.globalBoard?.every((o) => o === null), true)
  check('the opening move may go anywhere', initial?.state?.activeBoardIndex, null)
  check('starter moves first', initial?.actors?.[0], alice.session.sessionId)
  check('both see the same turn', bobInitial?.actors?.[0], alice.session.sessionId)
  check('game is not finished', initial?.finished, false)

  console.log('\nServer-side move validation')

  const outOfTurn = await emitAck(bob, 'game:move', { board: 0, cell: 0 })
  check('moving out of turn is refused', outOfTurn?.reason, 'not-your-turn')

  check('non-integer cell is refused', (await emitAck(alice, 'game:move', { board: 0, cell: 1.5 }))?.reason, 'cell-out-of-range')
  check('negative cell is refused', (await emitAck(alice, 'game:move', { board: 0, cell: -1 }))?.reason, 'cell-out-of-range')
  check('cell past the board is refused', (await emitAck(alice, 'game:move', { board: 0, cell: 9 }))?.reason, 'cell-out-of-range')
  check('board past the grid is refused', (await emitAck(alice, 'game:move', { board: 9, cell: 0 }))?.reason, 'board-out-of-range')
  check('a move with no board is refused', (await emitAck(alice, 'game:move', { cell: 0 }))?.reason, 'board-out-of-range')
  check('malformed move is refused', (await emitAck(alice, 'game:move', 'nope'))?.reason, 'malformed-move')

  const first = await move(alice, 0, 3)
  check('legal move is accepted', first.ack?.ok, true)
  check('board records the mark', first.view?.state?.boards?.[0]?.[3], 'X')
  check('turn passes to the opponent', first.view?.actors?.[0], bob.session.sessionId)

  // The rule that makes it Ultimate: X took cell 3, so O is pinned to board 3.
  check('the cell taken names the next board', first.view?.state?.activeBoardIndex, 3)
  check('playing outside that board is refused', (await emitAck(bob, 'game:move', { board: 0, cell: 0 }))?.reason, 'wrong-board')

  // O answers in board 3 with cell 0, which sends X back to board 0 — where
  // X's own first mark is already sitting on cell 3.
  const second = await move(bob, 3, 0)
  check('the pinned move is accepted', second.ack?.ok, true)
  check('and pins the opponent in turn', second.view?.state?.activeBoardIndex, 0)
  check('taken cell is refused', (await emitAck(alice, 'game:move', { board: 0, cell: 3 }))?.reason, 'cell-taken')

  // An outsider must not be able to reach someone else's game. Room capacity is
  // 2, so a third party can never be in the room — they are stopped at the room
  // boundary before the engine's own not-a-player check is even reached.
  const mallory = await connect('Mallory')
  check(
    'an outsider cannot move in a room they are not in',
    (await emitAck(mallory, 'game:move', { board: 4, cell: 4 }))?.reason,
    'not-in-a-room',
  )
  await emitAck(mallory, 'room:join', `${ROOM}-x`)
  check(
    'being in a different room gives no game',
    (await emitAck(mallory, 'game:move', { board: 4, cell: 4 }))?.reason,
    'no-game',
  )

  console.log('\nPlaying to a win')

  // Two of the seventeen scripted moves are already down.
  let localWin = null
  for (const [index, [board, cell]] of X_WINS_TOP_ROW.slice(2, -1).entries()) {
    const socket = index % 2 === 0 ? alice : bob
    const played = await move(socket, board, cell)
    check(`scripted move ${index + 3} is legal`, played.ack?.ok, true)
    if (played.view?.state?.globalBoard?.[0] === 'X' && !localWin) {
      localWin = played.view
    }
  }

  check('winning a local board claims a global square', localWin?.state?.globalBoard?.[0], 'X')
  check('the local winning line is exposed', localWin?.state?.localWinningLines?.[0], [3, 4, 5])
  check('a local win is not the game', localWin?.finished, false)

  const [lastBoard, lastCell] = X_WINS_TOP_ROW[X_WINS_TOP_ROW.length - 1]
  const winning = await move(alice, lastBoard, lastCell)

  check('winning move is accepted', winning.ack?.ok, true)
  check('winner is recorded', winning.view?.result?.winnerSessionIds, [alice.session.sessionId])
  check('result reason is a win', winning.view?.result?.reason, 'win')
  check('game reports finished', winning.view?.finished, true)
  check('no turn once finished', winning.view?.actors, [])
  check('winning line is exposed for the UI', winning.view?.state?.winningLine, [0, 1, 2])
  check('moves after the end are refused', (await emitAck(bob, 'game:move', { board: 8, cell: 8 }))?.reason, 'game-finished')

  console.log('\nEphemerality')

  check('state is in Redis while the room lives', (await redis.exists(`game:${ROOM}`)) === 1, true)

  // One player leaves. The game is already finished, so nothing new is
  // broadcast — but the state must survive while someone is still in the room.
  await emitAck(alice, 'room:leave')
  await new Promise((resolve) => setTimeout(resolve, 300))

  check('state survives while someone remains', (await redis.exists(`game:${ROOM}`)) === 1, true)

  // Last player leaves: state must be purged.
  await emitAck(bob, 'room:leave')
  await new Promise((resolve) => setTimeout(resolve, 300))

  check('state is PURGED when the room empties', await redis.exists(`game:${ROOM}`), 0)

  console.log('\nForfeit')

  const room2 = `${ROOM}-b`
  const carol = await connect('Carol')
  const dave = await connect('Dave')

  await emitAck(carol, 'room:join', room2)
  await emitAck(dave, 'room:join', room2)
  await emitAck(carol, 'game:start', 'tic-tac-toe')
  await waitForVersion(dave, 1)

  carol.disconnect()
  const forfeited = await waitForVersion(dave, 2)

  check('remaining player is told the game ended', forfeited?.finished, true)
  check('forfeit names the survivor as winner', forfeited?.result?.winnerSessionIds, [dave.session.sessionId])
  check('forfeit reason is recorded', forfeited?.result?.reason, 'forfeit')

  await emitAck(dave, 'room:leave')
  await new Promise((resolve) => setTimeout(resolve, 300))
  check('forfeited game is purged too', await redis.exists(`game:${room2}`), 0)
} finally {
  for (const socket of sockets) socket.close()
  await redis.quit()
}

console.log(
  failures === 0
    ? `\nAll ${checks} game checks passed.\n`
    : `\n${failures} of ${checks} game checks FAILED.\n`,
)

process.exit(failures === 0 ? 0 : 1)
