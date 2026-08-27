'use client'

import { useCallback, useEffect, useRef, useState } from 'react'

/**
 * Picking a slip up off the board.
 *
 * The wall draws paper and then behaves like a list of divs. This closes that
 * gap: a note can be taken off its pin, shoved somewhere else, and thrown — and
 * it carries on, slows down, and settles, the way a piece of card slid across a
 * table does.
 *
 * NOTHING IS PERSISTED, deliberately. Where you shoved a note is not state the
 * server has any business knowing, and the wall's whole promise is that it
 * keeps nothing. Move a slip, reload, it is back on its pin.
 *
 * WHY THE TRANSFORM IS WRITTEN TO THE DOM AND NOT HELD IN STATE: a drag
 * produces a value every frame, and re-rendering a React tree sixty times a
 * second to move one element is how a smooth interaction becomes a janky one.
 * React is told exactly once per drag — `dragging`, which flips a cursor and a
 * z-index — and the per-frame work goes straight to `style.transform`, which is
 * a compositor property and never touches layout.
 */

/** How far the pointer must travel before this counts as a drag and not a click. */
const ENGAGE_PX = 5

/** Velocity below which the throw has effectively stopped, in px/frame. */
const REST_SPEED = 0.12

/** Per-frame decay of a thrown slip. Card on a table, not ice. */
const FRICTION = 0.9

/**
 * How far a slip may be pushed from its pin before the board starts resisting.
 * Past this it still moves, but less and less — things do not hit invisible
 * walls in the real world, they slow down first.
 */
const SOFT_LIMIT = 190

/** Degrees of swing at full tilt. A shove rocks the paper; it does not spin it. */
const MAX_SWING = 7

/** Horizontal speed, in px/frame, that produces the full swing. */
const SWING_AT = 22

type Resting = {
  /** The slip's resting rotation, in degrees. */
  tilt: number
  /** The slip's resting offset on the board, in px. */
  nudgeX: number
  nudgeY: number
}

/** Clamp helper — the swing is bounded in three separate places. */
function clampSwing(vx: number): number {
  return Math.max(-MAX_SWING, Math.min(MAX_SWING, (vx / SWING_AT) * MAX_SWING))
}

/**
 * Beyond `SOFT_LIMIT`, further travel is compressed rather than refused. The
 * curve is asymptotic, so the slip can always be pushed a little further and
 * never quite escapes.
 */
function damp(value: number): number {
  const beyond = Math.abs(value) - SOFT_LIMIT
  if (beyond <= 0) return value

  return Math.sign(value) * (SOFT_LIMIT + beyond / (1 + beyond / 90))
}

export function useSlipDrag({ tilt, nudgeX, nudgeY }: Resting) {
  const ref = useRef<HTMLLIElement>(null)
  const [dragging, setDragging] = useState(false)

  /**
   * Everything the gesture needs, in a ref rather than state: it is read and
   * written every frame and must never trigger a render.
   */
  const grip = useRef({
    /** Pointer position when the button went down. */
    originX: 0,
    originY: 0,
    /** Where the slip already sat when this drag began — throws accumulate. */
    baseX: 0,
    baseY: 0,
    /** Current offset from the resting position. */
    x: 0,
    y: 0,
    /** Pointer delta on the last move, used for both throw and swing. */
    vx: 0,
    vy: 0,
    lastX: 0,
    lastY: 0,
    engaged: false,
    pointerId: -1,
    frame: 0,
  })

  /** Compose the resting transform with the drag offset and the swing. */
  const paint = useCallback(
    (x: number, y: number, swing: number) => {
      const el = ref.current
      if (!el) return

      el.style.transform =
        `rotate(${tilt + swing}deg) translate(${nudgeX + x}px, ${nudgeY + y}px)`
    },
    [tilt, nudgeX, nudgeY],
  )

  /** The throw. Runs only after the pointer has let go. */
  const glide = useCallback(() => {
    const g = grip.current

    const step = () => {
      g.vx *= FRICTION
      g.vy *= FRICTION
      g.x = damp(g.x + g.vx)
      g.y = damp(g.y + g.vy)

      if (Math.hypot(g.vx, g.vy) < REST_SPEED) {
        // Settle flat. The tilt is the slip's resting state and has to come
        // back exactly, or a thrown note keeps a rotation it was never given.
        paint(g.x, g.y, 0)
        setDragging(false)
        return
      }

      paint(g.x, g.y, clampSwing(g.vx))
      g.frame = requestAnimationFrame(step)
    }

    g.frame = requestAnimationFrame(step)
  }, [paint])

  const onPointerDown = useCallback((event: React.PointerEvent<HTMLLIElement>) => {
    // Primary button only, and never a touch or pen — see the media query in
    // globals.css for why the board stays scrollable on a phone.
    if (event.pointerType !== 'mouse' || event.button !== 0) return

    const g = grip.current
    cancelAnimationFrame(g.frame)

    g.originX = event.clientX
    g.originY = event.clientY
    g.lastX = event.clientX
    g.lastY = event.clientY
    g.baseX = g.x
    g.baseY = g.y
    g.vx = 0
    g.vy = 0
    g.engaged = false
    g.pointerId = event.pointerId
  }, [])

  const onPointerMove = useCallback(
    (event: React.PointerEvent<HTMLLIElement>) => {
      const g = grip.current
      if (g.pointerId !== event.pointerId) return

      const dx = event.clientX - g.originX
      const dy = event.clientY - g.originY

      if (!g.engaged) {
        // Still inside the threshold: this may yet turn out to be a click, so
        // leave selection and focus alone.
        if (Math.hypot(dx, dy) < ENGAGE_PX) return

        g.engaged = true

        // Capture so the slip keeps following even when the pointer outruns it
        // and leaves the element — which it will, on any quick throw.
        //
        // Guarded because `setPointerCapture` throws `NotFoundError` when the
        // id is no longer an active pointer, and there is a real race here: the
        // button can be released between the move that crossed the threshold
        // and this call. Losing capture degrades the drag; letting the error
        // escape would break the whole board.
        try {
          ref.current?.setPointerCapture(event.pointerId)
        } catch {
          // Not capturable — the pointerup handler still cleans up.
        }

        // The first few pixels will have started a text selection. Drop it, or
        // the slip drags with half its own message highlighted.
        window.getSelection()?.removeAllRanges()
        setDragging(true)
      }

      g.vx = event.clientX - g.lastX
      g.vy = event.clientY - g.lastY
      g.lastX = event.clientX
      g.lastY = event.clientY

      g.x = damp(g.baseX + dx)
      g.y = damp(g.baseY + dy)

      paint(g.x, g.y, clampSwing(g.vx))
    },
    [paint],
  )

  const onPointerUp = useCallback(
    (event: React.PointerEvent<HTMLLIElement>) => {
      const g = grip.current
      if (g.pointerId !== event.pointerId) return

      g.pointerId = -1
      if (!g.engaged) return
      g.engaged = false

      if (ref.current?.hasPointerCapture(event.pointerId)) {
        ref.current.releasePointerCapture(event.pointerId)
      }

      // Momentum is motion for its own sake. Someone who asked for less of it
      // still gets to move the slip; it just stops where they let go.
      const wantsMotion = !window.matchMedia('(prefers-reduced-motion: reduce)')
        .matches

      if (!wantsMotion || Math.hypot(g.vx, g.vy) < REST_SPEED) {
        paint(g.x, g.y, 0)
        setDragging(false)
        return
      }

      glide()
    },
    [glide, paint],
  )

  // A drag can outlive the component — the wall expires slips on a timer, and
  // one can come down mid-throw.
  useEffect(() => {
    const g = grip.current
    return () => cancelAnimationFrame(g.frame)
  }, [])

  return {
    ref,
    dragging,
    handlers: {
      onPointerDown,
      onPointerMove,
      onPointerUp,
      onPointerCancel: onPointerUp,
    },
  }
}
