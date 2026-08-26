'use client'

import { useState } from 'react'
import { useRouter } from 'next/navigation'

import { SHELL, SystemNote } from '@/components/site-chrome'
import {
  asMrWhite,
  canChat as canChatMrWhite,
  isAlive as isAliveMrWhite,
  mrWhiteSummary,
} from '@/lib/game/mr-white-view'
import { waitingSummary } from '@/lib/game/table-view'
import { useGame } from '@/lib/game/use-game'
import { useGameChat } from '@/lib/game/use-game-chat'
import {
  asWerewolf,
  canChat as canChatWerewolf,
  isAlive as isAliveWerewolf,
  werewolfSummary,
} from '@/lib/game/werewolf-view'
import { useLobby } from '@/lib/lobby/use-lobby'

import { ChatPanel } from './chat-panel'
import { EYEBROW } from './controls'
import { GamePicker, LOBBY_GAMES } from './game-picker'
import { MrWhiteActions } from './mr-white-actions'
import { PhaseBanner } from './phase-banner'
import { PlayerRail } from './player-rail'
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
 * The furniture — banner, rail, chat — reads `TableSummary`, which both games
 * project themselves down to. Only the ROLE CARD and the ACTION PANEL are
 * game-specific, which is right: those two are the game.
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
          className="mt-6 border-2 border-ink px-5 py-2.5 font-mono text-sm text-ink transition-colors hover:bg-yellow"
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
        seated={members.length}
        capacity={capacity}
        onLeave={handleLeave}
      />

      <div className="mt-6 grid gap-5 lg:grid-cols-[15rem_minmax(0,1fr)_19rem]">
        {/* On a narrow screen the clock and your own move come first — they are
            what a player under a 45-second deadline is actually looking for. */}
        <div className="order-1 space-y-5 lg:order-3">
          <PhaseBanner
            phaseLabel={summary.phaseLabel}
            phaseSeconds={summary.phaseSeconds}
            roundLabel={summary.roundLabel}
            phaseEndsAt={summary.phaseEndsAt}
            serverNow={summary.serverNow}
            finished={summary.finished}
          />

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
            />
          )}

          {werewolf && <WerewolfRoleCard table={werewolf} you={you} />}

          {/* The action panel for whatever is running — or, before the deal,
              for whatever the host has picked, so the start gate explains that
              game's seat requirement rather than a generic one. */}
          {gameId === 'mr-white' ? (
            <MrWhiteActions
              table={mrWhite}
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

        <div className="order-2 lg:order-1">
          <PlayerRail summary={summary} you={you} started={started} />
        </div>

        <div className="order-3 lg:order-2">
          <ChatPanel
            entries={entries}
            you={you}
            phaseLabel={summary.phaseLabel}
            open={chatOpen}
            deadChannel={started && !alive}
            error={chatError}
            onSend={send}
          />
        </div>
      </div>
    </div>
  )
}


