'use client'

import { useEffect, useRef } from 'react'

/**
 * A single video surface.
 *
 * `srcObject` holds a live MediaStream and cannot be expressed as a JSX
 * attribute, so it is assigned imperatively against a ref.
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
    <div className="relative aspect-video overflow-hidden rounded-xl border border-white/10 bg-zinc-900">
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
        <div className="absolute inset-0 grid place-items-center text-sm text-zinc-500">
          {status ?? 'Waiting for video…'}
        </div>
      )}

      <div className="absolute inset-x-0 bottom-0 flex items-center justify-between gap-2 bg-gradient-to-t from-black/80 to-transparent px-3 py-2">
        <span className="truncate text-sm font-medium text-white">{label}</span>
        {status && (
          <span className="shrink-0 rounded bg-black/50 px-1.5 py-0.5 font-mono text-[11px] text-zinc-300">
            {status}
          </span>
        )}
      </div>
    </div>
  )
}
