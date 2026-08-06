import { createServer } from 'node:http'

import { createAdapter } from '@socket.io/redis-adapter'
import { Server, type Socket } from 'socket.io'

import { getWall, postMessage, wallSize } from './dudu.js'
import { env } from './env.js'
import { composeChat } from './game-chat.js'
import {
  buildView,
  dueDisconnects,
  dueGames,
  expireDisconnect,
  forfeitGame,
  loadGame,
  markDisconnected,
  markReconnected,
  purgeGame,
  startGame,
  submitMove,
  tickGame,
} from './game-engine.js'
import { getGameDefinition } from './games/registry.js'
import type { AnyGameDefinition, GamePlayer, StoredGame } from './games/types.js'
import type {
  ClientToServerEvents,
  DuduBroadcast,
  LobbyMember,
  RoomPeer,
  ServerToClientEvents,
  SignalCandidate,
  SignalDescription,
  SocketData,
} from './events.js'
import {
  LOBBY_CAPACITY,
  getLobbyMembers,
  getSocketLobby,
  joinLobby,
  leaveLobby,
  listOpenLobbies,
} from './lobby.js'
import {
  dequeue,
  enqueue,
  generateMatchRoomId,
  popPair,
  queueLength,
  requeue,
  type QueueEntry,
} from './matchmaking.js'
import {
  closeRedis,
  createSubscriber,
  gameScope,
  keys,
  pubClient,
  subClient,
} from './redis.js'
import { canRelay, getMembers, getSocketRoom, joinRoom, leaveRoom } from './rooms.js'
import { SESSION_COOKIE_NAME, readCookie, verifySession } from './session.js'

/**
 * Real-time backend for the DUDU platform.
 *
 * SECURITY — why the handshake check exists:
 * Next.js Proxy (proxy.ts) enforces the German region lock, but it only runs
 * for requests routed through the Next.js app. This is a separate process on a
 * separate port, so Proxy never sees these connections. Without an independent
 * check here, anyone outside Germany could skip the website entirely and open a
 * WebSocket straight to this server.
 *
 * The link between the two is the session JWT: Proxy issues it only to visitors
 * who passed the region lock, so a valid signature is proof the holder got
 * through the gate.
 */

/** Socket.io room every wall subscriber joins. */
const DUDU_ROOM = 'dudu:wall'

/** Socket.io room for everyone browsing the open-table list on /lobby. */
const LOBBY_BROWSER_ROOM = 'lobby:browser'

type AppServer = Server<
  ClientToServerEvents,
  ServerToClientEvents,
  Record<string, never>,
  SocketData
>

type AppSocket = Socket<
  ClientToServerEvents,
  ServerToClientEvents,
  Record<string, never>,
  SocketData
>

const httpServer = createServer((req, res) => {
  if (req.url === '/health') {
    void (async () => {
      // Redis is reported on, not required. A platform healthcheck that fails
      // while Redis is briefly unreachable would roll back a deploy that is
      // otherwise fine, and an uncaught rejection here would leave the request
      // hanging until the checker times out — turning a blip into an outage.
      let redis: 'ok' | 'unreachable' = 'ok'
      let queued: number | null = null
      let wall: number | null = null

      try {
        ;[queued, wall] = await Promise.all([queueLength(), wallSize()])
      } catch (error) {
        redis = 'unreachable'
        console.error(
          `[health] redis unreachable: ${error instanceof Error ? error.message : String(error)}`,
        )
      }

      res.writeHead(200, { 'content-type': 'application/json' })
      res.end(
        JSON.stringify({
          status: 'ok',
          redis,
          uptime: process.uptime(),
          queued,
          wall,
        }),
      )
    })()
    return
  }

  res.writeHead(404, { 'content-type': 'text/plain' })
  res.end('Not Found')
})

const io: AppServer = new Server(httpServer, {
  cors: {
    origin: env.corsOrigin,
    // Required for the browser to send the HttpOnly session cookie along with
    // the handshake.
    credentials: true,
  },
})

/**
 * Redis adapter.
 *
 * Makes `io.to(...)`, `socketsJoin` and room membership work across processes.
 * Matchmaking depends on this: the node that pairs two people is frequently not
 * the node either of them is connected to, and it still has to put both into a
 * room and notify them.
 */
io.adapter(createAdapter(pubClient, subClient))

/**
 * Handshake gate. Runs once per connection, before any event is delivered.
 */
io.use(async (socket, next) => {
  const authToken = socket.handshake.auth?.['token']
  const token =
    typeof authToken === 'string' && authToken.length > 0
      ? authToken
      : readCookie(socket.handshake.headers.cookie, SESSION_COOKIE_NAME)

  const session = await verifySession(token)

  if (!session) {
    // Deliberately vague: a client that cannot prove it holds a valid session
    // learns nothing about why.
    next(new Error('unauthorized'))
    return
  }

  socket.data.session = session
  next()
})

// --- Payload validation ----------------------------------------------------
//
// Client-supplied signalling payloads are untrusted. These narrow them to the
// shape we relay, so a malformed or hostile body is never forwarded verbatim.

function isDescription(value: unknown): value is SignalDescription {
  if (typeof value !== 'object' || value === null) return false
  const candidate = value as Record<string, unknown>
  return (
    (candidate['type'] === 'offer' || candidate['type'] === 'answer') &&
    typeof candidate['sdp'] === 'string'
  )
}

function isCandidate(value: unknown): value is SignalCandidate {
  if (typeof value !== 'object' || value === null) return false
  return typeof (value as Record<string, unknown>)['candidate'] === 'string'
}

// --- Room helpers ----------------------------------------------------------

// --- Game targets ----------------------------------------------------------
//
// A game can be attached to either primitive: a two-person WebRTC room, or an
// eight-seat lobby with no video at all. Everything downstream of this — start,
// move, chat, the deadline sweeper — works the same way for both, so the
// difference is resolved once, here, rather than branching in every handler.

interface GameTarget {
  kind: 'room' | 'lobby'
  id: string
  /**
   * Namespaced game key AND the Socket.io room name.
   *
   * The two id spaces overlap (both allow `aachen-1`), so a lobby's scope is
   * prefixed. Using the same string for both means a lobby can never broadcast
   * into a video room that happens to share its id.
   */
  scope: string
}

function roomTarget(roomId: string): GameTarget {
  return { kind: 'room', id: roomId, scope: gameScope.room(roomId) }
}

function lobbyTarget(lobbyId: string): GameTarget {
  return { kind: 'lobby', id: lobbyId, scope: gameScope.lobby(lobbyId) }
}

type Occupant = { socketId: string; sessionId: string; nickname: string }

async function membersOf(target: GameTarget): Promise<Occupant[]> {
  return target.kind === 'lobby'
    ? getLobbyMembers(target.id)
    : getMembers(target.id)
}

/** Where this socket's game lives. A lobby wins — you cannot be in both. */
async function resolveTarget(socketId: string): Promise<GameTarget | null> {
  const lobbyId = await getSocketLobby(socketId)
  if (lobbyId) return lobbyTarget(lobbyId)

  const roomId = await getSocketRoom(socketId)
  if (roomId) return roomTarget(roomId)

  return null
}

/** Resolve sessionIds to the sockets currently holding them. */
async function socketsFor(
  target: GameTarget,
  sessionIds: readonly string[],
): Promise<string[]> {
  const wanted = new Set(sessionIds)

  return (await membersOf(target))
    .filter((member) => wanted.has(member.sessionId))
    .map((member) => member.socketId)
}

/**
 * Send the game state to every occupant, projected for each of them.
 *
 * Emitted per-socket rather than with a single `io.to(...)` because two players
 * can legitimately receive different views — `viewFor` strips hidden
 * information per viewer, and a broadcast would send one player's secrets to
 * everyone. Mr. White is the reason this was built this way in Phase 4.
 */
async function broadcastGame(
  target: GameTarget,
  stored: StoredGame,
  definition: AnyGameDefinition,
): Promise<void> {
  for (const member of await membersOf(target)) {
    io.to(member.socketId).emit(
      'game:state',
      buildView(stored, definition, member.sessionId),
    )
  }
}

/**
 * Push the open-table list to everyone browsing.
 *
 * Called after anything that changes what the list would say: a seat taken or
 * freed, and a game starting (which flips a table to "in progress"). Recomputed
 * rather than patched — the list is small, and diffing it against N watchers
 * would be more code than the read costs.
 */
async function publishOpenTables(): Promise<void> {
  io.to(LOBBY_BROWSER_ROOM).emit('lobby:open-tables', await listOpenLobbies())
}

/**
 * Advance a due phase and tell everyone, if it moved at all.
 *
 * Safe to call on any inbound game event: `tick` returns null when nothing is
 * due, so the common case costs one Redis read.
 */
async function advance(target: GameTarget): Promise<void> {
  const ticked = await tickGame(target.scope)
  if (ticked) await broadcastGame(target, ticked.stored, ticked.definition)
}

/** Remove a socket from its room and tell the remaining occupants. */
async function detach(socket: AppSocket): Promise<void> {
  const left = await leaveRoom(socket.id)
  socket.data.roomId = undefined

  if (!left) return

  // `.except()` rather than `socket.to()`: on the disconnect path the socket
  // has already been dropped from its rooms, so a sender-relative broadcast is
  // not reliable.
  io.to(left.roomId)
    .except(socket.id)
    .emit('room:peer-left', {
      socketId: left.peer.socketId,
      sessionId: left.peer.sessionId,
    })

  const target = roomTarget(left.roomId)

  if (left.remaining === 0) {
    // Room is empty — the game dies with it. This is the guarantee that game
    // state is ephemeral: nothing outlives the room it belonged to.
    await purgeGame(target.scope)
    io.to(left.roomId).emit('game:closed')
  } else {
    // Someone is still here. End any running game as a forfeit rather than
    // leaving them staring at a board that can never advance.
    const forfeited = await forfeitGame(target.scope, left.peer.sessionId)
    if (forfeited) {
      await broadcastGame(target, forfeited.stored, forfeited.definition)
    }
  }

  await socket.leave(left.roomId)
}

/**
 * Remove a socket from its lobby and tell the remaining seats.
 *
 * THE SEAT IS FREED IMMEDIATELY, ALWAYS. That is not just courtesy to a table
 * at capacity — it is what makes reconnecting work at all. A seat is keyed by
 * socketId and a socketId does not survive a dropped connection, whereas game
 * participation is keyed by sessionId and does. A player who comes back takes a
 * new seat and keeps their old role.
 *
 * WHAT DOES NOT HAPPEN ANY MORE is forfeiting the game. A lobby game has four
 * to eight people in it, and ending the round because one person's wifi blinked
 * is not a reasonable reading of what happened. Instead their reconnect window
 * opens; if it runs out, the sweeper eliminates them and the game carries on
 * without them. `forfeit` still applies to a two-person video room, where there
 * is no third party left to spoil the game for.
 *
 * An explicit `lobby:leave` comes through here too, and gets the same grace.
 * Deliberate: the client emits `lobby:leave` from its unmount cleanup, so
 * treating it as a hard quit would deny the window to a page refresh — the most
 * common reason anyone needs to reconnect in the first place.
 */
async function detachLobby(socket: AppSocket): Promise<void> {
  const left = await leaveLobby(socket.id)
  socket.data.lobbyId = undefined

  if (!left) return

  const target = lobbyTarget(left.lobbyId)

  io.to(target.scope)
    .except(socket.id)
    .emit('lobby:member-left', {
      socketId: left.member.socketId,
      sessionId: left.member.sessionId,
    })

  if (left.remaining === 0) {
    // Nobody left to reconnect TO. The game dies with the table, which is the
    // ephemerality guarantee the engine documents.
    await purgeGame(target.scope)
    io.to(target.scope).emit('game:closed')
  } else {
    await openReconnectWindow(target, left.member.sessionId)
  }

  await socket.leave(target.scope)

  // A freed seat — or a table that just emptied and was delisted — changes what
  // the browser should be showing.
  await publishOpenTables()
}

/**
 * Start counting down on a player who has left a table with a game running.
 *
 * SKIPPED WHEN THEY ARE STILL SEATED under another socket. A reconnecting
 * browser opens its new connection before the old one is reaped often enough to
 * matter, and without this check that ordering would arm an elimination against
 * a player who is demonstrably present. Checking membership rather than
 * assuming an order closes both interleavings: arrive-then-drop never arms,
 * and drop-then-arrive is disarmed by `lobby:join`.
 *
 * `markDisconnected` returns null for everything else not worth a countdown —
 * no game, a finished one, a mid-game watcher, or a window already open.
 */
async function openReconnectWindow(
  target: GameTarget,
  sessionId: string,
): Promise<void> {
  if (await isSeated(target, sessionId)) return

  const opened = await markDisconnected(
    target.scope,
    sessionId,
    env.disconnectGraceMs,
  )
  if (!opened) return

  // Read back after writing. A reconnect landing between the membership check
  // above and the write just made would otherwise leave a player who is sitting
  // at the table counting down to elimination — narrow, but the failure is
  // silent and thirty seconds later.
  if (await isSeated(target, sessionId)) {
    await closeReconnectWindow(target, sessionId)
    return
  }

  // Broadcast so the table sees "reconnecting" rather than a seat that has
  // simply stopped responding.
  await broadcastGame(target, opened.stored, opened.definition)
}

async function isSeated(target: GameTarget, sessionId: string): Promise<boolean> {
  return (await membersOf(target)).some((member) => member.sessionId === sessionId)
}

/**
 * Stop counting down, because the player is back.
 *
 * Called from every path that seats someone, so "any join cancels the window"
 * is an invariant rather than an argument about interleavings. Cheap when there
 * is nothing to cancel — `markReconnected` returns null and nothing is sent.
 */
async function closeReconnectWindow(
  target: GameTarget,
  sessionId: string,
): Promise<void> {
  const closed = await markReconnected(target.scope, sessionId)
  if (closed) await broadcastGame(target, closed.stored, closed.definition)
}

/** Whether a socket is still connected, anywhere in the cluster. */
async function isConnected(socketId: string): Promise<boolean> {
  const sockets = await io.in(socketId).fetchSockets()
  return sockets.length > 0
}

function toPeer(entry: QueueEntry): RoomPeer {
  return {
    socketId: entry.socketId,
    sessionId: entry.sessionId,
    nickname: entry.nickname,
    // Queue arrival time doubles as seating order, so whoever waited longer
    // gets to move first.
    joinedAt: entry.queuedAt,
  }
}

/**
 * Pair two waiters into a fresh room and tell them to start negotiating.
 */
async function pairUp(a: QueueEntry, b: QueueEntry): Promise<void> {
  const roomId = generateMatchRoomId()
  const peerA = toPeer(a)
  const peerB = toPeer(b)

  const joinedA = await joinRoom(roomId, peerA)
  const joinedB = await joinRoom(roomId, peerB)

  if (!joinedA.ok || !joinedB.ok) {
    // Should not happen for a freshly generated id, but never strand a waiter:
    // put whoever did get in back on the queue.
    if (joinedA.ok) await leaveRoom(a.socketId)
    if (joinedB.ok) await leaveRoom(b.socketId)
    await requeue(a)
    await requeue(b)
    return
  }

  // Cross-node join: these sockets may live on other processes.
  await io.in(a.socketId).socketsJoin(roomId)
  await io.in(b.socketId).socketsJoin(roomId)

  // Exactly one side offers. See the glare note on MatchFound.
  io.to(a.socketId).emit('match:found', { roomId, peer: peerB, shouldOffer: true })
  io.to(b.socketId).emit('match:found', { roomId, peer: peerA, shouldOffer: false })
}

/**
 * Drain the queue while pairs are available.
 *
 * Entries can be stale — a socket may have vanished without cancelling — so
 * each half is checked for liveness, and a surviving partner is returned to the
 * queue rather than dropped.
 */
async function attemptMatches(): Promise<void> {
  for (;;) {
    const pair = await popPair()
    if (!pair) return

    const [a, b] = pair
    const [aLive, bLive] = await Promise.all([
      isConnected(a.socketId),
      isConnected(b.socketId),
    ])

    if (!aLive && !bLive) continue
    if (!aLive) {
      await requeue(b)
      continue
    }
    if (!bLive) {
      await requeue(a)
      continue
    }

    await pairUp(a, b)
  }
}

// --- Connection ------------------------------------------------------------

io.on('connection', (socket) => {
  const { session } = socket.data

  socket.emit('session:ready', session)

  // --- DUDU wall ---------------------------------------------------------

  socket.on('dudu:subscribe', () => {
    void socket.join(DUDU_ROOM)
  })

  socket.on('dudu:unsubscribe', () => {
    void socket.leave(DUDU_ROOM)
  })

  socket.on('dudu:history', (ack) => {
    if (typeof ack !== 'function') return

    void getWall().then(
      (messages) => ack({ messages }),
      () => ack({ messages: [] }),
    )
  })

  socket.on('dudu:post', (body, ack) => {
    const respond = typeof ack === 'function' ? ack : () => {}

    void postMessage(session, body).then(
      (outcome) =>
        outcome.ok
          ? respond({ ok: true, message: outcome.message })
          : respond({ ok: false, error: outcome.error }),
      (error: unknown) => {
        console.error('[dudu] post failed:', error)
        respond({ ok: false, error: 'moderation-unavailable' })
      },
    )
  })

  // --- Matchmaking -------------------------------------------------------

  socket.on('match:find', (ack) => {
    const respond = typeof ack === 'function' ? ack : () => {}

    void (async () => {
      // Queueing implies abandoning any current call, and any table.
      await detach(socket)
      await detachLobby(socket)

      await enqueue({
        socketId: socket.id,
        sessionId: session.sessionId,
        nickname: session.nickname,
        queuedAt: Date.now(),
      })

      respond({ ok: true, queued: true })
      socket.emit('match:waiting', { position: await queueLength() })

      await attemptMatches()
    })()
  })

  socket.on('match:cancel', (ack) => {
    const respond = typeof ack === 'function' ? ack : () => {}

    void dequeue(socket.id).then((removed) => {
      respond({ ok: removed })
      if (removed) socket.emit('match:cancelled')
    })
  })

  // --- Manual room join --------------------------------------------------

  socket.on('room:join', (roomId, ack) => {
    const respond = typeof ack === 'function' ? ack : () => {}

    void (async () => {
      // One room at a time, and never queued and in a room simultaneously.
      await dequeue(socket.id)
      await detach(socket)
      await detachLobby(socket)

      const peer: RoomPeer = {
        socketId: socket.id,
        sessionId: session.sessionId,
        nickname: session.nickname,
        joinedAt: Date.now(),
      }

      const outcome = await joinRoom(roomId, peer)

      if (!outcome.ok) {
        respond({ ok: false, peers: [], error: outcome.error })
        return
      }

      socket.data.roomId = roomId
      await socket.join(roomId)

      // Existing occupants are told someone arrived, but do NOT offer to them.
      // Only the joiner initiates, which keeps both sides from creating offers
      // at the same time (SDP glare).
      socket.to(roomId).emit('room:peer-joined', peer)

      respond({ ok: true, peers: outcome.peers })
    })()
  })

  socket.on('room:leave', (ack) => {
    void detach(socket).then(() => {
      if (typeof ack === 'function') ack({ ok: true })
    })
  })

  // --- Social-game lobby -------------------------------------------------
  //
  // Eight seats, no WebRTC. A separate membership primitive from the video
  // room, because ROOM_CAPACITY = 2 is a property of a full-mesh P2P call and
  // has nothing to do with how many people can argue in a text game.

  socket.on('lobby:join', (lobbyId, ack) => {
    const respond = typeof ack === 'function' ? ack : () => {}

    void (async () => {
      /**
       * Already here? Say so and stop.
       *
       * This has to come before the detach below. `detachLobby` forfeits a
       * running game for everyone still seated, so a client that emits
       * `lobby:join` twice for the same lobby — a re-mounted effect, a
       * defensive re-join — would silently end the game for three other
       * people. Idempotent rather than an error, because "I want to be at this
       * table" is already true and refusing would make every client track
       * whether it had joined yet.
       */
      const seatedAt = await getSocketLobby(socket.id)

      if (seatedAt === lobbyId) {
        const seated = await getLobbyMembers(lobbyId)

        respond({
          ok: true,
          members: seated.filter((member) => member.socketId !== socket.id),
          you: seated.find((member) => member.socketId === socket.id),
          capacity: LOBBY_CAPACITY,
        })

        // Sitting here is proof of presence, so any countdown against this
        // session is void — even on the idempotent path.
        await closeReconnectWindow(lobbyTarget(lobbyId), session.sessionId)
        return
      }

      // One place at a time: never queued, in a video room, and seated at a
      // table simultaneously.
      await dequeue(socket.id)
      await detach(socket)
      await detachLobby(socket)

      const member: LobbyMember = {
        socketId: socket.id,
        sessionId: session.sessionId,
        nickname: session.nickname,
        joinedAt: Date.now(),
      }

      const outcome = await joinLobby(lobbyId, member)

      if (!outcome.ok) {
        respond({
          ok: false,
          members: [],
          capacity: LOBBY_CAPACITY,
          error: outcome.error,
        })
        return
      }

      socket.data.lobbyId = lobbyId
      const target = lobbyTarget(lobbyId)
      await socket.join(target.scope)

      socket.to(target.scope).emit('lobby:member-joined', member)
      respond({
        ok: true,
        members: outcome.members,
        you: member,
        capacity: LOBBY_CAPACITY,
      })

      // Back inside the grace window? Cancel the elimination first, so the
      // board this player is about to receive already shows them present — and
      // so does everyone else's.
      await closeReconnectWindow(target, session.sessionId)

      // Someone arriving mid-game gets the board immediately, projected for
      // them — otherwise they sit on an empty screen until the next phase.
      const stored = await loadGame(target.scope)
      const definition = stored ? getGameDefinition(stored.gameId) : null

      if (stored && definition) {
        socket.emit('game:state', buildView(stored, definition, session.sessionId))
      }

      await publishOpenTables()
    })()
  })

  socket.on('lobby:leave', (ack) => {
    void detachLobby(socket).then(() => {
      if (typeof ack === 'function') ack({ ok: true })
    })
  })

  /**
   * Browse the open tables.
   *
   * Readable without being in any lobby, which is the point — this is what the
   * `/lobby` page shows before you have picked one. `LobbySummary` carries no
   * roster and no game state precisely because its audience is anyone.
   */
  socket.on('lobby:watch', () => {
    void (async () => {
      await socket.join(LOBBY_BROWSER_ROOM)
      socket.emit('lobby:open-tables', await listOpenLobbies())
    })()
  })

  socket.on('lobby:unwatch', () => {
    void socket.leave(LOBBY_BROWSER_ROOM)
  })

  // --- Board games -------------------------------------------------------
  //
  // Clients submit intent only. The server owns the state, validates every move
  // against it, and is the sole writer — a client that lies about whose turn it
  // is, or fabricates a board, changes nothing.

  socket.on('game:start', (gameId, ack) => {
    const respond = typeof ack === 'function' ? ack : () => {}

    void (async () => {
      const target = await resolveTarget(socket.id)
      if (!target) {
        respond({ ok: false, error: 'not-in-a-room' })
        return
      }

      const members = await membersOf(target)

      /**
       * Only the host deals.
       *
       * The host is whoever sat down first — `membersOf` is ordered by
       * `joinedAt`, so this needs no stored flag and heals itself when the host
       * leaves: the next-earliest seat inherits it rather than the table being
       * stuck with nobody able to start.
       *
       * Lobbies only. A video room holds two people who can see and hear each
       * other; a start race there resolves itself socially, and adding a gate
       * would change behaviour nobody asked to change.
       */
      if (target.kind === 'lobby' && members[0]?.sessionId !== session.sessionId) {
        respond({ ok: false, error: 'not-the-host' })
        return
      }

      const players: GamePlayer[] = members.map((member) => ({
        sessionId: member.sessionId,
        socketId: member.socketId,
        nickname: member.nickname,
      }))

      const outcome = await startGame(target.scope, gameId, players)

      if (!outcome.ok) {
        respond({ ok: false, error: outcome.error })
        return
      }

      respond({ ok: true })
      await broadcastGame(target, outcome.stored, outcome.definition)

      // The table flips to "in progress" in the browser.
      if (target.kind === 'lobby') await publishOpenTables()
    })()
  })

  socket.on('game:move', (move, ack) => {
    const respond = typeof ack === 'function' ? ack : () => {}

    void (async () => {
      const target = await resolveTarget(socket.id)
      if (!target) {
        respond({ ok: false, reason: 'not-in-a-room' })
        return
      }

      // Opportunistic tick before judging the move. A vote arriving in the same
      // instant the phase expires must be validated against the phase that is
      // actually current, not the one the sweeper has not got to yet.
      await advance(target)

      const outcome = await submitMove(target.scope, session.sessionId, move)

      if (!outcome.ok) {
        // The reason travels back to the mover only. Other players are not told
        // that someone attempted an illegal move.
        respond({ ok: false, reason: outcome.reason })
        return
      }

      respond({ ok: true })
      await broadcastGame(target, outcome.stored, outcome.definition)
    })()
  })

  socket.on('game:sync', (ack) => {
    const respond = typeof ack === 'function' ? ack : () => {}

    void (async () => {
      const target = await resolveTarget(socket.id)
      if (!target) {
        respond({ ok: false })
        return
      }

      await advance(target)

      const stored = await loadGame(target.scope)
      const definition = stored ? getGameDefinition(stored.gameId) : null

      if (!stored || !definition) {
        socket.emit('game:closed')
        respond({ ok: false })
        return
      }

      socket.emit('game:state', buildView(stored, definition, session.sessionId))
      respond({ ok: true })
    })()
  })

  /**
   * Table talk.
   *
   * The game decides the audience, the server resolves it to sockets, and the
   * message goes out per recipient. A living player must never receive a
   * `dead`-channel line, and that is enforced here rather than in the UI.
   */
  socket.on('game:chat', (body, ack) => {
    const respond = typeof ack === 'function' ? ack : () => {}

    void (async () => {
      const target = await resolveTarget(socket.id)
      if (!target) {
        respond({ ok: false, error: 'not-in-a-room' })
        return
      }

      await advance(target)

      // Before a game starts — and once one has finished — a lobby falls back
      // to talking among everyone seated. Video rooms get no fallback: they
      // have actual voice, and text chat there would be a second, unrelated
      // feature rather than a gap being filled.
      const waitingRoom =
        target.kind === 'lobby'
          ? {
              channel: 'lobby',
              to: (await membersOf(target)).map((member) => member.sessionId),
            }
          : null

      const outcome = await composeChat(target.scope, session, body, waitingRoom)

      if (!outcome.ok) {
        respond({ ok: false, error: outcome.error })
        return
      }

      for (const socketId of await socketsFor(target, outcome.to)) {
        io.to(socketId).emit('game:chat-message', outcome.message)
      }

      respond({ ok: true })
    })()
  })

  // --- WebRTC signalling relay -------------------------------------------
  //
  // The server never parses SDP or touches media — it forwards sealed envelopes
  // between two sockets it has confirmed share a room.

  socket.on('webrtc:offer', (payload) => {
    if (!isDescription(payload?.description)) return

    void canRelay(socket.id, payload.target).then((allowed) => {
      if (!allowed) return
      io.to(payload.target).emit('webrtc:offer', {
        from: socket.id,
        description: payload.description,
      })
    })
  })

  socket.on('webrtc:answer', (payload) => {
    if (!isDescription(payload?.description)) return

    void canRelay(socket.id, payload.target).then((allowed) => {
      if (!allowed) return
      io.to(payload.target).emit('webrtc:answer', {
        from: socket.id,
        description: payload.description,
      })
    })
  })

  socket.on('webrtc:ice-candidate', (payload) => {
    if (!isCandidate(payload?.candidate)) return

    void canRelay(socket.id, payload.target).then((allowed) => {
      if (!allowed) return
      io.to(payload.target).emit('webrtc:ice-candidate', {
        from: socket.id,
        candidate: payload.candidate,
      })
    })
  })

  socket.on('disconnect', (reason) => {
    void (async () => {
      await dequeue(socket.id)
      await detach(socket)
      await detachLobby(socket)

      if (!env.isProduction) {
        console.log(`[socket] ${session.nickname} disconnected (${reason})`)
      }
    })()
  })
})

/**
 * Wall fan-out.
 *
 * Messages are published to Redis by whichever node accepted the post, and
 * every node relays them to its own subscribers. That is what lets the wall
 * work with more than one server process.
 */
const duduSubscriber = createSubscriber('dudu-sub')

await duduSubscriber.subscribe(keys.duduChannel)

duduSubscriber.on('message', (channel: string, payload: string) => {
  if (channel !== keys.duduChannel) return

  try {
    const message = JSON.parse(payload) as DuduBroadcast
    io.to(DUDU_ROOM).emit('dudu:message', message)
  } catch {
    console.error('[redis] dropped malformed DUDU payload')
  }
})

/**
 * Deadline sweeper.
 *
 * Timed phases — Mr. White's 90-second discussion, its 45-second vote — have to
 * expire even when nobody sends anything. Every node runs this; duplicate work
 * is harmless because `tickGame` goes through the same compare-and-set as a
 * move, and the loser of the race re-reads and finds nothing left to do.
 *
 * Cost is proportional to games actually DUE, not games running: untimed games
 * never enter the index at all, so a server full of Tic-Tac-Toe sweeps nothing.
 *
 * Granularity means a phase can end up to a second late. That is fine for a
 * social game — the countdown is advisory, and the server stays authoritative
 * on whether a move arrived in time.
 *
 * It sweeps two indexes on the same interval: phase deadlines, and reconnect
 * windows that have run out. Both are stored the same way and for the same
 * reason — a `setTimeout` would die with the process and would not exist on the
 * other nodes.
 */
const SWEEP_INTERVAL_MS = 1_000

/** Which primitive a game scope belongs to, for the sweeper's fan-out. */
function targetOf(scope: string): GameTarget {
  return gameScope.isLobby(scope)
    ? lobbyTarget(gameScope.lobbyIdOf(scope))
    : roomTarget(scope)
}

async function sweepDeadlines(): Promise<void> {
  for (const scope of await dueGames()) {
    const ticked = await tickGame(scope)
    if (!ticked) continue

    await broadcastGame(targetOf(scope), ticked.stored, ticked.definition)
  }
}

/**
 * Give up on players whose reconnect window has run out.
 *
 * Separate pass from the phase sweep, and run first: eliminating a missing
 * player can itself close the phase they were holding up — the last outstanding
 * vote, the clue nobody could follow — and doing it before the deadline sweep
 * means the table sees one transition rather than two in consecutive seconds.
 */
async function sweepDisconnects(): Promise<void> {
  for (const { scope, sessionId } of await dueDisconnects()) {
    const expired = await expireDisconnect(scope, sessionId)
    if (!expired) continue

    await broadcastGame(targetOf(scope), expired.stored, expired.definition)
  }
}

const sweeper = setInterval(() => {
  void (async () => {
    await sweepDisconnects()
    await sweepDeadlines()
  })().catch((error: unknown) => {
    console.error('[sweeper] tick failed:', error)
  })
}, SWEEP_INTERVAL_MS)

/** Managed Redis URLs carry a password; deploy logs are not a secret store. */
function redactCredentials(url: string): string {
  try {
    const parsed = new URL(url)
    if (parsed.password) parsed.password = '***'
    return parsed.toString()
  } catch {
    return '<unparseable REDIS_URL>'
  }
}

httpServer.listen(env.port, () => {
  console.log(`[server] Socket.io listening on port ${env.port}`)
  console.log(
    `[server] accepting browser origins: ${env.corsOrigin.join(', ')}`,
  )
  console.log(
    `[server] Redis adapter attached at ${redactCredentials(env.redisUrl)}`,
  )
})

async function shutdown(signal: string): Promise<void> {
  console.log(`[server] ${signal} received, shutting down`)

  clearInterval(sweeper)
  await io.close()
  await duduSubscriber.quit()
  await closeRedis()
  httpServer.close()

  process.exit(0)
}

process.on('SIGINT', () => void shutdown('SIGINT'))
process.on('SIGTERM', () => void shutdown('SIGTERM'))
