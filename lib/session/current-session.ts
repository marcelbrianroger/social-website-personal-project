import { headers } from 'next/headers'

import {
  SESSION_HEADER_ID,
  SESSION_HEADER_NICKNAME,
  type AnonymousSession,
} from '@/lib/session/session'

/**
 * Read the current visitor's anonymous identity inside a Server Component or
 * Route Handler.
 *
 * Reads the headers injected by proxy.ts rather than the cookie. On a first
 * visit the cookie is only in the outgoing Set-Cookie and `cookies()` would
 * still report nothing, so header-first is what makes the very first render
 * work.
 *
 * Returns null only if proxy did not run for this path — check the `matcher`
 * in proxy.ts if you hit that.
 */
export async function getCurrentSession(): Promise<AnonymousSession | null> {
  const headerList = await headers()

  const sessionId = headerList.get(SESSION_HEADER_ID)
  const nickname = headerList.get(SESSION_HEADER_NICKNAME)

  if (!sessionId || !nickname) return null

  return {
    sessionId,
    nickname: decodeURIComponent(nickname),
  }
}
