/**
 * Smoke test for the connection lifecycle: dropping out, coming back, and being
 * given up on.
 *
 * Source of truth:
 * docs/superpowers/specs/2026-08-04-disconnect-lifecycle-design.md
 *
 * The unit suite covers the rules (`eliminate`) and the engine (the reconnect
 * window in Redis). What only real sockets can show is the wiring between them:
 * that a hard disconnect actually reaches `detachLobby`, that `lobby:member-left`
 * goes out immediately, that the grace period reaches the other players' screens
 * rather than living only in Redis, and — the headline — that a drop mid-game no
 * longer ends the round for everyone else.
 *
 * SLOW BY NATURE. It waits out a real reveal phase and a real reconnect window.
 * Set `DISCONNECT_GRACE_MS=3000` in the repo-root `.env` and restart the server
 * to cut roughly thirty seconds off the run.
 *
 * Usage: start the server (`npm run dev`), then `npm run smoke:disconnect`.
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

/** Must match the server's own value, which comes from the same `.env`. */
const GRACE_MS = Number(process.env.DISCONNECT_GRACE_MS ?? '30000')

let failures = 0
let checks = 0

function check(label, actual, expected) {
  checks += 1
  const ok = JSON.stringify(actual) === JSON.stringify(expected)
  if (!ok) failures += 1
  console.log(
    `  ${ok ? 'PASS' : 'FAIL'}  ${label.padEnd(58)} ${
      ok
        ? JSON.stringify(actual)
        : `got ${JSON.stringify(actual)}, expected ${JSON.stringify(expected)}`
    }`,
  )
}

const sockets = []

async function mintToken(nickname) {
  return new SignJWT({ nickname })
    .setProtectedHeader({ alg: 'HS256' })
    .setSubject(crypto.randomUUID())
    .setIssuedAt()
    .setIssuer('dudu:web')
    .setAudience('dudu:client')
    .setExpirationTime('10m')
    .sign(secret)
}

/**
 * Connect one browser.
 *
 * `token` is passed back in on reconnect: a returning player MUST arrive with
 * the same sessionId, because that is what the game roster is keyed on. A fresh
 * token would be a different person as far as the server is concerned, which is
 * exactly the bug this whole feature exists to avoid.
 */
async function connect(nickname, token) {
  const auth = token ?? (await mintToken(nickname))

  const socket = io(URL, {
    auth: { token: auth },
    transports: ['websocket'],
    // No auto-reconnect: a drop in this script has to stay dropped until we say
    // otherwise, or socket.io would quietly heal the case under test.
    reconnection: false,
  })

  const session = await new Promise((resolve, reject) => {
    socket.once('session:ready', resolve)
    socket.once('connect_error', reject)
    setTimeout(() => reject(new Error('never connected')), 5000)
  })

  socket.token = auth
  socket.session = session
  socket.latestView = null
  socket.left = []
  socket.openTables = null

  socket.on('game:state', (view) => {
    socket.latestView = view
  })
  socket.on('lobby:member-left', (member) => {
    socket.left.push(member)
  })
  socket.on('lobby:open-tables', (tables) => {
    socket.openTables = tables
  })

  sockets.push(socket)
  return socket
}

function emitAck(socket, event, ...args) {
  return new Promise((resolve) => {
    socket.emit(event, ...args, resolve)
    setTimeout(() => resolve(null), 3000)
  })
}

function sleep(ms) {
  return new Promise((resolve) => setTimeout(resolve, ms))
}

/** Wait until `read()` returns something truthy, or give up. */
function waitUntil(read, ms = 5000) {
  return new Promise((resolve) => {
    const deadline = Date.now() + ms
    const tick = () => {
      const value = read()
      if (value) {
        resolve(value)
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

const waitForPhase = (socket, phase, ms) =>
  waitUntil(() => socket.latestView?.state?.phase === phase && socket.latestView, ms)

const LOBBY = `dc-${Date.now().toString(36)}`
const SCOPE = `lobby:${LOBBY}`

try {
  console.log(`\nUsing a ${GRACE_MS}ms reconnect window.`)
  console.log('\nDropping out while waiting in the lobby')

  const alice = await connect('Alice')
  const bob = await connect('Bob')
  const carol = await connect('Carol')
  const dave = await connect('Dave')
  const eve = await connect('Eve')

  for (const socket of [alice, bob, carol, dave, eve]) {
    await emitAck(socket, 'lobby:join', LOBBY)
  }

  const browser = await connect('Browser')
  browser.emit('lobby:watch')
  await sleep(300)
  check(
    'five seats are taken',
    browser.openTables?.find((table) => table.lobbyId === LOBBY)?.seated,
    5,
  )

  const eveSocketId = eve.id
  const eveSession = eve.session.sessionId
  eve.close()

  check(
    'the table is told immediately',
    Boolean(
      await waitUntil(() =>
        alice.left.some((member) => member.socketId === eveSocketId),
      ),
    ),
    true,
  )
  check(
    'and told who it was',
    alice.left.find((member) => member.socketId === eveSocketId)?.sessionId,
    eveSession,
  )
  check('the seat is freed at once', await redis.hlen(`lobby:${LOBBY}:members`), 4)
  await sleep(300)
  check(
    'and the browser sees the free seat',
    browser.openTables?.find((table) => table.lobbyId === LOBBY)?.seated,
    4,
  )
  check(
    'nothing is counting down, because there was no game to hold',
    await redis.zcard('games:disconnects'),
    0,
  )

  console.log('\nDropping out mid-game')

  check('a four-player table deals', (await emitAck(alice, 'game:start', 'mr-white'))?.ok, true)
  await sleep(300)

  const bobSession = bob.session.sessionId
  const bobToken = bob.token
  bob.close()

  const seenReconnecting = await waitUntil(
    () => alice.latestView?.disconnected?.[bobSession] && alice.latestView,
  )
  check('the table is shown a reconnect window', Boolean(seenReconnecting), true)
  check(
    'ending one grace period from now',
    seenReconnecting?.disconnected?.[bobSession] > seenReconnecting?.serverNow,
    true,
  )
  check(
    'and the sweeper has it indexed',
    await redis.zscore('games:disconnects', `${SCOPE}|${bobSession}`),
    String(seenReconnecting?.disconnected?.[bobSession]),
  )

  // The whole point. Before this change `detachLobby` forfeited, and these three
  // would be staring at a finished game because one person's wifi blinked.
  check('the game is NOT over for everyone else', alice.latestView?.finished, false)
  check('and has no result', alice.latestView?.result, null)
  check('the roster still names them', alice.latestView?.players?.length, 4)

  console.log('\nComing back')

  const bobAgain = await connect('Bob', bobToken)
  check('the returning player keeps their identity', bobAgain.session.sessionId, bobSession)
  await emitAck(bobAgain, 'lobby:join', LOBBY)

  check(
    'the countdown clears for the whole table',
    Boolean(
      await waitUntil(() => alice.latestView?.disconnected?.[bobSession] === undefined),
    ),
    true,
  )
  check(
    'and leaves nothing in the index',
    await redis.zscore('games:disconnects', `${SCOPE}|${bobSession}`),
    null,
  )
  check('they are still in the game', Boolean(bobAgain.latestView?.state?.yourRole), true)
  check(
    'and not eliminated',
    bobAgain.latestView?.state?.eliminated?.includes(bobSession),
    false,
  )

  console.log('\nNever coming back')

  const seated = [alice, bobAgain, carol, dave]
  const impostor = seated.find(
    (socket) => socket.latestView?.state?.yourRole === 'mr-white',
  )
  check('exactly one player holds the impostor role', Boolean(impostor), true)

  await waitForPhase(alice, 'clue', 15_000)
  check('the clue round opens on the server clock', alice.latestView?.state?.phase, 'clue')

  // Make the floor-holder deterministically a CIVILIAN. Dropping the impostor is
  // a different rule (the civilians win by forfeit) and would make this test
  // assert something different depending on the deal.
  if (alice.latestView?.actors?.[0] === impostor.session.sessionId) {
    await emitAck(impostor, 'game:move', { type: 'clue', word: 'bluff' })
    await waitUntil(
      () => alice.latestView?.actors?.[0] !== impostor.session.sessionId,
    )
  }

  const holderSession = alice.latestView?.actors?.[0]
  const holder = seated.find((socket) => socket.session.sessionId === holderSession)
  check(
    'the floor is held by a civilian',
    holder?.latestView?.state?.yourRole,
    'civilian',
  )

  const watcher = seated.find((socket) => socket !== holder)
  holder.close()

  check(
    'the table sees them counting down',
    Boolean(await waitUntil(() => watcher.latestView?.disconnected?.[holderSession])),
    true,
  )
  check(
    'and the game is still waiting on them',
    watcher.latestView?.actors?.includes(holderSession),
    true,
  )

  console.log(`\n  ... waiting out the ${GRACE_MS}ms window ...`)

  const eliminated = await waitUntil(
    () =>
      watcher.latestView?.state?.eliminated?.includes(holderSession) &&
      watcher.latestView,
    GRACE_MS + 8000,
  )

  check('the window runs out and they are eliminated', Boolean(eliminated), true)
  check(
    'the table stops waiting on them',
    eliminated?.actors?.includes(holderSession),
    false,
  )
  check(
    'and somebody else can act, so nothing is frozen',
    (eliminated?.actors?.length ?? 0) > 0 || eliminated?.state?.phase === 'discussion',
    true,
  )
  check('the game carries on for the rest', eliminated?.finished, false)
  check(
    'the reconnect window is cleared',
    eliminated?.disconnected?.[holderSession],
    undefined,
  )
  check(
    'and so is the index entry',
    await redis.zscore('games:disconnects', `${SCOPE}|${holderSession}`),
    null,
  )

  console.log('\nEphemerality')

  for (const socket of seated) {
    if (socket === holder) continue
    await emitAck(socket, 'lobby:leave')
    await sleep(60)
  }
  await sleep(400)

  check('the game is purged when the table empties', await redis.exists(`game:${SCOPE}`), 0)
  check(
    'and no countdown outlives it',
    (await redis.zrange('games:disconnects', 0, -1)).filter((member) =>
      member.startsWith(`${SCOPE}|`),
    ).length,
    0,
  )
} finally {
  for (const socket of sockets) socket.close()
  await redis.quit()
}

console.log(
  failures === 0
    ? `\nAll ${checks} disconnect checks passed.\n`
    : `\n${failures} of ${checks} disconnect checks FAILED.\n`,
)

process.exit(failures === 0 ? 0 : 1)
