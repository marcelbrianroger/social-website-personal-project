'use client'

import { useEffect, useState } from 'react'

/**
 * Two clocks: where you are, and where your family is.
 *
 * This is the smallest element on the page and the one that says most clearly
 * who the site is for. At 2am in Aachen it is already morning in Jakarta, which
 * is the whole reason somebody is awake and posting.
 *
 * Both zones are named with IANA identifiers and formatted by Intl, never by a
 * fixed offset — the gap is five hours in summer and six in winter, and a
 * hardcoded number would be wrong for half the year.
 *
 * Rendered empty on the server and filled after mount. A build-time timestamp
 * would be baked into the statically prerendered routes and permanently stale.
 */

const ZONES = [
  { label: 'aachen', timeZone: 'Europe/Berlin' },
  { label: 'jakarta', timeZone: 'Asia/Jakarta' },
] as const

function timeIn(timeZone: string): string {
  return new Intl.DateTimeFormat('en-GB', {
    timeZone,
    hour: '2-digit',
    minute: '2-digit',
    hour12: false,
  }).format(new Date())
}

export function Clocks() {
  const [times, setTimes] = useState<string[] | null>(null)

  useEffect(() => {
    const update = () => setTimes(ZONES.map((zone) => timeIn(zone.timeZone)))

    update()
    const interval = setInterval(update, 15_000)
    return () => clearInterval(interval)
  }, [])

  return (
    <dl className="flex items-baseline gap-4 font-mono text-[0.6875rem] leading-none text-ink-soft">
      {ZONES.map((zone, index) => (
        <div key={zone.timeZone} className="flex items-baseline gap-1.5">
          <dt>{zone.label}</dt>
          <dd className="tabular-nums text-ink">
            {times ? times[index] : '--:--'}
          </dd>
        </div>
      ))}
    </dl>
  )
}
