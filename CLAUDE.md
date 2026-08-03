@AGENTS.md
# Project Overview
A web-based multiplayer gaming and real-time communication platform. Features include P2P video calls (WebRTC), automated matchmaking, a 24-hour ephemeral public message board (DUDU Wall), and bot-driven board games. 

# Architecture & Tech Stack
- **Frontend:** Next.js (App Router), React, TailwindCSS.
- **Backend:** Node.js, Express, Socket.io (for signaling and game state).
- **Database:** PostgreSQL (via Prisma ORM).
- **Caching & State:** Redis (for Socket.io adapter, matchmaking queue, and DUDU wall TTL).
- **Infrastructure:** Local Docker Engine (`docker-compose` for Postgres and Redis).
- **Security:** Anonymous JWT sessions (UUID/nickname), strict Region Lock (MaxMind GeoIP targeting Germany).

# Development Rules

## 1. Codebase Structure
- Maintain a strict separation between `frontend/` (Next.js) and `server/` (Node.js). 
- Do not mix React server components with Express logic.
- Ensure the JWT contract remains synchronized between `frontend/` and `server/`.

## 2. Real-Time & WebRTC
- Use Socket.io strictly for signaling (offer, answer, ice-candidate), matchmaking, and text/game state. 
- Video/Audio streaming MUST remain Peer-to-Peer (WebRTC) to minimize server bandwidth.
- WebRTC rooms are limited to 2 users (full mesh not required for now).
- State management for Socket.io rooms must utilize `@socket.io/redis-adapter` to ensure scalability across multiple nodes.

## 3. Database & Caching
- **PostgreSQL:** Used exclusively for persistent data (user stats, persistent settings). 
- **Redis:** Used for all ephemeral data. The "DUDU Wall" must rely entirely on Redis with a strict 24-hour TTL (Time-To-Live). Do not store DUDU Wall posts in PostgreSQL.

## 4. Security & Access
- Never blindly trust client payloads. Validate all WebRTC signaling events against shared room membership on the server.
- The Region Lock middleware defaults to `GEO_FALLBACK=allow` during local development without the `.mmdb` database. Do not enforce strict rejection until the database is present.
- Environment variables containing credentials MUST NOT have `NEXT_PUBLIC_` prefixes unless strictly required by the frontend.

## 5. Execution Protocol
- Focus on robust error handling, especially for WebRTC connection drops and Socket.io reconnections.
- Before suggesting complex architectural overhauls, prioritize lightweight, local-first solutions suitable for a Home Server environment.
- Write concise, production-ready TypeScript code. Avoid overly verbose comments unless explaining complex WebRTC SDP negotiation logic.