'use client'

import { useState } from 'react'
import { useRouter } from 'next/navigation'

import { SHELL, SystemNote } from '@/components/site-chrome'
import {
  asMrWhite,
  canChat as canChatMrWhite,
  chatAudienceLabel as audienceMrWhite,
  isAlive as isAliveMrWhite,
  isPlaying as isPlayingMrWhite,
  mrWhiteSummary,
} from '@/lib/game/mr-white-view'
import { waitingFor, waitingSummary } from '@/lib/game/table-view'
import { useGame } from '@/lib/game/use-game'
import { useGameChat } from '@/lib/game/use-game-chat'
import {
  asWerewolf,
  canChat as canChatWerewolf,
  chatAudienceLabel as audienceWerewolf,
  isAlive as isAliveWerewolf,
  isPlaying as isPlayingWerewolf,
  werewolfSummary,
} from '@/lib/game/werewolf-view'
import { useLobby } from '@/lib/lobby/use-lobby'

import { ChatPanel } from './chat-panel'
import { EYEBROW } from './controls'
import { GamePicker, LOBBY_GAMES } from './game-picker'
import { MrWhiteActions } from './mr-white-actions'
import { RoleCard } from './role-card'
import { RoomHeader } from './room-header'
import { WerewolfActions } from './werewolf-actions'
import { WerewolfRoleCard } from './werewolf-role-card'

/**
 * The table. Mr. White or Werewolf, in the same room.
 *
 * Three hooks, one socket. `useLobby` owns the connection and membership;
 * `useGame` and `useGameChat` ride it. That sharing is not an optimisation — a
 * second socket would have a different id and therefore different lobby
 * membership, so the server would refuse its moves and never route it chat.
 *
 * HOW TWO GAMES SHARE ONE ROOM. Exactly one `asX` narrower returns non-null for
 * a given payload, because each checks `view.gameId` before trusting `state`.
 * So the two tables below are mutually exclusive by construction rather than by
 * an `if` anyone has to maintain, and a third game would add a third narrower
 * that is null whenever the other two are not.
 *
 * The furniture — the board, the clock, the chat — reads `TableSummary`, which
 * both games project themselves down to. Only the ROLE CARD and the MOVE PANEL
 * are game-specific, which is right: those two are the game.
 *
 * THE ROOM IS THREE PLACES, and the split is the thing to keep.
 *
 *   the table   the board, everyone at it, and the clock. You POINT here: every
 *               choice aimed at a person is made by clicking their chair.
 *   your hand   the role card and what it privately carries. Yours alone.
 *   the talk    chat, which for half of Werewolf is the entire game.
 *
 * The move panel sits under the board rather than beside it because it is the
 * caption to what the board is asking, not a separate control surface — and
 * each game renders its own board, since only the game knows which chairs are
 * live and what a click on one means. See `table-stage.tsx`.
 *
 * There is no local game logic here, not even an optimistic phase change. The
 * server is the only writer and `view` is always exactly what it last sent;
 * predicting a transition locally would let the two diverge, which is the whole
 * thing a server-authoritative engine exists to prevent.
 */
export function LobbyClient({ lobbyId }: { lobbyId: string }) {
  const router = useRouter()

  const {
    socket,
    session,
    phase: lobbyPhase,
    error,
    members,
    host,
    capacity,
    leave,
  } = useLobby(lobbyId)

  const { view, rejection, starting, start, move } = useGame(socket, lobbyId)

  /**
   * What the host will deal next.
   *
   * Local, and only the host's copy matters — see `game-picker.tsx` for why
   * this is not lobby state. Werewolf is the default because it is the game
   * this room was rebuilt for; a host who wants the other one clicks once.
   */
  const [chosen, setChosen] = useState<string>(LOBBY_GAMES[0]?.id ?? 'werewolf')

  const mrWhite = asMrWhite(view)
  const werewolf = asWerewolf(view)

  const you = session?.sessionId ?? null

  // One summary, whichever game produced it. Null-game falls back to the lobby
  // roster, because "are we five yet" is the only question before the deal.
  const summary = mrWhite
    ? mrWhiteSummary(mrWhite)
    : werewolf
      ? werewolfSummary(werewolf)
      : waitingSummary(members)

  /**
   * Everyone in the room who is not in the round being played.
   *
   * The lobby keeps taking people while a game runs and the roster is fixed at
   * the deal, so this is real and routinely non-empty. They are dealt in by the
   * next `game:start`, which reads lobby membership rather than the old roster
   * — the waiting is the whole of what they have to do.
   */
  const waiting = waitingFor(members, summary)

  /**
   * Whether YOU are in this round.
   *
   * Not the same question as `alive`, and the difference is load-bearing: a
   * mid-game arrival is in nobody's dead list, so every check written against
   * `isAlive` reads them as a living player and offers them controls the server
   * refuses. See `isPlaying` in either view module.
   */
  const playing = mrWhite
    ? isPlayingMrWhite(mrWhite, you)
    : werewolf
      ? isPlayingWerewolf(werewolf, you)
      : true

  const alive = mrWhite
    ? you
      ? isAliveMrWhite(mrWhite, you)
      : true
    : werewolf
      ? you
        ? isAliveWerewolf(werewolf, you)
        : true
      : true

  const chatOpen = mrWhite
    ? canChatMrWhite(mrWhite, you)
    : werewolf
      ? canChatWerewolf(werewolf, you)
      : true

  /**
   * Who hears the next thing you type.
   *
   * Comes from the game rather than being inferred from `chatOpen`, because the
   * interesting case is the one an open field cannot express: a wolf at night
   * is talking to two people, not to the village.
   */
  const chatAudience = mrWhite
    ? audienceMrWhite(mrWhite, you)
    : werewolf
      ? audienceWerewolf(werewolf, you)
      : 'everyone in the room'

  const {
    entries,
    error: chatError,
    send,
  } = useGameChat(socket, summary.phaseKey, summary.phaseNote, summary.serverNow)

  const started = mrWhite !== null || werewolf !== null
  const isHost = host !== null && host.sessionId === you
  /** A running game pins the id; otherwise it is whatever the host picked. */
  const gameId = mrWhite ? 'mr-white' : werewolf ? 'werewolf' : chosen

  function handleLeave() {
    leave()
    router.push('/')
  }

  // --------------------------------------------------------------- gates

  if (lobbyPhase === 'error') {
    return (
      <div className={`${SHELL} py-16`}>
        <h1
          className="font-display text-2xl leading-tight"
          style={{ fontVariationSettings: "'wght' 800, 'wdth' 95" }}
        >
          Could not sit down
        </h1>
        <SystemNote alert className="mt-5 max-w-xl">
          {error ?? 'Something went wrong joining this lobby.'}
        </SystemNote>
        <button
          type="button"
          onClick={() => router.push('/')}
          className="reg mt-6 border-2 border-ink bg-paper px-5 py-2.5 font-mono text-sm text-ink hover:bg-yellow"
        >
          Back to the start
        </button>
      </div>
    )
  }

  if (lobbyPhase !== 'seated') {
    return (
      <div className={`${SHELL} py-16`}>
        <p className={EYEBROW}>lobby</p>
        <p className="mt-3 font-mono text-sm text-ink-soft">
          {lobbyPhase === 'connecting' ? 'Connecting…' : 'Taking a seat…'}
        </p>
      </div>
    )
  }

  // ---------------------------------------------------------------- table

  return (
    <div className={`${SHELL} py-10 sm:py-14`}>
      <RoomHeader
        lobbyId={lobbyId}
        gameLabel={LOBBY_GAMES.find((game) => game.id === gameId)?.label ?? null}
        seated={members.length}
        capacity={capacity}
        onLeave={handleLeave}
      />

      {/*
        Three panes, placed rather than ordered, because the reading order has
        to change twice on the way up.

          phone   the table (clock on top of it), then the talk, then your hand.
          lg      the table with the talk under it; your hand pinned right.
          xl      the talk takes its own column beside the board.

        Explicit `col-start` / `row-start` rather than `order`: the board wants
        the widest column at every width, and expressing that as a reshuffle of
        a single flow is how it ends up 260px wide on a 1024 screen.

        THE TALK IS WIDER THAN THE HAND, and that is the point. Half of Werewolf
        is an argument; the role card is a thing you read once and check twice.
        Sizing them the same is what made the transcript read as a side panel.
        On a phone it comes second, directly under the board, for the same
        reason — it used to be last, below a role card nobody re-reads.
      */}
      <div className="mt-6 grid gap-5 lg:grid-cols-[minmax(0,1fr)_19rem] xl:grid-cols-[24rem_minmax(0,1fr)_17rem]">
        <div className="space-y-5 lg:col-start-1 lg:row-start-1 xl:col-start-2 xl:row-span-2 xl:row-start-1">
          {gameId === 'mr-white' ? (
            <MrWhiteActions
              table={mrWhite}
              summary={summary}
              waiting={waiting}
              capacity={capacity}
              you={you}
              seated={members.length}
              isHost={isHost}
              hostNickname={host?.nickname ?? null}
              starting={starting}
              onStart={() => start('mr-white')}
              onMove={move}
              rejection={rejection}
            />
          ) : (
            <WerewolfActions
              table={werewolf}
              summary={summary}
              waiting={waiting}
              capacity={capacity}
              you={you}
              seated={members.length}
              isHost={isHost}
              hostNickname={host?.nickname ?? null}
              starting={starting}
              onStart={() => start('werewolf')}
              onMove={move}
              rejection={rejection}
            />
          )}
        </div>

        <div className="lg:col-start-1 lg:row-start-2 xl:col-start-1 xl:row-span-2 xl:row-start-1">
          <ChatPanel
            entries={entries}
            you={you}
            seats={summary.seats}
            phaseLabel={summary.phaseLabel}
            open={chatOpen}
            audience={chatAudience}
            deadChannel={started && playing && !alive}
            waiting={started && !playing}
            error={chatError}
            onSend={send}
          />
        </div>

        <div className="space-y-5 self-start lg:col-start-2 lg:row-span-2 lg:row-start-1 xl:col-start-3">
          {/* Before the deal the host decides what this table is playing. */}
          {!started && (
            <GamePicker
              chosen={chosen}
              seated={members.length}
              isHost={isHost}
              hostNickname={host?.nickname ?? null}
              onChoose={setChosen}
            />
          )}

          {mrWhite && (
            <RoleCard
              role={mrWhite.yourRole}
              secretWord={mrWhite.secretWord}
              eliminated={!alive}
              revealed={mrWhite.phase === 'finished'}
              waiting={!playing}
            />
          )}

          {werewolf && (
            <WerewolfRoleCard table={werewolf} you={you} waiting={!playing} />
          )}
        </div>
      </div>
    </div>
  )
}
