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
 * TWO THINGS CHANGED IN THIS PASS.
 *
 * The page runs at board width now. It used to be a 64rem column centred in a
 * 1600px window, which fought the thing the whole site is drawn from: a mading
 * is pinned across a wall, not printed down the middle of one. Prose still sits
 * at a readable measure inside it — wide layout, narrow text.
 *
 * And the games are on it. Werewolf shipped complete and this page had never
 * heard of it, so a visitor could only find it by knowing the URL. Both games
 * are now the second thing you see, with the seat count that decides whether
 * you can play tonight.
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

          <div className="flex flex-wrap items-center gap-3">
            <Link
              href="/wall"
              className="border-2 border-ink bg-ink px-6 py-3 font-mono text-sm text-paper transition-colors hover:bg-pink hover:text-ink"
            >
              Open the wall
            </Link>
            <Link
              href="/lobby"
              className="border-2 border-ink px-6 py-3 font-mono text-sm text-ink transition-colors hover:bg-yellow"
            >
              Sit down at a table
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

          {/* Video rooms are a different KIND of thing — two people, a camera,
              no roles — so they get a band rather than a third equal card that
              would imply a set of three. */}
          <article className="mt-6 flex flex-wrap items-baseline justify-between gap-x-10 gap-y-4 border-2 border-ink px-6 py-5">
            <div>
              <h3 className="font-display text-xl leading-tight" style={DISPLAY}>
                Video rooms
              </h3>
              <p className={`${READING} mt-2 text-[0.9375rem] leading-relaxed text-ink`}>
                Two people per room. Press once and wait until somebody else is
                waiting too, or type in a room ID if you already arranged it.
                Video goes straight from browser to browser, never through our
                server, so on our side there is nothing to record.
              </p>
            </div>

            <Link
              href="/rooms"
              className={`${MARKER} shrink-0 py-0.5 text-sm hover:underline`}
            >
              Open a room
            </Link>
          </article>
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
