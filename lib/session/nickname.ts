/**
 * Nicknames for anonymous visitors: the one they are handed, and the one they
 * may choose instead.
 *
 * Uses Web Crypto (`crypto.getRandomValues`), which is a global in both the
 * Next.js runtime and Node 18+, so this module stays portable. It imports
 * nothing server-only, so the rename form can import the rules it enforces
 * rather than restating them and drifting.
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

/** Shape of a name this site could have handed out: AdjectiveNoun123. */
const GENERATED_SHAPE = /^(\p{Lu}\p{Ll}+)(\p{Lu}\p{Ll}+)(\d{3})$/u

/**
 * Whether a name is one of ours rather than one somebody chose.
 *
 * Checked against the actual word lists, not just the shape, so it cannot be
 * fooled into calling a typed name generated. It exists so the page can say
 * "handed to you" only while that is still true — the alternative was carrying
 * a `chosen` flag through the token, the proxy headers and the session type, to
 * decide one sentence.
 */
export function looksGenerated(nickname: string): boolean {
  const match = GENERATED_SHAPE.exec(nickname)
  if (!match) return false

  const adjectives: readonly string[] = ADJECTIVES
  const nouns: readonly string[] = NOUNS

  return adjectives.includes(match[1]!) && nouns.includes(match[2]!)
}

/**
 * A chosen name is shorter than a generated one on purpose: it is printed on
 * every slip that person pins up, beside a countdown, inside a box roughly one
 * newspaper column wide. Anything longer is truncated by the board anyway, so
 * the limit is honest about what will actually be read.
 *
 * The upper bound stays well under the 48 `verifySession` allows and the 48 the
 * `nickname` column holds, so a name that passes here cannot fail later.
 */
export const NICKNAME_MIN_LENGTH = 2
export const NICKNAME_MAX_LENGTH = 24

export type NicknameRejection =
  | 'too-short'
  | 'too-long'
  | 'invalid-characters'
  | 'blocked-language'

/** What the person who typed it is told. Plain, and never scolding. */
export const NICKNAME_ERROR_TEXT: Record<NicknameRejection, string> = {
  'too-short': `A name needs at least ${NICKNAME_MIN_LENGTH} characters.`,
  'too-long': `A name can be at most ${NICKNAME_MAX_LENGTH} characters.`,
  'invalid-characters':
    'Letters, numbers, spaces, and . _ - only. No emoji, no symbols.',
  'blocked-language': 'That name did not pass the filter. Try another.',
}

/**
 * MIRRORED from `server/src/moderation.ts`, deliberately.
 *
 * A name is printed beside every note its owner writes, so it has to pass the
 * same bar the notes do — but `/server` is a separate npm package with its own
 * build, and reaching across that boundary to share a seven-item array would
 * couple the two builds together for no real gain. Same tradeoff, and the same
 * hand-sync obligation, as the JWT constants in `server/src/session.ts`.
 */
const BLOCKED_TERMS = [
  'fuck',
  'shit',
  'bitch',
  'asshole',
  'wichser',
  'arschloch',
  'hurensohn',
]

/**
 * Characters a name may not contain, whatever it looks like on screen.
 *
 * `\p{Cf}` is the one doing the real work: it covers the zero-width joiners and
 * the bidi overrides, which are how two different names are made to render
 * identically — the whole trick behind impersonating someone on a board where
 * the name is the only identity anyone can see.
 */
const INVISIBLE = /[\p{Cc}\p{Cf}\p{Zl}\p{Zp}]/gu

/** Every other kind of space — NBSP and friends — flattened to a plain one. */
const EXOTIC_SPACE = /\p{Zs}/gu

/**
 * Must open with a letter or a digit, so a name cannot start with punctuation
 * and sort or read as something other than a name.
 */
const ALLOWED_SHAPE = /^[\p{L}\p{N}][\p{L}\p{N} ._-]*$/u

/**
 * Tidy a typed name into the form that will be stored.
 *
 * Exported because the form shows the result live: what is counted, and what
 * ends up on the slips, has to be the same string.
 */
export function normalizeNickname(raw: string): string {
  return raw
    .replace(INVISIBLE, '')
    .replace(EXOTIC_SPACE, ' ')
    .replace(/ {2,}/g, ' ')
    .trim()
}

export type NicknameVerdict =
  | { ok: true; nickname: string }
  | { ok: false; reason: NicknameRejection }

/**
 * Decide whether a typed name may be worn.
 *
 * Runs on the server, on a payload from the client, and is the only thing
 * standing between a text input and a string signed into a session token — so
 * it validates the normalized form, and returns that form rather than the
 * input, leaving the caller nothing to get wrong.
 */
export function validateNickname(raw: string): NicknameVerdict {
  const nickname = normalizeNickname(raw)

  if (nickname.length < NICKNAME_MIN_LENGTH) {
    return { ok: false, reason: 'too-short' }
  }

  if (nickname.length > NICKNAME_MAX_LENGTH) {
    return { ok: false, reason: 'too-long' }
  }

  if (!ALLOWED_SHAPE.test(nickname)) {
    return { ok: false, reason: 'invalid-characters' }
  }

  const lowered = nickname.toLowerCase()
  if (BLOCKED_TERMS.some((term) => lowered.includes(term))) {
    return { ok: false, reason: 'blocked-language' }
  }

  return { ok: true, nickname }
}
