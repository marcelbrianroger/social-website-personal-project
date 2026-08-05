'use client'

import { useState } from 'react'

import { ConnectionStatus, SHELL, SystemNote } from '@/app/chrome'
import { hasTurnConfigured } from '@/lib/webrtc/ice-config'
import { useP2PRoom } from '@/lib/webrtc/use-p2p-room'

import { GameBoard } from './game-board'
import { QuestionsBoard } from './questions-board'
import { VideoTile } from './video-tile'

const PHASE_LABEL: Record<string, string> = {
  idle: 'belum nyambung',
  'requesting-media': 'minta izin kamera',
  joining: 'lagi masuk',
  searching: 'lagi nyari',
  'in-room': 'di dalam ruang',
  error: 'error',
}

/** Filled control. One per view, at most. */
const PRIMARY =
  'border-2 border-ink bg-ink px-6 py-2.5 font-mono text-sm text-paper transition-colors hover:bg-pink hover:text-ink disabled:opacity-40 disabled:hover:bg-ink disabled:hover:text-paper'

/** Outline control, for everything that is not the main action. */
const SECONDARY =
  'border-2 border-ink px-5 py-2.5 font-mono text-sm text-ink transition-colors hover:bg-yellow disabled:opacity-40 disabled:hover:bg-transparent'

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
    <div className={`${SHELL} py-12 sm:py-16`}>
      <div className="flex flex-wrap items-end justify-between gap-4">
        <div>
          <p className="font-mono text-xs lowercase tracking-wide text-ink-soft">
            ruang video
          </p>
          <h1
            className="mt-3 font-display text-[clamp(1.875rem,5vw,3rem)] leading-[1.02] tracking-[-0.02em]"
            style={{ fontVariationSettings: "'wght' 800, 'wdth' 92" }}
          >
            Berdua aja, nggak lewat siapa-siapa.
          </h1>
        </div>

        <ConnectionStatus
          connected={phase !== 'idle' && phase !== 'error'}
          nickname={session?.nickname ?? null}
          detail={`${PHASE_LABEL[phase] ?? phase}${roomId ? ` · ${roomId}` : ''}`}
        />
      </div>

      <section className="mt-10 border-2 border-ink bg-stock p-6">
        <div className="flex flex-wrap items-center justify-between gap-4">
          <div>
            <h2
              className="font-display text-xl leading-tight"
              style={{ fontVariationSettings: "'wght' 800, 'wdth' 95" }}
            >
              Cari teman ngobrol
            </h2>
            <p className="mt-2 max-w-md text-[0.9375rem] leading-relaxed text-ink">
              {searching
                ? `Lagi nunggu partner${queuePosition ? ` · nomor ${queuePosition} di antrean` : ''}…`
                : 'Pencet sekali. Begitu ada orang lain yang juga nunggu, kalian langsung dimasukin ke satu ruang.'}
            </p>
          </div>

          {searching ? (
            <button type="button" onClick={cancelMatch} className={SECONDARY}>
              Berhenti nyari
            </button>
          ) : (
            <button
              type="button"
              onClick={() => void findMatch()}
              disabled={inRoom || busy}
              className={PRIMARY}
            >
              Cari sekarang
            </button>
          )}
        </div>
      </section>

      <div className="mt-8 flex items-center gap-4 font-mono text-xs lowercase text-ink-soft">
        <span className="h-0.5 flex-1 bg-ink" />
        atau masuk pakai id ruang
        <span className="h-0.5 flex-1 bg-ink" />
      </div>

      <form
        className="mt-8 flex flex-wrap gap-3"
        onSubmit={(event) => {
          event.preventDefault()
          if (!inRoom && input.trim()) void join(input.trim())
        }}
      >
        <input
          value={input}
          onChange={(event) => setInput(event.target.value)}
          disabled={inRoom || busy || searching}
          placeholder="aachen-1"
          aria-label="ID ruang"
          className="min-w-52 flex-1 border-2 border-ink bg-stock px-4 py-2.5 font-mono text-sm text-ink outline-none placeholder:text-ink-soft/70 disabled:opacity-50"
        />

        {inRoom ? (
          <button type="button" onClick={leave} className={SECONDARY}>
            Keluar ruang
          </button>
        ) : (
          <button
            type="submit"
            disabled={busy || searching || !input.trim()}
            className={PRIMARY}
          >
            {busy ? 'Masuk…' : 'Masuk'}
          </button>
        )}

        {inRoom && (
          <>
            <button type="button" onClick={toggleMic} className={SECONDARY}>
              {micEnabled ? 'Matiin mic' : 'Nyalain mic'}
            </button>
            <button type="button" onClick={toggleCamera} className={SECONDARY}>
              {cameraEnabled ? 'Matiin kamera' : 'Nyalain kamera'}
            </button>
          </>
        )}
      </form>

      {error && (
        <SystemNote alert className="mt-5">
          {error}
        </SystemNote>
      )}

      <div className="mt-10 grid gap-5 sm:grid-cols-2">
        <VideoTile
          stream={localStream}
          label={session ? `${session.nickname} (kamu)` : 'Kamu'}
          muted
          mirrored
          status={localStream ? undefined : 'kamera mati'}
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
          <div className="grid aspect-video place-items-center border-2 border-dashed border-rule px-6 text-center text-sm text-ink-soft">
            Nunggu orang lain masuk ke{' '}
            <span className="ml-1 font-mono text-ink">{roomId}</span>
          </div>
        )}
      </div>

      {/*
       * One room, two things to do in it. Each panel owns its own view of the
       * running game and shuts its own Start button when the other one is
       * playing — the engine already refuses a second game per room, so this is
       * only about not offering a button that cannot work.
       */}
      {inRoom && (
        <>
          <GameBoard
            socket={socket}
            roomId={roomId}
            sessionId={session?.sessionId ?? null}
            peerCount={peers.length}
          />
          <QuestionsBoard
            socket={socket}
            roomId={roomId}
            sessionId={session?.sessionId ?? null}
            peerCount={peers.length}
          />
        </>
      )}

      <div className="mt-12 max-w-2xl space-y-3 border-t-2 border-ink pt-5 text-sm leading-relaxed text-ink-soft">
        <p>
          Buka halaman ini di jendela kedua terus masuk pakai ID ruang yang sama.
          Satu ruang cuma muat dua orang.
        </p>
        {!hasTurnConfigured() && (
          <p>
            Belum ada server TURN, jadi cuma STUN yang jalan. Dua orang di
            jaringan yang sama bisa nyambung; kalau di balik symmetric NAT bisa
            mentok di{' '}
            <code className="font-mono text-ink">checking</code> dan nggak pernah
            nyambung.
          </p>
        )}
      </div>
    </div>
  )
}
