/**
 * Smoke test for room management and the WebRTC signalling relay.
 *
 * The case that matters most is CROSS-ROOM RELAY: the server must refuse to
 * forward signalling between sockets that do not share a room. Without that,
 * the relay is an open message bus and anyone can push an SDP offer at any
 * connected socket by guessing its id.
 *
 * Usage: start the server (`npm run dev`), then `npm run smoke:rooms`.
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
    `  ${ok ? 'PASS' : 'FAIL'}  ${label.padEnd(56)} ${
      ok ? JSON.stringify(actual) : `got ${JSON.stringify(actual)}, expected ${JSON.stringify(expected)}`
    }`,
  )
}

function mintToken(nickname) {
  return new SignJWT({ nickname })
    .setProtectedHeader({ alg: 'HS256' })
    .setSubject(crypto.randomUUID())
    .setIssuedAt()
    .setIssuer('dudu:web')
    .setAudience('dudu:client')
    .setExpirationTime('5m')
    .sign(secret)
}

/** Connect an authenticated client and wait until the handshake completes. */
async function connect(nickname) {
  const token = await mintToken(nickname)
  const socket = io(URL, {
    auth: { token },
    transports: ['websocket'],
    reconnection: false,
  })

  await new Promise((resolve, reject) => {
    socket.once('session:ready', resolve)
    socket.once('connect_error', reject)
    setTimeout(() => reject(new Error(`${nickname} never connected`)), 5000)
  })

  return socket
}

function join(socket, roomId) {
  return new Promise((resolve) => {
    socket.emit('room:join', roomId, resolve)
    setTimeout(() => resolve({ ok: false, peers: [], error: 'timeout' }), 3000)
  })
}

/** Resolve with the first matching event, or null if none arrives in time. */
function waitFor(socket, event, ms = 700) {
  return new Promise((resolve) => {
    const timer = setTimeout(() => {
      socket.off(event, handler)
      resolve(null)
    }, ms)

    const handler = (payload) => {
      clearTimeout(timer)
      socket.off(event, handler)
      resolve(payload)
    }

    socket.on(event, handler)
  })
}

const OFFER = { type: 'offer', sdp: 'v=0\r\no=- 0 0 IN IP4 127.0.0.1\r\n' }

console.log('\nRoom management')

const alice = await connect('Alice')
const bob = await connect('Bob')
const carol = await connect('Carol')
const mallory = await connect('Mallory')

try {
  check('invalid room id is rejected', (await join(alice, 'no')).error, 'invalid-room-id')
  check(
    'room id with illegal characters is rejected',
    (await join(alice, 'bad room!')).error,
    'invalid-room-id',
  )

  const aliceJoin = await join(alice, 'aachen-1')
  check('first join succeeds', aliceJoin.ok, true)
  check('first joiner sees an empty room', aliceJoin.peers.length, 0)

  const alicePeerJoined = waitFor(alice, 'room:peer-joined')
  const bobJoin = await join(bob, 'aachen-1')

  check('second join succeeds', bobJoin.ok, true)
  check('second joiner sees the first peer', bobJoin.peers.length, 1)
  check('peer list carries the nickname', bobJoin.peers[0]?.nickname, 'Alice')
  check('existing occupant is notified', (await alicePeerJoined)?.nickname, 'Bob')

  check('third join is refused (capacity 2)', (await join(carol, 'aachen-1')).error, 'room-full')

  console.log('\nWebRTC signalling relay')

  // Same room: the relay must forward.
  const bobOffer = waitFor(bob, 'webrtc:offer')
  alice.emit('webrtc:offer', { target: bob.id, description: OFFER })
  const delivered = await bobOffer
  check('offer is delivered within a room', delivered?.description?.sdp, OFFER.sdp)
  check('offer carries the sender id, not a client-supplied one', delivered?.from, alice.id)

  // Malformed payloads must be dropped, not forwarded.
  const bobGarbage = waitFor(bob, 'webrtc:offer')
  alice.emit('webrtc:offer', { target: bob.id, description: { type: 'offer' } })
  check('offer without sdp is dropped', await bobGarbage, null)

  // --- The important one -------------------------------------------------
  // Mallory sits in a different room and targets Bob directly.
  const malloryJoin = await join(mallory, 'other-room')
  check('attacker joins a different room', malloryJoin.ok, true)

  const bobFromMallory = waitFor(bob, 'webrtc:offer')
  mallory.emit('webrtc:offer', { target: bob.id, description: OFFER })
  check('CROSS-ROOM offer is blocked', await bobFromMallory, null)

  const bobIce = waitFor(bob, 'webrtc:ice-candidate')
  mallory.emit('webrtc:ice-candidate', {
    target: bob.id,
    candidate: { candidate: 'candidate:1 1 udp 1 127.0.0.1 1 typ host' },
  })
  check('CROSS-ROOM ICE candidate is blocked', await bobIce, null)

  // Carol is in no room at all.
  const bobFromCarol = waitFor(bob, 'webrtc:offer')
  carol.emit('webrtc:offer', { target: bob.id, description: OFFER })
  check('offer from a roomless socket is blocked', await bobFromCarol, null)

  console.log('\nLeaving')

  const bobSeesLeave = waitFor(bob, 'room:peer-left')
  alice.emit('room:leave')
  check('explicit leave notifies the peer', (await bobSeesLeave)?.socketId, alice.id)

  // Alice left, so the room has one occupant and Carol should now fit.
  check('slot frees up after leaving', (await join(carol, 'aachen-1')).ok, true)

  const carolSeesDisconnect = waitFor(carol, 'room:peer-left', 1500)
  bob.disconnect()
  check('disconnect notifies the peer', (await carolSeesDisconnect)?.socketId !== undefined, true)
} finally {
  for (const socket of [alice, bob, carol, mallory]) socket.close()
}

console.log(
  failures === 0
    ? `\nAll ${checks} room checks passed.\n`
    : `\n${failures} of ${checks} room checks FAILED.\n`,
)

process.exit(failures === 0 ? 0 : 1)
