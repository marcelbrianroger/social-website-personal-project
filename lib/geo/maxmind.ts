import path from 'node:path'

/**
 * Self-hosted GeoIP lookup backed by a MaxMind GeoLite2-Country database.
 *
 * This is the fallback for deployments with no geo-aware CDN in front. It runs
 * because Next.js 16 Proxy executes in the Node.js runtime — under the old Edge
 * runtime `maxmind` could not load at all (it needs `fs`).
 *
 * The database is licensed and not committed. Download GeoLite2-Country.mmdb
 * from MaxMind and place it at MAXMIND_DB_PATH. If it is absent, every lookup
 * returns null and the caller applies its GEO_FALLBACK policy.
 */

type CountryReader = {
  get: (ip: string) => { country?: { iso_code?: string } } | null
}

/**
 * Cached open handle. `null` means "tried and unavailable" — memoised so a
 * missing database does not re-hit the filesystem on every request.
 */
let readerPromise: Promise<CountryReader | null> | undefined

async function loadReader(): Promise<CountryReader | null> {
  const configured = process.env.MAXMIND_DB_PATH

  if (!configured) return null

  // `turbopackIgnore` stops the build tracer from walking the whole project:
  // this path is resolved at runtime against a file that is deliberately not
  // part of the bundle (the .mmdb is downloaded separately and gitignored).
  const dbPath = path.isAbsolute(configured)
    ? configured
    : path.join(/* turbopackIgnore: true */ process.cwd(), configured)

  try {
    // Imported dynamically so the Node-only dependency is never pulled into a
    // bundle that might be evaluated in a non-Node context.
    const maxmind = await import('maxmind')
    return (await maxmind.open(dbPath)) as unknown as CountryReader
  } catch (error) {
    console.warn(
      `[geo] MaxMind database unavailable at ${dbPath} — falling back to header-based geo only.`,
      error instanceof Error ? error.message : error,
    )
    return null
  }
}

/**
 * Resolve an IP to an ISO 3166-1 alpha-2 country code, or null if the database
 * is unavailable or has no record for the address.
 */
export async function lookupCountry(ip: string): Promise<string | null> {
  readerPromise ??= loadReader()

  const reader = await readerPromise
  if (!reader) return null

  try {
    const result = reader.get(ip)
    const isoCode = result?.country?.iso_code
    return isoCode ? isoCode.toUpperCase() : null
  } catch {
    return null
  }
}

/** Whether a usable MaxMind database is loaded. Useful for health checks. */
export async function isGeoDatabaseAvailable(): Promise<boolean> {
  readerPromise ??= loadReader()
  return (await readerPromise) !== null
}
