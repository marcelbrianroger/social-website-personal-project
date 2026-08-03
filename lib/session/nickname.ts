/**
 * Random nickname generation for anonymous visitors.
 *
 * Uses Web Crypto (`crypto.getRandomValues`), which is a global in both the
 * Next.js runtime and Node 18+, so this module stays portable.
 */

const ADJECTIVES = [
  'Blau', 'Flink', 'Klug', 'Leise', 'Mutig', 'Ruhig', 'Sanft', 'Stolz',
  'Wild', 'Froh', 'Hell', 'Kühn', 'Munter', 'Weise', 'Zart', 'Frei',
  'Golden', 'Silbern', 'Nebel', 'Sturm', 'Winter', 'Sommer', 'Abend', 'Morgen',
] as const

const NOUNS = [
  'Fuchs', 'Dachs', 'Reiher', 'Luchs', 'Otter', 'Falke', 'Rabe', 'Hirsch',
  'Igel', 'Marder', 'Kranich', 'Uhu', 'Biber', 'Wolf', 'Specht', 'Eule',
  'Anker', 'Turm', 'Fluss', 'Brücke', 'Garten', 'Stein', 'Wolke', 'Funke',
] as const

/**
 * Uniformly random integer in [0, max).
 *
 * Rejection sampling — `% max` on a raw 32-bit draw would bias toward low
 * values whenever max is not a power of two.
 */
function randomIndex(max: number): number {
  const limit = Math.floor(0xffffffff / max) * max
  const buffer = new Uint32Array(1)

  let value: number
  do {
    crypto.getRandomValues(buffer)
    value = buffer[0]!
  } while (value >= limit)

  return value % max
}

function pick<T>(items: readonly T[]): T {
  return items[randomIndex(items.length)]!
}

/**
 * Generate a display nickname, e.g. `FlinkFuchs417`.
 *
 * The numeric suffix keeps collisions rare (24 x 24 x 900 ≈ 518k combinations)
 * without needing a uniqueness check. Nicknames are cosmetic — the session UUID
 * is the identity, so a collision is harmless.
 *
 * Always <= 48 chars, matching the `nickname` column width.
 */
export function generateNickname(): string {
  const suffix = 100 + randomIndex(900)
  return `${pick(ADJECTIVES)}${pick(NOUNS)}${suffix}`
}
