'use client'

import { useState } from 'react'

import { ConnectionStatus, SHELL, SystemNote } from '@/app/chrome'
import { useP2PRoom } from '@/lib/webrtc/use-p2p-room'

import { GameBoard } from './game-board'
import { QuestionsBoard } from './questions-board'
import { VideoTile } from './video-tile'

const PHASE_LABEL: Record<string, string> = {
  idle: 'not connected',
  'requesting-media': 'asking for the camera',
  joining: 'joining',
  searching: 'searching',
  'in-room': 'in the room',
  error: 'error',
}

/** Filled control. One per view, at most. */
const PRIMARY =
  'border-2 border-ink bg-ink px-6 py-2.5 font-mono text-sm text-paper transition-colors hover:bg-pink hover:text-ink disabled:opacity-40 disabled:hover:bg-ink disabled:hover:text-paper'

/** Outline control, for everything that is not the main action. */
const SECONDARY =
  'border-2 border-ink px-5 py-2.5 font-mono text-sm text-ink transition-colors hover:bg-yellow disabled:opacity-40 disabled:hover:bg-transparent'

/**
 * In a call the stage IS the page: a wider gutter than the rest of the site,
 * because two faces side by side is the one thing here that genuinely wants
 * the whole screen.
 */
const STAGE_SHELL = 'mx-auto w-full max-w-[110rem] px-3 sm:px-5'

/**
 * Height of the stage.
 *
 * Taken from the viewport rather than an aspect ratio, and the feeds crop to
 * cover it — an aspect-locked grid leaves a band of dead paper under the video
 * on every screen that is not exactly the ratio you locked. The subtraction is
 * the site header plus this page's own room bar; `svh` rather than `vh` so a
 * mobile browser collapsing its toolbar cannot push the controls off-screen.
 */
const STAGE_HEIGHT = 'h-[calc(100svh-10.5rem)] min-h-[18rem]'

/** A floating chip on the call controls. Flat ink, no pretend hardware. */
const CONTROL =
  'border-2 border-ink px-4 py-2.5 font-mono text-xs transition-colors'

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
    turnAvailable,
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

  // A room holds two people, so there is exactly one remote feed to place.
  const peer = peers[0] ?? null

  // Off is a pink stamp rather than a dimmed button: muted is a state other
  // people are affected by, so it has to read across the room, not on inspection.
  const micChip = micEnabled
    ? `${CONTROL} bg-ink text-paper hover:bg-pink hover:text-ink`
    : `${CONTROL} bg-pink text-ink`
  const cameraChip = cameraEnabled
    ? `${CONTROL} bg-ink text-paper hover:bg-pink hover:text-ink`
    : `${CONTROL} bg-pink text-ink`

  if (inRoom) {
    return (
      <div className={`${STAGE_SHELL} py-4`}>
        {/* Room bar. Everything the lobby asked is settled by the time you are
            in here, so this is one line: where you are, and whether it is up. */}
        <div className="flex flex-wrap items-center justify-between gap-x-6 gap-y-2">
          <div className="flex items-baseline gap-2">
            <span className="font-mono text-[0.6875rem] lowercase tracking-wide text-ink-soft">
              room
            </span>
            <span className="bg-yellow px-1.5 font-mono text-sm text-ink">
              {roomId}
            </span>
          </div>

          <ConnectionStatus
            connected
            nickname={session?.nickname ?? null}
            detail={peer ? peer.connectionState : 'waiting for a partner'}
          />
        </div>

        {error && (
          <SystemNote alert className="mt-3">
            {error}
          </SystemNote>
        )}

        <section
          className={`relative mt-3 grid gap-3 lg:grid-cols-2 ${STAGE_HEIGHT}`}
        >
          {/*
           * Self-view.
           *
           * A thumbnail pinned into the corner until there is a second column
           * to give it — on a phone the other person is what you came for, and
           * splitting a portrait screen in half hands both of you a letterbox.
           * Top-right, so the controls own the bottom edge uncontested.
           */}
          <div
            className={
              peer
                ? 'absolute right-3 top-3 z-20 aspect-video w-32 sm:w-44 lg:static lg:aspect-auto lg:h-full lg:w-auto'
                : 'h-full lg:col-span-2'
            }
          >
            <VideoTile
              className="h-full w-full"
              stream={localStream}
              label={session ? `${session.nickname} (you)` : 'You'}
              muted
              mirrored
              status={cameraEnabled && localStream ? undefined : 'camera off'}
            />
          </div>

          {peer && (
            <VideoTile
              className="h-full w-full"
              stream={peer.stream}
              label={peer.nickname}
              status={
                peer.connectionState === 'connected'
                  ? undefined
                  : peer.connectionState
              }
            />
          )}

          {!peer && (
            // Clear of both the tile's own centred placeholder and the control
            // bar under it.
            <p className="pointer-events-none absolute inset-x-0 bottom-[4.5rem] z-10 mx-auto w-fit max-w-[calc(100%-1.5rem)] border-2 border-ink bg-ink px-4 py-2 text-center font-mono text-xs text-paper">
              Waiting for somebody else to join{' '}
              <span className="bg-yellow px-1 text-ink">{roomId}</span>
            </p>
          )}

          {/* The controls ride on the video instead of sitting under it — the
              alternative is a strip of paper the stage has to pay for. */}
          <div className="pointer-events-none absolute inset-x-0 bottom-0 z-20 flex flex-wrap justify-center gap-2 p-3">
            <button
              type="button"
              onClick={toggleMic}
              aria-pressed={!micEnabled}
              className={`pointer-events-auto ${micChip}`}
            >
              {micEnabled ? 'Mute mic' : 'Unmute mic'}
            </button>

            <button
              type="button"
              onClick={toggleCamera}
              aria-pressed={!cameraEnabled}
              className={`pointer-events-auto ${cameraChip}`}
            >
              {cameraEnabled ? 'Camera off' : 'Camera on'}
            </button>

            <button
              type="button"
              onClick={leave}
              className={`pointer-events-auto ${CONTROL} bg-paper text-ink hover:bg-pink`}
            >
              Leave
            </button>
          </div>
        </section>

        {/*
         * One room, two things to do in it. Each panel owns its own view of the
         * running game and shuts its own Start button when the other one is
         * playing — the engine already refuses a second game per room, so this
         * is only about not offering a button that cannot work.
         *
         * Side by side once the screen is wide enough that stacking them would
         * leave half the page empty next to each panel.
         */}
        <div className="mt-4 grid gap-4 xl:grid-cols-2 xl:items-start">
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
        </div>
      </div>
    )
  }

  return (
    <div className={`${SHELL} py-10 sm:py-14`}>
      <div className="flex flex-wrap items-end justify-between gap-4">
        <div>
          <p className="font-mono text-xs lowercase tracking-wide text-ink-soft">
            video rooms
          </p>
          <h1
            className="mt-3 font-display text-[clamp(1.875rem,5vw,3rem)] leading-[1.02] tracking-[-0.02em]"
            style={{ fontVariationSettings: "'wght' 800, 'wdth' 92" }}
          >
            Just the two of you, through nobody else.
          </h1>
        </div>

        <ConnectionStatus
          connected={phase !== 'idle' && phase !== 'error'}
          nickname={session?.nickname ?? null}
          detail={`${PHASE_LABEL[phase] ?? phase}${roomId ? ` · ${roomId}` : ''}`}
        />
      </div>

      {/*
       * Two ways in, one panel.
       *
       * These used to be two full-width blocks with an "or" rule set between
       * them, which spent most of a screen saying that a button and a text
       * field are alternatives. The hairline between the halves says it
       * instead: a 2px gap over an ink ground is the same rule, drawn once.
       */}
      <section className="mt-8 grid gap-0.5 border-2 border-ink bg-ink sm:grid-cols-[1.15fr_1fr]">
        <div className="flex flex-col justify-between gap-5 bg-stock p-6">
          <div>
            <h2
              className="font-display text-xl leading-tight"
              style={{ fontVariationSettings: "'wght' 800, 'wdth' 95" }}
            >
              Find someone to talk to
            </h2>
            <p className="mt-2 text-[0.9375rem] leading-relaxed text-ink">
              {searching
                ? `Waiting for a partner${queuePosition ? ` · number ${queuePosition} in the queue` : ''}…`
                : 'Press once. The moment somebody else is waiting too, the two of you are put in a room together.'}
            </p>
          </div>

          {searching ? (
            <button
              type="button"
              onClick={cancelMatch}
              className={`${SECONDARY} self-start`}
            >
              Stop searching
            </button>
          ) : (
            <button
              type="button"
              onClick={() => void findMatch()}
              disabled={busy}
              className={`${PRIMARY} self-start`}
            >
              Search now
            </button>
          )}
        </div>

        <form
          className="flex flex-col justify-between gap-5 bg-stock p-6"
          onSubmit={(event) => {
            event.preventDefault()
            if (input.trim()) void join(input.trim())
          }}
        >
          <div>
            <h2
              className="font-display text-xl leading-tight"
              style={{ fontVariationSettings: "'wght' 800, 'wdth' 95" }}
            >
              Already arranged it?
            </h2>
            <p className="mt-2 text-[0.9375rem] leading-relaxed text-ink">
              Join with the same room ID. A room only holds two people.
            </p>
          </div>

          <div className="flex flex-wrap gap-3">
            <input
              value={input}
              onChange={(event) => setInput(event.target.value)}
              disabled={busy || searching}
              placeholder="aachen-1"
              aria-label="Room ID"
              className="min-w-32 flex-1 border-2 border-ink bg-paper px-4 py-2.5 font-mono text-sm text-ink outline-none placeholder:text-ink-soft/70 disabled:opacity-50"
            />
            <button
              type="submit"
              disabled={busy || searching || !input.trim()}
              className={SECONDARY}
            >
              {busy ? 'Joining…' : 'Join'}
            </button>
          </div>
        </form>
      </section>

      {error && (
        <SystemNote alert className="mt-5">
          {error}
        </SystemNote>
      )}

      {/*
       * Preview, and only once the camera is actually live. Before that the
       * hook has not asked for it yet, and a permanently empty 16:9 box is a
       * hole in the page rather than information.
       */}
      {localStream && (
        <section className="mt-6 flex flex-col gap-4 sm:flex-row sm:items-end">
          <VideoTile
            className="aspect-video w-full flex-1 sm:max-w-2xl"
            stream={localStream}
            label={session ? `${session.nickname} (you)` : 'You'}
            muted
            mirrored
            status={cameraEnabled ? undefined : 'camera off'}
          />

          <div className="flex flex-wrap gap-3 sm:flex-col sm:items-start">
            <button
              type="button"
              onClick={toggleMic}
              aria-pressed={!micEnabled}
              className={SECONDARY}
            >
              {micEnabled ? 'Mute mic' : 'Unmute mic'}
            </button>
            <button
              type="button"
              onClick={toggleCamera}
              aria-pressed={!cameraEnabled}
              className={SECONDARY}
            >
              {cameraEnabled ? 'Camera off' : 'Camera on'}
            </button>
          </div>
        </section>
      )}

      {!turnAvailable && (
        <p className="mt-10 max-w-2xl border-t-2 border-ink pt-5 text-sm leading-relaxed text-ink-soft">
          There is no TURN server yet, so only STUN is running. Two people on
          the same network will connect; behind a symmetric NAT the call can
          stall at{' '}
          <code className="font-mono text-ink">checking</code> and never connect
          at all.
        </p>
      )}
    </div>
  )
}
