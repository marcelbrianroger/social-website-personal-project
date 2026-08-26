'use client'

import {
  nicknameOf,
  nicknamesOf,
  ROLE_BRIEF,
  ROLE_LABEL,
  type WerewolfTable,
} from '@/lib/game/werewolf-view'

import { DISPLAY_HEADING, EYEBROW, PANEL } from './controls'

/**
 * Your role, and every private thing that comes with it.
 *
 * EIGHT ROLES READ EIGHT DIFFERENT CARDS, and none of that is decided here.
 * `packmates` is `[]` in a villager's payload, `inspections` is `{}` for
 * everyone but the Seer, and `yourLover` is null unless Cupid tied you in — the
 * server built each viewer their own projection. So this component is not
 * choosing what to hide; there is genuinely nothing here to bypass. It chooses
 * what to DRAW, which is a different question with the same answer per role.
 *
 * Each block below is therefore gated on the DATA being present rather than on
 * the role name wherever it can be. A block that renders when its field is
 * non-empty cannot leak, because the field is empty for everyone not entitled
 * to it.
 */
export function WerewolfRoleCard({
  table,
  you,
}: {
  table: WerewolfTable
  you: string | null
}) {
  const role = table.yourRole
  const dead = you !== null && table.dead.includes(you)

  return (
    <section className={`${PANEL} p-4`} aria-label="Your role">
      <div className="flex items-baseline justify-between gap-3">
        <p className={EYEBROW}>your role</p>

        {dead && (
          <p className="border border-ink px-1.5 font-mono text-[0.625rem] uppercase tracking-wide text-ink-soft">
            dead
          </p>
        )}
      </div>

      <p
        className="mt-1.5 font-display text-2xl leading-none"
        style={DISPLAY_HEADING}
      >
        {role === null ? 'Watching' : ROLE_LABEL[role]}
      </p>

      <p className="mt-3 border-l-4 border-pink bg-paper px-3 py-2 font-mono text-[0.6875rem] leading-relaxed text-ink">
        {role === null
          ? 'You are not playing at this table. You see exactly what the room sees, and nothing more.'
          : ROLE_BRIEF[role]}
      </p>

      {/* --------------------------------------------------------- the pack */}
      {table.packmates.length > 0 && (
        <div className="mt-4">
          <p className={EYEBROW}>your pack</p>
          <p
            className="mt-1 font-display text-[0.9375rem] leading-tight text-ink"
            style={DISPLAY_HEADING}
          >
            {nicknamesOf(table, table.packmates)}
          </p>
        </div>
      )}

      {/* --------------------------------------------------------- the bond */}
      {table.yourLover && (
        <div className="mt-4">
          <p className={EYEBROW}>you are in love with</p>
          <p
            className="mt-1 bg-pink px-1.5 font-display text-[0.9375rem] leading-tight text-ink"
            style={DISPLAY_HEADING}
          >
            {nicknameOf(table, table.yourLover) ?? 'someone'}
          </p>
          <p className="mt-1.5 font-mono text-[0.625rem] leading-relaxed text-ink-soft">
            Whichever of you dies first, the other goes in the same breath.
          </p>
        </div>
      )}

      {/* Cupid sees the pair they made, whether or not they are in it. */}
      {role === 'cupid' && table.lovers.length === 2 && (
        <div className="mt-4">
          <p className={EYEBROW}>you tied together</p>
          <p
            className="mt-1 font-display text-[0.9375rem] leading-tight text-ink"
            style={DISPLAY_HEADING}
          >
            {nicknamesOf(table, table.lovers)}
          </p>
        </div>
      )}

      {/* ------------------------------------------------- the seer's ledger */}
      {Object.keys(table.inspections).length > 0 && (
        <div className="mt-4">
          <p className={EYEBROW}>what you have read</p>
          <ul className="mt-1 space-y-1">
            {Object.entries(table.inspections).map(([id, alignment]) => (
              <li key={id} className="font-mono text-[0.6875rem] text-ink">
                {nicknameOf(table, id) ?? id}
                {' · '}
                <span
                  className={
                    alignment === 'werewolf'
                      ? 'bg-yellow px-1 font-semibold uppercase'
                      : 'text-ink-soft'
                  }
                >
                  {alignment === 'werewolf' ? 'werewolf' : 'not a werewolf'}
                </span>
              </li>
            ))}
          </ul>
        </div>
      )}

      {/* --------------------------------------------------- the guard's log */}
      {role === 'guard' && table.lastProtected && (
        <p className="mt-4 font-mono text-[0.625rem] leading-relaxed text-ink-soft">
          Last night you covered{' '}
          <span className="text-ink">
            {nicknameOf(table, table.lastProtected) ?? '-'}
          </span>
          . Tonight it has to be somebody else.
        </p>
      )}

      {/* ------------------------------------------------- the witch's shelf */}
      {role === 'witch' && (
        <div className="mt-4">
          <p className={EYEBROW}>your potions</p>
          <ul className="mt-1 flex gap-2">
            <Potion label="heal" spent={table.healUsed} />
            <Potion label="poison" spent={table.poisonUsed} />
          </ul>
        </div>
      )}

      {/* ---------------------------------------------- the hunter's promise */}
      {role === 'hunter' && (
        <p className="mt-4 font-mono text-[0.625rem] leading-relaxed text-ink-soft">
          Nothing to do at night. The moment you die you get one shot, and
          twenty seconds to decide who it is for.
        </p>
      )}
    </section>
  )
}

/** One bottle on the shelf. Spent reads as struck through, never as absent. */
function Potion({ label, spent }: { label: string; spent: boolean }) {
  return (
    <li
      className={`flex-1 border-2 px-2 py-1 text-center font-mono text-[0.625rem] uppercase tracking-wide ${
        spent
          ? 'border-dashed border-rule text-ink-soft line-through'
          : 'border-ink bg-yellow text-ink'
      }`}
    >
      {label}
    </li>
  )
}
