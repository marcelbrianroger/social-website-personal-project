import { getClientIp, isPrivateOrLoopback } from '@/lib/geo/client-ip'
import { lookupCountry } from '@/lib/geo/maxmind'

/**
 * Region lock policy: only traffic originating in the configured countries
 * (Germany by default) may reach the app.
 *
 * THREAT MODEL — read before trusting this.
 *
 * Geo headers like `cf-ipcountry` are only meaningful when the edge that sets
 * them is the sole ingress path AND overwrites the header on every request.
 * Self-hosted behind nothing, a client can simply send `cf-ipcountry: DE`.
 * That is why header trust is opt-in via GEO_TRUST_PROXY_HEADERS and defaults
 * to off; with it off, the country comes from a MaxMind lookup instead.
 *
 * The MaxMind path is itself only as trustworthy as the IP it is given, which
 * comes from `x-forwarded-for` and friends. A truly spoof-proof region lock
 * belongs in the reverse proxy (nginx `ngx_http_geoip2_module`, Caddy, or a
 * CDN rule), where the real peer address is known. This module is defence in
 * depth and a correct default — not a substitute for that.
 */

export type GeoSource = 'trusted-header' | 'maxmind' | 'none'

export type RegionDecision =
  | {
      allowed: true
      reason: 'local-bypass' | 'allowed-country' | 'unknown-country-allowed'
      country: string | null
      source: GeoSource
      ip: string | null
    }
  | {
      allowed: false
      reason: 'blocked-country' | 'unknown-country-denied'
      country: string | null
      source: GeoSource
      ip: string | null
    }

/** Cloudflare uses these pseudo-codes for "no country" and Tor exit nodes. */
const NON_COUNTRY_CODES = new Set(['XX', 'T1'])

function envFlag(name: string, fallback: boolean): boolean {
  const raw = process.env[name]
  if (raw === undefined) return fallback
  return raw.toLowerCase() === 'true'
}

function allowedCountries(): Set<string> {
  const raw = process.env.GEO_ALLOWED_COUNTRIES ?? 'DE'
  return new Set(
    raw
      .split(',')
      .map((code) => code.trim().toUpperCase())
      .filter(Boolean),
  )
}

/**
 * Read a country code from upstream headers.
 *
 * Only consulted when GEO_TRUST_PROXY_HEADERS is true — otherwise these are
 * attacker-controlled strings.
 */
function countryFromHeaders(headers: Headers): string | null {
  const candidates = [
    process.env.GEO_TRUSTED_COUNTRY_HEADER ?? 'x-geo-country',
    'cf-ipcountry', // Cloudflare
    'x-vercel-ip-country', // Vercel
  ]

  for (const header of candidates) {
    const value = headers.get(header)?.trim().toUpperCase()
    if (value && value.length === 2 && !NON_COUNTRY_CODES.has(value)) {
      return value
    }
  }

  return null
}

/** Resolve the request's origin country and decide whether it may proceed. */
export async function evaluateRegionLock(
  headers: Headers,
): Promise<RegionDecision> {
  const ip = getClientIp(headers)

  // Local development and internal health checks have no routable address and
  // would otherwise be blocked outright.
  if (envFlag('GEO_BYPASS_LOCALHOST', true) && (!ip || isPrivateOrLoopback(ip))) {
    return {
      allowed: true,
      reason: 'local-bypass',
      country: null,
      source: 'none',
      ip,
    }
  }

  let country: string | null = null
  let source: GeoSource = 'none'

  if (envFlag('GEO_TRUST_PROXY_HEADERS', false)) {
    country = countryFromHeaders(headers)
    if (country) source = 'trusted-header'
  }

  if (!country && ip) {
    country = await lookupCountry(ip)
    if (country) source = 'maxmind'
  }

  if (!country) {
    const denyUnknown = (process.env.GEO_FALLBACK ?? 'allow').toLowerCase() === 'deny'
    return denyUnknown
      ? { allowed: false, reason: 'unknown-country-denied', country: null, source, ip }
      : { allowed: true, reason: 'unknown-country-allowed', country: null, source, ip }
  }

  return allowedCountries().has(country)
    ? { allowed: true, reason: 'allowed-country', country, source, ip }
    : { allowed: false, reason: 'blocked-country', country, source, ip }
}

/**
 * 403 page for blocked visitors.
 *
 * Deliberately self-contained: rendering a Next.js route here would mean
 * letting a blocked request into the app it is being kept out of.
 */
export function accessDeniedResponse(decision: RegionDecision): Response {
  const body = `<!doctype html>
<html lang="de">
<head>
<meta charset="utf-8">
<meta name="viewport" content="width=device-width, initial-scale=1">
<title>403: Zugriff verweigert</title>
<style>
  :root { color-scheme: light dark; }
  body {
    margin: 0; min-height: 100vh; display: grid; place-items: center;
    font: 16px/1.6 system-ui, -apple-system, "Segoe UI", sans-serif;
    background: #0b0b0f; color: #e8e8ee; padding: 2rem;
  }
  main { max-width: 34rem; text-align: center; }
  h1 { font-size: 3rem; margin: 0 0 .5rem; letter-spacing: -.03em; }
  p { margin: 0 0 .75rem; color: #a0a0ad; }
  code { color: #e8e8ee; }
</style>
</head>
<body>
  <main>
    <h1>403</h1>
    <p><strong>Zugriff verweigert: Access Denied</strong></p>
    <p>Dieser Dienst ist nur aus Deutschland erreichbar.</p>
    <p>This service is only available from Germany.</p>
  </main>
</body>
</html>`

  return new Response(body, {
    status: 403,
    headers: {
      'content-type': 'text/html; charset=utf-8',
      // A blocked response must never be cached and served to someone else.
      'cache-control': 'no-store, private',
      'x-region-lock': decision.reason,
    },
  })
}
