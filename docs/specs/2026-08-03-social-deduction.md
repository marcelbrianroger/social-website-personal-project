# Phase 5 — Social Deduction: Engine Generalization + Mr. White

Date: 2026-08-03
Status: awaiting review

## Problem

Phase 4 delivered a game state machine built for **sequential, perfect-information,
two-player** board games. Mr. White and Werewolf are **simultaneous,
hidden-information, N-player, timed** games. Five assumptions collide:

| # | Phase 4 assumption | Location | Why it breaks |
|---|---|---|---|
| 1 | `ROOM_CAPACITY = 2` | `server/src/rooms.ts:30` | Mr. White needs 4+, Werewolf 5+ |
| 2 | `currentTurn(state): string \| null` | `server/src/games/types.ts:51` | Voting and discussion are simultaneous |
| 3 | `winnerSessionId: string \| null` | `server/src/games/types.ts:33` | Wins are per-team, not per-player |
| 4 | State only advances on a client move | `server/src/game-engine.ts` | No time source for "night ends in 60s" |
| 5 | No in-game chat | `server/src/events.ts` | Wolf chat must be recipient-scoped |

`viewFor` (`types.ts:71-83`) already exists as the anti-cheat seam and explicitly
anticipates these games. Hidden roles need no new mechanism.

## Scope

This spec covers the generalized engine, the lobby, scoped chat, and **Mr. White**
end to end. **Werewolf is deliberately out of scope** and gets its own spec once
these foundations have run a real game.

Mr. White is the right first game: no night cycle, and its clue phase is genuinely
turn-based, so it exercises the new contract without stressing every axis at once.

## Decisions

Four forks, resolved before design:

1. **Capacity** — a separate lobby type. Existing two-person WebRTC video rooms are
   untouched; social games get their own membership primitive with no WebRTC at all.
2. **Phase clock** — deadline stored in state plus a pure `tick(state, now)`.
3. **Chat** — its own socket channel; the game rules decide the audience. Chat never
   enters game state.
4. **Cut** — engine + Mr. White now, Werewolf next.

## Architecture

### 1. The generalized contract

`server/src/games/types.ts`:

```ts
// BEFORE                                  AFTER
currentTurn(state): string | null          actors(state): string[]
result(): { winnerSessionId: string|null } result(): { winnerSessionIds: string[], team?: string }
// (none)                                  tick(state, now): S | null
// (none)                                  deadline(state): number | null
// (none)                                  chatAudience(state, sender): ChatAudience
```

- **`actors(state)`** — who may act right now. Tic-Tac-Toe returns `[playerX]`; a
  vote phase returns every living player; discussion returns `[]`. One concept
  spans sequential and simultaneous play instead of two parallel paths.
- **`winnerSessionIds`** — team wins fall out naturally. Tic-Tac-Toe returns `[]`
  for a draw or `[winner]`.
- **`tick(state, now)`** — pure; returns the next state if a deadline elapsed, else
  `null`. Definitions stay free of Redis and sockets, as `types.ts:5-7` requires.
- **`deadline(state)`** — lets the engine index due games in a Redis sorted set.
- **`chatAudience(state, sender)`** — `{ ok: false, reason }` or
  `{ ok: true, channel, to: string[] }`.

Method-shorthand declaration style is preserved throughout for the bivariance
reason documented at `types.ts:14-17`.

### 2. Why deadline-in-state needs no distributed lock

Duplicate ticks are harmless. Two nodes racing to advance the same phase both go
through the existing CAS loop (`game-engine.ts:218`); the loser re-reads, calls
`tick` again, receives `null` because the phase already moved, and stops. Restart
safety is free too — the deadline is data in Redis, not a live process timer.

The engine gains `tickGame(lobbyId)`, sharing `submitMove`'s CAS retry loop. It is
driven from two places:

- opportunistically, on any inbound game event
- a sweeper interval (~1s per node) reading `ZRANGEBYSCORE games:deadlines 0 now`,
  so the cost is proportional to games actually due, not games running

### 3. The lobby

New `server/src/lobby.ts`, mirroring `rooms.ts`'s atomic-Lua patterns:

- `LOBBY_CAPACITY = 8`
- members in a Redis hash; `joinedAt` gives stable seat order (`events.ts:22-28`)
- no `canRelay` equivalent — there is no signalling to authorize
- last member out purges the game, matching current room behaviour

Purely additive. No existing room or WebRTC code changes.

### 4. Chat

New events:

```
client → server   game:chat(body, ack)
server → client   game:chat-message({ id, from, nickname, body, channel, at })
```

The server loads the game, calls `chatAudience`, resolves sessionIds to sockets via
lobby membership, and emits **per socket** — the same per-recipient discipline
`game:state` already uses (`events.ts:109-114`). Messages pass through the existing
`moderation.ts` and are rate limited like `dudu:post`.

Chat never bumps the game version and is never persisted. No history replay on
reconnect; this matches the Redis-first, ephemeral design.

## Mr. White — rules

4–8 players. Roles: **Civilians** (majority) share a secret word; exactly one
**Mr. White** receives no word and must bluff. No Undercover role — deliberately
omitted as unnecessary complexity.

### Phases

| Phase | Deadline | `actors()` | Behaviour |
|---|---|---|---|
| `reveal` | 10s | `[]` | Each player sees their own role card |
| `clue` | 30s per turn | one player | Seat order among the living; one word each. Timeout submits a skip |
| `discussion` | 90s | `[]` | Free chat, no moves |
| `vote` | 45s | all living | Simultaneous; ends early once every living player has voted. Timeout abstains |
| `reveal-vote` | 8s | `[]` | Shows who voted for whom and who was eliminated |
| `guess` | 30s | Mr. White | Only if Mr. White was eliminated |
| `finished` | none | `[]` | Terminal |

**There is no `resolve` phase.** A phase with no deadline and no actors would
deadlock — nothing could advance it. Tallying happens *inside* the transition out
of `vote` (triggered either by the last vote arriving or by `tick` at the
deadline), which lands directly on `reveal-vote`, `guess`, `clue`, or `finished`.
Every non-terminal phase must have a deadline, actors, or both; this is an
invariant the implementation should assert.

### Resolution

Computed in the transition out of `vote`:

- Plurality target is eliminated; a tie eliminates nobody.
- Eliminated player was Mr. White → `reveal-vote`, then `guess`.
- Otherwise, if two or fewer players remain alive → Mr. White wins (`finished`).
- Otherwise → `reveal-vote`, then next round at `clue`.

### Win conditions

- **Civilians** win when Mr. White is eliminated *and* fails the final word guess.
- **Mr. White** wins by surviving to the final two, *or* by guessing the word
  correctly after elimination.

### Moves

```ts
{ type: 'clue',  word: string }        // clue phase, current actor only
{ type: 'vote',  target: sessionId }   // vote phase, living players, living target
{ type: 'guess', word: string }        // guess phase, Mr. White only
```

### Redaction (`viewFor`)

- Own role always visible; the secret word only to civilians.
- Other players' roles hidden until `finished`, then fully revealed.
- Individual votes hidden during `vote`, revealed at `reveal-vote`. This prevents
  bandwagoning, and matters because anything sent to the browser is readable in
  devtools regardless of what the UI renders.

### Chat audience

- `discussion` and `vote`: all living players.
- Dead players: only other dead players, on a `dead` channel.
- All other phases: refused with `chat-closed`.

## Frontend

New route `app/lobby/` (create/join) and `app/lobby/[lobbyId]/`, with no WebRTC.

| File | Responsibility |
|---|---|
| `lib/lobby/use-lobby.ts` | Membership, join/leave |
| `lib/game/use-game-chat.ts` | Chat send/receive |
| `phase-banner.tsx` | Phase name + live countdown |
| `role-card.tsx` | Private role and word |
| `player-rail.tsx` | Roster, alive/dead, current actor, vote marks |
| `chat-panel.tsx` | Messages, styled per channel |
| `mr-white-actions.tsx` | Phase-specific input: clue / vote / guess |

`use-game.ts` keeps its no-optimistic-update rule (`use-game.ts:17-23`): the server
remains the only writer.

**Clock skew.** `phaseEndsAt` is server epoch ms. `GameView` carries `serverNow`;
the client computes `offset = serverNow - Date.now()` once and renders
`phaseEndsAt - (Date.now() + offset)`. All timestamps are UTC epoch ms.

## Migration

Renaming `currentTurn` → `actors` and `winnerSessionId` → `winnerSessionIds`
touches:

1. `server/src/games/types.ts` — the contract
2. `server/src/games/tic-tac-toe.ts` — express existing rules in the new vocabulary
3. `server/src/game-engine.ts` — `buildView`
4. `server/src/events.ts` — `GameView`
5. `lib/socket/events.ts` — the frontend mirror (`events.ts:5-10`)
6. `lib/game/use-game.ts`, `app/rooms/game-board.tsx` — consumers

Tic-Tac-Toe's behaviour does not change. The existing 34 game smoke checks must
still pass unmodified except where they assert the two renamed field names — that
suite is the migration's safety net.

## Testing

Following the established smoke-script pattern (`server/scripts/smoke-*.mjs`),
adding `smoke-lobby.mjs` and `smoke-mrwhite.mjs`:

- capacity enforcement and seat ordering
- **redaction**: assert a civilian's socket never receives another player's role,
  and Mr. White's view never contains the word — read off the wire, not the UI
- turn enforcement during `clue`; rejection of out-of-turn and dead-player moves
- vote tallying, including the tie-eliminates-nobody path
- both win conditions, plus the correct-guess steal
- **tick**: fast-forward a deadline and assert the phase advances exactly once
- chat audience: a living player must never receive a `dead`-channel message

## Risks

- **Mr. White is unplayable below 4 humans.** With no bots in scope, local testing
  needs four browser sessions. The smoke scripts drive sockets directly, which
  covers rules, but real UX testing needs real people.
- **Tick granularity.** A ~1s sweeper means a phase can end up to a second late.
  Acceptable for a social game; the countdown is advisory, and the server remains
  authoritative on whether a move arrived in time.
- **No chat history on reconnect.** A player who drops during discussion loses the
  argument so far. Accepted as a consequence of keeping chat out of game state.
