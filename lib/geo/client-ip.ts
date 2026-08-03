/**
 * Client IP extraction from request headers.
 *
 * Next.js removed `request.ip` in v15, and Proxy has no access to the raw
 * socket, so the peer address can only come from headers.
 *
 * SECURITY: every header read here is attacker-controlled unless a reverse
 * proxy you operate overwrites it. Treat the result as a hint, not as proof.
 * See lib/geo/region-lock.ts for how that uncertainty is handled.
 */

/** Headers carrying a client IP, most-specific first. */
const IP_HEADERS = [
  'cf-connecting-ip', // Cloudflare
  'x-real-ip', // nginx `proxy_set_header X-Real-IP`
  'x-forwarded-for', // de-facto standard, may be a comma-separated chain
] as const

export function getClientIp(headers: Headers): string | null {
  for (const header of IP_HEADERS) {
    const value = headers.get(header)
    if (!value) continue

    // x-forwarded-for is "client, proxy1, proxy2" — the leftmost entry is the
    // originating client, and also the only one a client can forge.
    const candidate = value.split(',')[0]?.trim()

    if (candidate && isIpAddress(candidate)) {
      return normaliseIp(candidate)
    }
  }

  return null
}

/** Strip an IPv4-mapped IPv6 prefix (`::ffff:1.2.3.4`) and any zone/port. */
function normaliseIp(ip: string): string {
  const unmapped = ip.startsWith('::ffff:') ? ip.slice(7) : ip
  return unmapped.split('%')[0]!
}

const IPV4_PATTERN = /^(\d{1,3}\.){3}\d{1,3}$/
const IPV6_PATTERN = /^[0-9a-f:]+$/i

function isIpAddress(value: string): boolean {
  if (IPV4_PATTERN.test(value)) {
    return value.split('.').every((octet) => Number(octet) <= 255)
  }
  return value.includes(':') && IPV6_PATTERN.test(value)
}

/**
 * Loopback, link-local, and RFC1918 addresses.
 *
 * These never resolve to a country, so the region lock treats them separately
 * rather than letting them fall through to "unknown".
 */
export function isPrivateOrLoopback(ip: string): boolean {
  if (ip === '::1' || ip === '0.0.0.0') return true

  if (IPV4_PATTERN.test(ip)) {
    const [a, b] = ip.split('.').map(Number) as [number, number]

    if (a === 127) return true // 127.0.0.0/8 loopback
    if (a === 10) return true // 10.0.0.0/8
    if (a === 192 && b === 168) return true // 192.168.0.0/16
    if (a === 172 && b >= 16 && b <= 31) return true // 172.16.0.0/12
    if (a === 169 && b === 254) return true // 169.254.0.0/16 link-local
    return false
  }

  const lower = ip.toLowerCase()
  // fc00::/7 unique-local, fe80::/10 link-local
  return lower.startsWith('fc') || lower.startsWith('fd') || lower.startsWith('fe80')
}
