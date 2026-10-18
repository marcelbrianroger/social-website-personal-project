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
 * TWO PEOPLE, TWO INKS. The tiles sit on the dark plate, and each person's
 * name tag is printed in their own colour — yellow for you, pink for them —
 * the same two figures the home page draws for a video room. When there is no
 * picture, the tile shows that figure instead of a black rectangle, so a camera
 * that is off still reads as a person rather than as something broken.
 *
 * The tag is pinned to the TOP so the bottom edge stays free for the floating
 * call controls.
 */
const TONE = {
  you: { tag: 'bg-yellow', figure: 'fill-yellow' },
  them: { tag: 'bg-pink', figure: 'fill-pink' },
} as const

export function VideoTile({
  stream,
  label,
  muted = false,
  mirrored = false,
  status,
  tone = 'them',
  className = '',
}: {
  stream: MediaStream | null
  label: string
  muted?: boolean
  mirrored?: boolean
  status?: string
  /** Whose tile this is — decides the colour of the tag and the figure. */
  tone?: keyof typeof TONE
  /** Box the tile fills. The caller owns width, height and aspect ratio. */
  className?: string
}) {
  const videoRef = useRef<HTMLVideoElement>(null)
  const ink = TONE[tone]

  useEffect(() => {
    const element = videoRef.current
    if (!element) return

    element.srcObject = stream

    return () => {
      element.srcObject = null
    }
  }, [stream])

  // No picture to show: no stream yet, or the camera is off (the caller says
  // so through `status`, because a stream with a disabled track is still a
  // stream and would otherwise render as a black frame).
  const showFigure = !stream || status === 'camera off'

  return (
    <div
      className={`relative min-h-0 overflow-hidden border-2 border-paper/80 bg-ink ${className}`}
    >
      <video
        ref={videoRef}
        autoPlay
        playsInline
        // A self-view must be muted or the microphone feeds back into the
        // speakers as an echo.
        muted={muted}
        className={`h-full w-full object-cover ${mirrored ? '-scale-x-100' : ''} ${
          showFigure ? 'invisible' : ''
        }`}
      />

      {showFigure && (
        <div className="absolute inset-0 grid place-content-center justify-items-center gap-3 p-4 text-center">
          <svg
            aria-hidden="true"
            viewBox="0 0 96 80"
            className={`h-auto w-24 sm:w-36 ${ink.figure}`}
          >
            <circle cx="48" cy="28" r="16" />
            <path d="M18 80c4-20 15-28 30-28s26 8 30 28Z" />
          </svg>
          <p className="font-mono text-sm text-paper/80">
            {status ?? 'waiting for video'}
          </p>
        </div>
      )}

      <div
        className={`absolute left-0 top-0 flex max-w-full items-baseline gap-2 px-2.5 py-1.5 text-ink ${ink.tag}`}
      >
        <span className="truncate font-mono text-sm">{label}</span>
        {status && !showFigure && (
          <span className="shrink-0 font-mono text-xs">{status}</span>
        )}
      </div>
    </div>
  )
}
