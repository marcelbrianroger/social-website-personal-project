# Deploying DUDU: Vercel + Railway

**Date:** 2026-08-06
**Status:** Phase 1 and Phase 2 both implemented

## Problem

The app only ran on `localhost`. Opening it from a second laptop failed because
`lib/webrtc/ice-config.ts:50` defaults `SOCKET_URL` to `http://localhost:4000`,
and that value is inlined into the browser bundle — so the second laptop dialed
*itself*.

The goal is a public deployment on Vercel.

## Constraint

Vercel cannot host the Socket.io server. Serverless functions start per request
and exit; `server/src/index.ts` is a resident process holding live game state in
memory and two long-lived Redis `SUBSCRIBE` connections. The two Docker services
(`localhost:5432`, `localhost:6379`) likewise have no cloud equivalent by
default.

## Key finding

**The Next.js app is entirely stateless.** Nothing imports `lib/db/prisma.ts` or
`lib/redis.ts`; both are scaffolded ahead of the moderation/stats work. Verified
by grep across `app/`, `lib/`, and `server/`.

This collapsed the design:

- Postgres does not need provisioning at all.
- Redis is needed only by the socket server, so it stays on Railway's private
  network and is never publicly exposed.
- Vercel holds no datastore credentials.

`prisma generate` was verified to exit 0 with `DATABASE_URL` unset — generating
a client reads the schema, not a database — so no dummy value is required for
the Vercel build.

## Topology

```
Browser (DE only)
   ├─ HTTPS ──→ Vercel ─── Next.js: proxy.ts region lock + session JWT
   ├─ WSS ───→ Railway ─── Socket.io ──private──→ Railway Redis 7
   └─ P2P ───→ peer browser (STUN; TURN relay in Phase 2)
```

Trust flows one way: `proxy.ts` enforces the region lock and issues a session
JWT; the socket server treats a valid signature as proof the holder passed that
lock (`server/src/index.ts:67-74`). So `SESSION_JWT_SECRET` must be identical
across hosts, and it is the single credential worth protecting.

## Phase 1 — core deploy (implemented)

1. **`PORT` precedence** — `server/src/env.ts`. Managed hosts inject `PORT` and
   it is not configurable. Reading `SOCKET_PORT` alone would bind a port the
   platform router never forwards to: deploy green, every connection times out.

2. **Multi-origin CORS** — `server/src/env.ts`, `server/src/index.ts`.
   `corsOrigin` became `string[]` parsed from a comma-separated list. Vercel
   mints a fresh URL per preview deploy, so a single origin means only
   production connects. Trailing slashes are stripped, since an origin with one
   never matches.

3. **`/health` hardened** — `server/src/index.ts`. It awaited two Redis calls
   inside `void (async () => …)()` with no catch, so an unreachable Redis left
   the request hanging and raised an unhandled rejection. Railway's healthcheck
   would have timed out and rolled back an otherwise-fine deploy. Redis is now
   *reported* (`redis: "ok" | "unreachable"`) rather than required.

4. **Credential redaction** — `server/src/index.ts` logged `env.redisUrl`
   verbatim on boot. Railway's `REDIS_URL` embeds a password, which would have
   put it in the deploy log. Now redacted.

5. **`.vercelignore`** — excludes `server/`, safe because no file under `app/`
   or `lib/` imports from it; the two share a contract by duplication
   (`lib/socket/events.ts`), not by import.

Region lock in production reads `x-vercel-ip-country`, already a trusted
candidate at `lib/geo/region-lock.ts:70`. Vercel's edge overwrites it on every
request, satisfying the condition `.env.example` warns about, so the gitignored
GeoLite2 `.mmdb` is not needed.

Runbook: `docs/deploy.md`.

## Phase 1a — socket ticket (found during Phase 2, blocking)

Phase 1 as originally designed **could not have worked**. `lib/session/session.ts`
sets the session cookie `httpOnly` + `sameSite: 'lax'`, and the comment at its
definition already warned that hosting the socket server on a different
registrable domain means the cookie is never sent. Vercel and Railway are
exactly that. `withCredentials: true` does not override SameSite.

The failure path: browser withholds the cookie → no `auth.token` either, since
no hook passed one → `verifySession(undefined)` → `null` → every handshake
rejected as `unauthorized`. It never surfaced locally because
`localhost:3000 → localhost:4000` is same-site.

Fixed the way the codebase itself prescribes, not with `sameSite: 'none'`:

- `signSocketTicket()` in `lib/session/session.ts` — same issuer, audience,
  algorithm and claims as `signSession`, 60-second expiry. The socket server's
  `verifySession` accepts it with **no change on that side**, because the gate
  already read `socket.handshake.auth.token` before falling back to the cookie.
- `app/api/socket-ticket/route.ts` — same-origin, so the cookie *is* sent here.
- `lib/socket/connect.ts` — `fetchSocketTicket()` + `socketOptions()`, shared by
  all four hooks so the ticket logic exists once rather than four times.

`withCredentials` is kept alongside the ticket: same-site deployments still
authenticate by cookie, and letting both paths work costs nothing.

## Phase 2 — minted TURN credentials

Video is P2P; this gap affects only video/audio, not games, lobby, chat, or the
wall.

**Why it is needed.** STUN alone fails behind symmetric NAT — roughly 10–20% of
real pairs, who sit at `checking` forever. On one LAN this never showed up.

**Why not just set the existing vars.** `NEXT_PUBLIC_TURN_*` ship to the
browser, so anyone can read and reuse the relay quota — the warning already at
`lib/webrtc/ice-config.ts:12-16`.

**As built.**

- `app/api/ice/route.ts`, `dynamic = 'force-dynamic'` plus `cache-control:
  no-store` (credentials are per-user and time-bound; caching defeats them, and
  the route config alone does not bind CDNs or the browser cache). Mints coturn
  REST credentials: `username = <expiry-unix>:<sessionId>`,
  `credential = base64(HMAC-SHA1(username, TURN_STATIC_AUTH_SECRET))`.
  Returns STUN-only when TURN vars are absent, so local dev and the pre-TURN
  deploy are unaffected.
- Env vars lost `NEXT_PUBLIC_`: `TURN_URL` (comma-separated — providers give
  several transports sharing one secret), `TURN_STATIC_AUTH_SECRET`,
  `TURN_TTL_SECONDS`. Vercel only.
- `lib/webrtc/ice-config.ts`: `getIceServers()` → `fetchIceConfig()` returning
  `{ iceServers, turnAvailable }`, plus exported `STUN_ONLY` and `PUBLIC_STUN`.
  `turnAvailable` is derived from the response because the browser can no longer
  see the env vars.
- `lib/webrtc/use-p2p-room.ts`: `getIceServers()` was synchronous inside
  `createPeerConnection` and could not become async there. The servers now live
  in `iceServersRef`, filled before the socket opens; `createPeerConnection`
  reads the ref synchronously. The ticket and ICE fetches run in parallel and
  **gate the connection** — connecting first would let the very first peer be
  built with STUN only, exactly the case TURN exists to rescue, failing
  intermittently depending on how fast the peer arrived.
- `app/rooms/room-client.tsx`: `hasTurnConfigured()` → the hook's
  `turnAvailable`.

The client contract is just `GET /api/ice → { iceServers }`. That seam keeps
provider choice out of the client: the coturn HMAC scheme works with
self-hosted coturn and Metered; Cloudflare Realtime TURN uses a different
credential API and would change only the route body.

**Verified end to end** against a production build: the ticket carries
`iss: dudu:web` / `aud: dudu:client` with `exp - iat = 60`, matching what
`server/src/session.ts` checks; `/api/ice` returns STUN-only unconfigured and a
correct relay entry when configured, with the HMAC recomputed independently and
matching byte for byte.

## Rejected alternatives

- **Everything on one host (skip Vercel).** Simpler env wiring, but gives up
  Vercel's CDN and the `x-vercel-ip-country` header the region lock now relies
  on.
- **Render.** Free web services sleep after 15 minutes idle, dropping every
  WebSocket and wiping in-memory game state.
- **Upstash Redis.** Cheapest, but the adapter holds two long-lived `SUBSCRIBE`
  connections and pub/sub support was not certain enough to bet the deploy on.
  Railway's Redis 7 container matches `docker-compose.yml` exactly.
- **Fly.io.** Best latency for DE users, but requires hand-writing a Dockerfile
  and `fly.toml`.

## Known gaps

- TURN is optional: unset `TURN_URL`/`TURN_STATIC_AUTH_SECRET` and the app runs
  on STUN alone, with the symmetric-NAT gap intact and a notice on `/rooms`.
- Single socket instance: the adapter supports scaling, but games hold
  in-memory state, so a restart drops live games. Durable game state would be
  the prerequisite for running two.
- Vercel Hobby is non-commercial.
- Nothing here has been exercised against a real deployment yet — only against
  a local production build. The cross-site cookie failure is precisely the class
  of bug that only appears once the two hosts are actually on different domains.
