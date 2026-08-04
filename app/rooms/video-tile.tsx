'use client'

import { useEffect, useRef } from 'react'

/**
 * A single video surface.
 *
 * `srcObject` holds a live MediaStream and cannot be expressed as a JSX
 * attribute, so it is assigned imperatively against a ref.
 *
 * The label sits on an ink scrim rather than the paper ground: a camera feed is
 * arbitrarily dark, and the name has to stay legible over whatever is behind it.
 */
export function VideoTile({
  stream,
  label,
  muted = false,
  mirrored = false,
  status,
}: {
  stream: MediaStream | null
  label: string
  muted?: boolean
  mirrored?: boolean
  status?: string
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
    <div className="relative aspect-video overflow-hidden border-2 border-ink bg-stock">
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
        <div className="absolute inset-0 grid place-items-center font-mono text-xs text-ink-soft">
          {status ?? 'nunggu video'}
        </div>
      )}

      <div className="absolute inset-x-0 bottom-0 flex items-center justify-between gap-2 bg-ink px-3 py-2">
        <span className="truncate font-mono text-xs text-paper">{label}</span>
        {status && (
          <span className="shrink-0 font-mono text-[0.625rem] text-paper/70">
            {status}
          </span>
        )}
      </div>
    </div>
  )
}
