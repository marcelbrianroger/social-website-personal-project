'use client'

import { useEffect, useRef, useState } from 'react'

/**
 * The board. This is the signature element of the site.
 *
 * Slips of paper, pinned slightly crooked, overlapping each other. Where two
 * overlap the inks multiply and darken, the way a second pass through a riso
 * does — that overprint is the one visual idea everything else is built to stay
 * out of the way of.
 *
 * The notes are live: each carries the time it has left, and when one reaches
 * zero it is not deleted, it is UNPINNED — it swings off the pin and drops, and
 * another goes up in its place. A running count of what has come down since you
 * arrived sits underneath. A page that destroys its own content is a risk; the
 * count is what makes it an argument instead of a bug.
 *
 * HONESTY: the real wall keeps a note for 24 hours (DUDU_TTL_SECONDS in
 * server/src/redis.ts). This shows the tail of that queue — the notes closest
 * to coming down — which is why the times are minutes and not hours.
 *
 * HYDRATION: the seed below is fixed, and the tilts are deterministic per slot.
 * Nothing is randomised until after mount.
 */

interface Note {
  key: number
  body: string
  author: string
  /** Milliseconds left before this note comes down. */
  remainingMs: number
  /** Playing its exit; still in the DOM so the exit can be seen. */
  leaving: boolean
  /** Just went up, so it plays its entry. */
  arriving: boolean
}

interface Seed {
  body: string
  author: string
  remainingMs: number
}

/**
 * Six slips. Fixed slot count: a note is replaced in place rather than removed,
 * so the board never reflows and it reads as one slip swapped for another.
 */
const SEED: Seed[] = [
  {
    body: 'anyone know somewhere cheap for a haircut near Pontstraße?',
    author: 'LeiseUhu204',
    remainingMs: 14_000,
  },
  {
    body: 'Anmeldung finally done. only took three months.',
    author: 'NebelBrücke881',
    remainingMs: 47_000,
  },
  {
    body: '2am here, 7am back home. mum is already up.',
    author: 'WinterFunke126',
    remainingMs: 96_000,
  },
  {
    body: 'missing nasi padang. not the restaurant kind, the warung down the road kind.',
    author: 'SanftOtter332',
    remainingMs: 168_000,
  },
  {
    body: 'dark from 4pm every single day. when does it get warm again',
    author: 'SturmRabe549',
    remainingMs: 243_000,
  },
  {
    body: 'writing this because by tomorrow it will be gone',
    author: 'FlinkFuchs417',
    remainingMs: 391_000,
  },
]

/** Slips that go up as pins come free. */
const INCOMING: Array<Omit<Seed, 'remainingMs'>> = [
  { body: 'Indomie restocked at the Asia Markt. go before it is gone', author: 'KlugReiher773' },
  { body: 'Mathe exam tomorrow. wish me luck', author: 'ZartWolke615' },
  { body: 'anyone want to come to the Bürgeramt with me? the form makes no sense', author: 'FroheIgel288' },
  { body: 'first snow. never seen snow in my life', author: 'MutigLuchs902' },
  { body: 'two weeks now without speaking Indonesian to anyone', author: 'GoldenAnker451' },
  { body: 'wer ist noch wach', author: 'StolzKranich137' },
  { body: 'met a stranger on video, talked about bakso for an hour. worth it', author: 'HellSpecht660' },
  { body: 'mensa was actually decent today. that never happens', author: 'AbendBiber375' },
  { body: 'one WG-Zimmer still free in Burtscheid if anyone is looking', author: 'RuhigDachs818' },
  { body: 'sometimes you just want somebody to say hello', author: 'SilbernTurm240' },
]

/**
 * Deterministic so the server and the first client render agree.
 *
 * Tilt AND nudge: the nudge is what makes slips genuinely overlap, and it is a
 * translate rather than a negative margin so it cannot push the grid out of its
 * container. Where two slips cross, `mix-blend-mode: multiply` darkens the
 * paper — that overlap is the whole point of the board.
 */
const TILTS = [-1.6, 1.1, -0.7, 1.4, -1.2, 0.6]
const NUDGES = [
  [0, 0],
  [-5, 3],
  [4, -2],
  [-3, -4],
  [5, 3],
  [-4, 2],
] as const

const EXIT_MS = 620
const SLOT_COUNT = 6

function formatRemaining(ms: number): string {
  const total = Math.max(0, Math.ceil(ms / 1000))
  const minutes = Math.floor(total / 60)
  const seconds = total % 60
  return `${String(minutes).padStart(2, '0')}:${String(seconds).padStart(2, '0')}`
}

function seedNotes(): Note[] {
  return SEED.map((seed, index) => ({
    key: index,
    body: seed.body,
    author: seed.author,
    remainingMs: seed.remainingMs,
    leaving: false,
    arriving: false,
  }))
}

export function LiveWall() {
  const [notes, setNotes] = useState<Note[]>(seedNotes)
  const [takenDown, setTakenDown] = useState(0)

  const incomingIndex = useRef(0)
  const nextKey = useRef(SLOT_COUNT)
  const lastTick = useRef(0)
  const timers = useRef<ReturnType<typeof setTimeout>[]>([])

  useEffect(() => {
    const reduceMotion = window.matchMedia(
      '(prefers-reduced-motion: reduce)',
    ).matches
    const exitMs = reduceMotion ? 0 : EXIT_MS

    lastTick.current = Date.now()

    const replace = (slotKey: number) => {
      const arrival = INCOMING[incomingIndex.current % INCOMING.length]!
      incomingIndex.current += 1

      // Drawn only after mount, so it can never desync the markup. The spread
      // keeps the board turning over instead of drifting to a state where every
      // slip comes down at the same distant moment.
      const remainingMs = 45_000 + Math.random() * 315_000

      setNotes((current) =>
        current.map((note) =>
          note.key === slotKey
            ? {
                key: nextKey.current++,
                body: arrival.body,
                author: arrival.author,
                remainingMs,
                leaving: false,
                arriving: true,
              }
            : note,
        ),
      )

      setTakenDown((count) => count + 1)
    }

    const interval = setInterval(() => {
      const now = Date.now()
      const elapsed = now - lastTick.current
      lastTick.current = now

      setNotes((current) =>
        current.map((note) => {
          if (note.leaving) return note

          const remainingMs = note.remainingMs - elapsed
          if (remainingMs > 0) return { ...note, remainingMs, arriving: false }

          const slotKey = note.key
          timers.current.push(setTimeout(() => replace(slotKey), exitMs))

          return { ...note, remainingMs: 0, leaving: true, arriving: false }
        }),
      )
    }, 250)

    const pending = timers.current

    return () => {
      clearInterval(interval)
      for (const timer of pending) clearTimeout(timer)
      pending.length = 0
    }
  }, [])

  return (
    <div>
      {/* Padding so rotated corners and nudged slips never clip. */}
      <ul className="board grid grid-cols-1 items-start p-3 sm:grid-cols-2 lg:grid-cols-3">
        {notes.map((note, slot) => {
          const tilt = TILTS[slot % TILTS.length]!
          const [nudgeX, nudgeY] = NUDGES[slot % NUDGES.length]!
          const soon = note.remainingMs <= 60_000

          return (
            <li
              key={note.key}
              style={
                {
                  '--tilt': `${tilt}deg`,
                  transform: `rotate(${tilt}deg) translate(${nudgeX}px, ${nudgeY}px)`,
                  zIndex: slot % 2 === 0 ? 2 : 1,
                } as React.CSSProperties
              }
              className={`slip relative flex min-h-44 flex-col justify-between border-2 border-ink bg-stock px-6 pt-10 pb-5 ${
                note.leaving ? 'animate-unpin' : ''
              } ${note.arriving ? 'animate-pin-up' : ''}`}
            >
              {/* The pin. A printed mark, not a picture of a pushpin. */}
              <span
                aria-hidden="true"
                className="absolute left-[13px] top-[13px] size-2.5 rounded-full bg-pink"
              />

              <p className="text-[1.0625rem] leading-snug text-ink">
                {note.body}
              </p>

              <div className="mt-6 flex items-baseline justify-between gap-3 font-mono text-[0.6875rem]">
                <span className="truncate text-ink-soft">{note.author}</span>

                <span
                  className={`shrink-0 tabular-nums ${
                    soon ? 'bg-pink px-1 text-paper' : 'text-ink-soft'
                  }`}
                >
                  {/* Ticking digits would be announced continuously, so the
                      readable form is given once and the display hidden. */}
                  <span aria-hidden="true">{formatRemaining(note.remainingMs)}</span>
                  <span className="sr-only">
                    comes down in under{' '}
                    {Math.max(1, Math.ceil(note.remainingMs / 60_000))} minutes
                  </span>
                </span>
              </div>
            </li>
          )
        })}
      </ul>

      <p className="mt-6 font-mono text-xs text-ink-soft">
        <span className="bg-pink px-1.5 text-paper tabular-nums">
          {String(takenDown).padStart(2, '0')}
        </span>{' '}
        notes have come down since you opened this page.
      </p>
    </div>
  )
}
