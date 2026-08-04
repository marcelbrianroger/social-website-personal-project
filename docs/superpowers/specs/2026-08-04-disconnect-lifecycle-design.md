# Connection Lifecycle — Lobby Disconnects and Mr. White Auto-Elimination

Date: 2026-08-04
Status: approved

## Problem

Every disconnect is currently treated as a permanent departure, and every
permanent departure kills the game.

`detachLobby` (`server/src/index.ts:326-356`) frees the seat and then calls
`forfeitGame`. Mr. White's `forfeit` (`server/src/games/mr-white.ts:568-573`)
sets `phase: 'finished'` and `abandonedBy`. So one player's wifi blinking during
the discussion ends the round for the other three to seven people at the table,
and `result()` reports `{ winnerSessionIds: [], reason: 'forfeit' }` — a game
nobody won.

Three separate failures live inside that one behaviour:

| # | Failure | Consequence |
|---|---|---|
| 1 | No distinction between "waiting in the lobby" and "mid-game" | A pre-game drop is handled by game-forfeit code that has no game to forfeit |
| 2 | No reconnect window | A three-second network blip is indistinguishable from quitting |
| 3 | Departure is all-or-nothing | The only tools are "keep waiting for them" or "end the game"; there is no "carry on without them" |

Failure 3 is the load-bearing one. Without it, the alternative to forfeiting is a
table that deadlocks: `clue` waits on an actor who will never speak,
`majorityReady` measures against a denominator that includes a player who cannot
press the button, and `vote` holds the full 45s because the tally can never
complete.

## Scope

Covers the **lobby** membership path and the **Mr. White** rules. Two-person
WebRTC video rooms (`detach`) keep their instant forfeit — the media connection
has already dropped, and there is no third party whose game would be spoiled by
ending it. Werewolf remains out of scope, as in the Phase 5 spec.

## Decisions

Four forks, resolved before design:

1. **Mr. White drops and never returns** — the civilians win by forfeit. This is
   the existing `abandonedBy` path, which `result()` already handles; no new
   terminal state is introduced.
2. **The reconnect window is visible to the table** — carried in game state and
   projected to clients, so the other players see `reconnecting 22s` instead of a
   table that has silently stalled.
3. **An explicit `lobby:leave` gets the same grace as a hard disconnect** — one
   code path. `useLobby`'s unmount cleanup emits `lobby:leave`, so splitting the
   two would deny the grace period to a page refresh, which is the most common
   reason anyone needs to reconnect at all.
4. **A lobby that empties still purges its game instantly** — the ephemerality
   guarantee in `game-engine.ts:25-27` is unchanged, and there is nobody left to
   reconnect to.

## Architecture

### 1. Where the grace period lives

Modelled on the phase clock rather than beside it. The two are structurally
identical, so they are built the same way:

| Concern | Phase clock (exists) | Disconnect clock (new) |
|---|---|---|
| Index the sweeper reads | ZSET `games:deadlines` | ZSET `games:disconnects` |
| Member | `scope` | `` `${scope}\|${sessionId}` `` |
| Fact of record | `state.phaseEndsAt` | `StoredGame.disconnected` |
| Written via | CAS on `version` | CAS on `version` |
| Advanced by | `tickGame` | `expireDisconnect` |

**Not a `setTimeout`.** A timer dies with the process and does not exist on the
other nodes — the same reasoning already documented for `deadline()` at
`types.ts:86-94`. Storing the deadline as data is what makes a grace period
survive a server restart.

**Duplicate sweeps are harmless** for the same reason a duplicate `tick` is: the
CAS loser re-reads, finds the entry already gone, and stops.

**Separator.** A scope is either `<roomId>` or `lobby:<lobbyId>`; both id
patterns are `[A-Za-z0-9_-]`, and a sessionId is a UUID. Neither can contain
`|`, so it cannot be forged into a different scope.

```ts
// StoredGame
/**
 * sessionId -> epoch ms at which a missing player is auto-eliminated.
 * Absent on games written before this field existed, hence `?? {}` at every read.
 */
disconnected: Record<string, number>
```

### 2. The disconnect path

`detachLobby` frees the seat **instantly and unconditionally** — requirement 1,
and also what makes reconnect possible at all: a lobby seat is keyed by socketId
while game participation is keyed by sessionId, so a returning player takes a new
seat and keeps their old role.

```
leaveLobby(socket.id)  ->  emit lobby:member-left            <- always
  remaining === 0          -> purgeGame + game:closed          (unchanged)
  no game / finished       -> stop                             <- "waiting in the lobby"
  sessionId not a player   -> stop                             (joined mid-game, watching)
  otherwise                -> markDisconnected(grace) + broadcastGame
```

`forfeitGame` leaves the lobby path entirely.

**The reconnect race.** A new socket can join *before* the old socket's
disconnect handler runs. Arming is therefore conditional on the sessionId having
no remaining seat once `leaveLobby` returns:

- disconnect → join: armed, then disarmed by `markReconnected` in `lobby:join`
- join → disconnect: a seat already exists at arm time, so never armed

Neither ordering can strand a present player behind a running elimination timer.

### 3. The rules hook

`GameDefinition` gains one required method:

```ts
/**
 * Remove a player who is gone for good, repairing any phase that waits on them.
 * Distinct from `forfeit`, which ends the whole game.
 */
eliminate(state: S, sessionId: string, now: number): S
```

Required rather than optional so a new game has to decide what it means.

**Tic-Tac-Toe** has exactly two players, so losing one *is* the end — it
delegates to `forfeit`.

**Mr. White**:

1. No-op when finished, not a player, or already eliminated.
2. Mark eliminated; drop from `readyToVote`; drop votes cast **by** them **and
   votes cast for them**. The second half is correctness, not tidiness: a
   surviving vote targeting them lets `resolveVote` pick an already-eliminated
   player as `top` and append them to `eliminated` a second time.
3. They were Mr. White → `phase: 'finished'`, `abandonedBy` set. `result()`
   already returns civilians-win / `reason: 'forfeit'` for exactly this.
4. Mr. White still living and `livingOf <= 2` → Mr. White wins on survival, the
   same rule `resolveVote` applies at `mr-white.ts:244-248`.
5. Otherwise repair the phase that was waiting on them:

| Phase | Repair |
|---|---|
| `clue`, they held the floor | Floor passes with a fresh clock, or the round closes into `discussion` |
| `clue`, they did not | Nothing — the rotation already skips the eliminated |
| `discussion` | Recheck `majorityReady`; 2-of-4 ready becomes a majority at 2-of-3 |
| `vote` | Resolve if every remaining living player has now voted |
| `reveal`, `reveal-vote`, `guess` | Nothing — clock-driven |

Step 5 is what answers requirement 3: no timer and no tally can still be waiting
on someone who is gone.

`eliminate` must be pure, like `tick` and `applyMove`, because the engine may
call it more than once across a CAS retry.

### 4. Engine surface

```ts
markDisconnected(scope, sessionId, graceMs): CAS write + ZADD
markReconnected(scope, sessionId):           CAS write + ZREM
dueDisconnects(now):                         ZRANGEBYSCORE games:disconnects 0 now
expireDisconnect(scope, sessionId):          CAS write applying definition.eliminate
purgeGame(scope):                            also clears this scope's disconnect entries
```

`expireDisconnect` re-reads before acting and does nothing when the entry has
gone (reconnected), when the deadline has not actually passed, or when the game
has finished in the meantime.

### 5. Wire and UI

`StoredGame.disconnected` → `GameView.disconnected` → mirrored in
`lib/socket/events.ts` → carried through `asMrWhite` into `MrWhiteTable`.

`buildView` reads `stored.disconnected ?? {}`, so games already sitting in Redis
under the 12h TTL do not break across a deploy.

`PlayerRail` gains one status line ranked between `eliminated` and `active`:
`reconnecting 22s`. Rendering a per-player countdown needs a skew-corrected
clock, so `useServerNow(serverNow, ticking)` is extracted from `useCountdown` and
`useCountdown` is expressed in terms of it — the skew correction documented at
`use-countdown.ts:5-23` stays in one place.

`env.disconnectGraceMs`, default `30_000`, so the smoke script can drive a short
grace instead of waiting out a real one.

## Testing

**`server/tests/games/mr-white.test.ts`** — pure rules, no Redis:

- the floor passes when the clue-holder drops, with a fresh clock
- the last un-clued player dropping opens the discussion
- discussion majority is rechecked against the smaller table
- the vote resolves when the last outstanding voter drops
- votes *for* the dropped player are discarded — no double elimination
- Mr. White dropping ends the game as a civilian forfeit win
- dropping to two living hands Mr. White the survival win
- already-eliminated, non-player and finished inputs are no-ops
- `eliminate` does not mutate its input

**`server/tests/disconnect.test.ts`** (new, real Redis):

- `markDisconnected` writes both the state entry and the ZSET index
- `markReconnected` clears both
- `dueDisconnects` is empty before the deadline, returns the pair after
- `expireDisconnect` eliminates and de-indexes
- `expireDisconnect` on a reconnected player does nothing
- `purgeGame` clears the disconnect index
- `buildView` surfaces `disconnected`
- lobby: `leaveLobby` frees the seat and reports `remaining` with no game running

**`server/scripts/smoke-disconnect.mjs`** (new, wired into `smoke:socket`) —
four real sockets: drop one mid-game, assert the other three receive
`lobby:member-left`, assert the grace marker reaches their `game:state`,
reconnect and assert it clears, then drop another and assert auto-elimination
lands and the clock keeps advancing.

## Out of scope

- Grace periods for two-person WebRTC video rooms
- Replaying chat history to a reconnecting player — `events.ts:130-137` already
  states that a dropped player loses the argument so far, and that is unchanged
- Restoring host status to a reconnecting host; the next-earliest seat inherits
  it, which is the existing self-healing behaviour
- Werewolf
