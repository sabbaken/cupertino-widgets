import { describe, expect, it } from 'vitest'

import { geometryFor, type Box, type ReminderView } from './layout'

/**
 * §8 of `docs/reminders-widget-rules.md`, and the invariant behind it.
 */

// ---- The grid the Layout tab hands out -----------------------------------------

/**
 * A footprint, in the pixels Home Assistant's sections grid actually gives it.
 *
 * Reconstructed here rather than imported from `core/size.ts`, the same way the battery
 * card's sweep reconstructs it: the point of a test over every footprint is that it knows
 * what a footprint is, and a helper that agreed with the code by construction would be
 * asserting nothing. 12 columns, 56px rows, 8px gaps, in a section of the usual 500px.
 */
const SECTION = 500
const COLUMN = (SECTION - 11 * 8) / 12

const boxFor = (columns: number, rows: number): Box => ({
  width: Math.round(columns * COLUMN + (columns - 1) * 8),
  height: rows * 56 + (rows - 1) * 8,
})

/** What the card draws in that box, in the words §8's table uses. */
const shape = (box: Box, scale = 1): string => {
  const geometry = geometryFor(box, scale)
  return `${geometry.view}, ${geometry.rows} rows`
}

// ---- The reference footprints --------------------------------------------------

describe('the reference footprints', () => {
  /**
   * Four is the number the whole pitch was set from. Home Assistant's square is 214 design
   * units of content where the reference widget's is 126, so a card that simply filled it drew
   * five items at a density that read as a list rather than as a widget. Three would be the
   * reference exactly and would want a 48-unit pitch, which is mostly air everywhere else.
   */
  it('draws four in the square, which is what the pitch was chosen for', () => {
    expect(shape(boxFor(6, 4))).toBe('small, 4 rows')
    expect(shape(boxFor(4, 4))).toBe('small, 4 rows')
    expect(shape(boxFor(6, 3))).toBe('small, 3 rows')
  })

  it('sets the heading beside the rows in the wide card, which leaves them the full height', () => {
    expect(shape(boxFor(12, 4))).toBe('medium, 5 rows')
    expect(shape(boxFor(12, 3))).toBe('medium, 4 rows')
    expect(shape(boxFor(9, 4))).toBe('medium, 5 rows')
  })

  it('sets it over them once the box is roomy in both directions', () => {
    expect(shape(boxFor(12, 6))).toBe('large, 7 rows')
    expect(shape(boxFor(12, 8))).toBe('large, 10 rows')
  })

  it('leaves a narrow card square however tall it is dragged', () => {
    expect(shape(boxFor(6, 8))).toBe('small, 11 rows')
  })

  /**
   * The reference's own square, which is 158pt with 16 of inset. Reached from Home Assistant's
   * taller one by turning `scale` up rather than by a rule of its own, which is the whole
   * argument for `scale` existing.
   */
  it('reaches the reference’s three at 130%', () => {
    expect(shape(boxFor(6, 4), 1.3)).toBe('small, 3 rows')
  })
})

// ---- Where the shapes change -----------------------------------------------------

describe('the line between the wide card and the large one', () => {
  /**
   * The one fact that makes the large view worth having rather than a trap: the heading
   * band costs it rows, and at the footprints the Layout tab actually stops on, that cost
   * lands exactly between two stops and so is never paid.
   */
  it('costs nothing at the footprint it lands on: five rows and six both draw seven', () => {
    expect(shape(boxFor(12, 5))).toBe('medium, 7 rows')
    expect(shape(boxFor(12, 6))).toBe('large, 7 rows')
  })

  it('is measured in design units, so a card scaled down reaches it in the same box', () => {
    const box = { width: 500, height: 320 }
    expect(geometryFor(box).view).toBe('medium')
    expect(geometryFor(box, 0.8).view).toBe('large')
  })

  it('is the width that decides first: a narrow card is never large, however tall', () => {
    expect(geometryFor({ width: 246, height: 800 }).view).toBe('small')
    expect(geometryFor({ width: 339, height: 800 }).view).toBe('small')
    expect(geometryFor({ width: 340, height: 800 }).view).toBe('large')
  })
})

describe('scale', () => {
  it('spends the extra room on larger rows rather than on more of them', () => {
    expect(shape(boxFor(12, 4))).toBe('medium, 5 rows')
    expect(shape(boxFor(12, 4), 1.3)).toBe('medium, 4 rows')
    expect(shape(boxFor(12, 4), 0.8)).toBe('medium, 7 rows')
  })

  it('still draws a row at the three-row floor, in every shape and at every scale', () => {
    const broken: string[] = []

    for (const scale of [0.8, 0.9, 1, 1.1, 1.3]) {
      for (const columns of [4, 6, 9, 12]) {
        const geometry = geometryFor(boxFor(columns, 3), scale)
        if (geometry.rows < 1) broken.push(`${columns}×3 at ${scale} drew nothing`)
      }
    }

    expect(broken).toEqual([])
  })
})

// ---- The invariant ---------------------------------------------------------------

/**
 * Transcribed from `reminders-card.ts`'s stylesheet rather than imported from `layout.ts`:
 * that is the point. The budget's whole job is to describe what the CSS draws, and a sweep
 * that read the budget's own numbers back would agree with it whatever either of them said.
 */
const INSET = 16 //             --cw-inset
const BORDER = 1 //             ha-card's own, and the one length that does not scale
const ROW = 24 //               .item's min-height, and --cw-tick-size with it
const GAP = 16 //               --cw-item-gap
const COUNT = 34 //             .count's min-height, which is --cw-text-title-1's line box
const COUNT_SMALL = 22 //       the same in the square, at --cw-text-headline
const NAME = 22 //              .name, at --cw-text-headline
const RULE = 1 + 8 + 12 //      .rule's height, then its margins above and below

const HEAD: Record<ReminderView, number> = {
  small: COUNT_SMALL + GAP,
  medium: 0,
  large: COUNT + NAME + RULE,
}

/** Floating point only: every quantity below is a whole design unit at scale 1. */
const EPSILON = 1e-9

describe('invariants, over every footprint the Layout tab offers', () => {
  it('fills the box it was given, and never draws past it', () => {
    const broken: string[] = []
    const seen: Record<ReminderView, number> = { small: 0, medium: 0, large: 0 }

    for (const scale of [0.8, 0.9, 1, 1.1, 1.3]) {
      for (let columns = 4; columns <= 12; columns += 1) {
        for (let rows = 3; rows <= 12; rows += 1) {
          const box = boxFor(columns, rows)
          const geometry = geometryFor(box, scale)
          const content = (box.height - 2 * BORDER) / scale - 2 * INSET
          const where = `${columns}×${rows} at ${scale}: ${geometry.view}, ${geometry.rows} rows`

          seen[geometry.view] += 1

          const drawn =
            geometry.rows > 0
              ? HEAD[geometry.view] + geometry.rows * ROW + (geometry.rows - 1) * GAP
              : HEAD[geometry.view]
          if (drawn > content + EPSILON) broken.push(`${where} overflowed`)

          // And the other direction: a row left undrawn in a box that had room for it is a
          // budget that is being needlessly shy. Exact equality cannot appear here, because
          // a row that fits exactly is one `rowsIn` has already taken.
          const another = HEAD[geometry.view] + (geometry.rows + 1) * ROW + geometry.rows * GAP
          if (another <= content - EPSILON) broken.push(`${where} left room for another`)
        }
      }
    }

    expect(broken).toEqual([])

    // Not vacuous, and specifically not vacuous about the thing under test: all three
    // arrangements were reached, so the heading costs above were all three exercised.
    expect(seen.small).toBeGreaterThan(50)
    expect(seen.medium).toBeGreaterThan(50)
    expect(seen.large).toBeGreaterThan(50)
  })
})
