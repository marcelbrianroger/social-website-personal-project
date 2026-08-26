'use client'

import type { MrWhiteRole } from '@/lib/game/mr-white-view'

import { DISPLAY_HEADING, EYEBROW, PANEL } from './controls'

/**
 * Your role, and the word you are or are not holding.
 *
 * The blank for Mr. White is the whole point of the component. It is not an
 * empty state to be filled in later — it is the game, so it gets the same
 * weight on the page as the word a civilian sees, rather than reading as
 * something that failed to load.
 *
 * `secretWord` arriving `null` is the server's redaction, not a loading state.
 * There is no request the client could make that would fill it in.
 */
export function RoleCard({
  role,
  secretWord,
  eliminated,
  revealed = false,
}: {
  /** `null` for an observer, who is told nothing. */
  role: MrWhiteRole | null
  /** Civilians only, until the game finishes and everything is revealed. */
  secretWord: string | null
  eliminated: boolean
  /** True once `phase === 'finished'` — the word is public from then on. */
  revealed?: boolean
}) {
  const isImpostor = role === 'mr-white'

  return (
    <section className={`${PANEL} p-4`} aria-label="Your role">
      <div className="flex items-baseline justify-between gap-3">
        <p className={EYEBROW}>your role</p>

        {eliminated && (
          <p className="border border-ink px-1.5 font-mono text-[0.625rem] uppercase tracking-wide text-ink-soft">
            eliminated
          </p>
        )}
      </div>

      <p
        className="mt-1.5 font-display text-2xl leading-none"
        style={DISPLAY_HEADING}
      >
        {role === null ? 'Watching' : isImpostor ? 'Mr. White' : 'Civilian'}
      </p>

      {/* ------------------------------------------------------------- word */}
      <p className={`${EYEBROW} mt-5`}>
        {isImpostor && !revealed ? 'the word you were not given' : 'the word'}
      </p>

      {secretWord ? (
        <p
          className="mt-1.5 break-words font-display text-[1.75rem] leading-none"
          style={DISPLAY_HEADING}
        >
          <span className="bg-yellow box-decoration-clone px-2 py-0.5">
            {secretWord}
          </span>
        </p>
      ) : (
        // A blank slip, not a spinner. The dashed rule reads as a form field
        // nobody filled in, which is exactly the position Mr. White is in.
        <p
          className="mt-1.5 grid h-[2.75rem] place-items-center border-2 border-dashed border-rule font-mono text-[0.6875rem] uppercase tracking-[0.2em] text-ink-soft"
          aria-label={
            role === null ? 'No word: you are watching' : 'No word issued'
          }
        >
          no word
        </p>
      )}

      {/* ---------------------------------------------------------- briefing */}
      {/* The pink rule is the site's "the system is telling you something"
          stamp, borrowed from site-chrome.tsx's SystemNote. Written out rather than
          imported because SystemNote fills itself `bg-stock`, and this panel is
          already stock — the note would vanish into it. */}
      <p className="mt-4 border-l-4 border-pink bg-paper px-3 py-2.5 font-mono text-[0.75rem] leading-relaxed text-ink">
        {role === null
          ? 'You are not seated at this table. You see what the room sees and nothing more.'
          : isImpostor
            ? 'Everyone else shares a word. Read their clues, work out what it is, and give one of your own that does not give you away.'
            : 'Everyone but one of you has this word. Give a clue that proves you know it, without handing it to the one who does not.'}
      </p>
    </section>
  )
}
