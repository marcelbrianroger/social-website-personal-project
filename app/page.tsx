import Link from "next/link";

import { READING, SHELL } from "@/app/chrome";
import { LiveWall } from "@/app/live-wall";
import { GAMES } from "@/lib/games/catalogue";
import { getCurrentSession } from "@/lib/session/current-session";

/**
 * Home.
 *
 * Written in plain, spoken English, keeping the German words this audience uses
 * daily — Anmeldung, Bürgeramt, Mensa, WG-Zimmer, Pontstraße. That mixture is
 * how the people this is for genuinely talk, and it is doing more work than any
 * amount of styling to say who the site belongs to.
 *
 * Every claim is checked against the code: the 24 hours come from
 * DUDU_TTL_SECONDS, the two-per-room from ROOM_CAPACITY, and the seat ranges
 * from the game registry by way of `lib/games/catalogue.ts`.
 *
 * The page runs at board width. It used to be a 64rem column centred in a
 * 1600px window, which fought the thing the whole site is drawn from: a mading
 * is pinned across a wall, not printed down the middle of one. Prose still sits
 * at a readable measure inside it — wide layout, narrow text.
 *
 * FOUR SECTIONS, IN THE ORDER THE HERO PROMISES THEM: the wall, then a video
 * room, then the two games, then the rules. The hero's three buttons and the
 * three sections below are the same three things in the same order on
 * purpose — a visitor should never have to guess where a button on this page
 * leads.
 *
 * THE VIDEO SECTION IS A DIFFERENT PLATE, not another card. A riso job is a
 * stack of flat spot inks, and a video room is a different kind of thing from
 * a game — two people and a camera, no roles, no rounds — so it prints on the
 * dark plate instead of the paper one, full-bleed, rather than sitting in a
 * card that would read as a third, lesser game.
 *
 * Both games are on the page rather than one: Werewolf shipped complete and
 * this page had only ever heard of Mr. White, so a visitor could find the
 * second game only by knowing its URL.
 *
 * The board below is the wall itself, not a picture of it — the same socket,
 * history and expiry /wall runs on. Nothing on this page is written by us.
 */

/** Ink on yellow — a highlighter pass. The only way colour touches type here. */
const MARKER = "bg-yellow box-decoration-clone px-2";

const DISPLAY = { fontVariationSettings: "'wght' 800, 'wdth' 95" };

export default async function Home() {
  const session = await getCurrentSession();

  return (
    <>
      {/* ------------------------------------------------------------- hero */}
      <section className={`${SHELL} pt-14 pb-16 sm:pt-20 sm:pb-20`}>
        <p className="font-mono text-xs lowercase tracking-wide text-ink-soft">
          an anonymous noticeboard for indonesians in aachen
        </p>

        <h1
          className="mt-6 font-display text-[clamp(2.75rem,11vw,7.5rem)] uppercase leading-[0.86] tracking-[-0.035em]"
          style={{ fontVariationSettings: "'wght' 800, 'wdth' 90" }}
        >
          Someone is still <span className={MARKER}>awake</span>.
        </h1>

        {/* The pitch runs at reading width against the left edge; the doors sit
            out on the right rule. Two things at opposite ends of a wide line
            beats one narrow column with everything stacked in it. */}
        <div className="mt-12 grid gap-10 lg:grid-cols-[minmax(0,1fr)_auto] lg:items-end lg:gap-16">
          <p className={`${READING} text-[1.1875rem] leading-relaxed text-ink`}>
            Write anything on the wall and it deletes itself after 24 hours. Go
            straight into a video call with whoever is online. Or sit down at a
            table and play something with five other people. No introductions
            first, no sign-up.
          </p>

          {/* Three doors, in the order the page argues for them below: the
              wall, then a face, then a table. */}
          <div className="flex flex-wrap items-center gap-3">
            <Link
              href="/wall"
              className="border-2 border-ink bg-ink px-6 py-3 font-mono text-sm text-paper transition-colors hover:bg-pink hover:text-ink"
            >
              Open the wall
            </Link>
            <Link
              href="/rooms"
              className="border-2 border-ink px-6 py-3 font-mono text-sm text-ink transition-colors hover:bg-yellow"
            >
              Meet someone face to face
            </Link>
            <Link
              href="/lobby"
              className="border-2 border-ink px-6 py-3 font-mono text-sm text-ink transition-colors hover:bg-yellow"
            >
              Play a game
            </Link>
          </div>
        </div>
      </section>

      {/* -------------------------------------------- the board: signature */}
      <section className="border-t-2 border-ink py-14 sm:py-18">
        <div className={SHELL}>
          <div className="flex flex-wrap items-end justify-between gap-x-8 gap-y-3">
            <div>
              <p className="font-mono text-xs lowercase tracking-wide text-ink-soft">
                the wall
              </p>
              <h2
                className="mt-4 font-display text-[clamp(1.875rem,5vw,3.25rem)] leading-[1.02] tracking-[-0.02em]"
                style={{ fontVariationSettings: "'wght' 800, 'wdth' 92" }}
              >
                Everything is gone after 24 hours.
              </h2>
            </div>

            <Link
              href="/wall"
              className={`${MARKER} py-0.5 text-sm hover:underline`}
            >
              pin something up
            </Link>
          </div>

          <p className={`${READING} mt-6 text-[1.0625rem] leading-relaxed text-ink`}>
            Anyone who is online can pin something up. No archive, no undo,
            nothing you can ask back. Below is what is on it right now, written
            by whoever was here before you.
          </p>

          <div className="mt-10">
            <LiveWall />
          </div>
        </div>
      </section>

      {/* -------------------------------------------------- video: the plate
          A different KIND of thing from the games below — two people and a
          camera, no roles, no rounds — so it gets a different MATERIAL rather
          than another card in the same stock. A riso job is a stack of flat
          spot inks; this is the section printed in the dark plate instead of
          on the paper, full-bleed, so it reads as a different sheet the
          instant you land here rather than a card that forgot its border.
          The button's paper-coloured edge around a yellow fill is a mock
          mis-registration — the small imperfection a real print run has when
          two plates do not land in exactly the same place. */}
      <section className="border-t-2 border-ink bg-ink py-14 text-paper sm:py-18">
        <div className={SHELL}>
          <div className="grid gap-8 lg:grid-cols-[minmax(0,1fr)_auto] lg:items-center lg:gap-16">
            <div>
              <p className="font-mono text-xs lowercase tracking-wide text-paper/55">
                no roles, no rounds
              </p>
              <h2
                className="mt-4 font-display text-[clamp(1.875rem,5vw,3.25rem)] leading-[1.02] tracking-[-0.02em]"
                style={{ fontVariationSettings: "'wght' 800, 'wdth' 92" }}
              >
                Or just show your face.
              </h2>
              <p className={`${READING} mt-5 text-[1.0625rem] leading-relaxed text-paper/90`}>
                Two people per room. Press once and wait until somebody else is
                waiting too, or type in a room ID if you already arranged it.
                Video goes straight from browser to browser, never through our
                server — on our side there is nothing to record.
              </p>
            </div>

            <Link
              href="/rooms"
              className="inline-flex shrink-0 items-center justify-center border-2 border-paper bg-yellow px-9 py-4 font-mono text-base text-ink transition-colors hover:bg-pink"
            >
              Open a room
            </Link>
          </div>
        </div>
      </section>

      {/* ------------------------------------------------- games: the news */}
      <section className="border-t-2 border-ink py-14 sm:py-18">
        <div className={SHELL}>
          <div className="flex flex-wrap items-end justify-between gap-x-8 gap-y-3">
            <div>
              <p className="font-mono text-xs lowercase tracking-wide text-ink-soft">
                two games at the table
              </p>
              <h2
                className="mt-4 font-display text-[clamp(1.875rem,5vw,3.25rem)] leading-[1.02] tracking-[-0.02em]"
                style={{ fontVariationSettings: "'wght' 800, 'wdth' 92" }}
              >
                Bring people. Both need a crowd.
              </h2>
            </div>

            <Link
              href="/lobby"
              className={`${MARKER} py-0.5 text-sm hover:underline`}
            >
              see who has a table open
            </Link>
          </div>

          {/* Two, side by side and equal — they ARE the pair, and ranking one
              above the other would be a claim neither has earned. */}
          <div className="mt-10 grid gap-px border-2 border-ink bg-ink md:grid-cols-2">
            {GAMES.map((game) => (
              <article
                key={game.id}
                className="flex flex-col bg-stock p-6 sm:p-7"
              >
                <div className="flex items-baseline justify-between gap-4">
                  <h3
                    className="font-display text-[clamp(1.5rem,3vw,2rem)] leading-none"
                    style={DISPLAY}
                  >
                    {game.label}
                  </h3>

                  {/* The number that decides whether you can play tonight, so
                      it gets to be a number rather than a sentence. */}
                  <p className="shrink-0 border-2 border-ink bg-paper px-2 py-0.5 font-mono text-[0.6875rem] tabular-nums text-ink">
                    {game.minPlayers}–{game.maxPlayers}
                  </p>
                </div>

                {/* Typed spec line, like the back of a game box. */}
                <p className="mt-3 border-y-2 border-rule py-2 font-mono text-[0.6875rem] lowercase tracking-wide text-ink-soft">
                  {game.spec}
                </p>

                <p className="mt-4 flex-1 text-[0.9375rem] leading-relaxed text-ink">
                  {game.blurb}
                </p>

                <Link
                  href="/lobby"
                  className="mt-6 self-start border-2 border-ink px-5 py-2.5 font-mono text-sm text-ink transition-colors hover:bg-yellow"
                >
                  Play {game.label}
                </Link>
              </article>
            ))}
          </div>
        </div>
      </section>

      {/* ----------------------------------------------------------- the rules */}
      <section className="border-t-2 border-ink py-14 sm:py-18">
        <div className={SHELL}>
          <p className="font-mono text-xs lowercase tracking-wide text-ink-soft">
            the rules
          </p>

          <dl className="mt-10 grid grid-cols-1 gap-x-12 gap-y-9 sm:grid-cols-2 lg:grid-cols-3">
            <div>
              <dt className="font-display text-lg" style={DISPLAY}>
                Germany only
              </dt>
              <dd className="mt-2.5 text-[0.9375rem] leading-relaxed text-ink">
                Where a request comes from is checked before anything else
                runs. From outside Germany, this site does not answer at all.
              </dd>
            </div>

            <div>
              <dt className="font-display text-lg" style={DISPLAY}>
                Nothing is kept
              </dt>
              <dd className="mt-2.5 text-[0.9375rem] leading-relaxed text-ink">
                The wall holds a note for 24 hours and then throws it away.
                Games are deleted the moment the room empties. Video is never
                recorded, because it never reaches us in the first place.
              </dd>
            </div>

            <div>
              <dt className="font-display text-lg" style={DISPLAY}>
                No accounts
              </dt>
              <dd className="mt-2.5 text-[0.9375rem] leading-relaxed text-ink">
                There is nothing to sign up for, and nothing to delete.
                {session ? (
                  <>
                    {" "}
                    This is everything the site knows about you:
                    <span className="mt-3 block break-all border-2 border-ink bg-stock px-3 py-2 font-mono text-[0.75rem]">
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
