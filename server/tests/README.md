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
| `games/mr-white.pending.test.ts` | Phase 5 | Skipped. See below. |

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

## Phase 5 is not implemented

`games/mr-white.pending.test.ts` contains **39 skipped tests** encoding the rules
in `docs/superpowers/specs/2026-08-03-phase5-social-deduction-design.md`
(Status: *awaiting review*).

Nothing in that spec has been built yet:

- `src/games/registry.ts` registers only Tic-Tac-Toe.
- `src/games/types.ts` still exposes the Phase 4 contract (`currentTurn`,
  `winnerSessionId`), not the generalized one (`actors`, `winnerSessionIds`,
  `tick`, `deadline`, `chatAudience`).
- There is no `src/lobby.ts`, no game chat, and no deadline sweeper.

The pending tests are the red baseline for that work: remove the `PENDING`
option from a test and it should fail until the behaviour exists. They import
the missing modules through a non-literal specifier, so the file compiles and
runs today.

**Werewolf is not covered at all.** The design doc puts it out of scope pending
its own spec, so there is nothing to encode yet.
