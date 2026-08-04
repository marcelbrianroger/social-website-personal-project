'use client'

import { useEffect, useState } from 'react'

/**
 * Milliseconds left in the current phase, corrected for client clock skew.
 *
 * `phaseEndsAt` is server epoch ms and a browser clock can be minutes out, so
 * comparing it against a raw `Date.now()` shows the wrong number — a negative
 * one on a fast clock, which reads as "time's up" while the server is still
 * accepting moves. Each `game:state` push carries `serverNow`, which pins the
 * offset at the moment the state was sent.
 *
 * Two things are load-bearing in how this is written:
 *
 * 1. `now` is seeded from `serverNow`, never `Date.now()`. That makes the first
 *    render byte-identical on the server and the client, so the markup hydrates
 *    without a mismatch. Real time only enters from inside the interval.
 * 2. The re-pin on a new `serverNow` happens during render, not in an effect.
 *    The effect version renders one stale frame first and trips
 *    `react-hooks/set-state-in-effect` — same reason `lib/game/use-game.ts:36`
 *    resets its board that way.
 */
export function useCountdown(
  phaseEndsAt: number | null,
  serverNow: number,
): number | null {
  const [now, setNow] = useState(serverNow)
  const [seenServerNow, setSeenServerNow] = useState(serverNow)

  if (seenServerNow !== serverNow) {
    setSeenServerNow(serverNow)
    setNow(serverNow)
  }

  useEffect(() => {
    if (phaseEndsAt === null) return

    const offset = serverNow - Date.now()

    // 250ms rather than 1000ms so the seconds digit turns over on time instead
    // of lagging up to a full second behind the server.
    const id = window.setInterval(() => setNow(Date.now() + offset), 250)
    return () => window.clearInterval(id)
  }, [phaseEndsAt, serverNow])

  return phaseEndsAt === null ? null : Math.max(0, phaseEndsAt - now)
}

/** Whole seconds remaining, rounded up so the final second reads "1", not "0". */
export function toSeconds(remainingMs: number | null): number | null {
  return remainingMs === null ? null : Math.ceil(remainingMs / 1000)
}
