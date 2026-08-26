"use client";

import { useState } from "react";

import { ConnectionStatus, SHELL, SystemNote } from "@/components/site-chrome";
import { BOARD, WallSlip } from "@/components/wall-slip";
import { useWall } from "@/lib/wall/use-wall";
import { MAX_MESSAGE_LENGTH } from "@/lib/socket/events";

export function WallClient() {
  const { messages, session, connected, error, posting, post, clearError } =
    useWall();
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
            Everything is gone after 48 hours.
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
        <ul className={`${BOARD} mt-10`}>
          {messages.map((message, index) => (
            <WallSlip key={message.id} message={message} slot={index} />
          ))}
        </ul>
      )}

      <p className="mt-10 max-w-2xl border-t-2 border-ink pt-5 text-sm leading-relaxed text-ink-soft">
        Everything goes through a filter before it shows up. No links, and no
        more than five notes a minute.
      </p>
    </div>
  );
}
