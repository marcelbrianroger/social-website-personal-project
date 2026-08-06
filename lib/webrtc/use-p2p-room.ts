'use client'

import { useCallback, useEffect, useRef, useState } from 'react'
import { io, type Socket } from 'socket.io-client'

import {
  JOIN_ERROR_TEXT,
  type AnonymousSession,
  type ClientToServerEvents,
  type ServerToClientEvents,
} from '@/lib/socket/events'
import {
  SOCKET_UNCONFIGURED_MESSAGE,
  resolveSocketConnection,
  socketOptions,
} from '@/lib/socket/connect'
import { STUN_ONLY, fetchIceConfig } from '@/lib/webrtc/ice-config'

/**
 * P2P room membership plus a full-mesh WebRTC connection to every other
 * occupant.
 *
 * WHO OFFERS: the joiner offers to everyone already present; existing occupants
 * wait for that offer. That single rule is what avoids SDP glare — if both
 * sides created offers simultaneously the negotiation would deadlock, and the
 * usual fix (perfect negotiation with a polite/impolite role) is far more
 * machinery than a two-person room needs.
 */

export type AppSocket = Socket<ServerToClientEvents, ClientToServerEvents>

export type RoomPhase =
  | 'idle'
  | 'requesting-media'
  | 'joining'
  | 'searching'
  | 'in-room'
  | 'error'

export interface PeerView {
  socketId: string
  sessionId: string
  nickname: string
  connectionState: RTCPeerConnectionState
  stream: MediaStream | null
}

const MEDIA_CONSTRAINTS: MediaStreamConstraints = {
  video: { width: { ideal: 1280 }, height: { ideal: 720 } },
  audio: { echoCancellation: true, noiseSuppression: true },
}

export function useP2PRoom() {
  const [phase, setPhase] = useState<RoomPhase>('idle')
  const [error, setError] = useState<string | null>(null)
  const [session, setSession] = useState<AnonymousSession | null>(null)
  const [roomId, setRoomId] = useState<string | null>(null)
  const [peers, setPeers] = useState<PeerView[]>([])
  const [localStream, setLocalStream] = useState<MediaStream | null>(null)
  const [micEnabled, setMicEnabled] = useState(true)
  const [cameraEnabled, setCameraEnabled] = useState(true)
  const [queuePosition, setQueuePosition] = useState<number | null>(null)
  /**
   * Exposed so features scoped to this room (the game board) can share the same
   * connection. A second socket would get a different socket id and therefore
   * different room membership, so it must not be opened.
   */
  const [socket, setSocket] = useState<AppSocket | null>(null)

  /**
   * Whether a TURN relay is in play, for the UI to warn about.
   *
   * Comes from the ICE response rather than an env var: TURN settings are
   * server-side now, so the browser genuinely cannot know without asking.
   */
  const [turnAvailable, setTurnAvailable] = useState(false)

  const socketRef = useRef<AppSocket | null>(null)
  const localStreamRef = useRef<MediaStream | null>(null)
  const peerConnectionsRef = useRef(new Map<string, RTCPeerConnection>())
  /**
   * ICE servers, fetched once per mount.
   *
   * A ref rather than state because `createPeerConnection` is synchronous and
   * must read the current value without re-subscribing. The socket effect fills
   * this in before connecting, so by the time any peer event can arrive the
   * credentials are already here.
   */
  const iceServersRef = useRef<RTCIceServer[]>(STUN_ONLY)
  /**
   * ICE candidates that arrived before the matching remote description was
   * applied. addIceCandidate() throws in that window, so they are parked here
   * and flushed once setRemoteDescription resolves.
   */
  const pendingIceRef = useRef(new Map<string, RTCIceCandidateInit[]>())

  const updatePeer = useCallback(
    (socketId: string, patch: Partial<PeerView>) => {
      setPeers((current) =>
        current.map((peer) =>
          peer.socketId === socketId ? { ...peer, ...patch } : peer,
        ),
      )
    },
    [],
  )

  const closePeer = useCallback((socketId: string) => {
    const connection = peerConnectionsRef.current.get(socketId)

    if (connection) {
      // Detach handlers before closing so late events cannot touch React state
      // after unmount.
      connection.onicecandidate = null
      connection.ontrack = null
      connection.onconnectionstatechange = null
      connection.close()
      peerConnectionsRef.current.delete(socketId)
    }

    pendingIceRef.current.delete(socketId)
    setPeers((current) => current.filter((peer) => peer.socketId !== socketId))
  }, [])

  const createPeerConnection = useCallback(
    (socketId: string): RTCPeerConnection => {
      const existing = peerConnectionsRef.current.get(socketId)
      if (existing) return existing

      const connection = new RTCPeerConnection({
        iceServers: iceServersRef.current,
      })

      // Local tracks must be attached before creating an offer or answer, or
      // the SDP carries no media and the call connects silently with no video.
      const stream = localStreamRef.current
      if (stream) {
        for (const track of stream.getTracks()) {
          connection.addTrack(track, stream)
        }
      }

      connection.onicecandidate = (event) => {
        // A null candidate is the end-of-candidates signal; nothing to relay.
        if (!event.candidate) return

        const json = event.candidate.toJSON()

        // Mapped field by field: RTCIceCandidateInit types `candidate` as
        // optional, but the wire contract requires it, and the server drops
        // any payload without a string candidate.
        socketRef.current?.emit('webrtc:ice-candidate', {
          target: socketId,
          candidate: {
            candidate: json.candidate ?? '',
            sdpMid: json.sdpMid,
            sdpMLineIndex: json.sdpMLineIndex,
            usernameFragment: json.usernameFragment,
          },
        })
      }

      connection.ontrack = (event) => {
        const [remoteStream] = event.streams
        if (remoteStream) updatePeer(socketId, { stream: remoteStream })
      }

      connection.onconnectionstatechange = () => {
        updatePeer(socketId, { connectionState: connection.connectionState })

        if (
          connection.connectionState === 'failed' ||
          connection.connectionState === 'closed'
        ) {
          // Do not tear the peer out of the list on 'failed' — the UI surfaces
          // the state so a stuck connection is visible rather than silent.
        }
      }

      peerConnectionsRef.current.set(socketId, connection)
      return connection
    },
    [updatePeer],
  )

  const flushPendingIce = useCallback(
    async (socketId: string, connection: RTCPeerConnection) => {
      const queued = pendingIceRef.current.get(socketId)
      if (!queued?.length) return

      pendingIceRef.current.delete(socketId)

      for (const candidate of queued) {
        try {
          await connection.addIceCandidate(candidate)
        } catch {
          // A single bad candidate is not fatal; ICE tries the others.
        }
      }
    },
    [],
  )

  /**
   * Acquire the camera and microphone once, reusing the stream afterwards.
   *
   * Must complete before any peer connection is built: tracks added after an
   * offer is created are not in that offer's SDP, and the call connects with no
   * media. Returns null when access failed, having already set `error`.
   */
  const ensureLocalStream = useCallback(async (): Promise<MediaStream | null> => {
    if (localStreamRef.current) return localStreamRef.current

    setPhase('requesting-media')

    if (!navigator.mediaDevices?.getUserMedia) {
      setError(
        'Camera access needs a secure context. Use http://localhost or serve the site over HTTPS — a LAN IP like 192.168.x.x will not work.',
      )
      setPhase('error')
      return null
    }

    try {
      const stream = await navigator.mediaDevices.getUserMedia(MEDIA_CONSTRAINTS)
      localStreamRef.current = stream
      setLocalStream(stream)
      return stream
    } catch (cause) {
      const name = (cause as DOMException).name
      setError(
        name === 'NotAllowedError'
          ? 'Camera and microphone permission was denied.'
          : name === 'NotFoundError'
            ? 'No camera or microphone was found on this device.'
            : `Could not access media devices: ${(cause as Error).message}`,
      )
      setPhase('error')
      return null
    }
  }, [])

  // --- Socket lifecycle ----------------------------------------------------

  useEffect(() => {
    let cancelled = false
    let socket: AppSocket | null = null

    void (async () => {
      /**
       * Both fetches must land before the socket opens.
       *
       * The ticket authenticates the handshake. The ICE servers must be in the
       * ref before any peer event can arrive, because `createPeerConnection` is
       * synchronous — connecting first would let the very first peer be built
       * with STUN only, which is precisely the case TURN exists to rescue, and
       * it would fail intermittently depending on how fast the peer showed up.
       *
       * In parallel: they are independent, and serialising them would add a
       * round trip to every room open.
       */
      const [{ url, ticket }, ice] = await Promise.all([
        resolveSocketConnection(),
        fetchIceConfig(),
      ])
      if (cancelled) return

      iceServersRef.current = ice.iceServers
      setTurnAvailable(ice.turnAvailable)

      // No signalling server means no way to exchange SDP, so there is no point
      // opening a camera the user would only have to close again.
      if (!url) {
        setError(SOCKET_UNCONFIGURED_MESSAGE)
        setPhase('error')
        return
      }

      // Named `activeSocket`, not `connection`: the handlers below declare
      // their own `connection` for the RTCPeerConnection, and shadowing it
      // would silently send `emit` to the peer connection instead of the
      // socket.
      const activeSocket: AppSocket = io(url, socketOptions(ticket))
      socket = activeSocket
      socketRef.current = activeSocket

      // Published from the callback rather than the effect body: setState in an
      // effect body cascades renders. It also means consumers only ever see a
      // socket that has completed the handshake, which is the only point at
      // which it is actually usable.
      activeSocket.on('session:ready', (incoming) => {
        setSession(incoming)
        setSocket(activeSocket)
      })

      activeSocket.on('connect_error', (cause) => {
        setError(
          cause.message === 'unauthorized'
            ? 'The socket server rejected your session. Reload the page to get a fresh one.'
            : `Could not reach the realtime server at ${url}. Is it running?`,
        )
        setPhase('error')
      })

      activeSocket.on('room:peer-joined', (peer) => {
        // A newcomer offers to us, so no connection is created here — just show
        // them. The offer handler builds the connection when it arrives.
        setPeers((current) =>
          current.some((existing) => existing.socketId === peer.socketId)
            ? current
            : [...current, { ...peer, connectionState: 'new', stream: null }],
        )
      })

      activeSocket.on('room:peer-left', ({ socketId }) => {
        closePeer(socketId)
      })

      activeSocket.on('match:waiting', ({ position }) => {
        setQueuePosition(position)
        setPhase('searching')
      })

      activeSocket.on('match:cancelled', () => {
        setQueuePosition(null)
        setPhase('idle')
      })

      activeSocket.on(
        'match:found',
        ({ roomId: matchedRoom, peer, shouldOffer }) => {
          setQueuePosition(null)
          setRoomId(matchedRoom)
          setPhase('in-room')
          setPeers([{ ...peer, connectionState: 'new', stream: null }])

          // Unlike a manual join there is no "newcomer" to break the tie, so
          // the server designates exactly one side to offer. Obey it — if both
          // offered the negotiation would deadlock.
          if (!shouldOffer) return

          const connection = createPeerConnection(peer.socketId)

          void (async () => {
            try {
              const offer = await connection.createOffer()
              await connection.setLocalDescription(offer)

              activeSocket.emit('webrtc:offer', {
                target: peer.socketId,
                description: { type: 'offer', sdp: offer.sdp ?? '' },
              })
            } catch (cause) {
              setError(
                `Failed to start the matched call: ${(cause as Error).message}`,
              )
            }
          })()
        },
      )

      activeSocket.on('webrtc:offer', async ({ from, description }) => {
        const connection = createPeerConnection(from)

        try {
          await connection.setRemoteDescription(description)
          await flushPendingIce(from, connection)

          const answer = await connection.createAnswer()
          await connection.setLocalDescription(answer)

          activeSocket.emit('webrtc:answer', {
            target: from,
            description: { type: 'answer', sdp: answer.sdp ?? '' },
          })
        } catch (cause) {
          setError(`Failed to answer a call: ${(cause as Error).message}`)
        }
      })

      activeSocket.on('webrtc:answer', async ({ from, description }) => {
        const connection = peerConnectionsRef.current.get(from)
        if (!connection) return

        try {
          await connection.setRemoteDescription(description)
          await flushPendingIce(from, connection)
        } catch (cause) {
          setError(`Failed to complete a call: ${(cause as Error).message}`)
        }
      })

      activeSocket.on('webrtc:ice-candidate', async ({ from, candidate }) => {
        const connection = peerConnectionsRef.current.get(from)

        // Buffer until the remote description exists — see pendingIceRef.
        if (!connection?.remoteDescription) {
          const queued = pendingIceRef.current.get(from) ?? []
          queued.push(candidate)
          pendingIceRef.current.set(from, queued)
          return
        }

        try {
          await connection.addIceCandidate(candidate)
        } catch {
          // Ignore — ICE is tolerant of individual candidate failures.
        }
      })
    })()

    return () => {
      // Guards the in-flight fetches: without it a fast unmount leaves a socket
      // nothing disconnects.
      cancelled = true
      socket?.removeAllListeners()
      socket?.disconnect()
      socketRef.current = null
      setSocket(null)
    }
  }, [closePeer, createPeerConnection, flushPendingIce])

  // Release the camera and microphone when the component goes away. Skipping
  // this leaves the camera light on until the tab is closed.
  useEffect(() => {
    // The Map instance is created once by useRef and never reassigned, so
    // capturing it here is equivalent to reading it at cleanup time — and it
    // satisfies react-hooks/exhaustive-deps honestly rather than by suppression.
    const connections = peerConnectionsRef.current
    const streamRef = localStreamRef

    return () => {
      for (const connection of connections.values()) {
        connection.close()
      }
      connections.clear()

      // Read through the ref, not a captured value: `join` reassigns
      // `.current` after this effect runs, so a captured copy would still be
      // null and the camera would never be released.
      for (const track of streamRef.current?.getTracks() ?? []) {
        track.stop()
      }
      streamRef.current = null
    }
  }, [])

  // --- Actions -------------------------------------------------------------

  const join = useCallback(
    async (requestedRoomId: string) => {
      const socket = socketRef.current
      if (!socket) return

      setError(null)

      // Media first — see ensureLocalStream.
      if (!(await ensureLocalStream())) return

      setPhase('joining')

      socket.emit('room:join', requestedRoomId, (result) => {
        if (!result.ok) {
          setError(
            JOIN_ERROR_TEXT[result.error ?? ''] ??
              `Could not join the room (${result.error ?? 'unknown error'}).`,
          )
          setPhase('error')
          return
        }

        setRoomId(requestedRoomId)
        setPhase('in-room')
        setPeers(
          result.peers.map((peer) => ({
            ...peer,
            connectionState: 'new' as RTCPeerConnectionState,
            stream: null,
          })),
        )

        // We are the newcomer, so we initiate to everyone already here.
        for (const peer of result.peers) {
          const connection = createPeerConnection(peer.socketId)

          void (async () => {
            try {
              const offer = await connection.createOffer()
              await connection.setLocalDescription(offer)

              socket.emit('webrtc:offer', {
                target: peer.socketId,
                description: { type: 'offer', sdp: offer.sdp ?? '' },
              })
            } catch (cause) {
              setError(`Failed to start a call: ${(cause as Error).message}`)
            }
          })()
        }
      })
    },
    [createPeerConnection, ensureLocalStream],
  )

  /** Enter the matchmaking queue. The server pairs and creates the room. */
  const findMatch = useCallback(async () => {
    const socket = socketRef.current
    if (!socket) return

    setError(null)

    // Acquire media before queueing: a match can arrive milliseconds later and
    // the offer must already have tracks to describe.
    if (!(await ensureLocalStream())) return

    setPhase('searching')
    socket.emit('match:find', () => {})
  }, [ensureLocalStream])

  const cancelMatch = useCallback(() => {
    socketRef.current?.emit('match:cancel')
    setQueuePosition(null)
    setPhase('idle')
  }, [])

  const leave = useCallback(() => {
    socketRef.current?.emit('room:leave')
    socketRef.current?.emit('match:cancel')

    for (const socketId of [...peerConnectionsRef.current.keys()]) {
      closePeer(socketId)
    }

    setRoomId(null)
    setPeers([])
    setQueuePosition(null)
    setPhase('idle')
  }, [closePeer])

  const toggleMic = useCallback(() => {
    const tracks = localStreamRef.current?.getAudioTracks() ?? []
    const next = !tracks[0]?.enabled
    for (const track of tracks) track.enabled = next
    setMicEnabled(next)
  }, [])

  const toggleCamera = useCallback(() => {
    const tracks = localStreamRef.current?.getVideoTracks() ?? []
    const next = !tracks[0]?.enabled
    for (const track of tracks) track.enabled = next
    setCameraEnabled(next)
  }, [])

  return {
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
  }
}
