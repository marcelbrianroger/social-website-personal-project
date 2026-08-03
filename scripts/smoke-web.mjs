/**
 * End-to-end smoke test for the region lock and anonymous session.
 *
 * Self-contained: it boots its own `next start` on a spare port with the strict
 * geo settings, asserts, and tears down. It does not touch your dev server and
 * does not read your .env geo values — every geo variable is set explicitly
 * below, so the result does not depend on local configuration.
 *
 * Requires a production build first:
 *   npm run build && npm run smoke:web
 */

import { spawn } from 'node:child_process'
import path from 'node:path'
import { fileURLToPath } from 'node:url'

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..')
const PORT = Number(process.env.SMOKE_PORT ?? '3101')
const BASE = `http://localhost:${PORT}`

/** A routable, non-private address so the localhost bypass does not kick in. */
const PUBLIC_IP = '203.0.113.10'

let failures = 0
let checks = 0

function check(label, actual, expected) {
  checks += 1
  const ok = actual === expected
  if (!ok) failures += 1
  const detail = ok ? String(actual) : `got ${actual}, expected ${expected}`
  console.log(`  ${ok ? 'PASS' : 'FAIL'}  ${label.padEnd(52)} ${detail}`)
}

function get(pathname, { country, cookie } = {}) {
  const headers = { 'x-forwarded-for': PUBLIC_IP }
  if (country) headers['cf-ipcountry'] = country
  if (cookie) headers['cookie'] = cookie

  return fetch(`${BASE}${pathname}`, { headers, redirect: 'manual' })
}

function sessionCookie(response) {
  const raw = response.headers.getSetCookie?.() ?? []
  return raw.find((value) => value.startsWith('dudu_session=')) ?? null
}

function uuidIn(html) {
  const match = html.match(
    /[0-9a-f]{8}-[0-9a-f]{4}-4[0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}/,
  )
  return match?.[0] ?? null
}

async function startServer(env) {
  const child = spawn(
    process.execPath,
    ['node_modules/next/dist/bin/next', 'start', '-p', String(PORT)],
    {
      cwd: root,
      env: { ...process.env, ...env },
      stdio: 'ignore',
    },
  )

  const deadline = Date.now() + 30_000

  while (Date.now() < deadline) {
    try {
      await fetch(BASE, { headers: { 'x-forwarded-for': PUBLIC_IP } })
      return child
    } catch {
      await new Promise((resolve) => setTimeout(resolve, 300))
    }
  }

  child.kill()
  throw new Error(`server did not become ready on port ${PORT}`)
}

async function stopServer(child) {
  child.kill()
  // Give the port time to release before the next phase binds it.
  await new Promise((resolve) => setTimeout(resolve, 700))
}

const STRICT_GEO = {
  NODE_ENV: 'production',
  GEO_BYPASS_LOCALHOST: 'false',
  GEO_TRUST_PROXY_HEADERS: 'true',
  GEO_ALLOWED_COUNTRIES: 'DE',
  // Force the header path so the test does not depend on a MaxMind database
  // being present.
  MAXMIND_DB_PATH: '',
  SESSION_JWT_SECRET:
    process.env.SESSION_JWT_SECRET ?? 'smoke-test-secret-at-least-32-bytes-long-000',
}

// ---------------------------------------------------------------------------
// Phase A — unknown countries allowed (GEO_FALLBACK=allow)
// ---------------------------------------------------------------------------

console.log('\nPhase A — region lock, GEO_FALLBACK=allow')
let server = await startServer({ ...STRICT_GEO, GEO_FALLBACK: 'allow' })

try {
  check('German visitor is allowed', (await get('/', { country: 'DE' })).status, 200)
  check('French visitor is blocked', (await get('/', { country: 'FR' })).status, 403)
  check('US visitor is blocked', (await get('/', { country: 'US' })).status, 403)
  check('unknown country is allowed', (await get('/')).status, 200)
  // Cloudflare's pseudo-codes are "no country", NOT "a country that isn't DE",
  // so they follow GEO_FALLBACK rather than being blocked outright.
  check('Tor exit node (T1) counts as unknown', (await get('/', { country: 'T1' })).status, 200)
  check('XX counts as unknown', (await get('/', { country: 'XX' })).status, 200)

  const blocked = await get('/', { country: 'FR' })
  check('403 is marked no-store', blocked.headers.get('cache-control'), 'no-store, private')
  check('403 explains the reason', blocked.headers.get('x-region-lock'), 'blocked-country')
  check('403 issues NO session cookie', sessionCookie(blocked), null)

  console.log('\nPhase A — anonymous session lifecycle')

  const first = await get('/', { country: 'DE' })
  const cookie = sessionCookie(first)
  const firstHtml = await first.text()
  const firstUuid = uuidIn(firstHtml)

  check('first visit sets a session cookie', cookie !== null, true)
  check('cookie is HttpOnly', /HttpOnly/i.test(cookie ?? ''), true)
  check('cookie is SameSite=Lax', /SameSite=lax/i.test(cookie ?? ''), true)
  check('cookie has a 30-day Max-Age', /Max-Age=2592000/.test(cookie ?? ''), true)
  check('identity renders on the FIRST visit', firstUuid !== null, true)
  check(
    'a nickname renders',
    /[A-ZÄÖÜ][a-zäöüß]+[A-ZÄÖÜ][a-zäöüß]+\d{3}/.test(firstHtml),
    true,
  )

  const jar = (cookie ?? '').split(';')[0]

  const second = await get('/', { country: 'DE', cookie: jar })
  check('returning visit re-issues NO cookie', sessionCookie(second), null)
  check('identity is stable across visits', uuidIn(await second.text()), firstUuid)

  // Flip a character in the JWT signature.
  const tampered = jar.slice(0, -2) + (jar.endsWith('A') ? 'B' : 'A')
  const forged = await get('/', { country: 'DE', cookie: tampered })
  const forgedUuid = uuidIn(await forged.text())

  check('tampered cookie is rejected, not trusted', sessionCookie(forged) !== null, true)
  check('tampered cookie yields a NEW identity', forgedUuid !== firstUuid, true)
} finally {
  await stopServer(server)
}

// ---------------------------------------------------------------------------
// Phase B — unknown countries denied (GEO_FALLBACK=deny)
// ---------------------------------------------------------------------------

console.log('\nPhase B — region lock, GEO_FALLBACK=deny')
server = await startServer({ ...STRICT_GEO, GEO_FALLBACK: 'deny' })

try {
  check('German visitor still allowed', (await get('/', { country: 'DE' })).status, 200)

  const unknown = await get('/')
  check('unknown country is blocked', unknown.status, 403)
  check('403 reason is unknown-country', unknown.headers.get('x-region-lock'), 'unknown-country-denied')
  // Under `deny`, Tor is blocked — this is the setting that closes that gap.
  check('Tor exit node (T1) is blocked', (await get('/', { country: 'T1' })).status, 403)
} finally {
  await stopServer(server)
}

console.log(
  failures === 0
    ? `\nAll ${checks} web smoke checks passed.\n`
    : `\n${failures} of ${checks} web smoke checks FAILED.\n`,
)

process.exit(failures === 0 ? 0 : 1)
