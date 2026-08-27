/**
 * Smoke test for the DUDU wall: moderation gate, 48h TTL, broadcast, replies,
 * rate limit.
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

  console.log('\n48-hour TTL')

  const id = posted?.message?.id
  const ttl = await redis.ttl(`dudu:message:${id}`)

  // Allow a few seconds of slack for round-trip time.
  check('payload has a TTL set', ttl > 0, true)
  check('TTL is ~48h', ttl > 172_000 && ttl <= 172_800, true)

  const createdAt = new Date(posted.message.createdAt).getTime()
  const expiresAt = new Date(posted.message.expiresAt).getTime()
  check('expiresAt is exactly 48h after createdAt', expiresAt - createdAt, 172_800_000)

  check('message is indexed on the wall zset', await redis.zscore('dudu:wall', id) !== null, true)

  check('a fresh note reports zero replies', posted?.message?.replyCount, 0)

  console.log('\nReplies')

  const answerer = await client('Answerer')
  const answer = `ja, ich auch ${Date.now()}`

  const replyBroadcast = waitFor(listener, 'dudu:reply:new', 2000)
  const replied = await emitAck(answerer, 'dudu:reply', id, answer)

  check('reply is accepted', replied?.ok, true)
  check('reply echoes the stored body', replied?.reply?.body, answer)
  check('reply carries the author nickname', replied?.reply?.nickname, 'Answerer')
  check('reply names the note it hangs on', replied?.reply?.noteId, id)
  check('reply does NOT leak authorId', replied?.reply?.authorId, undefined)
  check('reply carries no expiry of its own', replied?.reply?.expiresAt, undefined)

  const heardReply = await replyBroadcast
  check('subscriber receives the reply broadcast', heardReply?.body, answer)

  const thread = await emitAck(answerer, 'dudu:replies', id)
  check('thread contains the reply', thread?.replies?.length, 1)
  check('thread reply matches what was written', thread?.replies?.[0]?.body, answer)

  const afterReply = await emitAck(poster, 'dudu:history')
  check(
    'the note now reports one reply',
    afterReply?.messages?.find((m) => m.id === id)?.replyCount,
    1,
  )

  // The whole point of the expiry rule: a thread inherits the note's REMAINING
  // life, so it can never outlive the paper it is stapled to.
  const noteTtl = await redis.ttl(`dudu:message:${id}`)
  const threadTtl = await redis.ttl(`dudu:replies:${id}`)

  check('thread has its own TTL', threadTtl > 0, true)
  check('thread expires with the note, not 48h later', Math.abs(threadTtl - noteTtl) <= 2, true)

  const orphan = await emitAck(answerer, 'dudu:reply', crypto.randomUUID(), 'nobody is here')
  check('reply to a note that is gone is refused', orphan?.error, 'unknown-note')

  const forged = await emitAck(answerer, 'dudu:reply', 'wall', 'not a uuid')
  check('reply to a forged note id is refused', forged?.error, 'unknown-note')

  const spammyReply = await client('Spammy')
  const blocked = await emitAck(spammyReply, 'dudu:reply', id, 'go to https://spam.example')
  check('replies pass the same moderation gate', blocked?.error, 'links-not-allowed')

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

  // One budget covers both: a reply is exactly as cheap to flood as a note.
  const spent = await emitAck(spammer, 'dudu:reply', id, 'and one more thing')
  check('a spent budget blocks replies too', spent?.error, 'rate-limited')
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
