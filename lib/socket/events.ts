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
   * Players currently missing, mapped to the epoch ms at which they are
   * auto-eliminated so the game can carry on without them.
   *
   * Always `{}` once `finished`. Compare against the same skew-corrected clock
   * as `phaseEndsAt` — these are server epoch ms too.
   */
  disconnected: Record<string, number>
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

// --- Ultimate Tic-Tac-Toe --------------------------------------------------

/**
 * MIRRORS `server/src/games/tic-tac-toe.ts`.
 *
 * `GameView.state` is `unknown` because the engine is game-agnostic; this is
 * what a `gameId: 'tic-tac-toe'` view narrows to. Perfect information, so
 * unlike Mr. White nothing is stripped — what the server stores is what every
 * viewer receives.
 */
export type Mark = 'X' | 'O'

/**
 * What has become of one local board.
 *
 * `'draw'` is load-bearing, not decoration: a full board with no line belongs
 * to nobody, yet it is every bit as closed as a won one — you cannot play in
 * it, and being sent to it frees you to go anywhere.
 */
export type BoardOutcome = Mark | 'draw' | null

export interface TicTacToeState {
  /** Nine local boards, each row-major and length 9. `boards[board][cell]`. */
  boards: (Mark | null)[][]
  /** Row-major, length 9. Who owns each local board. */
  globalBoard: BoardOutcome[]
  /** Per local board, the three cells that won it. For highlighting. */
  localWinningLines: (number[] | null)[]
  /**
   * The local board the mover MUST play in, or null for "any open board".
   *
   * The whole game in one field: the cell someone takes names the board their
   * opponent has to answer in. Null is normal — it is the opening position,
   * and it is what happens whenever that named board is already decided.
   */
  activeBoardIndex: number | null
  order: string[]
  turn: number
  winnerSessionId: string | null
  /** LOCAL BOARD indices (0–8) forming the winning line on the global board. */
  winningLine: number[] | null
  draw: boolean
  forfeitedBy: string | null
}

/** Move intent. Both are 0–8; the server decides whether it is legal. */
export interface CellMove {
  board: number
  cell: number
}

// --- 36 Questions ----------------------------------------------------------

/**
 * MIRRORS `server/src/games/thirty-six-questions.ts`.
 *
 * Note what is NOT here: the 36 questions themselves. The server resolves the
 * index into text inside `viewFor`, so there is exactly one copy of the wording
 * and no second list in the browser bundle to drift out of step with it.
 */
export interface ActiveDare {
  /** Index into the server's dare bank. */
  id: number
  text: string
  /** Who owes it. Everyone sees this — the point is that the partner watches. */
  sessionId: string
  /** The question that was refused. */
  questionIndex: number
  /**
   * Epoch ms at which the clock gives up waiting for the partner to confirm.
   *
   * Compare against `GameView.serverNow`, never a raw `Date.now()`: a browser
   * clock minutes out of step would show a dare as expired while the server is
   * still happily accepting the confirmation.
   */
  endsAt: number
}

/**
 * What `GameView.state` narrows to for `gameId: 'thirty-six-questions'`.
 *
 * REDACTED PER VIEWER. The listener's payload does not contain the question at
 * all — the server strips it, so there is nothing to read ahead to in devtools.
 * Do not add a client-side copy of the question bank to "fix" that.
 */
export interface ThirtySixQuestionsProjection {
  questionIndex: number
  /** Length of THIS session's deck — nine, not the 36 in the bank. */
  totalQuestions: number
  /**
   * The current question, and only if it is your turn to read it.
   *
   * Null in three cases the UI must tell apart using `activeTurn` and
   * `finished`: not your turn, deck finished, or you are an observer.
   */
  question: string | null
  /** Which of the three escalating sets this question came from. */
  set: 1 | 2 | 3 | null
  /** sessionId of whoever holds the card. Visibility only — both may act. */
  activeTurn: string | null
  /** sessionId -> refusals still available. */
  vetosRemaining: Record<string, number>
  /** The penalty being served right now, or null. */
  activeDare: ActiveDare | null
  abandonedBy: string | null
}

/**
 * Move intent for 36 Questions.
 *
 * These are moves rather than bespoke `question:*` socket events on purpose:
 * everything a game needs — compare-and-set, versioning, per-viewer projection,
 * forfeit and disconnect handling — already hangs off `game:move`, and a
 * private event per game would mean re-implementing all of it.
 */
export type QuestionMove =
  | { type: 'next' }
  | { type: 'veto' }
  | { type: 'dare-resolved' }

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
  'board-out-of-range': 'That is not a board on the grid.',
  // Ultimate Tic-Tac-Toe's two new ways to be wrong. `wrong-board` is the one
  // players hit constantly while learning the game.
  'wrong-board': 'You have to play in the highlighted board.',
  'board-closed': 'That board is already decided.',
  'malformed-move': 'That move made no sense.',
  'game-finished': 'The game is already over.',
  'not-a-player': 'You are watching, not playing.',
  'not-in-a-room': 'You are not in a room.',
  'no-game': 'No game is running.',
  conflict: 'Someone moved at the same time. Try again.',

  // Mr. White. `wrong-phase` is the common one: a 45-second vote can close
  // between the click and the packet arriving.
  'wrong-phase': 'That phase has already moved on.',
  eliminated: 'You are out. The living are deciding this one.',
  'invalid-target': 'That is not someone you can vote for.',
  'target-eliminated': 'They are already out.',
  'not-mr-white': 'Only Mr. White may guess the word.',
  'not-one-word': 'One word only, no spaces.',
  'clue-too-long': 'That is too long for one word.',

  // 36 Questions. `not-your-dare` is the one that needs explaining: the partner
  // confirms a dare, never the person performing it.
  'dare-in-progress': 'Finish the dare first.',
  'no-vetos-left': 'You have already used your veto.',
  'no-active-dare': 'There is no dare to finish.',
  'not-your-dare': 'Only your partner can say you did it.',
  // Deliberately not the existing 'not-your-turn': it IS your turn to answer,
  // just not your turn to hold the card and move the deck on.
  'not-your-card': 'Only whoever is reading the question can move on.',

  // Werewolf. The three `not-the-*` reasons should be unreachable from the real
  // UI — it only ever draws the control for the role you hold — so seeing one
  // means a hand-crafted packet, and the wording does not need to be gentle.
  'not-a-werewolf': 'Only the pack hunts at night.',
  'not-the-seer': 'Only the Seer may look.',
  'not-the-guard': 'Only the Guard may cover someone.',
  'target-is-pack': 'The pack does not eat its own.',
  'cannot-inspect-self': 'You already know what you are.',
  'already-inspected': 'You have read them before. Spend the night on someone new.',
  'repeat-protection': 'You covered them last night. Someone else tonight.',
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
  'rate-limited': 'Slow down. Twenty messages per minute.',
  'malformed-message': 'That message made no sense.',
  'too-short': 'Write something first.',
  'too-long': 'Too long. 280 characters maximum.',
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
  'rate-limited': 'Slow down. Five posts per minute.',
  'too-short': 'Write something first.',
  'too-long': 'Too long. 280 characters maximum.',
  'links-not-allowed': 'Links are not allowed on the wall.',
  'character-spam': 'That looks like character spam.',
  'excessive-caps': 'Please stop shouting.',
  'blocked-language': 'That message was blocked by moderation.',
  'moderation-unavailable':
    'Moderation is unavailable right now, so nothing can be posted. Try again shortly.',
}

export const MAX_MESSAGE_LENGTH = 280
