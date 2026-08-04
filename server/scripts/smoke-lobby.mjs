/**
 * Smoke test for the Mr. White lobby: membership, scoped chat, and the loop.
 *
 * Four sockets, driven the way four browsers would drive them. The unit suite
 * covers the rules as pure functions; this covers the things only real sockets
 * can show — that the redaction survives the wire, that a `dead`-channel line
 * never reaches a living player, and that a phase advances on the server's own
 * clock with nobody sending anything.
 *
 * Usage: start the server (`npm run dev`), then `npm run smoke:lobby`.
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
    `  ${ok ? 'PASS' : 'FAIL'}  ${label.padEnd(54)} ${
      ok
        ? JSON.stringify(actual)
        : `got ${JSON.stringify(actual)}, expected ${JSON.stringify(expected)}`
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

  const socket = io(URL, {
    auth: { token },
    transports: ['websocket'],
    reconnection: false,
  })

  const session = await new Promise((resolve, reject) => {
    socket.once('session:ready', resolve)
    socket.once('connect_error', reject)
    setTimeout(() => reject(new Error('never connected')), 5000)
  })

  socket.session = session

  // Persistent listeners rather than one-shot waiters: every transition
  // broadcasts to all four sockets, so a freshly attached one-shot listener
  // frequently catches the previous broadcast still in flight.
  socket.latestView = null
  socket.chat = []
  socket.openTables = null
  socket.on('game:state', (view) => {
    socket.latestView = view
  })
  socket.on('game:chat-message', (message) => {
    socket.chat.push(message)
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

/** Wait until this socket sees a view satisfying `predicate`. */
function waitFor(socket, predicate, ms = 4000) {
  return new Promise((resolve) => {
    const deadline = Date.now() + ms
    const tick = () => {
      if (socket.latestView && predicate(socket.latestView)) {
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

const waitForPhase = (socket, phase, ms) =>
  waitFor(socket, (view) => view.state?.phase === phase, ms)

const LOBBY = `mw-${Date.now().toString(36)}`

try {
  console.log('\nLobby membership')

  const alice = await connect('Alice')
  const bob = await connect('Bob')
  const carol = await connect('Carol')
  const dave = await connect('Dave')
  const players = [alice, bob, carol, dave]

  check(
    'a bad lobby id is refused',
    (await emitAck(alice, 'lobby:join', 'no'))?.error,
    'invalid-lobby-id',
  )

  const joinedFirst = await emitAck(alice, 'lobby:join', LOBBY)
  check('first player is seated', joinedFirst?.ok, true)
  check('and sees an empty table', joinedFirst?.members?.length, 0)
  check('capacity is published as eight', joinedFirst?.capacity, 8)

  const joinedSecond = await emitAck(bob, 'lobby:join', LOBBY)
  check('second player sees the first', joinedSecond?.members?.length, 1)

  // A re-join must be a no-op, not a leave-and-rejoin: the detach path forfeits
  // a running game for everyone else, so a client that emits join twice would
  // end three other people's game.
  const rejoined = await emitAck(bob, 'lobby:join', LOBBY)
  check('rejoining the same lobby succeeds', rejoined?.ok, true)
  check('and does not duplicate the seat', rejoined?.members?.length, 1)
  check(
    'nor vacate it',
    (await redis.hlen(`lobby:${LOBBY}:members`)) >= 2,
    true,
  )

  await emitAck(carol, 'lobby:join', LOBBY)

  // Checked at three seats, before Dave arrives — Mr. White's floor is four.
  check(
    'a three-player table is refused',
    (await emitAck(alice, 'game:start', 'mr-white'))?.error,
    'wrong-player-count',
  )

  console.log('\nThe open-table browser')

  // A watcher who is in no lobby at all — this is the /lobby page before you
  // have picked a table.
  const browser = await connect('Browser')
  browser.emit('lobby:watch')
  await sleep(300)

  const listed = browser.openTables?.find((table) => table.lobbyId === LOBBY)
  check('an occupied table is listed', Boolean(listed), true)
  check('with its occupancy', listed?.seated, 3)
  check('and its capacity', listed?.capacity, 8)
  check('and who opened it', listed?.host, 'Alice')
  check('not yet in progress', listed?.inProgress, false)
  check(
    'the summary carries no roster',
    Object.keys(listed ?? {}).sort(),
    ['capacity', 'host', 'inProgress', 'lobbyId', 'seated'],
  )

  await emitAck(dave, 'lobby:join', LOBBY)
  await sleep(300)
  check(
    'a seat taken updates watchers without asking',
    browser.openTables?.find((table) => table.lobbyId === LOBBY)?.seated,
    4,
  )

  console.log('\nPre-game chat')

  check(
    'chat is open before a game starts',
    (await emitAck(alice, 'game:chat', 'anyone else here?'))?.ok,
    true,
  )
  await sleep(200)
  check('every seat receives it', dave.chat.length, 1)
  check('on the lobby channel', dave.chat[0]?.channel, 'lobby')
  check('with the sender named', dave.chat[0]?.nickname, 'Alice')
  check('and the sender sees their own line', alice.chat.length, 1)

  check(
    'moderation still applies before the game',
    (await emitAck(bob, 'game:chat', 'http://spam.example.com'))?.error,
    'links-not-allowed',
  )

  console.log('\nStarting')

  // Alice sat down first, so she is the host. Everyone else is refused —
  // enforced on the server, not just hidden in the UI.
  check(
    'a guest cannot deal',
    (await emitAck(dave, 'game:start', 'mr-white'))?.error,
    'not-the-host',
  )
  check(
    'the join ack names your own seat',
    joinedSecond?.you?.nickname,
    'Bob',
  )

  const started = await emitAck(alice, 'game:start', 'mr-white')
  check('the host can deal', started?.ok, true)

  await sleep(300)
  check(
    'the browser sees the table go in progress',
    browser.openTables?.find((table) => table.lobbyId === LOBBY)?.inProgress,
    true,
  )

  const revealed = await waitForPhase(alice, 'reveal')
  check('the game opens in the reveal phase', revealed?.state?.phase, 'reveal')
  check('nobody may act during reveal', revealed?.actors, [])
  check('a phase deadline is published', typeof revealed?.phaseEndsAt, 'number')
  check('so is the server clock', typeof revealed?.serverNow, 'number')

  console.log('\nRedaction, read off the wire')

  const views = players.map((socket) => socket.latestView)
  const impostorSockets = players.filter(
    (socket) => socket.latestView?.state?.yourRole === 'mr-white',
  )

  check('exactly one player is Mr. White', impostorSockets.length, 1)

  const impostor = impostorSockets[0]
  const civilians = players.filter((socket) => socket !== impostor)

  check(
    'Mr. White is never given the word',
    impostor.latestView?.state?.secretWord,
    null,
  )
  check(
    'civilians all share one word',
    new Set(civilians.map((socket) => socket.latestView.state.secretWord)).size,
    1,
  )
  check(
    'no roles map is published while the game runs',
    views.every((view) => view.state.roles === null),
    true,
  )

  const impostorId = impostor.session.sessionId
  check(
    'no civilian payload contains Mr. White’s id',
    civilians.every(
      (socket) => !JSON.stringify(socket.latestView.state).includes(impostorId),
    ),
    true,
  )

  console.log('\nThe clue round')

  const clue = await waitForPhase(alice, 'clue', 13_000)
  check('the reveal expires on the server clock', clue?.state?.phase, 'clue')
  check('exactly one player holds the floor', clue?.actors?.length, 1)

  check(
    'chat is closed during the clue round',
    (await emitAck(dave, 'game:chat', 'psst'))?.error,
    'chat-closed',
  )

  const firstActor = players.find(
    (socket) => socket.session.sessionId === clue.actors[0],
  )
  const notTheActor = players.find(
    (socket) => socket.session.sessionId !== clue.actors[0],
  )

  check(
    'an out-of-turn clue is refused',
    (await emitAck(notTheActor, 'game:move', { type: 'clue', word: 'nope' }))
      ?.reason,
    'not-your-turn',
  )
  check(
    'a two-word clue is refused',
    (await emitAck(firstActor, 'game:move', {
      type: 'clue',
      word: 'tall and bright',
    }))?.reason,
    'not-one-word',
  )
  check(
    'so is one absurdly long word',
    (await emitAck(firstActor, 'game:move', {
      type: 'clue',
      word: 'a'.repeat(200),
    }))?.reason,
    'clue-too-long',
  )
  check(
    'the actor may give one word',
    (await emitAck(firstActor, 'game:move', { type: 'clue', word: 'bright' }))
      ?.ok,
    true,
  )

  await sleep(150)
  check(
    'the clue is public',
    dave.latestView?.state?.clues?.[firstActor.session.sessionId],
    'bright',
  )

  // Everyone else speaks, which closes the round. Turn order is read from one
  // socket's view throughout — every socket receives the same `actors`, and
  // mixing sources here would race the broadcast.
  for (let turn = 0; turn < players.length; turn += 1) {
    const current = alice.latestView
    if (current?.state?.phase !== 'clue') break

    const actor = players.find(
      (entry) => entry.session.sessionId === current.actors[0],
    )
    if (!actor) break

    await emitAck(actor, 'game:move', { type: 'clue', word: 'coast' })
    await sleep(120)
  }

  const discussion = await waitForPhase(alice, 'discussion', 40_000)
  check('a full clue round opens the discussion', discussion?.state?.phase, 'discussion')
  check('nobody may act during discussion', discussion?.actors, [])

  console.log('\nDiscussion and voting')

  check(
    'chat reopens for the discussion',
    (await emitAck(bob, 'game:chat', 'that clue was vague'))?.ok,
    true,
  )
  await sleep(200)
  check(
    'and goes to the table channel',
    bob.chat[bob.chat.length - 1]?.channel,
    'table',
  )

  // Cutting the 90-second discussion short, which is also what keeps this
  // suite from taking a minute and a half to reach the vote.
  await emitAck(alice, 'game:move', { type: 'ready' })
  await emitAck(bob, 'game:move', { type: 'ready' })
  await sleep(250)

  check(
    'half the table is not a majority',
    alice.latestView?.state?.phase,
    'discussion',
  )
  check(
    'and the count is public',
    alice.latestView?.state?.readyToVote?.length,
    2,
  )

  await emitAck(bob, 'game:move', { type: 'ready' })
  await sleep(200)
  check(
    'readiness can be taken back',
    alice.latestView?.state?.readyToVote?.length,
    1,
  )

  // Alice is still ready from above, so Bob coming back plus Carol makes three.
  await emitAck(bob, 'game:move', { type: 'ready' })
  await emitAck(carol, 'game:move', { type: 'ready' })

  const vote = await waitForPhase(alice, 'vote', 6000)
  check('a majority ends the discussion early', vote?.state?.phase, 'vote')
  check('and readiness resets with it', vote?.state?.readyToVote, [])
  check('every living player may vote', vote?.actors?.length, 4)
  check('no tally is published while voting', vote?.state?.votes, {})

  check(
    'a self-vote is legal',
    (await emitAck(alice, 'game:move', { type: 'vote', target: alice.session.sessionId }))
      ?.ok,
    true,
  )

  // The rest pile onto Mr. White, which is the only way to reach the guess.
  for (const socket of players) {
    if (socket === alice) continue
    await emitAck(socket, 'game:move', { type: 'vote', target: impostorId })
    await sleep(60)
  }

  const revealVote = await waitForPhase(alice, 'reveal-vote', 50_000)
  check('a full table closes the vote early', revealVote?.state?.phase, 'reveal-vote')
  check('votes are published once revealed', Object.keys(revealVote?.state?.votes ?? {}).length, 4)
  check('Mr. White is eliminated', revealVote?.state?.eliminated, [impostorId])

  console.log('\nThe dead channel')

  check(
    'an eliminated player may still talk',
    (await emitAck(impostor, 'game:chat', 'worth a shot'))?.ok,
    true,
  )
  await sleep(250)
  check(
    'on the dead channel',
    impostor.chat[impostor.chat.length - 1]?.channel,
    'dead',
  )
  check(
    'and no living player ever receives it',
    civilians.every(
      (socket) => !socket.chat.some((line) => line.channel === 'dead'),
    ),
    true,
  )

  console.log('\nThe final guess')

  const guess = await waitForPhase(alice, 'guess', 12_000)
  check('a caught Mr. White gets to guess', guess?.state?.phase, 'guess')
  check('and is the only actor', guess?.actors, [impostorId])

  check(
    'a civilian may not guess',
    (await emitAck(civilians[0], 'game:move', { type: 'guess', word: 'x' }))
      ?.reason,
    'not-mr-white',
  )

  const word = civilians[0].latestView.state.secretWord
  check(
    'the right word steals the game',
    (await emitAck(impostor, 'game:move', { type: 'guess', word }))?.ok,
    true,
  )

  const finished = await waitForPhase(alice, 'finished', 5000)
  check('the game finishes', finished?.finished, true)
  check('Mr. White takes the win', finished?.result?.team, 'mr-white')
  check('and is named the winner', finished?.result?.winnerSessionIds, [impostorId])
  check('every role is revealed at the end', finished?.state?.roles !== null, true)
  check('and so is the word', finished?.state?.secretWord, word)

  console.log('\nAfterwards')

  check(
    'chat reopens once the game is over',
    (await emitAck(impostor, 'game:chat', 'good game'))?.ok,
    true,
  )
  await sleep(200)
  check(
    'on the lobby channel again',
    alice.chat[alice.chat.length - 1]?.channel,
    'lobby',
  )

  console.log('\nEphemerality')

  check('state lives in Redis while the lobby does', await redis.exists(`game:lobby:${LOBBY}`), 1)

  for (const socket of players) {
    await emitAck(socket, 'lobby:leave')
    await sleep(60)
  }
  await sleep(300)

  check('state is PURGED when the lobby empties', await redis.exists(`game:lobby:${LOBBY}`), 0)
  check('and so is the deadline index entry', await redis.zscore('games:deadlines', `lobby:${LOBBY}`), null)
  check(
    'an empty table is delisted',
    await redis.sismember('lobbies:open', LOBBY),
    0,
  )
  check(
    'and vanishes from the browser',
    browser.openTables?.some((table) => table.lobbyId === LOBBY),
    false,
  )
} finally {
  for (const socket of sockets) socket.close()
  await redis.quit()
}

console.log(
  failures === 0
    ? `\nAll ${checks} lobby checks passed.\n`
    : `\n${failures} of ${checks} lobby checks FAILED.\n`,
)

process.exit(failures === 0 ? 0 : 1)
