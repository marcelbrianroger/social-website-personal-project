import Link from "next/link";

import { getCurrentSession } from "@/lib/session/current-session";

export default async function Home() {
  const session = await getCurrentSession();

  return (
    <div className="flex flex-1 flex-col items-center justify-center bg-zinc-50 px-6 py-16 font-sans dark:bg-black">
      <main className="w-full max-w-2xl">
        <p className="font-mono text-xs uppercase tracking-[0.2em] text-zinc-500">
          DUDU · Foundation
        </p>

        <h1 className="mt-3 text-3xl font-semibold tracking-tight text-black dark:text-zinc-50">
          {session ? (
            <>
              Willkommen,{" "}
              <span className="text-emerald-600 dark:text-emerald-400">
                {session.nickname}
              </span>
            </>
          ) : (
            "Keine Session"
          )}
        </h1>

        <p className="mt-3 text-zinc-600 dark:text-zinc-400">
          {session ? (
            <>
              You were given an anonymous identity automatically — no signup, no
              password. It is stored in a signed, HttpOnly cookie.
            </>
          ) : (
            <>
              No session headers were found, which means Proxy did not run for
              this path. Check the <code>matcher</code> in{" "}
              <code className="font-mono">proxy.ts</code>.
            </>
          )}
        </p>

        {session && (
          <dl className="mt-8 overflow-hidden rounded-lg border border-black/10 dark:border-white/15">
            <div className="flex flex-col gap-1 border-b border-black/10 px-4 py-3 dark:border-white/15 sm:flex-row sm:items-center sm:gap-4">
              <dt className="w-32 shrink-0 text-sm text-zinc-500">Session ID</dt>
              <dd className="break-all font-mono text-sm text-black dark:text-zinc-100">
                {session.sessionId}
              </dd>
            </div>
            <div className="flex flex-col gap-1 px-4 py-3 sm:flex-row sm:items-center sm:gap-4">
              <dt className="w-32 shrink-0 text-sm text-zinc-500">Nickname</dt>
              <dd className="font-mono text-sm text-black dark:text-zinc-100">
                {session.nickname}
              </dd>
            </div>
          </dl>
        )}

        <nav className="mt-8 flex flex-wrap gap-3">
          <Link
            href="/wall"
            className="rounded-lg bg-emerald-600 px-4 py-2 text-sm font-medium text-white hover:bg-emerald-500"
          >
            DUDU Wall
          </Link>
          <Link
            href="/rooms"
            className="rounded-lg border border-black/15 px-4 py-2 text-sm font-medium hover:bg-black/[.04] dark:border-white/15 dark:hover:bg-white/[.06]"
          >
            Video rooms
          </Link>
        </nav>

        <p className="mt-8 text-sm leading-6 text-zinc-500">
          Region lock active — this service only answers requests originating in
          Germany. See <code className="font-mono">lib/geo/region-lock.ts</code>{" "}
          for the trust model.
        </p>
      </main>
    </div>
  );
}
