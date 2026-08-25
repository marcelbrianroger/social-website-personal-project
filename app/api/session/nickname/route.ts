import { cookies } from 'next/headers'

import { getCurrentSession } from '@/lib/session/current-session'
import { validateNickname } from '@/lib/session/nickname'
import {
  SESSION_COOKIE_NAME,
  sessionCookieOptions,
  signSession,
} from '@/lib/session/session'

/**
 * Changes the visitor's display name.
 *
 * The name lives in the session JWT and nowhere else — there is no user row to
 * update — so a rename is simply the same identity signed again under a
 * different name and handed back as a cookie. The session UUID never changes,
 * which is what keeps the rate limit, and everything else keyed to the person
 * rather than the name, attached across a rename.
 *
 * WHAT DOES NOT CHANGE: notes already on the wall. Each stores the name as it
 * was when it was written, and Redis is not rewritten here — a note is a thing
 * somebody pinned up at a moment, not a live view of who they are now.
 *
 * PROPAGATION: sockets read the name from the handshake, so any connection
 * opened after this call has the new one — including every page navigation,
 * which mounts a fresh socket. A socket already open in another tab keeps the
 * old name until it reconnects. Acceptable: renaming is done from the home
 * page, which posts nothing.
 */

/** Per-visitor and cookie-setting. A cached response here would be a leak. */
export const dynamic = 'force-dynamic'

function json(body: unknown, status: number): Response {
  return Response.json(body, {
    status,
    headers: { 'cache-control': 'no-store' },
  })
}

/**
 * Reject anything not sent by our own pages.
 *
 * The session cookie is SameSite=Lax, so a cross-site POST arrives without it —
 * proxy.ts then mints a fresh identity for that request, and without this check
 * a form on another site could quietly replace a visitor's session with one it
 * named. Lax is what makes that only a nuisance rather than account theft, and
 * this is what makes it nothing at all.
 */
function sameOrigin(request: Request): boolean {
  const origin = request.headers.get('origin')

  // Same-origin fetch always sends Origin. Absent means it did not come from a
  // page — curl, a server, an extension — and there is no session to rename.
  if (!origin) return false

  try {
    return new URL(origin).host === new URL(request.url).host
  } catch {
    return false
  }
}

export async function POST(request: Request): Promise<Response> {
  if (!sameOrigin(request)) {
    return json({ error: 'cross-origin' }, 403)
  }

  const session = await getCurrentSession()

  if (!session) {
    return json({ error: 'no_session' }, 401)
  }

  let body: unknown
  try {
    body = await request.json()
  } catch {
    return json({ error: 'invalid-body' }, 400)
  }

  const requested = (body as { nickname?: unknown } | null)?.nickname

  if (typeof requested !== 'string') {
    return json({ error: 'invalid-body' }, 400)
  }

  const verdict = validateNickname(requested)

  if (!verdict.ok) {
    return json({ error: verdict.reason }, 422)
  }

  /**
   * On a request that arrived with no session cookie, proxy.ts has already put
   * one on this response, so the browser receives two Set-Cookie headers for
   * `dudu_session` and keeps the last — this one. Not worth engineering around:
   * both carry the same session UUID and differ only in the name, so losing the
   * race would leave the visitor with the identity they already had, and the
   * real UI cannot reach this path anyway (the page that renders the rename
   * form is itself what delivered the cookie).
   */
  const store = await cookies()

  store.set(
    SESSION_COOKIE_NAME,
    await signSession({
      sessionId: session.sessionId,
      nickname: verdict.nickname,
    }),
    sessionCookieOptions,
  )

  // The normalized form, not what was typed: the caller renders this, and it
  // has to match what was actually signed.
  return json({ nickname: verdict.nickname }, 200)
}
