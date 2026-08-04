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

// --- Social-game lobby -----------------------------------------------------

/**
 * A seat in a social-game lobby.
 *
 * Same shape as RoomPeer and deliberately a separate type: a lobby carries no
 * WebRTC, so `socketId` here is only an address for per-recipient emits, never
 * a signalling target.
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
 * carries nothing a player inside would consider private.
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
   * Your own seat, exactly as the server stored it.
   *
   * Use this rather than inventing a `joinedAt` locally: seat order decides
   * both the clue rotation and who the host is, and a browser clock minutes
   * out of step would sort the roster wrong and put the Start button on the
   * wrong person.
   */
  you?: LobbyMember
  /** LOBBY_CAPACITY — 8, against ROOM_CAPACITY = 2 for the video rooms. */
  capacity: number
  error?: string
}

/**
 * One chat line, already scoped to its audience by the server.
 *
 * Never persisted and never replayed on reconnect: a player who drops during a
 * discussion loses the argument so far. That is the accepted cost of keeping
 * chat out of the game state machine.
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

// --- Board games -----------------------------------------------------------

export interface GameResult {
  /**
   * Everyone who won. Empty for a draw, or for a game nobody won.
   *
   * A list rather than a single id because social-deduction games are won by a
   * TEAM: "the civilians" is three or four sessionIds. Tic-Tac-Toe returns a
   * one-element list, or an empty one for a draw.
   */
  winnerSessionIds: string[]
  /** Which side won, for team games. Absent when winning is individual. */
  team?: string
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
  /**
   * sessionIds who may act right now. Empty when nobody may, or when finished.
   *
   * One concept covering sequential and simultaneous play: Tic-Tac-Toe returns
   * the single player whose turn it is, a Mr. White vote returns every living
   * player, and a discussion phase returns nobody.
   */
  actors: string[]
  finished: boolean
  result: GameResult | null
  state: unknown
  /** Epoch ms the current phase ends, or null when the game is untimed. */
  phaseEndsAt: number | null
  /**
   * Server epoch ms at the moment this view was built.
   *
   * A browser clock can be minutes out, so `phaseEndsAt` compared against a raw
   * `Date.now()` shows the wrong number — negative on a fast clock, which reads
   * as "time's up" while the server is still accepting moves. Pin
   * `offset = serverNow - Date.now()` once per push and render against that.
   */
  serverNow: number
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

  // Mr. White. `wrong-phase` is the common one: a 45-second vote can close
  // between the click and the packet arriving.
  'wrong-phase': 'That phase has already moved on.',
  eliminated: 'You are out — the living are deciding this one.',
  'invalid-target': 'That is not someone you can vote for.',
  'target-eliminated': 'They are already out.',
  'not-mr-white': 'Only Mr. White may guess the word.',
  'not-one-word': 'One word only — no spaces.',
  'clue-too-long': 'That is too long for one word.',
}

/** Why joining a lobby failed. */
export const LOBBY_JOIN_ERROR_TEXT: Record<string, string> = {
  'invalid-lobby-id':
    'Lobby ID must be 3–32 characters: letters, digits, dash or underscore.',
  'lobby-full': 'That lobby already has eight people in it.',
  'already-in-lobby': 'You are already at that table.',
}

/** Why a chat message was refused. */
export const CHAT_ERROR_TEXT: Record<string, string> = {
  'chat-closed': 'Chat is closed during this phase.',
  'chat-not-supported': 'There is no chat in this game.',
  'not-a-player': 'You are watching, not playing.',
  'not-in-a-room': 'You are not at a table.',
  'no-game': 'No game is running.',
  'rate-limited': 'Slow down — twenty messages per minute.',
  'malformed-message': 'That message made no sense.',
  'too-short': 'Write something first.',
  'too-long': 'Too long — 280 characters maximum.',
  'links-not-allowed': 'Links are not allowed here.',
  'character-spam': 'That looks like character spam.',
  'excessive-caps': 'Please stop shouting.',
  'blocked-language': 'That message was blocked by moderation.',
  'moderation-unavailable':
    'Moderation is unavailable right now, so nothing can be sent. Try again shortly.',
}

export const START_ERROR_TEXT: Record<string, string> = {
  'not-in-a-room': 'Join a room before starting a game.',
  'unknown-game': 'That game does not exist.',
  'not-the-host': 'Only whoever opened the table can deal.',
  // Deliberately no longer names Tic-Tac-Toe: Mr. White raises the same error
  // and wants four to eight players, so a message about "exactly two" would be
  // actively wrong half the time.
  'wrong-player-count': 'Wrong number of players for that game.',
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

  'lobby:member-joined': (member: LobbyMember) => void
  'lobby:member-left': (member: Pick<LobbyMember, 'socketId' | 'sessionId'>) => void

  /** The open-table list, pushed to watchers whenever it changes. */
  'lobby:open-tables': (lobbies: LobbySummary[]) => void

  /**
   * A chat line this client is entitled to hear.
   *
   * Emitted per socket after the game's `chatAudience` resolves who may hear
   * it — a living player never receives a `dead`-channel message, and that is
   * enforced on the server, not by this client choosing not to render it.
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
  'game:sync': (ack: (result: { ok: boolean }) => void) => void
  /** Say something. The game's `chatAudience` decides who hears it. */
  'game:chat': (body: string, ack: (result: ChatResult) => void) => void

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
