import { createServer } from 'node:http'

import { createAdapter } from '@socket.io/redis-adapter'
import { Server, type Socket } from 'socket.io'

import { getWall, postMessage, wallSize } from './dudu.js'
import { env } from './env.js'
import {
  buildView,
  forfeitGame,
  loadGame,
  purgeGame,
  startGame,
  submitMove,
} from './game-engine.js'
import { getGameDefinition } from './games/registry.js'
import type { AnyGameDefinition, GamePlayer, StoredGame } from './games/types.js'
import type {
  ClientToServerEvents,
  DuduBroadcast,
  RoomPeer,
  ServerToClientEvents,
  SignalCandidate,
  SignalDescription,
  SocketData,
} from './events.js'
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
      const [queued, wall] = await Promise.all([queueLength(), wallSize()])
      res.writeHead(200, { 'content-type': 'application/json' })
      res.end(
        JSON.stringify({
          status: 'ok',
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

/**
 * Send the game state to every occupant, projected for each of them.
 *
 * Emitted per-socket rather than with a single `io.to(room)` because two
 * players can legitimately receive different views — `viewFor` strips hidden
 * information per viewer, and a room-wide broadcast would send one player's
 * secrets to everyone.
 */
async function broadcastGame(
  roomId: string,
  stored: StoredGame,
  definition: AnyGameDefinition,
): Promise<void> {
  const members = await getMembers(roomId)

  for (const member of members) {
    io.to(member.socketId).emit(
      'game:state',
      buildView(stored, definition, member.sessionId),
    )
  }
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

  if (left.remaining === 0) {
    // Room is empty — the game dies with it. This is the guarantee that game
    // state is ephemeral: nothing outlives the room it belonged to.
    await purgeGame(left.roomId)
    io.to(left.roomId).emit('game:closed')
  } else {
    // Someone is still here. End any running game as a forfeit rather than
    // leaving them staring at a board that can never advance.
    const forfeited = await forfeitGame(left.roomId, left.peer.sessionId)
    if (forfeited) {
      await broadcastGame(left.roomId, forfeited.stored, forfeited.definition)
    }
  }

  await socket.leave(left.roomId)
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
      // Queueing implies abandoning any current call.
      await detach(socket)

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

  // --- Board games -------------------------------------------------------
  //
  // Clients submit intent only. The server owns the state, validates every move
  // against it, and is the sole writer — a client that lies about whose turn it
  // is, or fabricates a board, changes nothing.

  socket.on('game:start', (gameId, ack) => {
    const respond = typeof ack === 'function' ? ack : () => {}

    void (async () => {
      const roomId = await getSocketRoom(socket.id)
      if (!roomId) {
        respond({ ok: false, error: 'not-in-a-room' })
        return
      }

      const members = await getMembers(roomId)
      const players: GamePlayer[] = members.map((member) => ({
        sessionId: member.sessionId,
        socketId: member.socketId,
        nickname: member.nickname,
      }))

      const outcome = await startGame(roomId, gameId, players)

      if (!outcome.ok) {
        respond({ ok: false, error: outcome.error })
        return
      }

      respond({ ok: true })
      await broadcastGame(roomId, outcome.stored, outcome.definition)
    })()
  })

  socket.on('game:move', (move, ack) => {
    const respond = typeof ack === 'function' ? ack : () => {}

    void (async () => {
      const roomId = await getSocketRoom(socket.id)
      if (!roomId) {
        respond({ ok: false, reason: 'not-in-a-room' })
        return
      }

      const outcome = await submitMove(roomId, session.sessionId, move)

      if (!outcome.ok) {
        // The reason travels back to the mover only. Other players are not told
        // that someone attempted an illegal move.
        respond({ ok: false, reason: outcome.reason })
        return
      }

      respond({ ok: true })
      await broadcastGame(roomId, outcome.stored, outcome.definition)
    })()
  })

  socket.on('game:sync', (ack) => {
    const respond = typeof ack === 'function' ? ack : () => {}

    void (async () => {
      const roomId = await getSocketRoom(socket.id)
      if (!roomId) {
        respond({ ok: false })
        return
      }

      const stored = await loadGame(roomId)
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

httpServer.listen(env.port, () => {
  console.log(`[server] Socket.io listening on http://localhost:${env.port}`)
  console.log(`[server] accepting browser origin ${env.corsOrigin}`)
  console.log(`[server] Redis adapter attached at ${env.redisUrl}`)
})

async function shutdown(signal: string): Promise<void> {
  console.log(`[server] ${signal} received, shutting down`)

  await io.close()
  await duduSubscriber.quit()
  await closeRedis()
  httpServer.close()

  process.exit(0)
}

process.on('SIGINT', () => void shutdown('SIGINT'))
process.on('SIGTERM', () => void shutdown('SIGTERM'))
