'use client'

import { useRouter } from 'next/navigation'

import { SystemNote } from '@/app/chrome'
import { asMrWhite, canChat, isAlive } from '@/lib/game/mr-white-view'
import { useGame } from '@/lib/game/use-game'
import { useGameChat } from '@/lib/game/use-game-chat'
import { useLobby } from '@/lib/lobby/use-lobby'

import { ChatPanel } from './chat-panel'
import { EYEBROW } from './controls'
import { MrWhiteActions } from './mr-white-actions'
import { PhaseBanner } from './phase-banner'
import { PlayerRail } from './player-rail'
import { RoleCard } from './role-card'
import { RoomHeader } from './room-header'

/**
 * The Mr. White table.
 *
 * Three hooks, one socket. `useLobby` owns the connection and membership;
 * `useGame` and `useGameChat` ride it. That sharing is not an optimisation — a
 * second socket would have a different id and therefore different lobby
 * membership, so the server would refuse its moves and never route it chat.
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
  const table = asMrWhite(view)

  const {
    entries,
    error: chatError,
    send,
  } = useGameChat(socket, table?.phase ?? null, table?.serverNow ?? 0)

  const you = session?.sessionId ?? null
  const alive = table && you ? isAlive(table, you) : true

  function handleLeave() {
    leave()
    router.push('/')
  }

  // --------------------------------------------------------------- gates

  if (lobbyPhase === 'error') {
    return (
      <div className={`${TABLE_SHELL} py-16`}>
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
      <div className={`${TABLE_SHELL} py-16`}>
        <p className={EYEBROW}>mr. white · lobby</p>
        <p className="mt-3 font-mono text-sm text-ink-soft">
          {lobbyPhase === 'connecting' ? 'Connecting…' : 'Taking a seat…'}
        </p>
      </div>
    )
  }

  // ---------------------------------------------------------------- table

  return (
    <div className={`${TABLE_SHELL} py-10 sm:py-14`}>
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
            phase={table?.phase ?? null}
            round={table?.round ?? 0}
            phaseEndsAt={table?.phaseEndsAt ?? null}
            serverNow={table?.serverNow ?? 0}
          />

          {table && (
            <RoleCard
              role={table.yourRole}
              secretWord={table.secretWord}
              eliminated={!alive}
              revealed={table.phase === 'finished'}
            />
          )}

          <MrWhiteActions
            table={table}
            you={you}
            seated={members.length}
            isHost={host !== null && host.sessionId === you}
            hostNickname={host?.nickname ?? null}
            starting={starting}
            onStart={() => start('mr-white')}
            onMove={move}
            rejection={rejection}
          />
        </div>

        <div className="order-2 lg:order-1">
          <PlayerRail table={table} members={members} you={you} />
        </div>

        <div className="order-3 lg:order-2">
          <ChatPanel
            entries={entries}
            you={you}
            phase={table?.phase ?? null}
            open={canChat(table, you)}
            deadChannel={!alive}
            error={chatError}
            onSend={send}
          />
        </div>
      </div>
    </div>
  )
}

/**
 * Wider than `chrome.tsx`'s `SHELL`.
 *
 * `max-w-5xl` is right for reading and wrong for three live panes — at 64rem
 * the roster and the controls both fall under 15rem and the chat stops being
 * usable. The gutter is kept identical so this page still measures from the
 * same edge as every other route.
 */
const TABLE_SHELL = 'mx-auto w-full max-w-7xl px-5 sm:px-8'
