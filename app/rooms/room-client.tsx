'use client'

import { useState } from 'react'

import { hasTurnConfigured } from '@/lib/webrtc/ice-config'
import { useP2PRoom } from '@/lib/webrtc/use-p2p-room'

import { GameBoard } from './game-board'
import { VideoTile } from './video-tile'

const PHASE_LABEL: Record<string, string> = {
  idle: 'Not connected',
  'requesting-media': 'Requesting camera…',
  joining: 'Joining room…',
  searching: 'Searching for a match…',
  'in-room': 'In room',
  error: 'Error',
}

export function RoomClient() {
  const {
    socket,
    phase,
    error,
    session,
    roomId,
    peers,
    localStream,
    micEnabled,
    cameraEnabled,
    queuePosition,
    join,
    findMatch,
    cancelMatch,
    leave,
    toggleMic,
    toggleCamera,
  } = useP2PRoom()

  const [input, setInput] = useState('')
  const inRoom = phase === 'in-room'
  const searching = phase === 'searching'
  const busy = phase === 'requesting-media' || phase === 'joining'

  return (
    <div className="mx-auto w-full max-w-4xl px-6 py-12">
      <header className="flex flex-wrap items-baseline justify-between gap-3">
        <div>
          <p className="font-mono text-xs uppercase tracking-[0.2em] text-zinc-500">
            DUDU · P2P Video
          </p>
          <h1 className="mt-2 text-2xl font-semibold tracking-tight text-black dark:text-zinc-50">
            Room test
          </h1>
        </div>

        <div className="text-right text-sm">
          <div className="text-zinc-500">
            {PHASE_LABEL[phase] ?? phase}
            {roomId && <> · <span className="font-mono">{roomId}</span></>}
          </div>
          <div className="font-mono text-xs text-zinc-500">
            {session ? session.nickname : 'connecting…'}
          </div>
        </div>
      </header>

      <section className="mt-8 rounded-xl border border-black/10 p-4 dark:border-white/15">
        <div className="flex flex-wrap items-center justify-between gap-3">
          <div>
            <h2 className="text-sm font-medium text-black dark:text-zinc-100">
              Find a match
            </h2>
            <p className="mt-0.5 text-sm text-zinc-500">
              {searching
                ? `Waiting for a partner${queuePosition ? ` · ${queuePosition} in queue` : ''}…`
                : 'Get paired automatically with whoever is waiting.'}
            </p>
          </div>

          {searching ? (
            <button
              type="button"
              onClick={cancelMatch}
              className="rounded-lg border border-black/15 px-4 py-2 text-sm dark:border-white/15"
            >
              Cancel
            </button>
          ) : (
            <button
              type="button"
              onClick={() => void findMatch()}
              disabled={inRoom || busy}
              className="rounded-lg bg-indigo-600 px-4 py-2 text-sm font-medium text-white hover:bg-indigo-500 disabled:opacity-40"
            >
              Find Match
            </button>
          )}
        </div>
      </section>

      <div className="mt-6 flex items-center gap-3 text-xs uppercase tracking-widest text-zinc-400">
        <span className="h-px flex-1 bg-black/10 dark:bg-white/15" />
        or join by ID
        <span className="h-px flex-1 bg-black/10 dark:bg-white/15" />
      </div>

      <form
        className="mt-6 flex flex-wrap gap-3"
        onSubmit={(event) => {
          event.preventDefault()
          if (!inRoom && input.trim()) void join(input.trim())
        }}
      >
        <input
          value={input}
          onChange={(event) => setInput(event.target.value)}
          disabled={inRoom || busy || searching}
          placeholder="Room ID (e.g. aachen-1)"
          aria-label="Room ID"
          className="min-w-52 flex-1 rounded-lg border border-black/15 bg-white px-3 py-2 font-mono text-sm outline-none placeholder:text-zinc-400 focus:border-emerald-500 disabled:opacity-50 dark:border-white/15 dark:bg-zinc-900 dark:text-zinc-100"
        />

        {inRoom ? (
          <button
            type="button"
            onClick={leave}
            className="rounded-lg bg-red-600 px-4 py-2 text-sm font-medium text-white hover:bg-red-500"
          >
            Leave
          </button>
        ) : (
          <button
            type="submit"
            disabled={busy || searching || !input.trim()}
            className="rounded-lg bg-emerald-600 px-4 py-2 text-sm font-medium text-white hover:bg-emerald-500 disabled:opacity-40"
          >
            {busy ? 'Working…' : 'Join'}
          </button>
        )}

        {inRoom && (
          <>
            <button
              type="button"
              onClick={toggleMic}
              className="rounded-lg border border-black/15 px-4 py-2 text-sm dark:border-white/15"
            >
              {micEnabled ? 'Mute' : 'Unmute'}
            </button>
            <button
              type="button"
              onClick={toggleCamera}
              className="rounded-lg border border-black/15 px-4 py-2 text-sm dark:border-white/15"
            >
              {cameraEnabled ? 'Camera off' : 'Camera on'}
            </button>
          </>
        )}
      </form>

      {error && (
        <p
          role="alert"
          className="mt-4 rounded-lg border border-red-500/30 bg-red-500/10 px-4 py-3 text-sm text-red-700 dark:text-red-300"
        >
          {error}
        </p>
      )}

      <div className="mt-8 grid gap-4 sm:grid-cols-2">
        <VideoTile
          stream={localStream}
          label={session ? `${session.nickname} (you)` : 'You'}
          muted
          mirrored
          status={localStream ? undefined : 'Camera off'}
        />

        {peers.map((peer) => (
          <VideoTile
            key={peer.socketId}
            stream={peer.stream}
            label={peer.nickname}
            status={peer.connectionState}
          />
        ))}

        {inRoom && peers.length === 0 && (
          <div className="grid aspect-video place-items-center rounded-xl border border-dashed border-black/15 text-sm text-zinc-500 dark:border-white/15">
            Waiting for someone to join <span className="mx-1 font-mono">{roomId}</span>
          </div>
        )}
      </div>

      {inRoom && (
        <GameBoard
          socket={socket}
          roomId={roomId}
          sessionId={session?.sessionId ?? null}
          peerCount={peers.length}
        />
      )}

      <section className="mt-10 space-y-2 text-sm leading-6 text-zinc-500">
        <p>
          Open this page in a second browser window and join the same Room ID.
          Rooms hold two people.
        </p>
        {!hasTurnConfigured() && (
          <p>
            No TURN server is configured, so only STUN is in use. Two peers on
            the same network will connect; peers behind symmetric NAT may stay
            at <code className="font-mono">checking</code> and never connect.
          </p>
        )}
      </section>
    </div>
  )
}
