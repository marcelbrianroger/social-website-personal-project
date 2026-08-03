# DUDU

Real-time community platform: P2P video matchmaking, temporary boardgame rooms
(Werewolf, Mr. White), and the **DUDU board** — a global ephemeral wall where
messages auto-delete 24 hours after posting and every submission passes an AI
moderation filter before broadcast.

Access is restricted to visitors in Germany.

## Stack

| Layer      | Choice                                          |
| ---------- | ----------------------------------------------- |
| Frontend   | Next.js 16 (App Router), TypeScript, Tailwind 4 |
| Real-time  | Node.js + Socket.io (`/server`)                 |
| Database   | PostgreSQL via Prisma 7                         |
| Cache/bus  | Redis                                           |

## Getting started

```bash
# 1. Infrastructure
docker compose up -d

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

## Architecture

### Request gate — `proxy.ts`

This is `proxy.ts`, **not** `middleware.ts`. Next.js 16 renamed the convention;
the exported function must be named `proxy`. Proxy also runs in the **Node.js
runtime**, and setting the `runtime` option inside it throws. `request.geo` and
`request.ip` were removed in Next 15, so geo data is read from headers manually.

It does two things, in order:

1. **Region lock** — non-German traffic gets a 403 and never reaches the app.
2. **Anonymous session** — first-time visitors are issued a signed identity.

The order matters: blocked visitors must not be handed a session cookie.

### Region lock — `lib/geo/`

Country resolution is a chain: trusted proxy header → MaxMind GeoLite2 → unknown.

**Header trust is opt-in and defaults to off.** `cf-ipcountry` is only
meaningful when Cloudflare is the sole ingress *and* overwrites it; self-hosted
behind nothing, a client can just send `cf-ipcountry: DE`. With
`GEO_TRUST_PROXY_HEADERS=false`, the country comes from a MaxMind lookup instead
(see `data/README.md` for the database).

> **A spoof-proof region lock belongs in the reverse proxy** — nginx
> `ngx_http_geoip2_module`, Caddy, or a CDN rule — where the real peer address
> is known. Even the MaxMind path here depends on `x-forwarded-for`, which is
> itself client-settable. This module is a correct default and defence in depth,
> not a substitute for edge enforcement.

`GEO_FALLBACK` decides what happens when the country cannot be determined:
`allow` (default) or `deny`.

### Anonymous sessions — `lib/session/`

On first visit a visitor gets a UUID plus a random nickname (`StolzWolf728`),
signed into an HS256 JWT stored in an HttpOnly cookie. No signup, no password,
no user row — the signature is the only thing making the identity tamper-proof.

Because a cookie set on the *response* is not visible to `cookies()` during the
same render, proxy also forwards the identity as request headers. Read it with:

```ts
import { getCurrentSession } from '@/lib/session/current-session'

const session = await getCurrentSession()
```

### Real-time — `/server`

A separate Node process, so **Next.js Proxy never sees its traffic**. Without an
independent check, anyone outside Germany could skip the website and open a
WebSocket directly.

The link is the session JWT: proxy issues it only to visitors who passed the
region lock, so a valid signature proves the holder got through. `io.use()`
verifies it at the handshake — no geo logic is duplicated.

```bash
npm --prefix server run smoke:handshake   # server must be running
```

`server/src/session.ts` deliberately **mirrors** the token contract in
`lib/session/session.ts` rather than importing it, because `/server` is a
separate package with its own build. Change the algorithm, issuer, audience,
cookie name or claim names in one and you must change the other.

### Rooms and WebRTC signalling

Rooms are ephemeral and implicit — the first person to join an id creates it,
the last to leave destroys it. There is no "create room" call, which would leave
orphans behind whenever a creator vanished. Capacity is **2**: P2P video is a
full mesh, so upload bandwidth grows with every extra participant. Going beyond
about four needs an SFU, not a bigger constant.

A socket occupies one room at a time; joining a second implicitly leaves the
first, so a client navigating between rooms cannot accumulate ghost memberships.

**Who offers:** the joiner offers to everyone already present; existing
occupants wait. That one rule avoids SDP glare — if both sides created offers
simultaneously the negotiation deadlocks, and the usual fix (perfect
negotiation with polite/impolite roles) is far more machinery than a two-person
room needs.

**The relay is authorised, not open.** Every `webrtc:*` event is checked against
shared room membership before being forwarded, and the server stamps `from`
with the real sender id rather than trusting the payload. Without that check any
client could push an SDP offer at any connected socket by guessing its id and
hijack or disrupt a call it was never part of. Malformed payloads are dropped
rather than relayed. The server never parses SDP — it forwards sealed envelopes.

### Matchmaking

Instead of naming a room, users press **Find Match** and enter a Redis LIST
queue (FIFO — pushed left, taken from the right, so nobody starves behind later
arrivals). The moment two people are waiting, the server pairs them into a
freshly generated random room id and tells both.

Two things have to be atomic or the system misbehaves under concurrency:

- **Popping a pair.** Two separate `RPOP`s from different nodes can interleave
  and hand the same partner to two people. A Lua script takes both or neither.
- **Joining a room.** A separate `HLEN` check followed by `HSET` lets two nodes
  both see "1 member" and both insert, putting three people in a two-person
  room. Capacity check and insert happen in one script.

Queue entries can go stale when someone closes their tab without cancelling, so
each half of a popped pair is checked for liveness across the cluster
(`io.in(id).fetchSockets()`); a surviving partner is returned to the queue
rather than dropped.

Unlike a manual join there is no "newcomer" to break the offer tie, so the
server designates exactly one side with `shouldOffer`.

### Multi-node

The room registry lives in Redis and `@socket.io/redis-adapter` is attached, so
`io.to(...)`, `socketsJoin` and room membership all work across processes. This
matters for matchmaking: the node that pairs two people is frequently not the
node either is connected to, and it still has to put both into a room and notify
them.

Because of that, `socket.data.roomId` is **not** authoritative — a socket can be
placed into a room by another node entirely. Relay authorisation always reads
Redis via a `socketId -> roomId` reverse index.

> The Lua scripts build room key names inside the script, which Redis **Cluster**
> forbids (all keys must be declared up front). Fine for the single instance in
> docker-compose; moving to Cluster means passing the key in explicitly.

### Board games

A generic state machine in `server/src/game-engine.ts`, with rules supplied by
game definitions in `server/src/games/`. A definition is pure: given a state and
a proposed move, decide legality and produce the next state. It knows nothing
about Redis, sockets or rooms, so adding a game touches no transport code —
write a `GameDefinition`, list it in `games/registry.ts`, done.

Tic-Tac-Toe (`games/tic-tac-toe.ts`) is the proof of concept.

**Server authority.** Clients submit *intent* only — `{ cell: 4 }`, never state.
The server validates against the stored board and is the sole writer. A client
that lies about whose turn it is, or fabricates a board, changes nothing. The UI
disables squares it believes are unplayable, but that is a **hint, not
enforcement**: every click is still sent and still judged server-side, because
anything enforced in the browser can be bypassed from devtools.

**`viewFor` is the anti-cheat seam.** Every piece of state a client receives is
projected through it, per viewer. Tic-Tac-Toe is perfect information so it
returns state unchanged — but Werewolf and Mr. White depend on this to strip
roles and the secret word for everyone except their owner. Game state is
therefore broadcast **per-socket**, not with one `io.to(room)` call, which would
send one player's secrets to the whole room.

**Concurrency.** A move is a read-modify-write. Two players clicking at the same
instant would both read version N, both compute from it, and the second write
would silently erase the first. Every write goes through a compare-and-set on
`version`; a losing writer re-runs the whole read-validate-apply cycle, because
a move validated against a superseded board must not be applied to the new one —
the winner may have taken the very cell it wanted.

**Seating order is explicit.** Members live in a Redis HASH and `HVALS` returns
fields in arbitrary order, so `getMembers` sorts by a `joinedAt` stamp. Without
that, "who is player one" is unpredictable and can differ between reads.

**Ephemeral by construction.** State lives only in Redis under `game:{roomId}`,
carries a TTL, and is deleted the moment the room empties — `leaveRoom` returns
the remaining occupancy in the same atomic step that removes the member, so the
purge decision needs no second round trip that another leave could interleave
with. If one player leaves mid-game the other does not get stranded: the game
ends as a forfeit and is retained until the room is empty, so they can see why.

### The DUDU wall

A global anonymous feed at `/wall` where posts vanish 24 hours after being
written.

```
dudu:message:{id}   STRING   the payload, with a native 24h Redis TTL
dudu:wall           ZSET     message ids scored by epoch-ms post time
dudu:broadcast      CHANNEL  pub/sub fan-out to every socket node
```

Redis expires the payloads itself, which is what makes "auto-delete exactly 24
hours after posting" true without a sweeper process. ZSET members do *not*
expire, so the index would grow forever — every read prunes entries past the TTL
and drops ids whose payload is already gone. Self-healing, no cron job.

`authorId` is stored but never broadcast: the wall is anonymous, and leaking a
stable id would let anyone correlate every post by the same person.

Posting is rate limited to five per minute per session, enforced with an atomic
`INCR`+`EXPIRE` script — done as two calls, a crash in between leaves a counter
that never resets and locks the session out permanently.

> **The moderation filter is a placeholder.** `CLAUDE.md` requires an AI text
> moderation filter before broadcast. `server/src/moderation.ts` currently
> implements a cheap local heuristic — length, shouting, character spam, link
> blocking, and a tiny word list. **It will not catch harassment, hate speech,
> coded language, or anything phrased with mild creativity.** It exists so the
> publish path has a real gate rather than a TODO, and so swapping in a real
> classifier is a one-function change. Implement `aiModeration()` and set
> `MODERATION_PROVIDER=ai` before real users touch this.
>
> The gate **fails closed**: if a configured classifier errors or times out,
> the post is rejected rather than published.

### Data

Postgres holds the durable schema; Redis is the hot path and the pub/sub bus.

> The Phase 1 `dudu_messages` table is **not currently written**. The realtime
> server has no Prisma client, so the durable moderation audit trail is
> unwritten — the wall lives entirely in Redis today. Add `@prisma/client` to
> `/server`, or route writes through a Next.js route handler, to close this.

## Testing

There is no unit-test framework yet. What exists are two smoke suites that
assert the security boundaries end-to-end against real running processes.

### Everything at once

```bash
docker compose up -d       # Postgres + Redis must be up
npm run verify             # typecheck + lint + build + server typecheck + web smoke
```

`verify` does **not** cover the socket suites, because they need the socket
server running. Full sequence:

```bash
npm run verify
npm run server:dev          # separate terminal, leave running
npm run smoke:socket        # handshake + rooms
```

### Web smoke — `npm run smoke:web`

Requires a build first (`npm run build`). Boots its own `next start` on port
3101 with strict geo settings, asserts, and tears down — it does not touch your
dev server, and it overrides every geo variable explicitly so results do not
depend on your `.env`.

23 checks covering: the allow/deny matrix, `no-store` on 403, blocked requests
receiving no cookie, cookie flags, identity rendering on the *first* visit,
identity stability across visits, and a tampered cookie being rejected rather
than trusted.

### Handshake smoke — `npm --prefix server run smoke:handshake`

Requires the socket server running. Six cases: no token, garbage token, token
signed with the wrong secret, wrong issuer, wrong audience — all must be
rejected; a valid token must be accepted.

This is the test that matters most. It is the only thing stopping someone
outside Germany from skipping the website and opening a WebSocket directly.

### Rooms smoke — `npm --prefix server run smoke:rooms`

Requires the socket server running. 19 checks covering room id validation,
capacity, peer-joined/peer-left notifications, slot reuse after leaving, and
disconnect cleanup — plus the signalling security cases:

- an offer is delivered within a room, stamped with the real sender id
- an offer missing `sdp` is dropped, not relayed
- a **cross-room** offer is blocked
- a **cross-room** ICE candidate is blocked
- an offer from a socket in no room at all is blocked

### Matchmaking smoke — `npm --prefix server run smoke:matchmaking`

16 checks: a lone user waits rather than matching, two waiters land in the
*same* generated room, each sees the other as peer, exactly one is told to
offer, the pair can actually signal each other, cancel works and is idempotent,
and a **stale queue entry from a vanished socket does not produce a match**.

### DUDU smoke — `npm --prefix server run smoke:dudu`

19 checks: posting, broadcast to subscribers, history, and that the broadcast
does **not** leak `authorId`. Asserts the TTL directly against Redis (`ttl` is
~86400 and `expiresAt - createdAt` is exactly 24h). Covers every moderation
rejection path and the five-per-minute rate limit.

### Game smoke — `npm --prefix server run smoke:game`

34 checks. Start guards (no room, unknown game, wrong player count), then every
rejection path proven **server-side**: out of turn, non-integer cell, negative
cell, off-board cell, malformed payload, taken cell, moving after the end, and
an outsider reaching another room's game. Then a game played to a win, and
ephemerality asserted directly against Redis — state exists while the room
lives, survives while one player remains, and is **gone** once the room empties.
Finally the forfeit path when a player disconnects mid-game.

### Manual check — P2P video

```bash
docker compose up -d
npm run dev            # terminal 1
npm run server:dev     # terminal 2
```

Open <http://localhost:3000/rooms> in **two** browser windows. Either press
**Find Match** in both — they pair automatically — or enter the same Room ID in
both and join. You should see two video tiles per window and the peer state
reach `connected`.

Once two people are in a room, press **Start game** for Tic-Tac-Toe. Clicking an
opponent's square, or playing out of turn, gets refused by the server and the
board shakes.

For the wall, open <http://localhost:3000/wall> in two windows and post: the
message should appear in both immediately, with a countdown to its expiry.

> `getUserMedia` requires a secure context. `http://localhost` counts; a LAN
> address like `http://192.168.1.5:3000` does **not**, and the camera request
> will fail. Testing across two physical devices needs HTTPS.

Use two different browsers (or a normal + private window) — two tabs in the
same profile share a session cookie and therefore the same identity.

### Not covered yet

There is no automated test of an actual media connection: the smoke tests
verify signalling is relayed and authorised, but a real ICE handshake needs two
browsers and is checked by hand. Also untested: the nickname generator,
`client-ip.ts` parsing, Redis pub/sub fan-out (no publisher exists yet), and
Prisma writes — only that the schema migrates.

## Status

Working and verified: region lock, anonymous sessions, socket handshake auth,
Prisma schema + migration, Redis-backed room registry with the Socket.io Redis
adapter, WebRTC signalling relay with same-room authorisation, automatic
matchmaking, the DUDU wall with a 24h TTL, and a server-authoritative board-game
engine with Tic-Tac-Toe. UI at `/rooms` and `/wall`.

**Room capacity is the binding constraint on games.** It is fixed at 2 for the
P2P video mesh, so Werewolf and Mr. White cannot run until rooms support more
players than a mesh call sensibly allows — those two concerns will need to
separate.

**The moderation filter is a heuristic placeholder, not the AI filter
`CLAUDE.md` requires.** See the DUDU wall section above.

**No TURN server.** Only public STUN is configured, so peers behind symmetric
NAT will not connect. See the WebRTC section in `.env.example`.

**Postgres is not written by the realtime server** — the wall is Redis-only
today, so there is no durable moderation audit trail.

Also not built yet: Werewolf and Mr. White (the engine and the `viewFor`
redaction seam are in place; the games themselves are not), reconnect-into-a-
running-game beyond `game:sync`, and any pairing preferences in matchmaking (it
is purely first-come-first-served).

## Scripts

| Command                    | Purpose                          |
| -------------------------- | -------------------------------- |
| `npm run dev`              | Next.js dev server               |
| `npm run build`            | Production build                 |
| `npm run typecheck`        | TypeScript, no emit              |
| `npm run lint`             | ESLint                           |
| `npm run db:migrate`       | Create + apply a migration       |
| `npm run db:studio`        | Prisma Studio                    |
| `npm run server:dev`       | Socket.io server (watch mode)    |
| `npm run verify`           | typecheck + lint + build + web smoke |
| `npm run smoke:socket`     | handshake + rooms (server must run) |
