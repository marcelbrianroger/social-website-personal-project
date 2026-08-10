# Social Aachen Website

An anonymous, ephemeral social platform for Indonesian students in Aachen.

Four things live here:

- **DUDU wall** — a shared board. Anyone online can post; every note deletes
  itself 24 hours later. No archive, no undo.
- **Video rooms** — two people per room, peer-to-peer. Audio and video never
  reach the server.
- **Matchmaking** — press once, wait, and get paired with whoever else is
  waiting. First in, first matched.
- **Games** — played inside a room, on a board the server owns.

There is no signup. A visitor is issued an anonymous identity on their first
request — a UUID plus a generated nickname like `SturmUhu827` — signed into a
cookie. Access is restricted to visitors in Germany.

> **On the name.** The site is *Social Aachen Website*. **DUDU** is the name of
> the wall, one feature among four. DUDU also survives throughout the code as an
> internal identifier — the `dudu_session` cookie, the `dudu:*` socket events,
> the `dudu:web` JWT issuer, the `dudu-web` / `dudu-server` packages, the
> `dudu_redis` container, the `dududb` database. Those are load-bearing: the JWT
> issuer in particular is verified byte-for-byte by `server/src/session.ts`, and
> renaming it breaks every socket handshake.

## Stack

| Layer     | Choice                                          |
| --------- | ----------------------------------------------- |
| Frontend  | Next.js 16 (App Router), TypeScript, Tailwind 4 |
| Real-time | Node.js + Socket.io (`/server`)                 |
| Database  | PostgreSQL 18 via Prisma 7                      |
| Cache/bus | Redis                                           |

## Getting started

```bash
# 1. Infrastructure
docker compose up -d   # Redis
npm run db:status      # Postgres 18 runs as a Windows service; db:start if stopped

# 2. Environment
cp .env.example .env
# then set SESSION_JWT_SECRET:
node -e "console.log(require('crypto').randomBytes(32).toString('base64url'))"

# 3. Dependencies
npm install
npm --prefix server install

# 4. Database
npm run db:migrate

# 5. Run (two terminals)
npm run dev          # http://localhost:3000
npm run server:dev   # http://localhost:4000
```

> `SESSION_JWT_SECRET` must be **identical** for both processes — they share the
> root `.env` for exactly this reason. A mismatch rejects every socket handshake.

**On Postgres.** It runs from the native PostgreSQL 18 install
(`C:\Program Files\PostgreSQL\18`), not from `docker-compose`, which is now
Redis-only. It is managed by the **`postgresql-18` Windows service**, set to
start automatically, so step 1's `npm run db:start` is only needed if the
service is stopped.

The EDB installer never got this far on its own: its `initdb` step failed, so
the cluster was created by hand and the service registered afterwards with
`pg_ctl register`. Nothing about that is unusual to operate — it just means a
reinstall would not reproduce it.

The cluster is deliberately `timezone = 'UTC'` and `listen_addresses =
'localhost'`. Connection details match `DATABASE_URL`: role `admin`, database
`dududb`, port **5432**. The superuser is `postgres` / `postgres` — local dev
only, and the server is not reachable off this machine.

**If the service refuses to start,** the usual cause is a postmaster already
running against the same data directory — typically one started by hand with
`npm run db:start`. The two cannot coexist: the service dies immediately with
`FATAL: lock file "postmaster.pid" already exists`, which lands in the Windows
Application event log rather than `data\log\`. Stop the stray one first:

```powershell
npm run db:stop          # or: pg_ctl -m fast -w stop
Start-Service postgresql-18
```

**If `server:dev` fails with `EADDRINUSE`,** the server is already running from
an earlier session. Closing a terminal on Windows does not stop it. Either use
the one you have — `tsx watch` already reloads on every file change — or:

```powershell
Get-NetTCPConnection -LocalPort 4000 -State Listen | ForEach-Object { Stop-Process -Id $_.OwningProcess -Force }
```

## How it fits together

### Request gate — `proxy.ts`

This is `proxy.ts`, **not** `middleware.ts`. Next.js 16 renamed the convention
and the exported function must be named `proxy`. It runs in the Node.js runtime,
which is what lets the region lock read a MaxMind `.mmdb` file at all.

Every request passes through it: region check first, then session issue or
refresh. Session identity is handed to Server Components as **request headers**
(`x-dudu-session-id`, `x-dudu-session-nickname`) rather than via the cookie,
because on a first visit the cookie only exists in the outgoing `Set-Cookie` and
`cookies()` would still report nothing.

### Region lock — `lib/geo/`

The client IP is resolved and checked against a MaxMind GeoLite2 database. The
`.mmdb` is licensed and not committed — download it separately into `data/`.

Without the database present, `GEO_FALLBACK=allow` lets everything through so
local development works. **Do not enforce strict rejection until the database is
in place.**

### Anonymous sessions — `lib/session/`

A UUID plus a random nickname, signed into an HS256 JWT and stored in an
HttpOnly cookie for **30 days**. There is no login, no password and no user row —
the signature is the only thing making the identity tamper-proof.

Nicknames come from `lib/session/nickname.ts`: a German adjective, a German
animal or landmark, and three digits — `FlinkFuchs417`, `NebelBrücke203`,
`WinterFunke126`. They are cosmetic and explicitly not unique; the UUID is the
identity.

The token contract is **mirrored** by `server/src/session.ts`, which verifies
these tokens at the Socket.io handshake. Changing the algorithm, issuer,
audience or claim names requires the same change in both files.

### Real-time — `/server`

A separate package with its own `package.json`, `tsconfig` and build. The
frontend cannot import from it, so the wire protocol is mirrored by hand in
`lib/socket/events.ts` — **if you add or rename an event, change both files.**

Socket.io uses `@socket.io/redis-adapter`, so rooms and broadcasts work across
multiple nodes. Redis needs three separate connections: subscriber mode is
exclusive, so the adapter's pub/sub clients cannot share the command client.

### Rooms and WebRTC signalling

Rooms are ephemeral and implicit: the first person to join an id creates it, the
last to leave destroys it. `ROOM_CAPACITY = 2`.

Membership lives in **Redis, not `socket.data`** — matchmaking can make a socket
on another node join a room, and that node's local state would be the only place
recording it, so relay authorisation on any other node would fail.

Capacity is enforced inside a Lua script. Two nodes checking `HLEN` separately
would both see one member and both insert, putting three people in a two-person
room.

`canRelay` is the check that stops the signalling relay being an open message
bus. Without it, any client could push an SDP offer at any connected socket just
by guessing its id.

### Matchmaking

A Redis LIST — newest pushed left, taken from the right, so it is FIFO and
nobody starves behind later arrivals. A pair is popped in **one Lua script**, so
two matchers can never be handed the same partner.

Match room ids are random rather than sequential (`m-` plus 20 hex chars); a
guessable id would let someone occupy a stranger's slot before their partner
arrives.

### Game engine — `server/src/game-engine.ts` + `server/src/games/`

The engine owns persistence, turn enforcement and concurrency. The rules live in
game definitions and know nothing about Redis or sockets — which is what lets a
new game be added without touching transport code.

**Server authority.** Clients submit *intent* only ("cell 4"), never state. A
client that lies about whose turn it is changes nothing; its move is validated
against the stored state before anything is applied.

**Concurrency.** A move is a read-modify-write, so every write goes through a
compare-and-set on a version number, and a losing writer retries against the
state that actually won.

**`viewFor` is the anti-cheat seam.** State is projected per viewer before it
goes on the wire. Tic-Tac-Toe returns it unchanged because it has no hidden
information, but the seam exists so hidden state is the default shape rather
than a retrofit — hidden-role games depend on it entirely.

State lives only in Redis, carries a TTL, and is deleted the moment its room
empties.

### DUDU wall

Redis only, never Postgres. Messages carry a 24-hour TTL (`DUDU_TTL_SECONDS`), a
sorted set indexes them by post time, and a pub/sub channel fans approved
messages to every node. Posts are rate limited per session and pass a moderation
filter before broadcast.

### Data

Postgres holds the Prisma schema and migrations. **The realtime server does not
currently write to it** — the wall is Redis-only, so there is no durable
moderation audit trail yet.

## Design

The interface direction is **mading** — the *majalah dinding*, the wall magazine
pinned up in every Indonesian school. It is already what the site is: a board
you pin a note to and someone takes down a day later. It also lands on the same
object as the German *Aushang* corkboard this audience now lives with.

Rendered as riso print: flat spot inks on cheap paper, ink that overprints where
it overlaps, no gradients.

| Token    | Value     | Rule                                             |
| -------- | --------- | ------------------------------------------------ |
| `ink`    | `#16284B` | All text and rules                               |
| `paper`  | `#E9E5D8` | Ground                                           |
| `stock`  | `#DED8C7` | Second paper, for slips and panels               |
| `pink`   | `#FF4E8E` | Large display, marks. **Never small text** — 2.1:1 |
| `yellow` | `#FFC93D` | Fill only, always with ink on top — 9.3:1        |

Type: **Bricolage Grotesque** (poster headers), **Karla** (reading),
**Courier Prime** (every typed label, timestamp and id).

Because pink cannot legally carry small text, links are ink over a yellow fill —
which is also just what a marker on a noticeboard looks like.

Interface copy is Indonesian, mixing in the German words this audience uses
daily (`Anmeldung`, `Bürgeramt`, `Mensa`, `WG-Zimmer`, `Pontstraße`).

Drop design references into `design/` — see `design/README.md`.

## Testing

Two independent layers.

### Integration tests — `server/tests/`

Run against the **real Redis** from `docker-compose`, on database 15.

```bash
npm test
```

The logic under test is mostly Lua — atomic room join, atomic pair pop,
compare-and-set on the game version. A mocked client would execute none of it,
so a mocked suite would only assert that we call the functions we call.

`server/tests/helpers/harness.ts` refuses to run unless it is pointed at db 15,
because the suite calls `flushdb` and doing that on db 0 would wipe a dev
server's rooms, queue and wall. `npm test` passes `--test-concurrency=1`:
node:test runs test *files* in parallel by default, and a flush in one would
wipe another's fixtures mid-assertion.

| File                              | Focus                                                        |
| --------------------------------- | ------------------------------------------------------------ |
| `matchmaking.test.ts`             | FIFO, dedupe, cancel, atomic pair pop under concurrency       |
| `game-engine.test.ts`             | Atomic start, compare-and-set, forfeit, TTL, `buildView`      |
| `rooms.test.ts`                   | Atomic capacity, join order, relay authorisation              |
| `games/tic-tac-toe.test.ts`       | Rules over hostile input, `applyMove` purity                  |
| `games/registry.test.ts`          | Lookup, plus contract checks applied to **every** game        |
| `games/mr-white.pending.test.ts`  | Skipped. The Phase 5 spec as a red baseline                   |

The contract block in `games/registry.test.ts` iterates `listGames()`, so a game
added later inherits those checks with no edit.

### Smoke scripts — `server/scripts/`

Drive real sockets against a running server and cover the wire protocol end to
end. Start both processes first, then `npm run smoke:socket`.

The two layers are complementary. Smoke scripts prove the protocol works; the
integration tests force the races a socket client cannot easily reproduce —
simultaneous writes, lost updates, capacity contention.

### Not covered

No automated test of a real media connection — signalling is verified, but an
actual ICE handshake needs two browsers and is checked by hand. Also untested:
the nickname generator, `client-ip.ts` parsing, and Prisma writes beyond the
schema migrating.

## Status

**Working:** region lock, anonymous sessions, socket handshake auth, Prisma
schema and migration, Redis room registry with the Socket.io Redis adapter,
WebRTC signalling with same-room authorisation, matchmaking, the DUDU wall with
its 24h TTL, and a server-authoritative game engine running Tic-Tac-Toe.

**Werewolf and Mr. White are not built.** `server/src/games/registry.ts`
registers only Tic-Tac-Toe. A design spec for Mr. White exists but is marked
*awaiting review*, and Werewolf is explicitly out of scope pending its own spec.
`server/src/games/types.ts` still carries the Phase 4 contract (`currentTurn`,
`winnerSessionId`), not the generalized one the spec proposes (`actors`,
`winnerSessionIds`, `tick`, `deadline`, `chatAudience`). There is no lobby, no
game chat and no deadline sweeper.

**Room capacity is the binding constraint.** It is fixed at 2 for the P2P video
mesh, so social-deduction games cannot run until rooms and lobbies separate into
two different primitives.

**The moderation filter is a heuristic placeholder,** not the AI filter
`CLAUDE.md` calls for.

**No TURN server.** Only public STUN is configured, so peers behind symmetric
NAT will not connect.

**Postgres is not written by the realtime server.**

Also missing: reconnect into a running game beyond `game:sync`, and any pairing
preference in matchmaking — it is purely first-come-first-served.

## Branches

| Branch                            | Contains                                            |
| --------------------------------- | --------------------------------------------------- |
| `main`                            | Phase 1–4 platform, original scaffolding UI          |
| `feature/phase5-social-deduction` | The above **plus** the test suite and the mading design |

The integration tests and the design system are committed on the feature branch
and are **not** on `main`. `git switch feature/phase5-social-deduction` to get
them.

## Scripts

| Command                   | Purpose                                       |
| ------------------------- | --------------------------------------------- |
| `npm run dev`             | Next.js dev server                            |
| `npm run server:dev`      | Socket.io server, watch mode                  |
| `npm run build`           | Production build                              |
| `npm run typecheck`       | TypeScript, no emit                           |
| `npm run lint`            | ESLint                                        |
| `npm test`                | Backend integration tests (needs Redis)       |
| `npm run smoke:web`       | HTTP smoke against a running Next.js          |
| `npm run smoke:socket`    | Full socket smoke (both processes must run)   |
| `npm run verify`          | typecheck + lint + build + tests + web smoke  |
| `npm run db:migrate`      | Create and apply a migration                  |
| `npm run db:studio`       | Prisma Studio                                 |

## Repo map

```
app/            Next.js App Router — pages and client components
lib/            Frontend logic: session, geo, socket contract, WebRTC, hooks
server/         Socket.io backend, its own package
  src/games/    Game rules. Add a definition, register it, done
  tests/        Integration tests against real Redis
  scripts/      Socket smoke scripts
prisma/         Schema and migrations
design/         Design references and notes
docs/           Specs
proxy.ts        Request gate — region lock and session issue
```
