/**
 * Smoke test for a five-seat Werewolf table.
 *
 * Five sockets, driven the way five browsers would drive them. The unit suite
 * covers the rules as pure functions; this covers the things only real sockets
 * can show — that the per-viewer redaction survives the wire, that the Witch is
 * the ONLY client ever sent tonight's victim, that the pack's night channel
 * never reaches a villager, and that the night closes on the server's own clock
 * with the sequential `witch` phase landing where it should.
 *
 * IT DISCOVERS THE DEAL RATHER THAN FIXING IT. Roles are dealt at random and the
 * server never tells a client who anyone else is, so the script finds the wolf
 * the same way a player does: by reading `yourRole` out of its OWN projection.
 * That is the point — if the redaction is right, this is the only way to find
 * out, and a script that could cheat here would prove the opposite.
 *
 * At five seats the deal is fixed in shape: 1 werewolf, Seer, Guard, Witch and
 * one plain villager. No Cupid, so `nightZero` is skipped entirely.
 *
 * Usage: start the server (`npm run dev`), then `npm run smoke:werewolf`.
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
    `  ${ok ? 'PASS' : 'FAIL'}  ${label.padEnd(56)} ${
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
  socket.nickname = nickname

  // Persistent listeners rather than one-shot waiters: every transition
  // broadcasts to all five sockets, so a freshly attached one-shot listener
  // frequently catches the previous broadcast still in flight.
  socket.latestView = null
  socket.chat = []
  socket.on('game:state', (view) => {
    socket.latestView = view
  })
  socket.on('game:chat-message', (message) => {
    socket.chat.push(message)
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
function waitFor(socket, predicate, ms = 6000) {
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

/** The one socket holding `role`, by its own projection. */
const holder = (players, role) =>
  players.find((socket) => socket.latestView?.state?.yourRole === role) ?? null

const idOf = (socket) => socket.session.sessionId

const LOBBY = `ww-${Date.now().toString(36)}`

try {
  console.log('\nSeating a five-player table')

  const players = []
  for (const name of ['Ana', 'Budi', 'Citra', 'Dewi', 'Eko']) {
    players.push(await connect(name))
  }
  const [ana] = players

  for (const socket of players.slice(0, 4)) {
    await emitAck(socket, 'lobby:join', LOBBY)
  }

  // Werewolf's floor is five while the LOBBY holds eight, so a refusal here
  // proves the engine reads the limit off the game rather than off the room.
  //
  // Deliberately no Mr. White game is started to contrast against: there is no
  // event that ends a running game without emptying the lobby, so starting one
  // would leave it in Redis and every `waitForPhase` below could match ITS
  // reveal instead of Werewolf's.
  check(
    'a four-player Werewolf table is refused',
    (await emitAck(ana, 'game:start', 'werewolf'))?.error,
    'wrong-player-count',
  )

  await emitAck(players[4], 'lobby:join', LOBBY)
  check('the fifth seat fills', (await redis.hlen(`lobby:${LOBBY}:members`)) , 5)

  console.log('\nThe deal')

  // Belt and braces against the trap above: a view left over from any earlier
  // game would satisfy `waitForPhase('reveal')` the instant it is called.
  for (const socket of players) socket.latestView = null

  check('five players may start', (await emitAck(ana, 'game:start', 'werewolf'))?.ok, true)
  const reveal = await waitForPhase(ana, 'reveal')
  check('the table opens on reveal', reveal?.state?.phase, 'reveal')
  check('and names the game', reveal?.gameId, 'werewolf')

  await sleep(200)

  const roles = players.map((socket) => socket.latestView?.state?.yourRole)
  check('every seat is dealt a role', roles.every(Boolean), true)
  check(
    'the five-seat deal is exactly one of each',
    [...roles].sort(),
    ['guard', 'seer', 'villager', 'werewolf', 'witch'],
  )

  const wolf = holder(players, 'werewolf')
  const seer = holder(players, 'seer')
  const guard = holder(players, 'guard')
  const witch = holder(players, 'witch')
  const villager = holder(players, 'villager')

  console.log('\nRedaction on the wire')

  // The whole anti-cheat story, checked against the bytes a browser receives.
  for (const socket of players) {
    const state = socket.latestView.state
    check(
      `${socket.nickname}: no seat order on the wire`,
      'order' in state,
      false,
    )
    check(`${socket.nickname}: no roles map on the wire`, 'roles' in state, false)
  }

  const wolfId = idOf(wolf)
  check(
    "nobody else's payload contains the wolf's id",
    players
      .filter((socket) => socket !== wolf)
      .every((socket) => !JSON.stringify(socket.latestView.state).includes(wolfId)),
    true,
  )
  check(
    'a lone wolf is told of no packmates',
    wolf.latestView.state.packmates,
    [],
  )
  check(
    'the villager is told nothing but their own role',
    {
      packmates: villager.latestView.state.packmates,
      inspections: villager.latestView.state.inspections,
      lovers: villager.latestView.state.lovers,
      pendingKill: villager.latestView.state.pendingKill,
    },
    { packmates: [], inspections: {}, lovers: [], pendingKill: null },
  )

  console.log('\nNight one')

  // No Cupid at five seats, so the first night is `night`, never `nightZero`.
  const night = await waitForPhase(ana, 'night', 14000)
  check('reveal gives way to night, not nightZero', night?.state?.phase, 'night')
  check('and it is night one', night?.state?.night, 1)
  check(
    'only the three night roles may act',
    [...night.actors].sort(),
    [idOf(wolf), idOf(seer), idOf(guard)].sort(),
  )
  check('the Witch does NOT act in the night phase', night.actors.includes(idOf(witch)), false)

  console.log('\nThe pack channel')

  check(
    'a villager may not talk at night',
    (await emitAck(villager, 'game:chat', 'hello?'))?.error,
    'chat-closed',
  )
  check(
    'the wolf may, on the pack channel',
    (await emitAck(wolf, 'game:chat', 'taking the seer'))?.ok,
    true,
  )
  await sleep(250)
  check(
    'and no villager ever receives it',
    players
      .filter((socket) => socket !== wolf)
      .every((socket) => socket.chat.length === 0),
    true,
  )

  console.log('\nThe night actions')

  check(
    'the wolf may not eat itself',
    (await emitAck(wolf, 'game:move', { type: 'kill', target: wolfId }))?.reason,
    'target-is-pack',
  )
  check(
    'a villager may not hunt',
    (await emitAck(villager, 'game:move', { type: 'kill', target: idOf(seer) }))?.reason,
    'not-a-werewolf',
  )

  // The wolf eats the villager, so the village keeps its power roles and the
  // game stays live for the day phase below.
  check(
    'the wolf takes the villager',
    (await emitAck(wolf, 'game:move', { type: 'kill', target: idOf(villager) }))?.ok,
    true,
  )
  check(
    'the Seer reads the wolf',
    (await emitAck(seer, 'game:move', { type: 'inspect', target: wolfId }))?.ok,
    true,
  )
  // Covering someone OTHER than tonight's victim, so the kill lands and the
  // Witch is offered a real decision below.
  check(
    'the Guard covers the Seer',
    (await emitAck(guard, 'game:move', { type: 'protect', target: idOf(seer) }))?.ok,
    true,
  )

  console.log("\nThe Witch's phase")

  const witchPhase = await waitForPhase(witch, 'witch', 6000)
  check('the last night actor opens the Witch phase', witchPhase?.state?.phase, 'witch')
  check('and she is the only actor', witchPhase?.actors, [idOf(witch)])
  check('nobody has died yet', witchPhase?.state?.dead, [])

  check(
    'the Witch is shown tonight\'s victim',
    witch.latestView.state.pendingKill,
    idOf(villager),
  )
  check(
    'and she is the ONLY client shown it',
    players
      .filter((socket) => socket !== witch)
      .every((socket) => socket.latestView.state.pendingKill === null),
    true,
  )
  check(
    'her potions are hers alone',
    players
      .filter((socket) => socket !== witch)
      .every((socket) => socket.latestView.state.healUsed === false),
    true,
  )
  check(
    'a non-witch may not touch the potions',
    (await emitAck(seer, 'game:move', { type: 'heal' }))?.reason,
    'not-the-witch',
  )

  // She lets him die, keeping both potions — the simplest path that still
  // proves the phase closes on a real move.
  check('the Witch passes', (await emitAck(witch, 'game:move', { type: 'pass' }))?.ok, true)

  console.log('\nDawn')

  const dawn = await waitForPhase(ana, 'dawn', 6000)
  check('passing closes the night to dawn', dawn?.state?.phase, 'dawn')
  check('the victim is dead', dawn?.state?.dead, [idOf(villager)])
  check('and the pack is credited', dawn?.state?.lastKilled, idOf(villager))
  check('the Guard did not save them', dawn?.state?.lastSaved, false)
  check('nor did the Witch', dawn?.state?.lastHealed, false)
  check('both potions are still on the shelf', witch.latestView.state.healUsed, false)
  check(
    "the dead player's role is now public",
    dawn?.state?.revealedRoles?.[idOf(villager)],
    'villager',
  )
  check(
    'and no living role leaked with it',
    Object.keys(dawn?.state?.revealedRoles ?? {}),
    [idOf(villager)],
  )

  console.log("\nThe Seer's private ledger")

  check(
    'the Seer holds a reading on the wolf',
    seer.latestView.state.inspections?.[wolfId],
    'werewolf',
  )
  check(
    'and nobody else holds a single entry',
    players
      .filter((socket) => socket !== seer)
      .every(
        (socket) => Object.keys(socket.latestView.state.inspections ?? {}).length === 0,
      ),
    true,
  )

  console.log('\nDay and the vote')

  const day = await waitForPhase(ana, 'day', 12000)
  check('dawn gives way to the argument', day?.state?.phase, 'day')
  check('the table chat reopens', (await emitAck(seer, 'game:chat', 'it is them'))?.ok, true)
  await sleep(250)
  check(
    'and the living all hear it',
    players.filter((s) => s !== villager).every((s) => s.chat.some((m) => m.channel === 'table')),
    true,
  )
  check(
    'the dead player may still talk, on the dead channel',
    (await emitAck(villager, 'game:chat', 'it was them, I saw'))?.ok,
    true,
  )

  // Three of the four living is a strict majority, which opens the vote early.
  for (const socket of [seer, guard, witch]) {
    await emitAck(socket, 'game:move', { type: 'ready' })
  }

  const vote = await waitForPhase(ana, 'vote', 6000)
  check('a majority cuts the discussion short', vote?.state?.phase, 'vote')
  check('every living player may vote', vote?.actors?.length, 4)
  check('no tally is published while voting', vote?.state?.votes, {})
  check(
    'the dead do not vote',
    (await emitAck(villager, 'game:move', { type: 'vote', target: wolfId }))?.reason,
    'eliminated',
  )

  for (const socket of [seer, guard, witch, wolf]) {
    await emitAck(socket, 'game:move', { type: 'vote', target: wolfId })
  }

  console.log('\nVerdict and the win')

  const verdict = await waitForPhase(ana, 'verdict', 6000)
  check('a full table closes the vote early', verdict?.state?.phase, 'verdict')
  check('the wolf is hanged', verdict?.state?.lastLynched, wolfId)
  check('votes are published once cast', Object.keys(verdict?.state?.votes ?? {}).length, 4)

  const finished = await waitForPhase(ana, 'finished', 12000)
  check('losing its last wolf ends the game', finished?.state?.phase, 'finished')
  check('the village takes it', finished?.state?.winningTeam, 'village')
  check('and the result names the team', finished?.result?.team, 'village')
  check(
    'the four villagers are the winners',
    [...(finished?.result?.winnerSessionIds ?? [])].sort(),
    [idOf(seer), idOf(guard), idOf(witch), idOf(villager)].sort(),
  )
  check(
    'every role is revealed at the end',
    Object.keys(finished?.state?.revealedRoles ?? {}).length,
    5,
  )

  console.log('\nEphemerality')

  const scope = `lobby:${LOBBY}`
  check('state lives in Redis while the lobby does', await redis.exists(`game:${scope}`), 1)
  for (const socket of players) await emitAck(socket, 'lobby:leave')
  await sleep(400)
  check('state is PURGED when the lobby empties', await redis.exists(`game:${scope}`), 0)
  check('and so is the deadline index entry', await redis.zscore('game:deadlines', scope), null)
} catch (error) {
  failures += 1
  console.error('\nSMOKE ABORTED:', error)
} finally {
  for (const socket of sockets) socket.close()
  await redis.quit()

  console.log(
    failures === 0
      ? `\nAll ${checks} Werewolf checks passed.\n`
      : `\n${failures} of ${checks} Werewolf checks FAILED.\n`,
  )
  process.exit(failures === 0 ? 0 : 1)
}
