# Design direction — mading, in colour

Written before the October 2026 redesign. The concept did not change; how
loudly the site says it did.

## 1. Content

- **What it is:** an anonymous, short-lived social space for Indonesian students
  in Aachen. A wall of notes (gone after 48h), 1:1 video rooms, table games for
  4–8 people.
- **Who visits:** students, often late at night, often a little homesick. At
  01:30 in Aachen it is already morning in Jakarta.
- **What they should feel:** that other people are here right now, and that it
  is safe to write something small.
- **What they should do:** read the wall, then pin something up; otherwise open
  a room or a table.
- **Real facts only:** 48h TTL, 2 per video room, 4–8 / 5–8 seats, Germany only,
  no accounts. No invented counts, quotes or testimonials. The wall shows only
  what people actually wrote, and an honest empty state when there's nothing.

## 2. Register and hero subject

- **Temperature:** warm. It's people, food, homesickness, a school-wall habit.
- **Volume:** medium-loud. A student board, not a gallery.
- **What the visitor must see:** **the notes.** They are the people. They go at
  the top of the home page, in the first viewport, as coloured paper. The
  previous build put them below a full-height headline in the same grey as
  everything else.

## 3. Concept

**The mading**: the wall magazine every Indonesian school has. Coloured paper
sheets pinned to a board, and a header made of **letters cut out of coloured
paper**, each one stuck on slightly crooked. That header is the one signature
moment, and only the home hero gets it.

Rendering stays riso: flat colours, no gradients, no soft shadows, overprint
(multiply) where paper overlaps. Riso is printed on **coloured stock**, which
the previous build never used. That is the main change.

| Layer | Decision |
|---|---|
| Hero subject | Live notes on a board ground, directly under the hero |
| Type | Bricolage Grotesque (poster header), Karla (reading), Courier Prime (typed labels, never below 12px for meaningful text) |
| Surface | Warm paper canvas; the board is a darker stock with a halftone screen, so notes sit *on* something |
| Paper | Four sheet colours for notes: white, yellow, pink, blue tints. Surfaces, not accents |
| Accent | Fluorescent pink: pins, the cut-out header, the press offset. Yellow stays the highlighter fill |
| Structure | The board. Things are pinned, not boxed. Fewer 2px outlines |
| Labels | Typed, lowercase, in the site's own voice ("47h left") |
| Motion | Paper pinned up: letters and notes swing onto their pin and settle. No bounce |
| Closing | A plain footer: where it works, what it keeps (nothing), the three doors |

## 4. System

- `paper` #EFE9DC canvas, warmer and lighter than the old #E9E5D8 so coloured
  sheets read as colour.
- `stock` #E2DAC6 board ground and panels.
- `ink` #16284B (unchanged; every piece of text). `ink-soft` #44516A.
- Sheets: `sheet-white` #FBF8F1, `sheet-yellow` #FBE7A1, `sheet-pink` #F9D2DE,
  `sheet-blue` #D6DEEE. All carry ink at > 10:1.
- `pink` #FF4E8E: large marks only, never small text.
- `yellow` #FFC93D: fills with ink on top.
- Radius 0. Paper has corners.

## 5. The game and the video room

- **The board of suspects, not a table.** The octagonal table with chairs on
  an ellipse read as a diagram, cut every nickname in half, and turned into a
  list on phones anyway. Each player is now a pinned card with a portrait (their
  initial cut out of their own colour of paper) in a plain grid. Picking still
  happens by clicking a person's card. Votes are tally marks; out is a stamp.
- **Night is the ink plate.** During Werewolf's night phases (`reveal`,
  `nightZero`, `night`, `witch`) the board and the clock strip go dark and a
  pink moon comes up; dawn turns them back to paper. This is the game screen's
  one signature moment: you can tell from across the room whether to talk.
- **The clock is a strip.** Phase name large, seconds larger, a draining bar
  underneath; yellow for the last ten seconds, whatever the time of day.
- **The call is on the dark plate**, like the home page's video section. Name
  tags are yellow for you and pink for them; a camera that is off shows that
  person's figure, not a black rectangle. The two in-room games sit underneath
  on yellow (Tic-Tac-Toe) and blue (36 Questions) sheets.
- **Panels are white sheets**, not grey stock inside a 2px ink rule.

## Take / leave from the previous build

| Take | Leave |
|---|---|
| Out-of-register press (`reg`): it's tactile and it's ours | Two-plate masthead + marker swipe: two effects competing for one headline |
| Draggable slips, unpin on expiry | Every surface the same stock with a 2px ink outline |
| Aachen / Jakarta clocks (made a hero line, not 11px header text) | Footer colophon and ink swatches (talks to designers, not visitors) |
| Riso grain and halftone | 10–11px Courier for anything a visitor needs to read |
