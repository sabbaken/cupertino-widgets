/**
 * Which of the three shapes the widget is in, and how many rows the box holds.
 *
 * Two questions, and only the second is arithmetic in the calendar's sense. The card's
 * content is a list of arbitrary length, so, unlike the battery card's rings, rows really
 * are cut for want of room and this file is a *budget*: the same shape as
 * `cards/calendar/layout.ts`'s `geometryFor`, priced against one kind of row instead of a
 * mix of them, which is why there is no packing pass to go with it.
 *
 * Every number below is in **design units**: pixels at `scale: 100`. `geometryFor` divides
 * the measured box by the factor exactly once, and the rest is priced against the
 * stylesheet as written. Each constant names its twin there, and a change to one that is
 * not made to the other is a card that draws over its own inset.
 *
 * ## The third shape
 *
 * `core/size.ts` knows two layouts and one threshold, and the threshold is on the width
 * alone, deliberately: for the two cards that came before, height feeds the row budget and
 * never the shape. The reference widget this one copies has three sizes, and the third is
 * not a wider card, it is a taller one. So the view is decided here rather than in core,
 * and `viewFor` is a refinement of `layoutFromBox` rather than a second opinion about it:
 * the width half is that function's answer, unchanged, and the height only ever splits its
 * `medium` in two.
 *
 * Kept local rather than added to `WIDGET_LAYOUTS`, and that is a decision worth its
 * paragraph. A third member of that union is a `Record<WidgetLayout, number>` entry the
 * battery card would have to be given (`docs/battery-widget-rules.md` §9 names the two
 * tables), which means designing a `large` battery card to get a `large` reminders card:
 * a change to a widget nobody asked to change, taken on the way past. The calendar card
 * keeps its own `LayoutMode` for a smaller version of the same reason. What core keeps is
 * the one number both halves of the library have to agree on, `LAYOUT_THRESHOLD`, and this
 * file reads it rather than restating it.
 */

import { LAYOUT_THRESHOLD, layoutFromBox } from '../../core/size'

/** Must match `--cw-inset`, the padding inside the card. */
const INSET = 16

/**
 * The border `ha-card` draws, top and bottom.
 *
 * Taken off in real pixels before the box is divided by the scale, for the reason the other
 * two cards spell out on their own `BORDER`: Home Assistant draws it at 1px whatever the
 * widget inside is scaled to, so it is not one of the lengths the factor moves.
 */
const BORDER = 1

/**
 * One row's box: the `min-height` of `.item`, and also the tick's diameter.
 *
 * Larger than the 22 of `--cw-text-body`'s line box that the title sets in, which is what
 * makes the row a row rather than a line of text: the circle is drawn at exactly this, and
 * the title is centred against it.
 *
 * ROW and GAP together are the only thing that decides how many items a footprint shows, and
 * the pair was set from the smallest one. Home Assistant's square is 214 design units of
 * content against the reference widget's 126, so a card that simply filled it drew five items
 * where the phone draws three, at a density that reads as a list rather than as a widget. In
 * the square the gap cancels out of the budget (the heading costs one of them and the last row
 * saves one), so the count there is exactly `floor(192 / (ROW + GAP))`: 34 gave five, and
 * anything from 39 to 48 gives four. 40 is the shallow end of that, which is the compromise
 * worth taking: three would mean a 48-unit pitch and a widget mostly made of air at every
 * other footprint.
 */
const ROW = 24

/** Must match `--cw-item-gap`: the space between two rows, and under a small heading. */
const GAP = 16

/** The count's line box in the two big views: `--cw-text-title-1`'s 34px. */
const COUNT = 34

/** And in the square, where the count shares a line with the name: `--cw-text-headline`. */
const COUNT_SMALL = 22

/** The name's line box, in every view: `--cw-text-headline`'s 22px. */
const NAME = 22

/**
 * The hairline under the large view's heading, and the space either side of it: `.rule`.
 *
 * `RULE_BELOW` is 12 rather than a `GAP`, and it stayed 12 when the gap grew to 16. A gap
 * between two rows is doing the separating on its own; here there is a line doing it, so the
 * air around it can be less than the air between things that have none. It is also what keeps
 * the large view from costing a row at the footprint it arrives on: see `LARGE_HEIGHT`.
 */
const RULE = 1
const RULE_ABOVE = 8
const RULE_BELOW = 12

/**
 * The measured height, in design units, at which the wide card becomes the large one.
 *
 * The same number as `LAYOUT_THRESHOLD` and for the same kind of reason rather than by
 * coincidence: the reference's large widget is the square one, twice the tall of the wide,
 * so the question this asks is "has the box stopped being a band and become a panel", and
 * the library already has a number for how much room a widget needs before it is not narrow.
 * Using it in the other direction says a large card is one that is roomy both ways.
 *
 * In Home Assistant's sections grid that lands the flip at six rows: five rows is 312px and
 * six is 376px, against the four rows a card arrives at. So a card has to be dragged
 * distinctly taller than its default footprint to reach the large view, which is right: it
 * is the shape somebody chose, not one they got by nudging.
 *
 * And it costs nothing to cross, which is not luck and did not survive the row pitch growing
 * by itself: a 12 × 5 card draws seven rows in the wide arrangement and a 12 × 6 card draws
 * seven in the large one, and it is `RULE_BELOW` staying at 12 while `GAP` went to 16 that
 * holds the second of those where it is. A heading band that cost a row to gain the width
 * would be a card that got smaller as it got bigger.
 */
export const LARGE_HEIGHT = LAYOUT_THRESHOLD

export type ReminderView = 'small' | 'medium' | 'large'

export interface Box {
  width: number
  height: number
}

export interface Geometry {
  view: ReminderView
  /** How many rows the box holds, from the front of the list. May be 0 in a squashed box. */
  rows: number
}

/**
 * What the heading costs, down to the top of the first row.
 *
 * `medium` is zero because its heading is not above the rows at all: the count, the name and
 * the badge are a column beside them, so the list has the whole content height. The other
 * two stack, and the numbers are the line boxes of the type they are set in plus the space
 * to the first row.
 */
const HEAD: Record<ReminderView, number> = {
  small: COUNT_SMALL + GAP,
  medium: 0,
  large: COUNT + NAME + RULE_ABOVE + RULE + RULE_BELOW,
}

/**
 * How many rows fit in `space`.
 *
 * The `+ GAP` is because the last row has no gap under it: N rows occupy
 * `N * ROW + (N - 1) * GAP`. The same expression as the calendar's `rowsIn` and the battery
 * card's `fits`, and it is written out in all three rather than shared, because each prices
 * a different thing and a helper taking two numbers would only be hiding which.
 */
const rowsIn = (space: number): number => Math.max(0, Math.floor((space + GAP) / (ROW + GAP)))

/**
 * Which shape the box is, in the box's own units.
 *
 * `scale` divides both dimensions before either threshold is compared, which is the only
 * reading of a threshold that stays true: they are statements about how much room the type
 * needs, and type drawn 20% larger needs 20% more room. `core/size.ts` has the long version
 * on the width.
 */
export const viewFor = (box: Box, scale = 1): ReminderView => {
  if (layoutFromBox(box.width, scale) === 'small') return 'small'
  return box.height / scale >= LARGE_HEIGHT ? 'large' : 'medium'
}

/**
 * The shape and the row budget for the box the card was measured in.
 *
 * The border comes off in real pixels first and the inset in design units after, which is
 * the order the other two cards take them off in and the one that is right: the border is
 * Home Assistant's and does not scale, the inset is ours and does.
 */
export const geometryFor = (box: Box, scale = 1): Geometry => {
  const view = viewFor(box, scale)
  const content = Math.max(0, (box.height - 2 * BORDER) / scale - 2 * INSET)

  return { view, rows: rowsIn(content - HEAD[view]) }
}
