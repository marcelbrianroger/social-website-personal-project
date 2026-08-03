/**
 * Smoke test for the Socket.io handshake gate.
 *
 * Asserts the security boundary described in src/index.ts: only a holder of a
 * valid session JWT — i.e. someone the region lock already let through — can
 * open a socket.
 *
 * Usage: start the server (`npm run dev`), then `node scripts/smoke-handshake.mjs`.
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

/** Mirrors signSession() in lib/session/session.ts. */
function mintToken({ issuer = 'dudu:web', audience = 'dudu:client', key = secret } = {}) {
  return new SignJWT({ nickname: 'SmokeTest001' })
    .setProtectedHeader({ alg: 'HS256' })
    .setSubject('11111111-2222-4333-8444-555555555555')
    .setIssuedAt()
    .setIssuer(issuer)
    .setAudience(audience)
    .setExpirationTime('5m')
    .sign(key)
}

function attempt(label, auth) {
  return new Promise((resolve) => {
    const socket = io(URL, { auth, transports: ['websocket'], reconnection: false })

    const done = (outcome, detail) => {
      socket.close()
      resolve({ label, outcome, detail })
    }

    socket.on('session:ready', (session) => done('ACCEPTED', session.nickname))
    socket.on('connect_error', (error) => done('REJECTED', error.message))
    setTimeout(() => done('TIMEOUT', 'no response in 5s'), 5000)
  })
}

const cases = [
  ['no token at all', {}],
  ['garbage token', { token: 'not-a-jwt' }],
  ['token signed with wrong secret', {
    token: await mintToken({ key: new TextEncoder().encode('x'.repeat(48)) }),
  }],
  ['token with wrong issuer', { token: await mintToken({ issuer: 'evil:web' }) }],
  ['token with wrong audience', { token: await mintToken({ audience: 'evil:client' }) }],
  ['valid token', { token: await mintToken() }],
]

let failures = 0

for (const [label, auth] of cases) {
  const expected = label === 'valid token' ? 'ACCEPTED' : 'REJECTED'
  const result = await attempt(label, auth)
  const ok = result.outcome === expected

  if (!ok) failures += 1
  console.log(
    `${ok ? 'PASS' : 'FAIL'}  ${label.padEnd(32)} -> ${result.outcome} (${result.detail})`,
  )
}

console.log(failures === 0 ? '\nAll handshake cases passed.' : `\n${failures} case(s) FAILED.`)
process.exit(failures === 0 ? 0 : 1)
