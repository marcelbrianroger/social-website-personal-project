/**
 * Drawings for the home page.
 *
 * Flat riso shapes — two inks, no gradients, and `multiply` where they overlap
 * so a pink pass over an ink pass darkens the way a second pull through the
 * duplicator does. They show what each thing IS rather than decorating it: a
 * night for the game played at night, the one blank card for the game about the
 * one blank card, two frames for a call between two people.
 *
 * All decorative. Every fact they show is also in the text beside them.
 */

/**
 * Each game's drawing and the paper it is printed on, by catalogue id. Shared
 * by the home page and the lobby so a game looks the same wherever it appears.
 */
export const GAME_ART: Record<
  string,
  { Art: (props: { className?: string }) => React.JSX.Element; sheet: string; tilt: number }
> = {
  werewolf: { Art: NightArt, sheet: 'bg-sheet-blue', tilt: -0.6 },
  'mr-white': { Art: BlankCardArt, sheet: 'bg-sheet-yellow', tilt: 0.7 },
}

/** Werewolf: a moon over the village, overprinted. */
export function NightArt({ className = '' }: { className?: string }) {
  return (
    <svg
      viewBox="0 0 160 120"
      aria-hidden="true"
      className={className}
      style={{ isolation: 'isolate' }}
    >
      {/* The moon is the pink pass; the ink disc printed over it leaves the
          crescent, and the overlap goes dark rather than vanishing. */}
      <circle cx="96" cy="46" r="30" fill="var(--color-pink)" />
      <circle
        cx="110"
        cy="38"
        r="26"
        fill="var(--color-ink)"
        style={{ mixBlendMode: 'multiply' }}
      />
      {[
        [28, 22],
        [52, 40],
        [140, 16],
        [22, 58],
        [146, 70],
      ].map(([x, y]) => (
        <circle key={`${x}-${y}`} cx={x} cy={y} r="2.2" fill="var(--color-ink)" />
      ))}
      {/* The village, as a roofline. */}
      <path
        d="M0 120V96l14-12 14 12V88l18-16 18 16v8l12-10 12 10V80l16-14 16 14v16l14-12 14 12v24Z"
        fill="var(--color-ink)"
      />
      {/* One window still lit — somebody in the village is awake too. */}
      <rect x="44" y="94" width="6" height="7" fill="var(--color-yellow)" />
    </svg>
  )
}

/** Mr. White: everybody's card says the word, one card says nothing. */
export function BlankCardArt({ className = '' }: { className?: string }) {
  const cards = [
    { x: 14, tilt: -9, blank: false },
    { x: 58, tilt: 4, blank: true },
    { x: 102, tilt: 11, blank: false },
  ]

  return (
    <svg viewBox="0 0 160 120" aria-hidden="true" className={className}>
      {cards.map((card) => (
        <g key={card.x} transform={`rotate(${card.tilt} ${card.x + 22} 70)`}>
          <rect
            x={card.x}
            y="30"
            width="44"
            height="62"
            fill={card.blank ? 'var(--color-sheet-white)' : 'var(--color-paper)'}
            stroke="var(--color-ink)"
            strokeWidth="2.5"
          />
          {card.blank ? (
            /* The pink pin marks the card that matters. */
            <circle
              cx={card.x + 22}
              cy="40"
              r="4"
              fill="var(--color-pink)"
              stroke="var(--color-ink)"
              strokeWidth="2"
            />
          ) : (
            <>
              <rect x={card.x + 8} y="54" width="28" height="5" fill="var(--color-ink)" />
              <rect x={card.x + 12} y="64" width="20" height="5" fill="var(--color-ink)" />
            </>
          )}
        </g>
      ))}
    </svg>
  )
}

/** A video room: two frames, two people, nothing in between. */
export function TwoFramesArt({ className = '' }: { className?: string }) {
  return (
    <svg viewBox="0 0 220 110" aria-hidden="true" className={className}>
      {[8, 116].map((x, i) => {
        const fill = i === 0 ? 'var(--color-yellow)' : 'var(--color-pink)'

        return (
          <g key={x}>
            <rect
              x={x}
              y="14"
              width="96"
              height="72"
              fill="none"
              stroke="var(--color-paper)"
              strokeWidth="3"
            />
            <circle cx={x + 48} cy="42" r="12" fill={fill} />
            <path d={`M${x + 22} 86c4-18 14-24 26-24s22 6 26 24`} fill={fill} />
          </g>
        )
      })}
    </svg>
  )
}
