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
async function move(socket, cell) {
  const before = socket.latestView?.version ?? 0
  const ack = await emitAck(socket, 'game:move', { cell })
  const view = ack?.ok ? await waitForVersion(socket, before + 1) : null
  return { ack, view }
}

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
  check('board starts empty', initial?.state?.board?.every((c) => c === null), true)
  check('starter moves first', initial?.currentTurn, alice.session.sessionId)
  check('both see the same turn', bobInitial?.currentTurn, alice.session.sessionId)
  check('game is not finished', initial?.finished, false)

  console.log('\nServer-side move validation')

  const outOfTurn = await emitAck(bob, 'game:move', { cell: 0 })
  check('moving out of turn is refused', outOfTurn?.reason, 'not-your-turn')

  check('non-integer cell is refused', (await emitAck(alice, 'game:move', { cell: 1.5 }))?.reason, 'cell-out-of-range')
  check('negative cell is refused', (await emitAck(alice, 'game:move', { cell: -1 }))?.reason, 'cell-out-of-range')
  check('cell past the board is refused', (await emitAck(alice, 'game:move', { cell: 9 }))?.reason, 'cell-out-of-range')
  check('malformed move is refused', (await emitAck(alice, 'game:move', 'nope'))?.reason, 'malformed-move')

  const first = await move(alice, 0)
  check('legal move is accepted', first.ack?.ok, true)
  check('board records the mark', first.view?.state?.board?.[0], 'X')
  check('turn passes to the opponent', first.view?.currentTurn, bob.session.sessionId)

  check('taken cell is refused', (await emitAck(bob, 'game:move', { cell: 0 }))?.reason, 'cell-taken')

  // An outsider must not be able to reach someone else's game. Room capacity is
  // 2, so a third party can never be in the room — they are stopped at the room
  // boundary before the engine's own not-a-player check is even reached.
  const mallory = await connect('Mallory')
  check(
    'an outsider cannot move in a room they are not in',
    (await emitAck(mallory, 'game:move', { cell: 4 }))?.reason,
    'not-in-a-room',
  )
  await emitAck(mallory, 'room:join', `${ROOM}-x`)
  check(
    'being in a different room gives no game',
    (await emitAck(mallory, 'game:move', { cell: 4 }))?.reason,
    'no-game',
  )

  console.log('\nPlaying to a win')

  // X: 0,1,2 across the top. O: 3,4.
  await move(bob, 3)
  await move(alice, 1)
  await move(bob, 4)
  const winning = await move(alice, 2)

  check('winning move is accepted', winning.ack?.ok, true)
  check('winner is recorded', winning.view?.result?.winnerSessionId, alice.session.sessionId)
  check('result reason is a win', winning.view?.result?.reason, 'win')
  check('game reports finished', winning.view?.finished, true)
  check('no turn once finished', winning.view?.currentTurn, null)
  check('winning line is exposed for the UI', winning.view?.state?.winningLine, [0, 1, 2])
  check('moves after the end are refused', (await emitAck(bob, 'game:move', { cell: 5 }))?.reason, 'game-finished')

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
  check('forfeit names the survivor as winner', forfeited?.result?.winnerSessionId, dave.session.sessionId)
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
