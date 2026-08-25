'use client'

import { useEffect, useRef } from 'react'

/**
 * A single video surface.
 *
 * `srcObject` holds a live MediaStream and cannot be expressed as a JSX
 * attribute, so it is assigned imperatively against a ref.
 *
 * SIZING IS THE CALLER'S JOB. The tile has no aspect ratio of its own — it
 * fills whatever box it is given and the feed is cropped to cover it, because
 * on a call the height comes from the viewport and letterboxing a 16:9 camera
 * into it would spend the page on empty bars.
 *
 * The label sits on an ink scrim rather than the paper ground: a camera feed is
 * arbitrarily dark, and the name has to stay legible over whatever is behind
 * it. It is pinned to the TOP so the bottom edge stays free for the floating
 * call controls.
 */
export function VideoTile({
  stream,
  label,
  muted = false,
  mirrored = false,
  status,
  className = '',
}: {
  stream: MediaStream | null
  label: string
  muted?: boolean
  mirrored?: boolean
  status?: string
  /** Box the tile fills. The caller owns width, height and aspect ratio. */
  className?: string
}) {
  const videoRef = useRef<HTMLVideoElement>(null)

  useEffect(() => {
    const element = videoRef.current
    if (!element) return

    element.srcObject = stream

    return () => {
      element.srcObject = null
    }
  }, [stream])

  return (
    <div
      className={`relative min-h-0 overflow-hidden border-2 border-ink bg-stock ${className}`}
    >
      <video
        ref={videoRef}
        autoPlay
        playsInline
        // A self-view must be muted or the microphone feeds back into the
        // speakers as an echo.
        muted={muted}
        className={`h-full w-full object-cover ${mirrored ? '-scale-x-100' : ''}`}
      />

      {!stream && (
        <div className="absolute inset-0 grid place-items-center px-4 text-center font-mono text-xs text-ink-soft">
          {status ?? 'waiting for video'}
        </div>
      )}

      <div className="absolute left-0 top-0 flex max-w-full items-baseline gap-2 bg-ink px-2.5 py-1.5">
        <span className="truncate font-mono text-[0.6875rem] text-paper">
          {label}
        </span>
        {status && (
          <span className="shrink-0 font-mono text-[0.625rem] text-paper/70">
            {status}
          </span>
        )}
      </div>
    </div>
  )
}
