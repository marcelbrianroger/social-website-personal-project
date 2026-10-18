import type { MrWhiteRole } from '@/lib/game/mr-white-view'
import type { WerewolfRole } from '@/lib/game/werewolf-view'

/**
 * A character for every role you can be dealt.
 *
 * Same press as home-art.tsx: flat ink, pink and yellow, no gradients. Skin is
 * the `stock` paper, so faces read as cut paper on the coloured sheet behind.
 * Each role is its own person with its own silhouette and expression, so the
 * table can name it from across the room before reading the label.
 *
 * The village is ours, not a generic European one: the Guard is a ronda
 * watchman with a peci, a sarung and a kentongan; the Villager wears a caping.
 *
 * Decorative. The role's name is always printed next to the drawing.
 */

type ArtProps = { className?: string }
type RoleArt = { Art: (props: ArtProps) => React.JSX.Element; sheet: string }

const INK = 'var(--color-ink)'
const PINK = 'var(--color-pink)'
const YELLOW = 'var(--color-yellow)'
const WHITE = 'var(--color-sheet-white)'
const SKIN = 'var(--color-stock)'

/** The outline every cut-out shape gets. */
const LINE = {
  stroke: INK,
  strokeWidth: 3,
  strokeLinejoin: 'round',
  strokeLinecap: 'round',
} as const

/** A drawn line with no fill: features, creases, motion. */
const PEN = { ...LINE, fill: 'none' } as const

function Frame({ className = '', children }: ArtProps & { children: React.ReactNode }) {
  return (
    <svg viewBox="0 0 160 160" aria-hidden="true" className={className}>
      {children}
    </svg>
  )
}

function Torso({ fill = INK, dashed = false }: { fill?: string; dashed?: boolean }) {
  return (
    <path
      d="M26 162c2-30 22-46 54-46s52 16 54 46Z"
      fill={fill}
      {...LINE}
      strokeDasharray={dashed ? '6 5' : undefined}
    />
  )
}

function Neck() {
  return <rect x="70" y="94" width="20" height="26" fill={SKIN} {...LINE} />
}

/** Werewolf: not a person in a mask. All wolf, under its own moon. */
function WerewolfArt({ className }: ArtProps) {
  return (
    <Frame className={className}>
      <circle cx="120" cy="38" r="26" fill={PINK} />
      {/* Shaggy shoulders: the coat, not a shirt. */}
      <path
        d="M20 162c4-26 16-40 34-46l6 8 8-10 12 8 12-8 8 10 6-8c18 6 30 20 34 46Z"
        fill={INK}
      />
      <path d="M50 60L42 16l30 26Z M110 60l8-44-30 26Z" fill={INK} />
      <path d="M53 52l-4-24 17 15Z M107 52l4-24-17 15Z" fill={PINK} />
      {/* Head with cheek tufts flaring out. */}
      <path
        d="M80 32c22 0 36 16 36 38l12 8-13 4 7 11-15-2c-6 12-16 19-27 19s-21-7-27-19l-15 2 7-11-13-4 12-8c0-22 14-38 36-38Z"
        fill={INK}
      />
      <ellipse cx="80" cy="94" rx="17" ry="13" fill={SKIN} />
      <path d="M71 85h18l-9 9Z" fill={INK} />
      <path d="M80 94v5 M71 101q9 6 18 0" {...PEN} strokeWidth="2.5" />
      <path d="M74 101l2 8 4-7Z M86 101l-2 8-4-7Z" fill={WHITE} />
      {/* Slanted, lit, and looking at you. */}
      <path d="M56 64l18 7-14 6Z M104 64l-18 7 14 6Z" fill={YELLOW} />
      <circle cx="65" cy="71" r="2.4" fill={INK} />
      <circle cx="95" cy="71" r="2.4" fill={INK} />
    </Frame>
  )
}

/** Seer: eyes shut, because what she reads is not in front of her. */
function SeerArt({ className }: ArtProps) {
  return (
    <Frame className={className}>
      {[
        [28, 36],
        [134, 26],
        [140, 66],
      ].map(([x, y]) => (
        <path
          key={x}
          d={`M${x} ${y - 7}l2 5 5 2-5 2-2 5-2-5-5-2 5-2Z`}
          fill={YELLOW}
        />
      ))}
      <Torso />
      {/* The kerudung frames the face and falls to the shoulders. */}
      <path
        d="M80 34c-28 0-40 22-40 46 0 18 6 30 14 40h52c8-10 14-22 14-40 0-24-12-46-40-46Z"
        fill={PINK}
        {...LINE}
      />
      <ellipse cx="80" cy="80" rx="20" ry="23" fill={SKIN} {...LINE} />
      <path d="M80 59l4 5-4 5-4-5Z" fill={YELLOW} stroke={INK} strokeWidth="1.5" />
      <path d="M67 79q5 4 10 0 M83 79q5 4 10 0" {...PEN} strokeWidth="2.5" />
      <path d="M75 92q5 4 10 0" {...PEN} strokeWidth="2.5" />
      {/* The ball, cradled. */}
      <ellipse cx="58" cy="148" rx="11" ry="8" fill={SKIN} {...LINE} />
      <ellipse cx="102" cy="148" rx="11" ry="8" fill={SKIN} {...LINE} />
      <circle cx="80" cy="132" r="20" fill={YELLOW} {...LINE} />
      <path d="M88 128l2 5 5 2-5 2-2 5-2-5-5-2 5-2Z" fill={PINK} />
      <ellipse cx="72" cy="124" rx="4" ry="6" fill={WHITE} />
    </Frame>
  )
}

/** Guard: the ronda on night watch, kentongan ready to raise the alarm. */
function GuardArt({ className }: ArtProps) {
  return (
    <Frame className={className}>
      <Torso />
      {/* Sarung slung over one shoulder, checked in yellow. */}
      <path d="M34 128c8-8 16-12 24-13l66 47H94Z" fill={PINK} {...LINE} />
      <path
        d="M52 122l-8 12 M70 134l-9 12 M88 147l-8 12"
        stroke={YELLOW}
        strokeWidth="3"
        strokeLinecap="round"
      />
      <Neck />
      <ellipse cx="80" cy="74" rx="24" ry="26" fill={SKIN} {...LINE} />
      {/* Peci. */}
      <path d="M56 62l2-20q22-7 44 0l2 20q-24-7-48 0Z" fill={INK} {...LINE} />
      <path d="M63 68l12-2 M85 66l12 2" {...PEN} />
      <circle cx="71" cy="76" r="3" fill={INK} />
      <circle cx="89" cy="76" r="3" fill={INK} />
      <path d="M68 88q6-6 12-1q6-5 12 1q-6 3-12 0q-6 3-12 0Z" fill={INK} />
      <path d="M76 95h8" {...PEN} strokeWidth="2.5" />
      {/* Kentongan: the bamboo slit drum every pos ronda hangs up. */}
      <rect x="114" y="92" width="18" height="50" rx="7" fill={YELLOW} {...LINE} />
      <rect x="121" y="103" width="4" height="26" rx="2" fill={INK} />
      <path d="M115 98h16 M115 136h16" {...PEN} strokeWidth="2" />
      <circle cx="123" cy="144" r="8" fill={SKIN} {...LINE} />
    </Frame>
  )
}

/** Witch: one bottle saves, one kills, and she has not decided yet. */
function WitchArt({ className }: ArtProps) {
  return (
    <Frame className={className}>
      <path d="M52 72c0-22 12-34 28-34s28 12 28 34v48H52Z" fill={INK} />
      <Torso />
      <Neck />
      <ellipse cx="80" cy="78" rx="20" ry="23" fill={SKIN} {...LINE} />
      <ellipse cx="80" cy="57" rx="40" ry="8" fill={PINK} {...LINE} />
      <path d="M58 55C70 32 80 15 98 10c-6 10-2 26 6 45Z" fill={PINK} {...LINE} />
      <path d="M60 50q22-5 42 0l2 5q-24-5-46 0Z" fill={YELLOW} {...LINE} strokeWidth="2" />
      {/* Smug: one lid low, one brow up. */}
      <path d="M64 72h12 M84 70q6-5 12-2" {...PEN} strokeWidth="2.5" />
      <path d="M66 80q5-4 10 0" {...PEN} strokeWidth="2.5" />
      <circle cx="90" cy="79" r="3" fill={INK} />
      <path d="M73 91q8 5 15-2" {...PEN} strokeWidth="2.5" />
      {[
        { x: 36, fill: YELLOW, mark: 'M36 122v12 M30 128h12' },
        { x: 124, fill: PINK, mark: 'M119 123l10 10 M129 123l-10 10' },
      ].map((bottle) => (
        <g key={bottle.x}>
          <rect x={bottle.x - 4} y="104" width="8" height="12" fill={WHITE} {...LINE} strokeWidth="2.5" />
          <rect x={bottle.x - 5} y="98" width="10" height="7" rx="2" fill={INK} />
          <circle cx={bottle.x} cy="128" r="13" fill={bottle.fill} {...LINE} />
          <path d={bottle.mark} {...PEN} strokeWidth="2.5" />
          <ellipse cx={bottle.x} cy="146" rx="9" ry="6" fill={SKIN} {...LINE} />
        </g>
      ))}
    </Frame>
  )
}

/** Hunter: one eye shut, already picking who comes with him. */
function HunterArt({ className }: ArtProps) {
  return (
    <Frame className={className}>
      <g stroke={PINK} strokeWidth="3" fill="none" strokeLinecap="round">
        <circle cx="34" cy="40" r="14" />
        <path d="M34 20v9 M34 51v9 M14 40h9 M45 40h9" />
      </g>
      {/* Rifle over the shoulder, behind the body. */}
      <path d="M116 26l10 84" stroke={INK} strokeWidth="6" strokeLinecap="round" />
      <path d="M121 104l14 1 6 50h-16Z" fill={YELLOW} {...LINE} />
      <Torso />
      <path d="M38 162c2-22 12-36 30-44l4 44Z M122 162c-2-22-12-36-30-44l-4 44Z" fill={YELLOW} {...LINE} />
      <path d="M46 140h12 M102 140h12" {...PEN} strokeWidth="2.5" />
      <Neck />
      <ellipse cx="80" cy="76" rx="24" ry="26" fill={SKIN} {...LINE} />
      <path d="M58 58q2-22 22-22t22 22Z" fill={INK} {...LINE} />
      <path d="M44 60q36-12 72 0q-36 8-72 0Z" fill={INK} {...LINE} />
      <path d="M58 54h44" stroke={PINK} strokeWidth="4" />
      <path d="M64 78h12 M84 68l12-3" {...PEN} />
      <circle cx="90" cy="78" r="3.5" fill={INK} />
      <path d="M74 94q6-2 12 0" {...PEN} strokeWidth="2.5" />
      {[
        [64, 92],
        [68, 98],
        [74, 101],
        [86, 101],
        [92, 98],
        [96, 92],
      ].map(([cx, cy]) => (
        <circle key={`${cx}-${cy}`} cx={cx} cy={cy} r="1.3" fill={INK} />
      ))}
    </Frame>
  )
}

/** Cupid: a kid with wings and a heart-tipped arrow, very pleased with itself. */
function CupidArt({ className }: ArtProps) {
  return (
    <Frame className={className}>
      <path d="M50 122C20 114 12 88 22 74c6 14 18 18 30 22Z" fill={WHITE} {...LINE} />
      <path d="M110 122c30-8 38-34 28-48-6 14-18 18-30 22Z" fill={WHITE} {...LINE} />
      <path d="M28 96q8 6 18 8 M132 96q-8 6-18 8" {...PEN} strokeWidth="2" />
      <path d="M34 162c2-28 20-42 46-42s44 14 46 42Z" fill={PINK} {...LINE} />
      <circle cx="80" cy="80" r="28" fill={SKIN} {...LINE} />
      {[
        [60, 58, 10],
        [74, 50, 11],
        [90, 50, 11],
        [102, 60, 9],
      ].map(([cx, cy, r]) => (
        <circle key={cx} cx={cx} cy={cy} r={r} fill={YELLOW} {...LINE} />
      ))}
      <path d="M65 82q5-6 10 0 M85 82q5-6 10 0" {...PEN} />
      <circle cx="63" cy="92" r="5" fill={PINK} />
      <circle cx="97" cy="92" r="5" fill={PINK} />
      <path d="M71 95q9 10 18 0Z" fill={INK} {...LINE} strokeWidth="2.5" />
      <path d="M28 152L126 114" {...PEN} />
      <path d="M28 152l-5-11 M28 152l-12 2" stroke={YELLOW} strokeWidth="4" strokeLinecap="round" />
      <path
        d="M134 120c-8-5-11-9-11-13a5.5 5.5 0 0 1 11-2a5.5 5.5 0 0 1 11 2c0 4-3 8-11 13Z"
        fill={PINK}
        {...LINE}
        strokeWidth="2.5"
      />
    </Frame>
  )
}

/** Jester: plays for nobody's side, and the grin says so. */
function JesterArt({ className }: ArtProps) {
  return (
    <Frame className={className}>
      <path d="M26 162c2-30 22-46 54-46s52 16 54 46Z" fill={PINK} {...LINE} />
      <path d="M26 162c2-30 22-46 54-46v46Z" fill={YELLOW} {...LINE} />
      <path
        d="M44 116q6 9 12 0q6 9 12 0q6 9 12 0q6 9 12 0q6 9 12 0q6 9 12 0l-2-8H46Z"
        fill={WHITE}
        {...LINE}
      />
      <ellipse cx="80" cy="82" rx="22" ry="25" fill={SKIN} {...LINE} />
      {/* The three points of the cap, each with its bell. */}
      <path d="M60 68C50 54 38 52 26 60c12-20 32-24 46-12Z" fill={PINK} {...LINE} />
      <path d="M100 68c10-14 22-16 34-8-12-20-32-24-46-12Z" fill={PINK} {...LINE} />
      <path d="M64 58c2-20 10-34 16-44 6 12 14 26 16 44Z" fill={YELLOW} {...LINE} />
      <path d="M56 68q24-10 48 0v6q-24-10-48 0Z" fill={INK} {...LINE} />
      {[
        [26, 60],
        [80, 14],
        [134, 60],
      ].map(([cx, cy]) => (
        <circle key={cx} cx={cx} cy={cy} r="5" fill={YELLOW} {...LINE} strokeWidth="2.5" />
      ))}
      <path d="M64 77q6-5 12 0 M84 77q6-5 12 0" {...PEN} strokeWidth="2.5" />
      <circle cx="70" cy="84" r="3" fill={INK} />
      <circle cx="90" cy="84" r="3" fill={INK} />
      <path d="M92 90l3 5-3 5-3-5Z" fill={PINK} />
      <path d="M66 95q14 14 28 0Z" fill={WHITE} {...LINE} strokeWidth="2.5" />
    </Frame>
  )
}

/** Villager: a farmer in a caping. No power, only a vote, and a kind face. */
function VillagerArt({ className }: ArtProps) {
  return (
    <Frame className={className}>
      <Torso />
      <Neck />
      {/* Handuk round the neck, one end hanging. */}
      <path d="M54 116q26 14 52 0l-3 10q-23 12-46 0Z" fill={WHITE} {...LINE} />
      <path d="M92 124l4 22 10-2-4-24Z" fill={WHITE} {...LINE} />
      <ellipse cx="80" cy="84" rx="22" ry="25" fill={SKIN} {...LINE} />
      <path d="M16 72L80 32l64 40q-64-10-128 0Z" fill={YELLOW} {...LINE} />
      <path d="M48 66L80 36l32 30 M80 36v30" {...PEN} strokeWidth="1.5" />
      <circle cx="71" cy="86" r="3" fill={INK} />
      <circle cx="89" cy="86" r="3" fill={INK} />
      <circle cx="64" cy="96" r="4.5" fill={PINK} />
      <circle cx="96" cy="96" r="4.5" fill={PINK} />
      <path d="M71 96q9 8 18 0" {...PEN} />
    </Frame>
  )
}

/** Civilian: a student holding the word, sure of it. */
function CivilianArt({ className }: ArtProps) {
  return (
    <Frame className={className}>
      <Torso />
      <path d="M50 122q-6-40 30-46q36 6 30 46Z" fill={INK} {...LINE} />
      <path d="M72 120v20 M88 120v20" stroke={YELLOW} strokeWidth="3" strokeLinecap="round" />
      <Neck />
      <ellipse cx="80" cy="76" rx="23" ry="26" fill={SKIN} {...LINE} />
      <path
        d="M56 72c-2-24 14-30 28-30s24 10 20 30c-8-12-22-16-36-10-4 2-8 6-12 10Z"
        fill={INK}
        {...LINE}
      />
      <circle cx="70" cy="80" r="8" fill="none" {...LINE} strokeWidth="2.5" />
      <circle cx="91" cy="80" r="8" fill="none" {...LINE} strokeWidth="2.5" />
      <path d="M78 80h5" {...PEN} strokeWidth="2.5" />
      <circle cx="70" cy="80" r="2.5" fill={INK} />
      <circle cx="91" cy="80" r="2.5" fill={INK} />
      <path d="M72 94q8 6 16 0" {...PEN} strokeWidth="2.5" />
      <g transform="rotate(-8 112 132)">
        <rect x="94" y="114" width="38" height="34" fill={WHITE} {...LINE} />
        <rect x="101" y="124" width="24" height="4" fill={INK} />
        <rect x="104" y="133" width="18" height="4" fill={INK} />
      </g>
      <ellipse cx="104" cy="148" rx="9" ry="6" fill={SKIN} {...LINE} />
    </Frame>
  )
}

/**
 * Mr. White: the same student, never filled in. Dashed for the same reason
 * role-card.tsx's "no word" slip is dashed; the card has nothing on it and
 * the face knows it.
 */
function MrWhiteArt({ className }: ArtProps) {
  return (
    <Frame className={className}>
      <Torso fill={WHITE} dashed />
      <ellipse
        cx="80"
        cy="76"
        rx="23"
        ry="26"
        fill={WHITE}
        {...LINE}
        strokeDasharray="6 5"
      />
      <path d="M64 71l10-4 M96 71l-10-4" {...PEN} strokeWidth="2.5" />
      {/* Eyes sliding sideways, looking for the word on someone else. */}
      <circle cx="74" cy="79" r="3" fill={INK} />
      <circle cx="94" cy="79" r="3" fill={INK} />
      <path d="M68 94q3-3 6 0t6 0t6 0t6 0" {...PEN} strokeWidth="2.5" />
      <path d="M106 60q6 9 0 12q-6-3 0-12Z" fill={PINK} />
      <g transform="rotate(6 112 132)">
        <rect x="94" y="114" width="38" height="34" fill={WHITE} {...LINE} />
        <circle cx="113" cy="122" r="4" fill={PINK} {...LINE} strokeWidth="2" />
      </g>
      <ellipse cx="104" cy="148" rx="9" ry="6" fill={WHITE} {...LINE} strokeDasharray="4 3" />
    </Frame>
  )
}

export const ROLE_ART: Record<WerewolfRole | MrWhiteRole, RoleArt> = {
  werewolf: { Art: WerewolfArt, sheet: 'bg-sheet-blue' },
  seer: { Art: SeerArt, sheet: 'bg-sheet-blue' },
  guard: { Art: GuardArt, sheet: 'bg-sheet-blue' },
  witch: { Art: WitchArt, sheet: 'bg-sheet-yellow' },
  hunter: { Art: HunterArt, sheet: 'bg-sheet-pink' },
  cupid: { Art: CupidArt, sheet: 'bg-sheet-blue' },
  jester: { Art: JesterArt, sheet: 'bg-sheet-blue' },
  villager: { Art: VillagerArt, sheet: 'bg-sheet-pink' },
  civilian: { Art: CivilianArt, sheet: 'bg-sheet-pink' },
  'mr-white': { Art: MrWhiteArt, sheet: 'bg-sheet-yellow' },
}

/**
 * The character as it sits on a role card: printed on its own sheet, pinned
 * slightly crooked. A dead player's portrait fades rather than disappearing:
 * you are still that role, you just no longer get to play it.
 */
export function RolePortrait({
  role,
  out = false,
  className = 'size-28',
}: {
  role: WerewolfRole | MrWhiteRole
  out?: boolean
  className?: string
}) {
  const { Art, sheet } = ROLE_ART[role]

  return (
    <div
      className={`${sheet} ${className} shrink-0 overflow-hidden -rotate-2 ${out ? 'opacity-45 grayscale' : ''}`}
    >
      <Art className="size-full" />
    </div>
  )
}
