"use client";

import { useState } from "react";

import { ConnectionStatus, SHELL, SystemNote } from "@/app/chrome";
import { useDuduWall } from "@/lib/dudu/use-dudu-wall";
import { MAX_MESSAGE_LENGTH } from "@/lib/socket/events";

/** How long until this slip comes down. */
function timeLeft(expiresAt: string): string {
  const remaining = new Date(expiresAt).getTime() - Date.now();
  if (remaining <= 0) return "gone";

  const hours = Math.floor(remaining / 3_600_000);
  if (hours >= 1) return `${hours}h left`;

  const minutes = Math.floor(remaining / 60_000);
  if (minutes >= 1) return `${minutes}m left`;

  return `${Math.floor(remaining / 1000)}s left`;
}

/** Under an hour, it is close enough to the end to mark. */
function isSoon(expiresAt: string): boolean {
  return new Date(expiresAt).getTime() - Date.now() < 3_600_000;
}

/**
 * Deterministic tilts and nudges, so the board looks pinned rather than laid
 * out. The nudge is a translate, not a margin, so it cannot break the grid.
 */
const TILTS = [-1.6, 1.1, -0.7, 1.4, -1.2, 0.6];
const NUDGES = [
  [0, 0],
  [-5, 3],
  [4, -2],
  [-3, -4],
  [5, 3],
  [-4, 2],
] as const;

export function WallClient() {
  const { messages, session, connected, error, posting, post, clearError } =
    useDuduWall();
  const [draft, setDraft] = useState("");

  const remaining = MAX_MESSAGE_LENGTH - draft.length;
  const canPost =
    connected && !posting && draft.trim().length > 0 && remaining >= 0;

  return (
    <div className={`${SHELL} py-12 sm:py-16`}>
      <div className="flex flex-wrap items-end justify-between gap-4">
        <div>
          <p className="font-mono text-xs lowercase tracking-wide text-ink-soft">
            the wall
          </p>
          <h1
            className="mt-3 font-display text-[clamp(1.875rem,5vw,3rem)] leading-[1.02] tracking-[-0.02em]"
            style={{ fontVariationSettings: "'wght' 800, 'wdth' 92" }}
          >
            Everything is gone after 24 hours.
          </h1>
        </div>

        <ConnectionStatus
          connected={connected}
          nickname={session?.nickname ?? null}
        />
      </div>

      {/* A blank slip, waiting to be filled in. */}
      <form
        className="mt-10 border-2 border-ink bg-stock p-5"
        onSubmit={async (event) => {
          event.preventDefault();
          if (!canPost) return;
          if (await post(draft)) setDraft("");
        }}
      >
        <textarea
          value={draft}
          onChange={(event) => {
            setDraft(event.target.value);
            if (error) clearError();
          }}
          disabled={!connected}
          rows={3}
          maxLength={MAX_MESSAGE_LENGTH + 40}
          placeholder="Write anything…"
          aria-label="Your note"
          className="w-full resize-none bg-transparent text-[1.0625rem] leading-relaxed text-ink outline-none placeholder:text-ink-soft/70 disabled:opacity-50"
        />

        <div className="mt-4 flex items-center justify-between gap-3 border-t border-rule pt-4">
          <span
            className={`font-mono text-xs tabular-nums ${
              remaining < 0 ? "bg-pink px-1 text-paper" : "text-ink-soft"
            }`}
          >
            {remaining}
            <span className="sr-only"> characters left</span>
          </span>

          <button
            type="submit"
            disabled={!canPost}
            className="border-2 border-ink bg-ink px-6 py-2.5 font-mono text-sm text-paper transition-colors hover:bg-pink hover:text-ink disabled:opacity-40 disabled:hover:bg-ink disabled:hover:text-paper"
          >
            {posting ? "Pinning…" : "Pin it up"}
          </button>
        </div>
      </form>

      {error && (
        <SystemNote alert className="mt-4">
          {error}
        </SystemNote>
      )}

      {messages.length === 0 ? (
        <p className="mt-10 border-2 border-dashed border-rule px-5 py-16 text-center text-ink-soft">
          The wall is empty. Pin up the first one.
        </p>
      ) : (
        <ul className="board mt-10 grid grid-cols-1 items-start p-3 sm:grid-cols-2 lg:grid-cols-3">
          {messages.map((message, index) => {
            const tilt = TILTS[index % TILTS.length]!;
            const [nudgeX, nudgeY] = NUDGES[index % NUDGES.length]!;

            return (
              <li
                key={message.id}
                style={{
                  transform: `rotate(${tilt}deg) translate(${nudgeX}px, ${nudgeY}px)`,
                  zIndex: index % 2 === 0 ? 2 : 1,
                }}
                className="slip relative flex min-h-44 flex-col justify-between border-2 border-ink bg-stock px-6 pt-10 pb-5"
              >
                <span
                  aria-hidden="true"
                  className="absolute left-[13px] top-[13px] size-2.5 rounded-full bg-pink"
                />

                <p className="whitespace-pre-wrap break-words text-[1.0625rem] leading-snug text-ink">
                  {message.body}
                </p>

                <div className="mt-6 flex items-baseline justify-between gap-3 font-mono text-[0.6875rem]">
                  <span className="truncate text-ink-soft">
                    {message.nickname}
                  </span>
                  <span
                    className={`shrink-0 ${
                      isSoon(message.expiresAt)
                        ? "bg-pink px-1 text-paper"
                        : "text-ink-soft"
                    }`}
                  >
                    {timeLeft(message.expiresAt)}
                  </span>
                </div>
              </li>
            );
          })}
        </ul>
      )}

      <p className="mt-10 max-w-2xl border-t-2 border-ink pt-5 text-sm leading-relaxed text-ink-soft">
        Everything goes through a filter before it shows up. No links, and no
        more than five notes a minute.
      </p>
    </div>
  );
}
