/**
 * The games this site can seat, as the site talks about them.
 *
 * ONE LIST, THREE SCREENS. The home page, the lobby entry and the host's picker
 * inside a table all name these games, and until this existed the home page
 * knew about Mr. White only — Werewolf shipped complete and was invisible to
 * anyone who did not already know the URL. A catalogue is the cheapest way to
 * make "there are two games" true everywhere at once rather than in the one
 * place somebody remembered to edit.
 *
 * The seat ranges are the server's, mirrored from `server/src/games/registry.ts`
 * so the copy can say "five to eight" without a round trip. As everywhere else
 * in this codebase that is a HINT: the server validates the seat count on
 * `game:start` regardless, and this only saves a host a rejection.
 */

export interface GameEntry {
  /** Matches the id in the server registry. */
  id: string
  label: string
  minPlayers: number
  maxPlayers: number
  /**
   * The hook, one sentence, in the second person.
   *
   * Written to say what YOU do, not what the game is about — "you hold a word
   * you were never given" beats "a social deduction game of hidden roles".
   */
  pitch: string
  /** The typed spec line: what this is, in the fewest words that are true. */
  spec: string
  /** Longer copy for the home page. Two sentences at most. */
  blurb: string
}

export const GAMES: readonly GameEntry[] = [
  {
    id: 'werewolf',
    label: 'Werewolf',
    minPlayers: 5,
    maxPlayers: 8,
    pitch: 'A pack eats one of you every night, and nobody admits what they are.',
    spec: 'eight roles · night and day · nobody tells the truth',
    blurb:
      'Five to eight players. Every night the wolves take somebody and the village wakes up one short; every day the table argues and hangs a suspect. Eight roles: a Seer who can read one person a night, a Witch holding one save and one kill, a Hunter who shoots back as they die, a Cupid who ties two people together, and a Jester who wins by getting himself hanged.',
  },
  {
    id: 'mr-white',
    label: 'Mr. White',
    minPlayers: 4,
    maxPlayers: 8,
    pitch: 'Everyone gets the same word. One of you gets a blank, and has to bluff.',
    spec: 'one word · one liar · four rounds',
    blurb:
      'Four to eight players. Everyone is given the same secret word except one, who has to work it out from what everybody else says without ever giving themselves away. One clue each per round, then the table votes.',
  },
]

/** Look one up by id. Null for an id this build does not know. */
export function gameById(id: string): GameEntry | null {
  return GAMES.find((game) => game.id === id) ?? null
}

/** "Five to eight" — the seat range as words, for running copy. */
export function seatRange(game: GameEntry): string {
  return `${game.minPlayers}–${game.maxPlayers} players`
}
