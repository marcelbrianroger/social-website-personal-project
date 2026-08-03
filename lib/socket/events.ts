/**
 * The socket wire protocol, client side.
 *
 * MIRRORS `server/src/events.ts`. The two are duplicated rather than shared
 * because `/server` is a separate npm package with its own build — importing
 * across that boundary would couple the two builds together. If you add or
 * rename an event, change both files.
 */

export interface AnonymousSession {
  sessionId: string
  nickname: string
}

export interface RoomPeer {
  /** Socket id — the address for WebRTC signalling. Changes on reconnect. */
  socketId: string
  sessionId: string
  nickname: string
  /** Epoch ms of joining. Determines seating order in games. */
  joinedAt: number
}

export interface SignalDescription {
  type: 'offer' | 'answer'
  sdp: string
}

export interface SignalCandidate {
  candidate: string
  sdpMid?: string | null
  sdpMLineIndex?: number | null
  usernameFragment?: string | null
}

export interface JoinResult {
  ok: boolean
  peers: RoomPeer[]
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
  /** Exactly one side of the pair is told to offer, so neither glares. */
  shouldOffer: boolean
}

export interface PostResult {
  ok: boolean
  message?: DuduBroadcast
  error?: string
}

// --- Board games -----------------------------------------------------------

export interface GameResult {
  /** Winner's sessionId, or null for a draw. */
  winnerSessionId: string | null
  reason: 'win' | 'draw' | 'forfeit'
}

/**
 * The authoritative game state, already projected for this viewer.
 *
 * `state` is deliberately `unknown`: the engine is game-agnostic, and each
 * game's UI narrows it to its own shape. It also carries only what this viewer
 * is allowed to see — the server strips hidden information before sending.
 */
export interface GameView {
  gameId: string
  label: string
  version: number
  players: Array<{ sessionId: string; nickname: string }>
  /** sessionId whose turn it is, or null when finished. */
  currentTurn: string | null
  finished: boolean
  result: GameResult | null
  state: unknown
}

export interface MoveResult {
  ok: boolean
  reason?: string
}

export interface StartGameResult {
  ok: boolean
  error?: string
}

/** Why a move was refused, in words a player can act on. */
export const MOVE_ERROR_TEXT: Record<string, string> = {
  'not-your-turn': "It's not your turn.",
  'cell-taken': 'That square is already taken.',
  'cell-out-of-range': 'That is not a square on the board.',
  'malformed-move': 'That move made no sense.',
  'game-finished': 'The game is already over.',
  'not-a-player': 'You are watching, not playing.',
  'not-in-a-room': 'You are not in a room.',
  'no-game': 'No game is running.',
  conflict: 'Someone moved at the same time. Try again.',
}

export const START_ERROR_TEXT: Record<string, string> = {
  'not-in-a-room': 'Join a room before starting a game.',
  'unknown-game': 'That game does not exist.',
  'wrong-player-count': 'Tic-Tac-Toe needs exactly two players in the room.',
}

export interface ServerToClientEvents {
  'session:ready': (session: AnonymousSession) => void
  'dudu:message': (message: DuduBroadcast) => void

  'room:peer-joined': (peer: RoomPeer) => void
  'room:peer-left': (peer: Pick<RoomPeer, 'socketId' | 'sessionId'>) => void

  'webrtc:offer': (payload: { from: string; description: SignalDescription }) => void
  'webrtc:answer': (payload: { from: string; description: SignalDescription }) => void
  'webrtc:ice-candidate': (payload: { from: string; candidate: SignalCandidate }) => void

  'match:waiting': (payload: { position: number }) => void
  'match:found': (payload: MatchFound) => void
  'match:cancelled': () => void

  'game:state': (view: GameView) => void
  'game:closed': () => void
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

  'game:start': (gameId: string, ack: (result: StartGameResult) => void) => void
  /** Submit move *intent*. The server decides whether it is legal. */
  'game:move': (move: unknown, ack: (result: MoveResult) => void) => void
  'game:sync': (ack: (result: { ok: boolean }) => void) => void

  'webrtc:offer': (payload: { target: string; description: SignalDescription }) => void
  'webrtc:answer': (payload: { target: string; description: SignalDescription }) => void
  'webrtc:ice-candidate': (payload: { target: string; candidate: SignalCandidate }) => void
}

/** Human-readable text for the join failures the server can return. */
export const JOIN_ERROR_TEXT: Record<string, string> = {
  'invalid-room-id':
    'Room ID must be 3–32 characters: letters, digits, dash or underscore.',
  'room-full': 'That room already has two people in it.',
  'already-in-room': 'You are already in that room.',
}

/** Human-readable text for the DUDU post failures the server can return. */
export const POST_ERROR_TEXT: Record<string, string> = {
  'rate-limited': 'Slow down — five posts per minute.',
  'too-short': 'Write something first.',
  'too-long': 'Too long — 280 characters maximum.',
  'links-not-allowed': 'Links are not allowed on the wall.',
  'character-spam': 'That looks like character spam.',
  'excessive-caps': 'Please stop shouting.',
  'blocked-language': 'That message was blocked by moderation.',
  'moderation-unavailable':
    'Moderation is unavailable right now, so nothing can be posted. Try again shortly.',
}

export const MAX_MESSAGE_LENGTH = 280
