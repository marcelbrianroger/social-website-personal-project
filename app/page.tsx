import Link from "next/link";

import { ClockLine } from "@/components/clocks";
import { GAME_ART, TwoFramesArt } from "@/components/home-art";
import { LiveWall } from "@/components/live-wall";
import {
  FLAT_PAPER,
  PRESS_INK,
  PRESS_PAPER,
  READING,
  SHELL,
} from "@/components/site-chrome";
import { GAMES } from "@/lib/game/catalogue";
import { getCurrentSession } from "@/lib/session/current-session";

/**
 * Home.
 *
 * Written in plain, spoken English, keeping the German words this audience uses
 * daily — Anmeldung, Bürgeramt, Mensa, WG-Zimmer, Pontstraße. That mixture is
 * how the people this is for genuinely talk, and it is doing more work than any
 * amount of styling to say who the site belongs to.
 *
 * Every claim is checked against the code: the 48 hours come from
 * DUDU_TTL_SECONDS, the two-per-room from ROOM_CAPACITY, and the seat ranges
 * from the game registry by way of `lib/game/catalogue.ts`.
 *
 * THE NOTES ARE THE HERO. The previous layout spent the whole first screen on a
 * headline and put the wall underneath it, which meant a first-time visitor saw
 * a claim that someone was awake before seeing anyone. The hero is now short
 * enough that the board starts inside the first viewport on a laptop, and the
 * board is a full-bleed surface rather than a section like the others — it is
 * the one thing on this page written by the people it is for.
 *
 * Order below the board is unchanged: the games, then a video room on the dark
 * plate, then the rules. See design/DESIGN.md for the reasoning.
 */

/**
 * The cut-out header.
 *
 * Each letter is glued onto its own scrap of coloured paper, the way every
 * mading title is made. Only "UP" gets it: the word is the verb the whole site
 * runs on, and two scraps in the two loud inks are enough to say "mading"
 * without turning the headline into a ransom note.
 *
 * Tilts and lifts are fixed per letter, not random, so the server render and
 * the client agree. Delays run left to right: the letters go up in the order
 * somebody would stick them on.
 */
const CUTOUT = [
  { ch: "U", paper: "bg-yellow text-ink", tilt: -5, lift: 2 },
  { ch: "P", paper: "bg-pink text-ink", tilt: 4, lift: -4 },
] as const;

function CutOut() {
  return (
    <span aria-hidden="true" className="flex gap-[0.06em]">
      {CUTOUT.map((letter, index) => (
        <span
          key={index}
          className={`cutout-letter inline-flex h-[1.08em] w-[0.98em] items-center justify-center pt-[0.06em] ${letter.paper}`}
          style={
            {
              "--tilt": `${letter.tilt}deg`,
              marginTop: `${letter.lift / 100}em`,
              animationDelay: `${120 + index * 70}ms`,
            } as React.CSSProperties
          }
        >
          {letter.ch}
        </span>
      ))}
    </span>
  );
}

const DISPLAY = { fontVariationSettings: "'wght' 800, 'wdth' 92" };

export default async function Home() {
  const session = await getCurrentSession();

  return (
    <>
      {/* ------------------------------------------------------------- hero
          Headline on the left, the reason and the doors on the right, both on
          one baseline so the whole thing is one band rather than a stack. The
          headline is the only animated entrance on the page that is not
          somebody's note. */}
      <section className={`${SHELL} pt-10 pb-12 sm:pt-14 sm:pb-14`}>
        {/* Two poster lines: the instruction, with its verb cut out of
            paper, then the rule that makes it safe to follow. */}
        <h1
          className="font-display text-[clamp(2.75rem,7vw,6.25rem)] uppercase leading-[0.95] tracking-[-0.035em] [overflow-wrap:anywhere]"
          style={{ fontVariationSettings: "'wght' 800, 'wdth' 88" }}
        >
          <span className="flex flex-wrap items-center gap-x-[0.28em]">
            <span className="animate-ink-in">Pin it</span>
            {/* The word for screen readers and copy-paste; the paper scraps
                are the same word drawn, and hidden from both. */}
            <span className="sr-only">up.</span>
            <span aria-hidden="true" className="flex items-end">
              <CutOut />
              <span className="animate-ink-in" style={{ animationDelay: "280ms" }}>
                .
              </span>
            </span>
          </span>
          <span
            className="animate-ink-in mt-[0.12em] block"
            style={{ animationDelay: "320ms" }}
          >
            {" "}
            Gone in 48 hours.
          </span>
        </h1>

        <div
          className="animate-ink-in mt-10 grid gap-8 lg:grid-cols-[minmax(0,1fr)_auto] lg:items-end lg:gap-16"
          style={{ animationDelay: "200ms" }}
        >
          <div>
            <ClockLine />

            <p className={`${READING} mt-3 text-[1.1875rem] leading-relaxed text-ink`}>
              An anonymous wall for Indonesians in Aachen. Write anything on
              it, go straight into a video call with whoever is online, or sit
              down at a table and play something with a few other people. No
              introductions first, no sign-up.
            </p>
          </div>

          <div>
            {/* Three doors in the order the page argues for them below. The
                pink offset is on all three — it is how this site says "you can
                press this" — but only the wall gets the dark plate. */}
            <div className="flex flex-wrap gap-3">
              <Link href="/wall" className={`${PRESS_INK} inline-flex min-h-12 items-center px-6 text-sm`}>
                Open the wall
              </Link>
              <Link href="/rooms" className={`${PRESS_PAPER} inline-flex min-h-12 items-center px-5 text-sm`}>
                Video call
              </Link>
              <Link href="/lobby" className={`${PRESS_PAPER} inline-flex min-h-12 items-center px-5 text-sm`}>
                Play a game
              </Link>
            </div>
          </div>
        </div>
      </section>

      {/* ---------------------------------------------- the board: the hero
          Full-bleed, on the darker stock with its halftone screen, so the
          notes sit ON something. Not a `reveal`: it is above the fold on most
          screens and a board that fades in reads as one that was loading. */}
      <section
        aria-labelledby="board-heading"
        className="board-ground border-y-2 border-ink py-10 sm:py-12"
      >
        <div className={SHELL}>
          <div className="mb-6 flex flex-wrap items-end justify-between gap-x-8 gap-y-4">
            <div>
              <p className="font-mono text-sm lowercase text-ink-soft">
                the wall
              </p>
              <h2
                id="board-heading"
                className="mt-2 font-display text-[clamp(1.625rem,3.6vw,2.5rem)] leading-[1.04] tracking-[-0.02em]"
                style={DISPLAY}
              >
                What&rsquo;s up there right now.
              </h2>
            </div>

            <Link
              href="/wall"
              className={`${PRESS_INK} inline-flex min-h-11 items-center px-5 text-sm`}
            >
              Pin something up
            </Link>
          </div>

          <LiveWall />
        </div>
      </section>

      {/* ---------------------------------------------------------- games
          Two sheets pinned side by side, each with a drawing of what the game
          actually is. Equal size: they ARE the pair, and ranking one above the
          other would be a claim neither has earned. */}
      <section className="reveal py-16 sm:py-20">
        <div className={SHELL}>
          <div className="flex flex-wrap items-end justify-between gap-x-8 gap-y-4">
            <div>
              <p className="font-mono text-sm lowercase text-ink-soft">
                two games at the table
              </p>
              <h2
                className="mt-2 font-display text-[clamp(1.875rem,5vw,3.25rem)] leading-[1.02] tracking-[-0.02em]"
                style={DISPLAY}
              >
                Bring people. Both need a crowd.
              </h2>
            </div>

            <Link
              href="/lobby"
              className="inline-flex min-h-11 items-center bg-yellow px-3 font-mono text-sm text-ink hover:underline"
            >
              see who has a table open →
            </Link>
          </div>

          <div className="mt-10 grid gap-8 md:grid-cols-2 md:gap-10">
            {GAMES.map((game) => {
              const art = GAME_ART[game.id];

              return (
                <article
                  key={game.id}
                  className={`relative flex flex-col p-6 sm:p-8 ${art?.sheet ?? "bg-sheet-white"}`}
                  style={{ transform: `rotate(${art?.tilt ?? 0}deg)` }}
                >
                  <span
                    aria-hidden="true"
                    className="absolute left-1/2 top-3 size-3.5 -translate-x-1/2 rounded-full border-2 border-ink bg-pink"
                  />

                  {art && <art.Art className="mx-auto mt-2 h-32 w-auto sm:h-36" />}

                  <div className="mt-6 flex items-baseline justify-between gap-4">
                    <h3
                      className="font-display text-[clamp(1.625rem,3vw,2.125rem)] leading-none"
                      style={DISPLAY}
                    >
                      {game.label}
                    </h3>

                    {/* The number that decides whether you can play tonight. */}
                    <p className="shrink-0 font-mono text-sm tabular-nums text-ink">
                      {game.minPlayers}–{game.maxPlayers} players
                    </p>
                  </div>

                  <p className="mt-3 border-y border-ink/25 py-2 font-mono text-xs lowercase tracking-wide text-ink-soft">
                    {game.spec}
                  </p>

                  <p className="mt-4 flex-1 text-[1rem] leading-relaxed text-ink">
                    {game.blurb}
                  </p>

                  <Link
                    href="/lobby"
                    className={`${FLAT_PAPER} mt-6 inline-flex min-h-11 items-center self-start px-5 text-sm`}
                  >
                    Play {game.label}
                  </Link>
                </article>
              );
            })}
          </div>
        </div>
      </section>

      {/* -------------------------------------------------- video: the plate
          A different KIND of thing from the games — two people and a camera,
          no roles, no rounds — so it prints on the dark plate, full-bleed. */}
      <section className="reveal bg-ink py-16 text-paper sm:py-20">
        <div className={SHELL}>
          <div className="grid gap-10 lg:grid-cols-[minmax(0,1fr)_auto] lg:items-center lg:gap-16">
            <div>
              <p className="font-mono text-sm lowercase text-paper/70">
                no roles, no rounds
              </p>
              <h2
                className="mt-2 font-display text-[clamp(1.875rem,5vw,3.25rem)] leading-[1.02] tracking-[-0.02em]"
                style={DISPLAY}
              >
                Or just show your face.
              </h2>
              <p className={`${READING} mt-5 text-[1.0625rem] leading-relaxed text-paper/90`}>
                Two people per room. Press once and wait until somebody else is
                waiting too, or type in a room ID if you already arranged it.
                Video goes straight from browser to browser, never through our
                server, so on our side there is nothing to record.
              </p>

              <Link
                href="/rooms"
                className="reg-flat mt-8 inline-flex min-h-12 items-center border-2 border-paper bg-yellow px-8 font-mono text-base text-ink transition-colors hover:bg-pink"
              >
                Open a room
              </Link>
            </div>

            <TwoFramesArt className="h-auto w-full max-w-[22rem] lg:w-[22rem]" />
          </div>
        </div>
      </section>

      {/* ----------------------------------------------------------- the rules */}
      <section className="reveal py-16 sm:py-20">
        <div className={SHELL}>
          <p className="font-mono text-sm lowercase text-ink-soft">the rules</p>

          <dl className="mt-8 grid grid-cols-1 gap-x-12 gap-y-10 sm:grid-cols-2 lg:grid-cols-3">
            <div className="border-t-2 border-ink pt-5">
              <dt className="font-display text-xl" style={DISPLAY}>
                Germany only
              </dt>
              <dd className="mt-2.5 text-[1rem] leading-relaxed text-ink">
                Where a request comes from is checked before anything else
                runs. From outside Germany, this site does not answer at all.
              </dd>
            </div>

            <div className="border-t-2 border-ink pt-5">
              <dt className="font-display text-xl" style={DISPLAY}>
                Nothing is kept
              </dt>
              <dd className="mt-2.5 text-[1rem] leading-relaxed text-ink">
                The wall holds a note for 48 hours and then throws it away.
                Games are deleted the moment the room empties. Video is never
                recorded, because it never reaches us in the first place.
              </dd>
            </div>

            <div className="border-t-2 border-ink pt-5">
              <dt className="font-display text-xl" style={DISPLAY}>
                No accounts
              </dt>
              <dd className="mt-2.5 text-[1rem] leading-relaxed text-ink">
                There is nothing to sign up for, and nothing to delete.
                {session ? (
                  <>
                    {" "}
                    This is everything the site knows about you:
                    <span className="mt-3 block break-all bg-sheet-white px-3 py-2 font-mono text-xs">
                      {session.sessionId}
                    </span>
                  </>
                ) : (
                  <> Just a signed cookie holding one id and one name.</>
                )}
              </dd>
            </div>
          </dl>
        </div>
      </section>
    </>
  );
}
