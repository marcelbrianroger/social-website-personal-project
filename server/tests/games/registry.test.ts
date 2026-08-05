import assert from 'node:assert/strict'
import { describe, it } from 'node:test'

import { getGameDefinition, listGames } from '../../src/games/registry.js'
import type { GamePlayer } from '../../src/games/types.js'

/**
 * The game registry.
 *
 * Seam: getGameDefinition / listGames. Pure lookup, no Redis.
 *
 * The contract block below runs against EVERY registered definition, so a game
 * added in a later phase — Mr. White, Werewolf — is held to the same rules the
 * engine assumes without anyone having to remember to extend this file.
 */

function player(nickname: string): GamePlayer {
  return {
    sessionId: `session-${nickname.toLowerCase()}`,
    socketId: `socket-${nickname.toLowerCase()}`,
    nickname,
  }
}

describe('looking up a game', () => {
  it('finds a registered game by id', () => {
    assert.equal(getGameDefinition('tic-tac-toe')?.id, 'tic-tac-toe')
  })

  it('returns nothing for an id nobody registered', () => {
    assert.equal(getGameDefinition('chess'), null)
    assert.equal(getGameDefinition('Tic-Tac-Toe'), null, 'ids are case sensitive')
  })

  it('returns nothing for input that is not an id', () => {
    // The id arrives straight off a socket, so every shape is possible.
    for (const raw of [null, undefined, 42, {}, [], true, () => {}]) {
      assert.equal(
        getGameDefinition(raw),
        null,
        `${String(raw)} must not resolve to a game`,
      )
    }
  })
})

describe('listing games', () => {
  it('publishes only what a lobby needs to render a menu', () => {
    for (const entry of listGames()) {
      assert.deepEqual(
        Object.keys(entry).sort(),
        ['id', 'label', 'maxPlayers', 'minPlayers'],
        'the rules themselves must not be shipped to clients',
      )
    }
  })

  it('lists every game that can actually be started', () => {
    for (const entry of listGames()) {
      assert.notEqual(
        getGameDefinition(entry.id),
        null,
        `${entry.id} is advertised but cannot be resolved`,
      )
    }
  })

  it('offers Tic-Tac-Toe, Mr. White and 36 Questions', () => {
    assert.deepEqual(
      listGames().map((entry) => entry.id),
      ['tic-tac-toe', 'mr-white', 'thirty-six-questions'],
      'Werewolf is still out of scope pending its own spec',
    )
  })
})

describe('every registered definition honours the contract', () => {
  for (const entry of listGames()) {
    describe(entry.id, () => {
      const definition = getGameDefinition(entry.id)!

      const players = Array.from({ length: entry.minPlayers }, (_, index) =>
        player(`P${index}`),
      )

      it('declares a workable player range', () => {
        assert.ok(definition.minPlayers >= 1, 'a game needs at least one player')
        assert.ok(
          definition.maxPlayers >= definition.minPlayers,
          'max must not be below min, or no game can ever start',
        )
      })

      it('has a human-readable label', () => {
        assert.equal(typeof definition.label, 'string')
        assert.ok(definition.label.length > 0)
      })

      it('opens with a live position', () => {
        const state = definition.createInitialState(players)

        assert.equal(
          definition.result(state),
          null,
          'a game must not be over before it starts',
        )
      })

      it('refuses a move from a session that is not playing', () => {
        const state = definition.createInitialState(players)

        const validation = definition.validateMove(state, 'session-outsider', {})

        assert.equal(
          validation.ok,
          false,
          'an outsider must never be able to move',
        )
      })

      it('survives hostile move input without throwing', () => {
        const state = definition.createInitialState(players)
        const mover = definition.actors(state)[0] ?? players[0]!.sessionId

        for (const raw of [null, undefined, 'x', 42, [], {}, { cell: -1 }]) {
          assert.doesNotThrow(
            () => definition.validateMove(state, mover, raw),
            `validateMove threw on ${String(raw)}`,
          )
        }
      })

      it('ends when a player walks away', () => {
        const state = definition.createInitialState(players)

        const forfeited = definition.forfeit(state, players[0]!.sessionId)

        assert.notEqual(
          definition.result(forfeited),
          null,
          'the engine relies on forfeit producing a terminal result',
        )
      })

      it('removes one player without leaving the game unable to advance', () => {
        const state = definition.createInitialState(players)
        const departed = players[0]!.sessionId

        const next = definition.eliminate(state, departed, Date.now())

        // The deadlock this guards against: a game that is neither over, nor has
        // anyone who may act, nor has a clock that would advance it. Nothing
        // could ever move it again.
        assert.ok(
          definition.result(next) !== null ||
            definition.actors(next).length > 0 ||
            definition.deadline(next) !== null,
          'eliminating a player left the game with no way to advance',
        )

        assert.equal(
          definition.actors(next).includes(departed),
          false,
          'a player who is gone must not still be asked to act',
        )
      })

      it('does not mutate state when eliminating a player', () => {
        const state = definition.createInitialState(players)
        const snapshot = JSON.parse(JSON.stringify(state))

        // The engine may call this more than once across a compare-and-set
        // retry, so a mutation would corrupt the state the retry reads.
        definition.eliminate(state, players[0]!.sessionId, Date.now())

        assert.deepEqual(state, snapshot)
      })

      it('projects a view for players and observers alike', () => {
        const state = definition.createInitialState(players)

        assert.doesNotThrow(() => definition.viewFor(state, players[0]!.sessionId))
        assert.doesNotThrow(
          () => definition.viewFor(state, null),
          'viewFor must tolerate an observer',
        )
      })

      it('produces a state that survives a Redis round trip', () => {
        const state = definition.createInitialState(players)

        // The engine persists state as JSON. Anything not JSON-representable
        // (Map, Set, undefined, a class instance) would silently change shape
        // between the write and the next read.
        assert.deepEqual(
          JSON.parse(JSON.stringify(state)),
          state,
          'state must be plain JSON-safe data',
        )
      })
    })
  }
})
