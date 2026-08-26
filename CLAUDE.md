@AGENTS.md

# Project Overview

An anonymous, ephemeral social platform for Indonesian students in Aachen. Four
features: the **DUDU wall** (48h-TTL public board), **P2P video rooms**, FIFO
**matchmaking**, and server-authoritative **multiplayer games** (Tic-Tac-Toe,
Mr. White, 36 Questions, Werewolf).

Read `README.md` first — it is the source of truth for architecture, and it
explains *why* each piece is shaped the way it is. This file only carries the
rules that are not obvious from reading the code.

# Architecture & Tech Stack

- **Frontend:** Next.js 16 (App Router), React 19, Tailwind 4 — at the repo root.
- **Realtime:** Node.js + Socket.io, in `server/`. Its own package and tsconfig.
  No Express — Socket.io attaches to a bare `node:http` server.
- **Database:** PostgreSQL 18 via Prisma 7. Native install, not Docker.
- **Cache & bus:** Redis — Socket.io adapter, matchmaking queue, room registry,
  game state, DUDU wall TTL. `docker-compose` provides Redis only.
- **Security:** Anonymous JWT sessions (UUID + generated nickname), region lock
  via MaxMind GeoIP / `x-vercel-ip-country`.

# Development Rules

## 1. Codebase structure

- The Next.js app is at the **repo root** (`app/`, `components/`, `lib/`); the
  realtime backend is in `server/`. There is no `frontend/` directory.
- `app/` holds only App Router conventions — routes, `layout.tsx`, `page.tsx`.
  Shared client components live in `components/`, shared logic in `lib/`.
- The two packages **cannot import each other**. The wire protocol is mirrored
  by hand in `lib/socket/events.ts` and `server/src/events.ts` — adding or
  renaming an event means editing both.
- The JWT contract is likewise mirrored between `lib/session/session.ts` and
  `server/src/session.ts`. Issuer, audience, algorithm and claim names are
  verified byte-for-byte; changing one side breaks every socket handshake.

## 2. Real-time & WebRTC

- Socket.io carries signalling (offer, answer, ice-candidate), matchmaking, chat
  and game state. Audio and video stay **peer-to-peer** and never reach the server.
- `ROOM_CAPACITY = 2` (video rooms) and `LOBBY_CAPACITY = 8` (game tables) are
  deliberately different primitives. Do not collapse them.
- Room membership lives in **Redis, not `socket.data`** — matchmaking can make a
  socket on another node join a room, and local state would not record it.
- Capacity and pair-popping are enforced in **Lua**, not in application code. Two
  nodes checking separately would both see room and both insert.

## 3. Database & caching

- **PostgreSQL:** persistent data only. Currently schema + migrations; the
  realtime server does not write to it yet.
- **Redis:** all ephemeral state. The DUDU wall is Redis-only with a strict 48h
  TTL — never persist wall posts to Postgres.

## 4. Security & access

- Never trust client payloads. Validate every signalling event against shared
  room membership **on the server**.
- Clients submit game *intent* ("cell 4"), never state. Moves are validated
  against stored state before anything is applied.
- `viewFor` is the anti-cheat seam: project state per viewer before it goes on
  the wire. Hidden-role games depend on this entirely.
- The region lock defaults to `GEO_FALLBACK=allow` in local development without
  the `.mmdb`. Do not enforce strict rejection until the database is present.
- Credentials in environment variables MUST NOT carry a `NEXT_PUBLIC_` prefix.

## 5. Execution protocol

- Run `npm run verify` before calling work done — typecheck, lint, build, server
  typecheck, integration tests and the web smoke, in one command.
- Integration tests in `server/tests/` run against **real Redis on database 15**.
  The harness refuses any other database because it calls `flushdb`.
- Handle WebRTC connection drops and Socket.io reconnection explicitly.
- Prefer lightweight, local-first solutions suitable for a home-server
  deployment over architectural overhauls.
- Comments explain *why*, not *what*. The existing codebase sets the standard —
  match its density rather than stripping or padding it.
