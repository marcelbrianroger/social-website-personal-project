import { NextResponse } from 'next/server'
import type { NextRequest } from 'next/server'

import { accessDeniedResponse, evaluateRegionLock } from '@/lib/geo/region-lock'
import {
  SESSION_COOKIE_NAME,
  SESSION_HEADER_ID,
  SESSION_HEADER_NICKNAME,
  createAnonymousSession,
  sessionCookieOptions,
  signSession,
  verifySession,
} from '@/lib/session/session'

/**
 * Request gate for the whole app.
 *
 * NOTE ON NAMING: this is `proxy.ts`, not `middleware.ts`. Next.js 16 renamed
 * the convention and deprecated `middleware` — the exported function must be
 * named `proxy` (or be the default export).
 *
 * NOTE ON RUNTIME: Proxy runs in the Node.js runtime in Next 16, and the
 * `runtime` route-segment option is NOT available here (setting it throws).
 * That is what lets the MaxMind GeoIP lookup work at all.
 *
 * Two responsibilities, in order:
 *   1. Region lock — non-German traffic gets a 403 and never reaches the app.
 *   2. Anonymous session — first-time visitors are issued a signed identity.
 *
 * Ordering matters: blocked traffic must not be handed a session cookie.
 */
export async function proxy(request: NextRequest): Promise<Response> {
  const decision = await evaluateRegionLock(request.headers)

  if (!decision.allowed) {
    return accessDeniedResponse(decision)
  }

  const existing = await verifySession(
    request.cookies.get(SESSION_COOKIE_NAME)?.value,
  )

  // A cookie set on the *response* is not visible to `cookies()` during the
  // same render — that reads the incoming request. So the identity is also
  // forwarded as request headers, which Server Components can read immediately,
  // including on the very first visit.
  const session = existing ?? createAnonymousSession()

  const requestHeaders = new Headers(request.headers)
  requestHeaders.set(SESSION_HEADER_ID, session.sessionId)
  // Nicknames may contain umlauts; headers are latin1, so percent-encode.
  requestHeaders.set(SESSION_HEADER_NICKNAME, encodeURIComponent(session.nickname))

  const response = NextResponse.next({ request: { headers: requestHeaders } })

  if (!existing) {
    response.cookies.set(
      SESSION_COOKIE_NAME,
      await signSession(session),
      sessionCookieOptions,
    )
  }

  return response
}

export const config = {
  matcher: [
    /*
     * Everything except build assets and static metadata.
     *
     * API routes are deliberately INCLUDED — excluding them would leave an
     * unguarded path straight past the region lock.
     */
    '/((?!_next/static|_next/image|favicon.ico|robots.txt|sitemap.xml).*)',
  ],
}
