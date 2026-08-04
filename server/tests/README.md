# Backend integration tests

Integration tests for the realtime server's core logic, run against the **real
Redis** from `docker-compose`.

```bash
docker compose up -d redis     # from the repo root
npm test                       # or: npm --prefix server run test
```

Other entry points:

| Command | What it does |
|---|---|
| `npm --prefix server run test` | Run the suite once |
| `npm --prefix server run test:watch` | Re-run on change |
| `npm --prefix server run typecheck:tests` | Typecheck `src` + `tests` together |

## What is covered

| File | Seam | Focus |
|---|---|---|
| `matchmaking.test.ts` | `src/matchmaking.ts` | FIFO ordering, double-click dedupe, cancel, atomic pair pop under concurrency, room-id generation |
| `game-engine.test.ts` | `src/game-engine.ts` | Atomic start, compare-and-set on move, forfeit, TTL, purge, `buildView` redaction |
| `rooms.test.ts` | `src/rooms.ts` | Atomic capacity, join order, leave/remaining, relay authorisation |
| `games/tic-tac-toe.test.ts` | `GameDefinition` contract | Validation over hostile input, purity of `applyMove`, win/draw/forfeit |
| `games/registry.test.ts` | `src/games/registry.ts` | Lookup, plus contract checks applied to **every** registered game |
| `games/mr-white.test.ts` | Phase 5 rules | Roles, redaction, the phase clock, win conditions, auto-elimination |
| `disconnect.test.ts` | `src/game-engine.ts` presence + `src/lobby.ts` | The reconnect window: arming, cancelling, expiry, duplicate sweeps, purge |

The contract block at the bottom of `games/registry.test.ts` iterates over
`listGames()`, so a game added later — Mr. White, Werewolf — is held to the
engine's assumptions without anyone having to extend that file.

## Why real Redis, and why no mocks

The logic under test is mostly Lua: atomic room join, atomic pair pop,
compare-and-set on the game version. A fake client would execute none of it,
so a mocked suite would only assert that we call the functions we call.

The trade-off is that `npm test` needs the `dudu_redis` container up.

### Database isolation

The suite talks to **Redis database 15**, set by `redis-test.env` and loaded via
`node --env-file`. That runs before `src/env.ts` does its dotenv load of the
repo-root `.env`, and dotenv does not overwrite variables that are already set.

`helpers/harness.ts` asserts the connection really is on db 15 before it will
flush anything. Running a test file directly without `--env-file` fails loudly
rather than clearing a dev server's rooms, queue and DUDU wall on db 0.

`npm test` passes `--test-concurrency=1`. node:test runs test *files* in
parallel by default, and the per-test `flushdb` in one file would wipe another
file's fixtures mid-assertion.

## Relationship to the smoke scripts

`scripts/smoke-*.mjs` drive real sockets against a running server and cover the
wire protocol end to end. These tests sit one layer below, at the module API,
and cover what a socket client cannot easily force: simultaneous writes, lost
updates, capacity races. The two are complementary — neither replaces the other.

## Phase 5

`games/mr-white.test.ts` encodes the rules in
`docs/superpowers/specs/2026-08-03-phase5-social-deduction-design.md`. It was
written as 39 skipped tests before any implementation existed; the
implementation landed, the skip came off, and all of it now runs.

What that work put in place:

- `src/games/types.ts` carries the generalized contract — `actors`,
  `winnerSessionIds`, `tick`, `deadline`, `chatAudience` — replacing
  `currentTurn` and `winnerSessionId`.
- `src/games/mr-white.ts` implements the seven phases, both win conditions and
  the `viewFor` redaction.
- `src/lobby.ts` is the 8-seat membership primitive, separate from the 2-seat
  WebRTC room.
- `src/game-chat.ts` plus `tickGame` / `dueGames` in the engine give scoped chat
  and the deadline sweeper.

One fixture in that suite was corrected rather than satisfied: `eliminates the
plurality target` originally tallied 2-2, which is the same tally as the tie
case beside it, so the two tests contradicted each other. Making both pass would
have required vote resolution to depend on object key insertion order. No
assertion was weakened.

**Werewolf is not covered at all.** The design doc puts it out of scope pending
its own spec, so there is nothing to encode yet.

## Connection lifecycle

`disconnect.test.ts` and the `Mr. White — auto-elimination` block in
`games/mr-white.test.ts` encode
`docs/superpowers/specs/2026-08-04-disconnect-lifecycle-design.md`.

The split follows the same seam as everything else here: the *rules* for giving
up on an absent player are pure functions in `games/mr-white.test.ts`, and the
*machinery* — a deadline in the game record, an index the sweeper reads, a
compare-and-set that makes a duplicate sweep a no-op — is in `disconnect.test.ts`
against real Redis.

The half that is easy to get wrong is not the removal, it is the REPAIR. Marking
someone absent and stopping there leaves the table deadlocked: a clue phase
waiting on an actor who will never speak, a readiness majority measured against
someone who cannot press the button, a tally that can never complete. Most of
the assertions are therefore about the phase the game lands on, not about the
`eliminated` array. The contract block in `games/registry.test.ts` enforces the
weaker version of the same property for every registered game — after an
elimination the game must still have a result, an actor, or a clock.

`scripts/smoke-disconnect.mjs` covers the wire end to end, including the one
thing no unit test can: that a real socket dying reaches `detachLobby` at all.
It waits out a real reconnect window, so set `DISCONNECT_GRACE_MS` low in `.env`
and restart the server before running it.
