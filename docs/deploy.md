# Deploying DUDU

Production runs on two hosts, because the app is two processes with different
needs:

| Piece            | Host    | Why                                                     |
| ---------------- | ------- | ------------------------------------------------------- |
| Next.js app      | Vercel  | Stateless. Renders UI, region-locks, issues session JWTs |
| Socket.io server | Railway | Long-lived process holding live game state               |
| Redis            | Railway | Backs the adapter, DUDU wall TTL, queues, sweepers       |

Vercel cannot host the socket server. Serverless functions start per request
and exit; a WebSocket server has to stay resident, and `server/src/index.ts`
holds every in-flight game in memory.

**Postgres is not deployed.** Nothing imports `lib/db/prisma.ts` or
`lib/redis.ts` — both are scaffolded ahead of the moderation/stats work. The
Next.js app talks to no datastore at all, which is why Railway's Redis can stay
on the private network and never be exposed publicly.

---

## Before you start

Generate a fresh session secret. Do not reuse the local one — it lives in a
`.env` next to a `password123` Postgres URL.

```bash
node -e "console.log(require('crypto').randomBytes(32).toString('base64url'))"
```

Hold onto that value. It goes into **both** hosts, byte-identical. The socket
server treats a valid signature as proof the holder already passed the region
lock (`server/src/index.ts:67-74`), so a mismatch rejects every handshake and a
leak bypasses the region lock entirely.

### Why the handshake uses a ticket, not the cookie

Worth understanding before you change anything about auth.

The session cookie is `httpOnly` + `sameSite: 'lax'`. Vercel and Railway are
**different registrable domains**, which makes the Socket.io handshake a
cross-site request — and Lax means the browser withholds the cookie from it.
`withCredentials: true` does not override that; SameSite is enforced regardless.
Left alone, every connection is rejected as `unauthorized`.

So the client first calls `/api/socket-ticket` (same-origin, cookie *is* sent)
and passes the returned token in the Socket.io `auth` payload. The server checks
`auth.token` before falling back to the cookie, so both paths work and local
development is unchanged.

The ticket lives 60 seconds. Do **not** "simplify" this by setting
`sameSite: 'none'` — that exposes the real 30-day session cookie to every
cross-site request on the internet. `lib/session/session.ts` documents the same
reasoning at the cookie definition.

---

## The ordering problem

Vercel needs Railway's URL (`SOCKET_URL`). Railway needs Vercel's URL
(`SOCKET_CORS_ORIGIN`). Neither exists yet.

Break the cycle by deploying Railway first with CORS left at its default, then
coming back in step 4. Railway's URL is knowable before its first successful
deploy; Vercel's is not.

---

## 1. Redis on Railway

New project → **Add Service** → **Database** → **Redis**. Nothing to configure.
Leave it on the private network; do not enable a public TCP proxy.

It must be a real Redis speaking the TCP protocol. The socket server holds two
long-lived `SUBSCRIBE` connections for `@socket.io/redis-adapter` plus the
`dudu:broadcast` channel, so a REST-only Redis will not work.

## 2. Socket server on Railway

**Add Service** → **GitHub Repo** → this repo.

Settings:

| Setting       | Value                |
| ------------- | -------------------- |
| Root Director | `server`             |
| Build Command | `npm run build`      |
| Start Command | `npm start`          |
| Healthcheck   | `/health`            |

Variables:

```
SESSION_JWT_SECRET   <the secret from above>
REDIS_URL            ${{Redis.REDIS_URL}}
DISCONNECT_GRACE_MS  30000
NODE_ENV             production
SOCKET_CORS_ORIGIN   http://localhost:3000
```

`REDIS_URL` uses Railway's reference syntax so the value resolves over private
networking — type it literally, braces included.

Do **not** set `PORT`. Railway injects it, and `server/src/env.ts` reads it
ahead of `SOCKET_PORT` precisely so the process binds where Railway's router
forwards.

Deploy, then **Settings → Networking → Generate Domain**. Note the URL, e.g.
`https://dudu-server-production.up.railway.app`.

Confirm it is alive:

```bash
curl https://<your-railway-domain>/health
# {"status":"ok","redis":"ok","uptime":12.3,"queued":0,"wall":0}
```

If `redis` reads `unreachable`, the service is up but `REDIS_URL` did not
resolve — check the reference syntax before continuing. The endpoint reports
Redis rather than failing on it, so a blip cannot roll back a good deploy.

## 3. Next.js on Vercel

Import the repo. Framework preset Next.js; leave build settings alone.

Variables:

```
SESSION_JWT_SECRET          <the same secret, byte-identical>
SOCKET_URL                  https://<your-railway-domain>
GEO_ALLOWED_COUNTRIES       DE
GEO_TRUST_PROXY_HEADERS     true
GEO_TRUSTED_COUNTRY_HEADER  x-vercel-ip-country
GEO_FALLBACK                allow
GEO_BYPASS_LOCALHOST        false
```

Optionally, to enable the TURN relay (see Known gaps if you skip it):

```
TURN_URL                    turn:relay.example.com:3478?transport=udp,turns:relay.example.com:5349
TURN_STATIC_AUTH_SECRET     <the provider's static-auth-secret>
TURN_TTL_SECONDS            43200
```

These are server-side only — no `NEXT_PUBLIC_` prefix, deliberately.
`app/api/ice/route.ts` mints per-visitor credentials from the secret, so the
browser never receives anything reusable.

`SOCKET_URL` is read per request by `/api/socket-ticket`, which hands it to the
browser alongside the handshake ticket. Editing it in the dashboard therefore
takes effect on save — no rebuild. Use `https://` (socket.io upgrades to `wss://`
by itself) and no trailing slash, which would break the CORS match in step 4.

Deliberately **not** `NEXT_PUBLIC_`. That prefix inlines the value during
`next build`, so a project first deployed without it ships an app that has no
socket address at all — the failure this indirection exists to prevent. The old
name still works as a fallback if it is already set.

Header trust is safe here specifically because Vercel's edge overwrites
`x-vercel-ip-country` on every request. That is the condition `.env.example`
warns about; a proxy that merely *adds* the header when absent would let any
client forge it. This is also how the region lock works without the GeoLite2
`.mmdb`, which is gitignored and never reaches the deployment.

Start with `GEO_FALLBACK=allow`. Confirm you can reach the site, *then* flip to
`deny`. Flipping first risks locking yourself out with no way to see why.

Deploy. Note the production domain.

## 4. Close the loop

Back in Railway, set `SOCKET_CORS_ORIGIN` to the Vercel domain and redeploy:

```
SOCKET_CORS_ORIGIN   https://your-app.vercel.app
```

Comma-separate to allow preview deploys, which each get a unique URL and would
otherwise fail their handshake:

```
SOCKET_CORS_ORIGIN   https://your-app.vercel.app,https://your-app-git-dev-you.vercel.app
```

CORS is not the security boundary — the handshake still demands a valid session
JWT. It only decides whose browser may attempt one.

---

## Verifying

1. Open the Vercel URL. You should get a nickname, not a 403.
2. Open `/wall` and post. It should appear without a refresh.
3. Open `/rooms` in two browsers on **different networks** and match.

Step 3 is the real test. Two tabs on one machine prove almost nothing about
WebRTC — they will connect via host candidates even when nothing else would.

## Known gaps

- **TURN is supported but optional.** Leave `TURN_URL` and
  `TURN_STATIC_AUTH_SECRET` unset and the app runs on STUN alone — pairs behind
  symmetric NAT (roughly 10–20% of real pairs) will sit at `checking` forever.
  Games, lobby, chat and the wall are unaffected; this is video/audio only. The
  `/rooms` page shows a notice while no relay is configured.
- **Single socket instance.** The Redis adapter supports scaling, but games hold
  in-memory state, so a restart or redeploy drops every live game.
- **Vercel Hobby is non-commercial.** Fine for a student project.

## Troubleshooting

| Symptom                                     | Cause                                                             |
| ------------------------------------------- | ----------------------------------------------------------------- |
| Every handshake rejected                    | `SESSION_JWT_SECRET` differs between hosts                        |
| Handshake rejected, secrets match           | `/api/socket-ticket` returning 401 — check proxy.ts still matches API routes |
| Video stuck at `checking`, everything else fine | No TURN relay configured. Expected; see Known gaps             |
| Browser console shows a CORS error          | Vercel domain missing from `SOCKET_CORS_ORIGIN`, or a trailing `/` |
| "No realtime server configured" on the site | `SOCKET_URL` unset on Vercel, or the socket server was never deployed |
| Client still dials `localhost:4000`         | Only possible on a dev build; production no longer falls back to it |
| Railway deploy green, connections time out  | Something is overriding `PORT`; unset it and let Railway inject    |
| 403 before the page renders                 | Region lock. You are outside DE, or on a VPN                       |
| `/health` reports `redis: unreachable`      | `REDIS_URL` reference did not resolve                             |
