import assert from 'node:assert/strict'

import { closeRedis, redis } from '../../src/redis.js'

/**
 * Shared setup for the integration suite.
 *
 * These tests run against the REAL Redis from docker-compose, not a mock. That
 * is deliberate: the logic under test is mostly Lua — atomic join, atomic pair
 * pop, compare-and-set on game version — and a fake client would execute none
 * of it. A mock here would assert that we call the functions we call, which is
 * exactly the tautology worth avoiding.
 */

/**
 * Database index the suite is allowed to flush.
 *
 * Kept in sync with tests/redis-test.env. Asserted rather than assumed, because
 * `flushdb` against db 0 would destroy a running dev server's state.
 */
const TEST_DB = 15

let guarded = false

/**
 * Refuse to run unless we are pointed at the throwaway database.
 *
 * ioredis exposes the selected index on its options. If the suite is ever run
 * without `--env-file=tests/redis-test.env`, this fails loudly instead of
 * quietly clearing real data.
 */
export function assertTestDatabase(): void {
  if (guarded) return

  assert.equal(
    redis.options.db,
    TEST_DB,
    `refusing to run: expected Redis db ${TEST_DB}, got ${String(redis.options.db ?? 0)}. ` +
      'Run via `npm test` so --env-file=tests/redis-test.env is applied.',
  )

  guarded = true
}

/**
 * Empty the test database. Safe only after assertTestDatabase().
 *
 * A full flush rather than targeted deletes, because matchmaking's queue lives
 * at one fixed key shared by every test. That is also why `npm test` passes
 * `--test-concurrency=1`: node:test runs test FILES in parallel by default, and
 * a flush in one file would wipe another file's fixtures mid-assertion.
 */
export async function resetRedis(): Promise<void> {
  assertTestDatabase()
  await redis.flushdb()
}

/**
 * Close every Redis connection so the test process can exit.
 *
 * src/redis.ts opens three sockets at import time (commands plus the two the
 * Socket.io adapter owns). Two of them are unused here, but an open handle is
 * still an open handle and node:test would hang waiting for the event loop.
 */
export async function teardownRedis(): Promise<void> {
  await closeRedis()
}

let counter = 0

/**
 * A room id unique to this test.
 *
 * Must satisfy the pattern in rooms.ts (3-32 chars, alphanumeric plus dash and
 * underscore), so it doubles as a check that generated ids stay joinable.
 */
export function uniqueRoomId(label = 'r'): string {
  counter += 1
  return `t-${label}-${Date.now().toString(36)}-${counter}`
}

let socketCounter = 0

export function uniqueSocketId(): string {
  socketCounter += 1
  return `sock-${socketCounter}-${Math.random().toString(36).slice(2, 8)}`
}
