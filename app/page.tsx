import Link from "next/link";

import { SHELL } from "@/app/chrome";
import { LiveWall } from "@/app/live-wall";
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
 * DUDU_TTL_SECONDS, the two-per-room from ROOM_CAPACITY, and the nickname is
 * whatever lib/session/nickname.ts actually issued this visitor.
 */

/** Ink on yellow — a highlighter pass. The only way colour touches type here. */
const MARKER = "bg-yellow box-decoration-clone px-2";

export default async function Home() {
  const session = await getCurrentSession();

  return (
    <>
      {/* ------------------------------------------------------------- hero */}
      <section className={`${SHELL} pt-14 pb-20 sm:pt-20 sm:pb-24`}>
        <p className="font-mono text-xs lowercase tracking-wide text-ink-soft">
          an anonymous noticeboard for indonesians in aachen
        </p>

        <h1
          className="mt-6 max-w-4xl font-display text-[clamp(2.75rem,10.5vw,6rem)] uppercase leading-[0.88] tracking-[-0.03em]"
          style={{ fontVariationSettings: "'wght' 800, 'wdth' 90" }}
        >
          Someone is still <span className={MARKER}>awake</span>.
        </h1>

        {/* Two columns from md up: the pitch reads on the left, the name sits
            beside it. Single column below that. */}
        <div className="mt-10 grid gap-10 md:grid-cols-[1fr_auto] md:items-start md:gap-14">
          <div>
            <p className="max-w-xl text-[1.125rem] leading-relaxed text-ink">
              Write anything on the wall. It disappears on its own after 24
              hours. Or go straight into a video call with whoever is online.
              no introductions first, no sign-up.
            </p>

            <div className="mt-9 flex flex-wrap items-center gap-3">
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
                Open a video room
              </Link>
            </div>
          </div>

          {/* The name, as a printed label. Real data, not a mockup. */}
          <div className="max-w-sm border-2 border-ink bg-stock px-5 py-4 md:w-72">
            <p className="font-mono text-[0.6875rem] lowercase tracking-wide text-ink-soft">
              your name here
            </p>
            <p
              className="mt-1.5 break-words font-display text-2xl leading-none"
              style={{ fontVariationSettings: "'wght' 800, 'wdth' 95" }}
            >
              {session ? session.nickname : "not issued yet"}
            </p>
            <p className="mt-3 max-w-xs text-[0.8125rem] leading-relaxed text-ink-soft">
              {session ? (
                <>
                  Handed to you the moment you opened this page. German, yes,
                  because we are, in fact, in Germany.
                </>
              ) : (
                <>
                  The proxy does not run on this path, so there is no name yet.
                  Check{" "}
                  <code className="font-mono">matcher</code> in{" "}
                  <code className="font-mono">proxy.ts</code>.
                </>
              )}
            </p>
          </div>
        </div>
      </section>

      {/* -------------------------------------------- the board: signature */}
      <section className="border-t-2 border-ink py-16 sm:py-20">
        <div className={SHELL}>
          <p className="font-mono text-xs lowercase tracking-wide text-ink-soft">
            the wall
          </p>

          <h2
            className="mt-4 max-w-3xl font-display text-[clamp(1.875rem,5vw,3.25rem)] leading-[1.02] tracking-[-0.02em]"
            style={{ fontVariationSettings: "'wght' 800, 'wdth' 92" }}
          >
            Everything is gone after 24 hours.
          </h2>

          <p className="mt-6 max-w-2xl text-[1.0625rem] leading-relaxed text-ink">
            Anyone who is online can pin something up. No archive, no undo,
            nothing you can ask back. Below are the ones closest to coming
            down.
          </p>

          <div className="mt-10">
            <LiveWall />
          </div>
        </div>
      </section>

      {/* ------------------------------------------------------ everything else */}
      <section className="border-t-2 border-ink py-16 sm:py-20">
        <div className={SHELL}>
          <p className="font-mono text-xs lowercase tracking-wide text-ink-soft">
            besides the wall
          </p>

          {/* One card per destination, not per door. Finding a partner and
              typing in a room ID both land on /rooms, so both are told on the
              same card — rather than split into two cards that would read as
              two separate features. */}
          <div className="mt-10 grid grid-cols-1 gap-y-10 sm:gap-x-10 md:grid-cols-2">
            <article className="flex flex-col border-t-2 border-ink pt-5">
              <h3
                className="font-display text-xl leading-tight"
                style={{ fontVariationSettings: "'wght' 800, 'wdth' 95" }}
              >
                Video rooms
              </h3>
              <p className="mt-3 flex-1 text-[0.9375rem] leading-relaxed text-ink">
                Two people per room. Press once and wait until somebody else
                is waiting too, or type in a room ID if you already arranged
                it. Video and audio go straight from browser to browser, never
                through our server, so on our side there is genuinely nothing
                to record. Inside a room you can play tic-tac-toe.
              </p>
              <Link
                href="/rooms"
                className={`mt-5 self-start ${MARKER} py-0.5 text-sm`}
              >
                Open a room
              </Link>
            </article>

            <article className="flex flex-col border-t-2 border-ink pt-5">
              <h3
                className="font-display text-xl leading-tight"
                style={{ fontVariationSettings: "'wght' 800, 'wdth' 95" }}
              >
                Mr. White
              </h3>
              <p className="mt-3 flex-1 text-[0.9375rem] leading-relaxed text-ink">
                Four to eight players, no video. Everyone holds the same
                secret word, except one, who has to pretend they know it. The
                board is held by the server; your browser can only ask to move,
                and never gets to decide for itself.
              </p>
              <Link
                href="/lobby"
                className={`mt-5 self-start ${MARKER} py-0.5 text-sm`}
              >
                open or join a table
              </Link>
            </article>
          </div>
        </div>
      </section>

      {/* ----------------------------------------------------------- the rules */}
      <section className="border-t-2 border-ink py-16 sm:py-20">
        <div className={SHELL}>
          <p className="font-mono text-xs lowercase tracking-wide text-ink-soft">
            the rules
          </p>

          <dl className="mt-10 grid grid-cols-1 gap-x-10 gap-y-9 sm:grid-cols-2">
            <div>
              <dt
                className="font-display text-lg"
                style={{ fontVariationSettings: "'wght' 800, 'wdth' 95" }}
              >
                Germany only
              </dt>
              <dd className="mt-2.5 text-[0.9375rem] leading-relaxed text-ink">
                Where a request comes from is checked before anything else
                runs. From outside Germany, this site does not answer at all.
              </dd>
            </div>

            <div>
              <dt
                className="font-display text-lg"
                style={{ fontVariationSettings: "'wght' 800, 'wdth' 95" }}
              >
                Nothing is kept
              </dt>
              <dd className="mt-2.5 text-[0.9375rem] leading-relaxed text-ink">
                The wall holds a note for 24 hours and then throws it away.
                Games are deleted the moment the room empties. Video is never
                recorded, because it never reaches us in the first place.
              </dd>
            </div>

            <div className="sm:col-span-2">
              <dt
                className="font-display text-lg"
                style={{ fontVariationSettings: "'wght' 800, 'wdth' 95" }}
              >
                No accounts
              </dt>
              <dd className="mt-2.5 max-w-2xl text-[0.9375rem] leading-relaxed text-ink">
                There is nothing to sign up for, and nothing to delete.
                {session ? (
                  <>
                    {" "}
                    This is everything the site knows about you:
                    <span className="mt-3 block break-all border-2 border-ink bg-stock px-3 py-2 font-mono text-[0.8125rem]">
                      {session.sessionId}
                    </span>
                  </>
                ) : (
                  <>
                    {" "}
                    Just a signed cookie holding one id and one name.
                  </>
                )}
              </dd>
            </div>
          </dl>
        </div>
      </section>
    </>
  );
}
