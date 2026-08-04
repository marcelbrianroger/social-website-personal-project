import type { AnonymousSession } from './session.js'

/**
 * The socket wire protocol.
 *
 * MIRRORED by `lib/socket/events.ts` in the Next.js app. `/server` is a separate
 * package with its own build, so the frontend cannot import from here. If you
 * add or rename an event, change both files.
 *
 * Naming: `namespace:verb`. Server-authored events use past tense
 * (`peer-joined`) so they read as facts, not requests.
 */

/** A participant in a room, as seen by other participants. */
export interface RoomPeer {
  /** Socket id — the address for WebRTC signalling. Changes on reconnect. */
  socketId: string
  /** Stable anonymous identity from the session cookie. */
  sessionId: string
  nickname: string
  /**
   * Epoch ms of joining.
   *
   * Members are stored in a Redis HASH, and HVALS returns fields in arbitrary
   * order — so without this, "who is player one" would be unpredictable and
   * could differ between reads. Game seating order depends on it.
   */
  joinedAt: number
}

/** WebRTC session description, narrowed to what we actually relay. */
export interface SignalDescription {
  type: 'offer' | 'answer'
  sdp: string
}

/** Minimal ICE candidate shape. Matches RTCIceCandidateInit. */
export interface SignalCandidate {
  candidate: string
  sdpMid?: string | null
  sdpMLineIndex?: number | null
  usernameFragment?: string | null
}

export interface JoinResult {
  ok: boolean
  /** Peers already in the room. The joiner initiates an offer to each. */
  peers: RoomPeer[]
  /** Present only when `ok` is false. */
  error?: string
}

export interface DuduBroadcast {
  id: string
  nickname: string
  body: string
  createdAt: string
  expiresAt: string
}

/** Sent to both halves of a pair the instant matchmaking finds one. */
export interface MatchFound {
  roomId: string
  peer: RoomPeer
  /**
   * Exactly one side of the pair is told to offer. Without a server-assigned
   * role both would create offers at once and the negotiation would deadlock
   * (SDP glare) — there is no "joiner" here to break the tie the way there is
   * for a manual join.
   */
  shouldOffer: boolean
}

export interface PostResult {
  ok: boolean
  message?: DuduBroadcast
  error?: string
}

/**
 * A seat in a social-game lobby.
 *
 * Same shape as RoomPeer and deliberately a separate type: a lobby has no
 * WebRTC, so `socketId` here is only an address for per-recipient emits, never
 * a signalling target. Merging the two would invite someone to pass a lobby
 * member to `canRelay`.
 */
export interface LobbyMember {
  socketId: string
  sessionId: string
  nickname: string
  /** Epoch ms of joining. Fixes seat order, which the clue rotation walks. */
  joinedAt: number
}

/**
 * One open table, as shown in the browser on `/lobby`.
 *
 * Deliberately thin: an id, how full it is, and who opened it. No roster and no
 * game state — anyone can watch this list without being in the lobby, so it
 * must not carry anything a player inside would consider private.
 */
export interface LobbySummary {
  lobbyId: string
  seated: number
  capacity: number
  /** A game is already running. You may still join, but you will be watching. */
  inProgress: boolean
  /** Host nickname, so a table someone told you about is recognisable. */
  host: string | null
}

export interface LobbyJoinResult {
  ok: boolean
  /** Everyone already seated. Does NOT include the caller — see `you`. */
  members: LobbyMember[]
  /**
   * The caller's own seat, exactly as the server stored it.
   *
   * Returned so the client never has to invent its own `joinedAt`. Seat order
   * decides both the clue rotation and who the host is, and a client clock
   * minutes out of step would sort the roster wrong and show the wrong person
   * holding the Start button.
   */
  you?: LobbyMember
  capacity: number
  error?: string
}

/**
 * One chat line, already scoped to its audience.
 *
 * Never persisted, never replayed on reconnect, and never part of game state —
 * so it does not bump the game version. A player who drops during discussion
 * loses the argument so far, which is the accepted cost of keeping chat out of
 * the state machine.
 */
export interface ChatMessage {
  id: string
  /** sessionId of the sender. */
  from: string
  nickname: string
  body: string
  /** Which audience this went to, e.g. 'table' or 'dead'. */
  channel: string
  /** Epoch ms. */
  at: number
}

export interface ChatResult {
  ok: boolean
  error?: string
}

export type { GameView } from './games/types.js'

/**
 * Ultimate Tic-Tac-Toe's slice of the wire.
 *
 * Re-exported from the rules rather than restated, so the shape the client
 * narrows `GameView.state` to is literally the shape the server computes. The
 * frontend mirrors these in `lib/socket/events.ts` — the two packages build
 * separately, so that copy has to be kept in step by hand.
 */
export type {
  BoardOutcome,
  CellMove,
  Mark,
  TicTacToeState,
} from './games/tic-tac-toe.js'

export interface MoveResult {
  ok: boolean
  /**
   * Why the move was refused, e.g. 'not-your-turn', 'cell-taken', or — in
   * Ultimate Tic-Tac-Toe — 'wrong-board' and 'board-closed'.
   */
  reason?: string
}

export interface StartGameResult {
  ok: boolean
  error?: string
}

export interface ServerToClientEvents {
  'session:ready': (session: AnonymousSession) => void
  'dudu:message': (message: DuduBroadcast) => void

  /** Someone joined the room you are in. You do NOT offer to them — they offer to you. */
  'room:peer-joined': (peer: RoomPeer) => void
  'room:peer-left': (peer: Pick<RoomPeer, 'socketId' | 'sessionId'>) => void

  'webrtc:offer': (payload: { from: string; description: SignalDescription }) => void
  'webrtc:answer': (payload: { from: string; description: SignalDescription }) => void
  'webrtc:ice-candidate': (payload: { from: string; candidate: SignalCandidate }) => void

  'match:waiting': (payload: { position: number }) => void
  'match:found': (payload: MatchFound) => void
  'match:cancelled': () => void

  /**
   * The authoritative game state, already projected for this recipient.
   * Emitted per-socket rather than to the room, because two players in the same
   * room can legitimately receive different views (hidden roles).
   */
  'game:state': (view: import('./games/types.js').GameView) => void
  /** The room's game was purged — nothing is running any more. */
  'game:closed': () => void

  'lobby:member-joined': (member: LobbyMember) => void
  'lobby:member-left': (member: Pick<LobbyMember, 'socketId' | 'sessionId'>) => void

  /** The open-table list, pushed to watchers whenever it changes. */
  'lobby:open-tables': (lobbies: LobbySummary[]) => void

  /**
   * A chat line the recipient is entitled to hear.
   *
   * Emitted per socket after `chatAudience` resolves who may hear it — never
   * with a room-wide broadcast, because the whole point of the `dead` channel
   * is that the living must not receive it.
   */
  'game:chat-message': (message: ChatMessage) => void
}

export interface ClientToServerEvents {
  'dudu:subscribe': () => void
  'dudu:unsubscribe': () => void
  'dudu:post': (body: string, ack: (result: PostResult) => void) => void
  'dudu:history': (ack: (result: { messages: DuduBroadcast[] }) => void) => void

  'room:join': (roomId: string, ack: (result: JoinResult) => void) => void
  'room:leave': (ack?: (result: { ok: boolean }) => void) => void

  'match:find': (ack: (result: { ok: boolean; queued: boolean }) => void) => void
  'match:cancel': (ack?: (result: { ok: boolean }) => void) => void

  'lobby:join': (lobbyId: string, ack: (result: LobbyJoinResult) => void) => void
  'lobby:leave': (ack?: (result: { ok: boolean }) => void) => void
  /** Subscribe to the open-table list. The current list arrives immediately. */
  'lobby:watch': () => void
  'lobby:unwatch': () => void

  'game:start': (gameId: string, ack: (result: StartGameResult) => void) => void
  /** Submit move *intent*. The server decides whether it is legal. */
  'game:move': (move: unknown, ack: (result: MoveResult) => void) => void
  /** Re-request the current view, e.g. after a reconnect. */
  'game:sync': (ack: (result: { ok: boolean }) => void) => void
  /** Say something. The game's `chatAudience` decides who hears it. */
  'game:chat': (body: string, ack: (result: ChatResult) => void) => void

  'webrtc:offer': (payload: { target: string; description: SignalDescription }) => void
  'webrtc:answer': (payload: { target: string; description: SignalDescription }) => void
  'webrtc:ice-candidate': (payload: { target: string; candidate: SignalCandidate }) => void
}

export interface SocketData {
  session: AnonymousSession
  /**
   * Local cache of the current room, used only for cheap logging and cleanup
   * hints. It is NOT authoritative: matchmaking can place a socket on another
   * node into a room, and that node's `socket.data` would never learn about it.
   * Relay authorisation always reads Redis — see rooms.ts.
   */
  roomId?: string
  /** Same caveat as `roomId`: a hint for logging, never authoritative. */
  lobbyId?: string
}
