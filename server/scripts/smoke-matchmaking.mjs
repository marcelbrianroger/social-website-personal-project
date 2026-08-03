/**
 * Smoke test for the Redis-backed matchmaking queue.
 *
 * Usage: start the server (`npm run dev`), then `npm run smoke:matchmaking`.
 */

import path from 'node:path'
import { fileURLToPath } from 'node:url'

import { config as loadEnv } from 'dotenv'
import { SignJWT } from 'jose'
import { io } from 'socket.io-client'

const here = path.dirname(fileURLToPath(import.meta.url))
loadEnv({ path: path.resolve(here, '../../.env') })

const URL = `http://localhost:${process.env.SOCKET_PORT ?? '4000'}`
const secret = new TextEncoder().encode(process.env.SESSION_JWT_SECRET)

let failures = 0
let checks = 0

function check(label, actual, expected) {
  checks += 1
  const ok = JSON.stringify(actual) === JSON.stringify(expected)
  if (!ok) failures += 1
  console.log(
    `  ${ok ? 'PASS' : 'FAIL'}  ${label.padEnd(54)} ${
      ok ? JSON.stringify(actual) : `got ${JSON.stringify(actual)}, expected ${JSON.stringify(expected)}`
    }`,
  )
}

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

  await new Promise((resolve, reject) => {
    socket.once('session:ready', resolve)
    socket.once('connect_error', reject)
    setTimeout(() => reject(new Error(`${nickname} never connected`)), 5000)
  })

  return socket
}

function waitFor(socket, event, ms = 1500) {
  return new Promise((resolve) => {
    const timer = setTimeout(() => {
      socket.off(event, handler)
      resolve(null)
    }, ms)
    const handler = (payload) => {
      clearTimeout(timer)
      socket.off(event, handler)
      resolve(payload ?? true)
    }
    socket.on(event, handler)
  })
}

function emitAck(socket, event, ...args) {
  return new Promise((resolve) => {
    socket.emit(event, ...args, resolve)
    setTimeout(() => resolve(null), 3000)
  })
}

const sockets = []
async function client(name) {
  const socket = await connect(name)
  sockets.push(socket)
  return socket
}

try {
  console.log('\nMatchmaking')

  const alice = await client('Alice')
  const bob = await client('Bob')

  // Alice queues alone.
  const aliceWaiting = waitFor(alice, 'match:waiting')
  const aliceFound = waitFor(alice, 'match:found', 800)
  const aliceAck = await emitAck(alice, 'match:find')

  check('find is acknowledged', aliceAck?.queued, true)
  check('lone user is told they are waiting', (await aliceWaiting)?.position >= 1, true)
  check('lone user is NOT matched', await aliceFound, null)

  // Bob queues — both should be paired.
  const aliceMatch = waitFor(alice, 'match:found', 3000)
  const bobMatch = waitFor(bob, 'match:found', 3000)
  await emitAck(bob, 'match:find')

  const [aliceResult, bobResult] = await Promise.all([aliceMatch, bobMatch])

  check('first waiter is matched', Boolean(aliceResult), true)
  check('second waiter is matched', Boolean(bobResult), true)
  check('both land in the SAME room', aliceResult?.roomId === bobResult?.roomId, true)
  check('room id looks generated', /^m-[0-9a-f]{20}$/.test(aliceResult?.roomId ?? ''), true)
  check('each sees the other as peer', aliceResult?.peer?.nickname, 'Bob')
  check('peer identity is mutual', bobResult?.peer?.nickname, 'Alice')
  check(
    'exactly one side is told to offer',
    Number(aliceResult?.shouldOffer) + Number(bobResult?.shouldOffer),
    1,
  )

  // The pair must be able to signal each other — proves they really share a room.
  const offerArrived = waitFor(bob, 'webrtc:offer')
  alice.emit('webrtc:offer', {
    target: aliceResult.peer.socketId,
    description: { type: 'offer', sdp: 'v=0\r\n' },
  })
  check('matched pair can signal', (await offerArrived)?.from, alice.id)

  console.log('\nQueue hygiene')

  const carol = await client('Carol')
  await emitAck(carol, 'match:find')
  const cancelled = waitFor(carol, 'match:cancelled')
  const cancelAck = await emitAck(carol, 'match:cancel')

  check('cancel is acknowledged', cancelAck?.ok, true)
  check('cancel emits confirmation', await cancelled, true)
  check('cancelling twice is a no-op', (await emitAck(carol, 'match:cancel'))?.ok, false)

  // A queued socket that vanishes must not be handed to the next arrival.
  const ghost = await client('Ghost')
  await emitAck(ghost, 'match:find')
  ghost.disconnect()
  await new Promise((resolve) => setTimeout(resolve, 300))

  const dave = await client('Dave')
  const daveWaiting = waitFor(dave, 'match:waiting')
  const daveMatched = waitFor(dave, 'match:found', 1200)
  await emitAck(dave, 'match:find')

  check('user after a ghost still waits', Boolean(await daveWaiting), true)
  check('stale queue entry does NOT produce a match', await daveMatched, null)

  await emitAck(dave, 'match:cancel')
} finally {
  for (const socket of sockets) socket.close()
}

console.log(
  failures === 0
    ? `\nAll ${checks} matchmaking checks passed.\n`
    : `\n${failures} of ${checks} matchmaking checks FAILED.\n`,
)

process.exit(failures === 0 ? 0 : 1)
