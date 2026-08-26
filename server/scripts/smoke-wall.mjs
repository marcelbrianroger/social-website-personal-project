/**
 * Smoke test for the DUDU wall: moderation gate, 24h TTL, broadcast, rate limit.
 *
 * Usage: start the server (`npm run dev`), then `npm run smoke:wall`.
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
    `  ${ok ? 'PASS' : 'FAIL'}  ${label.padEnd(50)} ${
      ok ? JSON.stringify(actual) : `got ${JSON.stringify(actual)}, expected ${JSON.stringify(expected)}`
    }`,
  )
}

const sockets = []

async function client(nickname) {
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
    setTimeout(() => reject(new Error('never connected')), 5000)
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

function waitFor(socket, event, ms = 1500) {
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

try {
  console.log('\nPosting and broadcast')

  const poster = await client('Poster')
  const listener = await client('Listener')

  listener.emit('dudu:subscribe')
  await new Promise((resolve) => setTimeout(resolve, 200))

  const unique = `hallo aus aachen ${Date.now()}`
  const broadcast = waitFor(listener, 'dudu:message', 2000)
  const posted = await emitAck(poster, 'dudu:post', unique)

  check('valid post is accepted', posted?.ok, true)
  check('post echoes the stored body', posted?.message?.body, unique)
  check('post carries the author nickname', posted?.message?.nickname, 'Poster')

  const received = await broadcast
  check('subscriber receives the broadcast', received?.body, unique)
  check('broadcast does NOT leak authorId', received?.authorId, undefined)

  const history = await emitAck(poster, 'dudu:history')
  check(
    'message appears in history',
    history?.messages?.some((m) => m.body === unique),
    true,
  )

  console.log('\n24-hour TTL')

  const id = posted?.message?.id
  const ttl = await redis.ttl(`dudu:message:${id}`)

  // Allow a few seconds of slack for round-trip time.
  check('payload has a TTL set', ttl > 0, true)
  check('TTL is ~24h', ttl > 86_000 && ttl <= 86_400, true)

  const createdAt = new Date(posted.message.createdAt).getTime()
  const expiresAt = new Date(posted.message.expiresAt).getTime()
  check('expiresAt is exactly 24h after createdAt', expiresAt - createdAt, 86_400_000)

  check('message is indexed on the wall zset', await redis.zscore('dudu:wall', id) !== null, true)

  console.log('\nModeration gate')

  // A fresh session per case: rejected posts still consume rate-limit budget,
  // which is deliberate (a flood must not be able to hammer the classifier).
  const cases = [
    ['empty message', '   ', 'too-short'],
    ['overlong message', 'a'.repeat(281), 'too-long'],
    ['links are blocked', 'check out https://spam.example', 'links-not-allowed'],
    ['character spam', 'heyyyyyyyyyy there', 'character-spam'],
    ['shouting', 'THIS IS ALL CAPS SHOUTING', 'excessive-caps'],
    ['blocked language', 'du arschloch', 'blocked-language'],
  ]

  for (const [label, body, expected] of cases) {
    const socket = await client('Tester')
    const result = await emitAck(socket, 'dudu:post', body)
    check(label, result?.error, expected)
  }

  console.log('\nRate limiting')

  const spammer = await client('Spammer')
  const outcomes = []

  for (let i = 0; i < 7; i += 1) {
    const result = await emitAck(spammer, 'dudu:post', `message number ${i} from aachen`)
    outcomes.push(result?.ok === true)
  }

  check('first five posts succeed', outcomes.slice(0, 5).every(Boolean), true)
  check('sixth post is rate limited', outcomes[5], false)
  check('seventh post is rate limited', outcomes[6], false)
} finally {
  for (const socket of sockets) socket.close()
  await redis.quit()
}

console.log(
  failures === 0
    ? `\nAll ${checks} DUDU checks passed.\n`
    : `\n${failures} of ${checks} DUDU checks FAILED.\n`,
)

process.exit(failures === 0 ? 0 : 1)
