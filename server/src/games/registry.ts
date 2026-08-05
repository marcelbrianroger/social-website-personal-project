import { mrWhite } from './mr-white.js'
import { thirtySixQuestions } from './thirty-six-questions.js'
import { ticTacToe } from './tic-tac-toe.js'
import type { AnyGameDefinition } from './types.js'

/**
 * Available games.
 *
 * Adding a game means writing a GameDefinition and listing it here — no
 * transport, Redis or socket code changes. Mr. White proved that: it needed
 * hidden roles, a phase clock and scoped chat, and all three landed as methods
 * on the contract rather than as special cases in the engine. 36 Questions
 * proved it again from the opposite direction: no turn order at all, and a
 * penalty phase where the only legal move belongs to the player who did NOT
 * trigger it.
 */
const DEFINITIONS: AnyGameDefinition[] = [
  ticTacToe as AnyGameDefinition,
  mrWhite as AnyGameDefinition,
  thirtySixQuestions as AnyGameDefinition,
]

const byId = new Map<string, AnyGameDefinition>(
  DEFINITIONS.map((definition) => [definition.id, definition]),
)

export function getGameDefinition(gameId: unknown): AnyGameDefinition | null {
  if (typeof gameId !== 'string') return null
  return byId.get(gameId) ?? null
}

export function listGames(): Array<{
  id: string
  label: string
  minPlayers: number
  maxPlayers: number
}> {
  return DEFINITIONS.map(({ id, label, minPlayers, maxPlayers }) => ({
    id,
    label,
    minPlayers,
    maxPlayers,
  }))
}
