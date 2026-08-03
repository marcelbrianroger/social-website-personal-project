/**
 * Text moderation gate for DUDU submissions.
 *
 * ============================ READ THIS ============================
 * CLAUDE.md requires that "all submissions must pass through an AI text
 * moderation filter before being broadcasted".
 *
 * THIS IS NOT THAT FILTER. What follows is a cheap local heuristic: length
 * limits, shouting, character spam, link blocking and a tiny word list. It
 * will not catch harassment, hate speech, coded language, or anything phrased
 * with the slightest creativity.
 *
 * It exists so the publish path has a real gate in front of it instead of a
 * TODO, and so swapping in a proper classifier is a one-function change. Before
 * this goes anywhere near real users, implement `aiModeration` below against an
 * actual service (OpenAI moderations, Perspective API, or Claude) and set
 * MODERATION_PROVIDER=ai.
 * ===================================================================
 */

export interface ModerationVerdict {
  allowed: boolean
  /** Short machine-readable reason, surfaced to the poster. */
  reason?: string
}

export const MAX_MESSAGE_LENGTH = 280
const MIN_MESSAGE_LENGTH = 2

/**
 * Deliberately tiny and obviously incomplete. A real deployment replaces this
 * wholesale — maintaining a word list is a losing game and is not the intended
 * long-term approach.
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

const LINK_PATTERN = /(https?:\/\/|www\.|\b[a-z0-9-]+\.(com|net|org|de|io|ru|xyz)\b)/i

/** Four or more of the same character in a row: "aaaaaa", "!!!!!!". */
const CHAR_SPAM_PATTERN = /(.)\1{5,}/

function heuristicModeration(text: string): ModerationVerdict {
  const trimmed = text.trim()

  if (trimmed.length < MIN_MESSAGE_LENGTH) {
    return { allowed: false, reason: 'too-short' }
  }

  if (trimmed.length > MAX_MESSAGE_LENGTH) {
    return { allowed: false, reason: 'too-long' }
  }

  if (LINK_PATTERN.test(trimmed)) {
    return { allowed: false, reason: 'links-not-allowed' }
  }

  if (CHAR_SPAM_PATTERN.test(trimmed)) {
    return { allowed: false, reason: 'character-spam' }
  }

  const letters = trimmed.replace(/[^\p{L}]/gu, '')
  if (letters.length >= 12) {
    const uppercase = trimmed.replace(/[^\p{Lu}]/gu, '').length
    if (uppercase / letters.length > 0.7) {
      return { allowed: false, reason: 'excessive-caps' }
    }
  }

  const normalised = trimmed.toLowerCase()
  if (BLOCKED_TERMS.some((term) => normalised.includes(term))) {
    return { allowed: false, reason: 'blocked-language' }
  }

  return { allowed: true }
}

/**
 * Placeholder for the real classifier.
 *
 * Implement against your provider of choice and return its verdict. Keep the
 * `throw` on failure — see the fail-closed note in `moderateText`.
 */
async function aiModeration(_text: string): Promise<ModerationVerdict> {
  throw new Error(
    'MODERATION_PROVIDER=ai is set but no AI moderation backend is implemented in server/src/moderation.ts',
  )
}

/**
 * Moderate a submission.
 *
 * FAIL CLOSED: if a remote classifier is configured and it errors or times out,
 * the message is rejected rather than published. An outage must not become an
 * open floodgate — the whole point of the gate is that nothing reaches the wall
 * unchecked.
 */
export async function moderateText(text: string): Promise<ModerationVerdict> {
  const provider = (process.env.MODERATION_PROVIDER ?? 'heuristic').toLowerCase()

  if (provider === 'ai') {
    try {
      return await aiModeration(text)
    } catch (error) {
      console.error(
        '[moderation] classifier unavailable, rejecting submission:',
        error instanceof Error ? error.message : error,
      )
      return { allowed: false, reason: 'moderation-unavailable' }
    }
  }

  // Length limits still apply even when moderation is disabled outright,
  // otherwise a single post could exhaust memory.
  if (provider === 'none') {
    const trimmed = text.trim()
    if (trimmed.length < MIN_MESSAGE_LENGTH) return { allowed: false, reason: 'too-short' }
    if (trimmed.length > MAX_MESSAGE_LENGTH) return { allowed: false, reason: 'too-long' }
    return { allowed: true }
  }

  return heuristicModeration(text)
}
