import { describe, expect, it } from 'vitest'

import type { FlowNode } from './flow'
import { COST, geometryFor, packFlow, type LayoutColumn, type MoreNode } from './layout'
import type { CalendarItem } from './model'

const item = (title: string, location?: string): CalendarItem => ({
  id: title,
  entityId: 'calendar.work',
  kind: 'event',
  title,
  ...(location ? { location } : {}),
  start: new Date('2026-07-24T10:00:00Z'),
  end: new Date('2026-07-24T11:00:00Z'),
  color: 'orange',
})

const row = (title: string, location?: string): FlowNode => ({
  type: 'item',
  key: title,
  item: item(title, location),
})

/** A location is allowed in here on purpose: an all-day row must never draw one. */
const allDay = (title: string, location?: string): FlowNode => ({
  type: 'item',
  key: title,
  item: { ...item(title, location), allDay: true },
})

const heading = (text: string): FlowNode => ({ type: 'header', key: text, text })

/** The shape a column ended up with, as the spec writes it: a list of row costs. */
const costs = (flow: FlowNode[], budgets: number[], mode: 'small' | 'medium'): number[][] =>
  packFlow(flow, budgets, mode).map(column => column.rows.map(r => r.cost))

/** What a reader would see, row by row: a title, a heading, or `2 more events`. */
const titles = (flow: FlowNode[], budgets: number[], mode: 'small' | 'medium'): string[][] =>
  packFlow(flow, budgets, mode).map(column =>
    column.rows.map(r => {
      if (r.node.type === 'header') return r.node.text
      if (r.node.type === 'more') return `${r.node.count} more`
      return r.node.item.title
    }),
  )

/**
 * What the flow was cut off in the middle of saying: the rest of the section the last
 * drawn row belongs to, and nothing at all from the days past it.
 *
 * The drawn rows are always a prefix of the flow, so where they end is where the tail
 * begins. That includes a row the indicator evicted, since it too counts as undrawn.
 */
const unfinishedSection = (flow: FlowNode[], columns: LayoutColumn[]): FlowNode[] => {
  const drawn = columns.flatMap(column => column.rows).filter(r => r.node.type !== 'more').length
  const tail = flow.slice(drawn)
  const nextDay = tail.findIndex(node => node.type === 'header')
  return nextDay === -1 ? tail : tail.slice(0, nextDay)
}

/** The one tail indicator among the packed rows, if the flow ended with one. */
const more = (columns: LayoutColumn[]): MoreNode | undefined =>
  columns
    .flatMap(column => column.rows)
    .map(r => r.node)
    .find((node): node is MoreNode => node.type === 'more')

/** Whether a packed column has anything left to buy the indicator's row with. */
const canAfford = (column: LayoutColumn): boolean => {
  if (column.budget - column.used >= COST.more) return true
  if (column.rows.some(r => r.expanded)) return true
  return column.rows.length >= 2 && column.rows.slice(-2).every(r => r.node.type === 'item')
}

const TOMORROW = heading('TOMORROW')
const REST_OF_TOMORROW = [row('T1'), row('T2'), row('T3')]

/**
 * The six cases the rules were reconstructed from, transcribed straight out of
 * `docs/calendar-widget-rules.md`. If one of these changes, the widget stopped
 * matching the thing it is copying.
 */
describe('the reference screenshots', () => {
  it('three plain events today: the third flows into the right column', () => {
    const flow = [row('A'), row('B'), row('C'), TOMORROW, ...REST_OF_TOMORROW]
    // The column came out exactly full with a third item of tomorrow still to draw, so
    // `T2` buys the row that says so (the one place this card departs from the
    // screenshots, where that item vanished with nothing to mark it).
    expect(costs(flow, [4, 7], 'medium')).toEqual([
      [2, 2],
      [2, 1, 2, 1],
    ])
    expect(titles(flow, [4, 7], 'medium')).toEqual([
      ['A', 'B'],
      ['C', 'TOMORROW', 'T1', '2 more'],
    ])
  })

  it('an all-day entry costs one row, and that row pays for a location', () => {
    // The eighth screenshot. In medium the whole flow fits: the day's one row leaves
    // exactly enough for the location beneath `Test`.
    const flow = [
      allDay('All day test'),
      row('Test', 'Warsawa Główna'),
      TOMORROW,
      ...REST_OF_TOMORROW,
    ]
    expect(costs(flow, [4, 7], 'medium')).toEqual([
      [1, 3],
      [1, 2, 2, 2],
    ])

    // And in small, where today is all there is: two items *and* a location, which two
    // timed events could never have managed.
    const columns = packFlow([allDay('All day test'), row('Test', 'Warsawa Główna')], [4], 'small')
    expect(columns[0]!.rows.map(r => r.cost)).toEqual([1, 3])
    expect(columns[0]!.rows.map(r => r.expanded)).toEqual([false, true])
  })

  it('a spare row at the bottom becomes the count of what is missing', () => {
    // Two greedy locations today: the left column takes one, the right takes the other
    // and has a row over at the end of tomorrow's first event.
    const flow = [
      row('A', 'Długa 36, Warsawa'),
      row('B', 'Focha 4, Warsawa'),
      TOMORROW,
      ...REST_OF_TOMORROW,
    ]
    expect(costs(flow, [4, 7], 'medium')).toEqual([[3], [3, 1, 2, 1]])
    expect(titles(flow, [4, 7], 'medium')).toEqual([['A'], ['B', 'TOMORROW', 'T1', '2 more']])
  })

  it('two events today: tomorrow starts at the top of the right column', () => {
    const flow = [row('A'), row('B'), TOMORROW, ...REST_OF_TOMORROW]
    expect(costs(flow, [4, 7], 'medium')).toEqual([
      [2, 2],
      [1, 2, 2, 2],
    ])
  })

  it('one event with a location: it expands and eats the left column', () => {
    const flow = [row('A', 'Długa 36, Warsawa'), TOMORROW, ...REST_OF_TOMORROW]
    // The location takes three of the four rows and the row it leaves over is not enough
    // for `TOMORROW` and tomorrow's first event, so the whole of tomorrow starts the right
    // column and that odd row goes unspent.
    expect(costs(flow, [4, 7], 'medium')).toEqual([[3], [1, 2, 2, 2]])
    expect(titles(flow, [4, 7], 'medium')).toEqual([['A'], ['TOMORROW', 'T1', 'T2', 'T3']])
  })

  it('a location wins even when it pushes the next event across', () => {
    const flow = [row('A', 'Długa 36, Warsawa'), row('B'), TOMORROW, ...REST_OF_TOMORROW]
    // `A`'s location is in the other column, so there is nothing cheap for the indicator
    // to reclaim here and `T2` pays for it instead.
    expect(costs(flow, [4, 7], 'medium')).toEqual([[3], [2, 1, 2, 1]])
    expect(titles(flow, [4, 7], 'medium')[1]).toEqual(['B', 'TOMORROW', 'T1', '2 more'])
  })
})

describe('medium: packing rules', () => {
  it('drops the location rather than the event when only the location will not fit', () => {
    // Two rows left, an event that wants three: the event stays, compacted.
    const flow = [row('A'), row('B', 'somewhere')]
    const columns = packFlow(flow, [4, 7], 'medium')
    expect(columns[0]!.rows.map(r => r.cost)).toEqual([2, 2])
    expect(columns[0]!.rows[1]!.expanded).toBe(false)
  })

  it('moves a whole section on rather than draw its heading without its first row', () => {
    // Two rows left after the events, and a heading with a timed entry under it needs
    // three. Sunday's name would fit where it stands and Sunday's first event would not,
    // which is the split the pair exists to refuse: both go, and the two rows the heading
    // passed over stay blank.
    const flow = [row('A'), row('B'), heading('SUNDAY, 26 JUL'), row('S1')]
    expect(titles(flow, [6, 7], 'medium')).toEqual([
      ['A', 'B'],
      ['SUNDAY, 26 JUL', 'S1'],
    ])
    expect(packFlow(flow, [6, 7], 'medium')[0]!.used).toBe(4)
  })

  it('asks for the same room whether or not the first event carries a location', () => {
    // Three rows left and a heading whose event has an address on it. The pair is priced
    // at what that event costs plainly, so the section starts here and the location is
    // the thing that gives way: a day that began in one column or the other depending on
    // whether its first event happened to name a street would be the packing showing.
    const flow = [row('A'), row('B'), TOMORROW, row('T1', 'Długa 36, Warsawa')]
    expect(costs(flow, [7, 7], 'medium')).toEqual([[2, 2, 1, 2], []])
    expect(titles(flow, [7, 7], 'medium')[0]).toEqual(['A', 'B', 'TOMORROW', 'T1'])
  })

  it('lets a heading arrive with the count when its own events cannot follow it', () => {
    // The other screenshot: a date over `2 more events`, with not one of that day's events
    // drawn. Two rows left and tomorrow's first event needs three of them with the heading,
    // so the section is cut whole; the count is a row of tomorrow's all the same, and two
    // spare rows is exactly what the pair costs.
    const flow = [row('A'), row('B'), row('C'), TOMORROW, row('T1'), row('T2')]
    expect(titles(flow, [4, 4], 'medium')).toEqual([
      ['A', 'B'],
      ['C', 'TOMORROW', '2 more'],
    ])
  })

  it('draws no heading at all where the count cannot follow it either', () => {
    // One row left at the foot of the right column. Sunday cannot start there (three
    // rows), and neither can it start with the count (two), with no location line in the
    // column to hand back for the second. So the day goes unmentioned and the row goes
    // unspent: a heading over nothing announces its own absence.
    const flow = [row('A'), row('B'), TOMORROW, row('T1'), heading('SUNDAY, 26 JUL'), row('S1')]
    expect(titles(flow, [4, 4], 'medium')).toEqual([
      ['A', 'B'],
      ['TOMORROW', 'T1'],
    ])
    expect(packFlow(flow, [4, 4], 'medium')[1]!.used).toBe(3)
  })

  it('starts on the right when the left column has no budget', () => {
    const flow = [TOMORROW, ...REST_OF_TOMORROW]
    expect(titles(flow, [0, 7], 'medium')).toEqual([[], ['TOMORROW', 'T1', 'T2', 'T3']])
  })

  it('stops at the end of the last column instead of overflowing', () => {
    const flow = Array.from({ length: 20 }, (_, index) => row(`E${index}`))
    const columns = packFlow(flow, [4, 7], 'medium')
    expect(columns.every(column => column.used <= column.budget)).toBe(true)
    // Two events left, three drawn, and the odd row at the foot of the right column
    // spent on the fifteen that did not make it.
    expect(columns.flatMap(column => column.rows)).toHaveLength(6)
    expect(titles(flow, [4, 7], 'medium')[1]).toEqual(['E2', 'E3', 'E4', '15 more'])
  })

  it('never expands an all-day entry, however much room and location it has', () => {
    // Greedy medium would take a third row for any other event carrying a location.
    const columns = packFlow([allDay('A', 'Warsawa Główna')], [4, 7], 'medium')
    expect(columns[0]!.rows.map(r => r.cost)).toEqual([COST.allday])
    expect(columns[0]!.rows[0]!.expanded).toBe(false)
  })

  it('never spends a small column’s slack on an all-day entry either', () => {
    const columns = packFlow([allDay('A', 'here'), row('B', 'there')], [5], 'small')
    // The slack goes past the all-day row to the one that can use it.
    expect(columns[0]!.rows.map(r => r.expanded)).toEqual([false, true])
    expect(columns[0]!.used).toBe(4)
  })

  it('packs four all-day entries where two timed events would have fitted', () => {
    const flow = Array.from({ length: 7 }, (_, index) => allDay(`A${index}`))
    expect(costs(flow, [4, 7], 'medium')).toEqual([
      [1, 1, 1, 1],
      [1, 1, 1],
    ])
  })

  it('keeps a whole section in the column when its first entry is all-day', () => {
    // Two rows left over and one line each: the same pair of nodes that a timed entry
    // splits across the columns in the test above fits here entire.
    const flow = [row('A'), row('B'), TOMORROW, allDay('T1')]
    expect(titles(flow, [6, 7], 'medium')).toEqual([['A', 'B', 'TOMORROW', 'T1'], []])
  })

  it('never reserves a location row for a reminder', () => {
    const reminder: FlowNode = {
      type: 'item',
      key: 'r',
      item: { ...item('Pick up dry cleaning', 'Gdańska 12, Warsawa'), kind: 'reminder' },
    }
    expect(costs([reminder], [4, 7], 'medium')).toEqual([[2], []])
  })

  /**
   * A to-do due on a date with no time carries `allDay` for exactly this: there is no time
   * to print under its title, so it is one line, and the budget must not be charged for
   * two. The kind is what changes the row's anatomy (a bullet rather than the calendar
   * badge), not what it costs.
   */
  it('prices a dated reminder with no time at one row, like any all-day entry', () => {
    // Built out rather than spread from `item`: a reminder has no `end` at all, which is
    // what keeps `isOver` from retiring it, and there is no spreading `end` away.
    const datedReminder = (title: string): FlowNode => ({
      type: 'item',
      key: title,
      item: {
        id: title,
        entityId: 'todo.reminders',
        kind: 'reminder',
        title,
        start: new Date('2026-07-24T00:00:00Z'),
        allDay: true,
        color: 'orange',
      },
    })

    const flow = ['R1', 'R2', 'R3', 'R4'].map(datedReminder)
    expect(costs(flow, [4, 7], 'medium')).toEqual([[1, 1, 1, 1], []])
  })
})

describe('the tail indicator', () => {
  const reminder = (title: string): FlowNode => ({
    type: 'item',
    key: title,
    item: { ...item(title), kind: 'reminder' },
  })

  it('says nothing when everything fitted', () => {
    expect(more(packFlow([row('A'), row('B')], [4, 7], 'medium'))).toBeUndefined()
  })

  it('buys a row off the last event when the column came out exactly full', () => {
    const flow = [row('A'), row('B'), row('C'), TOMORROW, ...REST_OF_TOMORROW]
    expect(more(packFlow(flow, [4, 7], 'medium'))?.count).toBe(2)
    // The event that stepped aside is the one that lends the row its colour, being the
    // first thing the reader can no longer see.
    expect(titles(flow, [4, 7], 'medium')[1]).toEqual(['C', 'TOMORROW', 'T1', '2 more'])
  })

  it('gives back a location rather than an event when it can', () => {
    // Same column, exactly full, but this time the row above carries a location: dropping
    // that line buys the indicator its row and every event stays on screen.
    const flow = [row('A'), row('B'), row('C', 'Focha 4, Warsawa'), row('D'), row('E'), row('F')]
    expect(titles(flow, [4, 7], 'medium')).toEqual([
      ['A', 'B'],
      ['C', 'D', 'E', '1 more'],
    ])
    // `C` came out of the packing expanded and gives the line back: three rows to two.
    expect(costs(flow, [4, 7], 'medium')).toEqual([
      [2, 2],
      [2, 2, 2, 1],
    ])
  })

  it('hands back a location line to say a day exists at all', () => {
    // The default footprint, and the pair one row short at the foot of the right column:
    // the last location drawn there covers it, exactly as it covers a count under an
    // event. Tomorrow's name and the size of it are worth more than the street under `D`,
    // and a day the reader would otherwise never hear of is the dearest thing on offer.
    const flow = [
      row('A'),
      row('B'),
      row('C', 'Długa 36, Warsawa'),
      row('D', 'Focha 4, Warsawa'),
      TOMORROW,
      row('T1'),
    ]
    expect(titles(flow, [4, 7], 'medium')).toEqual([
      ['A', 'B'],
      ['C', 'D', 'TOMORROW', '1 more'],
    ])
    // `C` keeps its three rows and `D` gives its line back: the last one handed out is the
    // first one taken away.
    expect(costs(flow, [4, 7], 'medium')).toEqual([
      [2, 2],
      [3, 2, 1, 1],
    ])
  })

  it('counts only the day it is drawn inside, not the fortnight behind it', () => {
    // Four of today's events did not fit and neither did any of tomorrow's three. The row
    // sits inside today, so it speaks for today: `4 more events`, not seven.
    const flow = [
      row('A'),
      row('B'),
      row('C'),
      row('D'),
      row('E'),
      row('F'),
      row('G'),
      row('H'),
      TOMORROW,
      ...REST_OF_TOMORROW,
    ]
    expect(titles(flow, [4, 5], 'medium')[1]).toEqual(['C', 'D', '4 more'])
  })

  it('says nothing at all about a section that never made it on screen', () => {
    // The Sunday heading needs three rows to arrive with its first event and has one, so
    // the whole section is cut. There is no Sunday on the card for a count to belong to,
    // and putting one under `T2` would read as two more events tomorrow.
    const flow = [
      row('A'),
      row('B'),
      row('C'),
      TOMORROW,
      row('T1'),
      row('T2'),
      heading('SUNDAY, 26 JUL'),
      row('S1'),
    ]
    expect(titles(flow, [4, 8], 'medium')[1]).toEqual(['C', 'TOMORROW', 'T1', 'T2'])
    expect(more(packFlow(flow, [4, 8], 'medium'))).toBeUndefined()
  })

  it('will not spend a section’s only visible event on the count', () => {
    // Tomorrow arrives at the foot of the column with room for one event and has three.
    // Evicting `T1` would leave `TOMORROW` heading nothing at all, so the widget keeps the
    // event it can show and stays quiet about the two it cannot.
    const flow = [row('A'), row('B'), TOMORROW, ...REST_OF_TOMORROW]
    expect(titles(flow, [4, 3], 'medium')).toEqual([
      ['A', 'B'],
      ['TOMORROW', 'T1'],
    ])
    expect(more(packFlow(flow, [4, 3], 'medium'))).toBeUndefined()
  })

  it('goes at the end of the flow, not in the column that had room to spare', () => {
    // The left column keeps its spare row: an indicator there would sit above rows that
    // the right column carries on drawing past it.
    const flow = [row('A', 'here'), row('B'), row('C'), row('D'), row('E')]
    expect(titles(flow, [4, 5], 'medium')).toEqual([['A'], ['B', 'C', '2 more']])
  })

  it('counts reminders too, and still calls them events for now', () => {
    const flow = [row('A'), row('B'), row('C'), reminder('R1'), reminder('R2'), reminder('R3')]
    expect(titles(flow, [4, 5], 'medium')[1]).toEqual(['C', 'R1', '2 more'])
    expect(more(packFlow(flow, [4, 5], 'medium'))?.count).toBe(2)
  })

  it('takes the colour of the first thing you cannot see', () => {
    const purple: FlowNode = { type: 'item', key: 'P', item: { ...item('P'), color: 'purple' } }
    // Four events fit, so the purple fifth is the first one missing.
    const flow = [row('A'), row('B'), row('C'), row('D'), purple, row('F')]
    expect(titles(flow, [4, 5], 'medium')[1]).toEqual(['C', 'D', '2 more'])
    expect(more(packFlow(flow, [4, 5], 'medium'))?.color).toBe('purple')
  })

  it('is the only one of its kind, and always the last row drawn', () => {
    const flow = Array.from({ length: 12 }, (_, index) => row(`E${index}`))
    const rows = packFlow(flow, [5, 9], 'medium').flatMap(column => column.rows)
    expect(rows.filter(r => r.node.type === 'more')).toHaveLength(1)
    expect(rows[rows.length - 1]?.node.type).toBe('more')
  })

  /**
   * The appearance rule itself, rather than one case of it: over every budget pair the
   * card can actually produce, an unfinished section means the indicator, and a section
   * that finished means no indicator, whatever is undrawn further down the week.
   *
   * The one excuse for silence is having nothing to pay with, and after packing that is
   * three things and no others: a spare row, a location line to give back, or an event
   * with another event of its own above it.
   */
  it('appears exactly when a section on screen was left unfinished', () => {
    const flows: FlowNode[][] = [
      Array.from({ length: 9 }, (_, index) => row(`E${index}`)),
      [row('A', 'here'), row('B'), row('C', 'there'), TOMORROW, ...REST_OF_TOMORROW],
      [row('A'), TOMORROW, row('T1'), heading('SUNDAY, 26 JUL'), row('S1'), row('S2')],
      [row('A', 'here'), ...REST_OF_TOMORROW],
    ]

    const broken: string[] = []
    for (const flow of flows) {
      for (let height = 100; height <= 800; height += 2) {
        for (const mode of ['small', 'medium'] as const) {
          for (const todayEmpty of [false, true]) {
            const { budgets } = geometryFor(mode, height, todayEmpty)
            const columns = packFlow(flow, budgets, mode)
            const rows = columns.flatMap(column => column.rows)
            const indicator = rows.some(r => r.node.type === 'more')
            const missed = unfinishedSection(flow, columns)
            // After packing, so this is what the indicator really had to work with.
            const last = columns.filter(column => column.rows.length).pop()
            const affordable = last ? canAfford(last) : false
            const where = `${mode} ${JSON.stringify(budgets)}, ${flow.length} nodes`

            if (!missed.length && indicator) {
              broken.push(`nothing left in the section and it said so anyway: ${where}`)
            }
            if (missed.length && !indicator && affordable) {
              broken.push(`${missed.length} left in the section, said nothing: ${where}`)
            }
          }
        }
      }
    }

    expect(broken).toEqual([])
  })

  it('spends a small column’s last row on the count rather than on a location', () => {
    // "Count wins" all the way down: knowing an event is missing beats knowing where
    // the first one is.
    const columns = packFlow([row('A', 'here'), row('B'), row('C')], [5], 'small')
    expect(columns[0]!.rows.map(r => r.cost)).toEqual([2, 2, 1])
    expect(columns[0]!.rows.some(r => r.expanded)).toBe(false)
    expect(more(columns)?.count).toBe(1)
  })
})

describe('small: count first, locations out of the slack', () => {
  it('shows the location of a lone event', () => {
    expect(costs([row('A', 'Długa 36, Warsawa')], [4], 'small')).toEqual([[COST.expanded]])
  })

  it('shows no location at all once two events fill the budget', () => {
    const columns = packFlow([row('A', 'Długa 36, Warsawa'), row('B')], [4], 'small')
    expect(columns[0]!.rows.map(r => r.cost)).toEqual([2, 2])
    expect(columns[0]!.rows.some(r => r.expanded)).toBe(false)
  })

  it('spends slack top-down', () => {
    // Five rows, two events, both with locations: only the first one can expand.
    const columns = packFlow([row('A', 'here'), row('B', 'there')], [5], 'small')
    expect(columns[0]!.rows.map(r => r.expanded)).toEqual([true, false])
  })

  it('gives up the second of three events to admit that a third exists', () => {
    // Four rows and three timed events: two of them fit exactly, and the row the count
    // needs can only come out of one of the two. This is "count wins" at its most
    // expensive (one event you can read for two you know are there), and it is the whole
    // of the small size's argument, that four rows are too few to be quietly wrong in.
    const columns = packFlow([row('A'), row('B'), row('C')], [4], 'small')
    expect(columns[0]!.rows.map(r => r.cost)).toEqual([2, 1])
    expect(more(columns)?.count).toBe(2)

    // The row an eviction frees and the count does not need is slack like any other, so
    // a location on the event still standing takes it rather than the white space.
    const withLocation = packFlow([row('A', 'here'), row('B'), row('C')], [4], 'small')
    expect(withLocation[0]!.rows.map(r => r.cost)).toEqual([3, 1])
    expect(withLocation[0]!.rows[0]!.expanded).toBe(true)
  })

  it('keeps its one event rather than replacing it with a count', () => {
    // Two rows, three events: there is nothing above the event to evict, and a column
    // holding `3 more events` and no calendar at all would be worse than a quiet one.
    const columns = packFlow([row('A'), row('B'), row('C')], [2], 'small')
    expect(titles([row('A'), row('B'), row('C')], [2], 'small')).toEqual([['A']])
    expect(more(columns)).toBeUndefined()
  })

  /**
   * The same taste one row further down, where there is no event to keep either.
   *
   * A single row is a real budget rather than a curiosity (the 3-row footprint at 110% and
   * up), and it is the one place the count could be had for nothing, since no event fitted
   * there to be given up for it. Taken, it would make the size non-monotonic in its own
   * argument: three rows draw the event and the count, two draw the event and go quiet, and
   * one would drop the event to announce it. So the rule is the column's rather than the
   * trade's: a count needs a calendar above it.
   */
  it('says nothing at all in a column that never fitted an event', () => {
    const columns = packFlow([row('A'), row('B'), row('C')], [1], 'small')
    expect(columns[0]!.rows).toEqual([])
    expect(more(columns)).toBeUndefined()
  })
})

describe('invariants, over twenty thousand random flows', () => {
  /** Deterministic, so a failure is reproducible rather than a Tuesday thing. */
  let seed = 1
  const random = (bound: number): number => {
    seed = (Math.imul(seed, 1664525) + 1013904223) >>> 0
    return (seed >>> 8) % bound
  }

  const randomFlow = (): FlowNode[] => {
    const flow: FlowNode[] = []
    const length = random(9)
    for (let i = 0; i < length; i += 1) {
      // Headings only ever arrive before an item, and never two in a row, which is
      // all `buildFlow` can produce.
      const heads = random(4) === 0 && (flow.length === 0 || flow[flow.length - 1]!.type === 'item')
      if (heads) {
        flow.push(heading(`H${i}`))
        continue
      }
      const location = random(2) ? 'somewhere' : undefined
      flow.push(random(4) === 0 ? allDay(`A${i}`, location) : row(`I${i}`, location))
    }
    while (flow.length && flow[flow.length - 1]!.type === 'header') flow.pop()
    return flow
  }

  it('holds its budget, never orphans a heading, and never reorders', () => {
    const broken: string[] = []
    let indicators = 0
    let headings = 0

    for (let trial = 0; trial < 20_000 && broken.length === 0; trial += 1) {
      const flow = randomFlow()
      const mode = random(2) ? 'medium' : 'small'
      const budgets = mode === 'medium' ? [random(9), random(11)] : [random(9)]
      const columns = packFlow(flow, budgets, mode)
      const where = JSON.stringify({ mode, budgets, flow: flow.map(n => n.key) })

      for (const column of columns) {
        if (column.used > column.budget) broken.push(`over budget: ${where}`)
        if (column.rows.reduce((sum, r) => sum + r.cost, 0) !== column.used) {
          broken.push(`used does not match the rows: ${where}`)
        }
        // The pair, stated over every column rather than over the card: a heading is
        // never the last row of one, so the day's name and the first row of that day are
        // always found in the same place. The last column drawn is the card's end and is
        // covered by the same line, a heading there heading nothing at all.
        if (column.rows[column.rows.length - 1]?.node.type === 'header') {
          broken.push(`heading left at the foot of a column: ${where}`)
        }
      }

      const rows = columns.flatMap(column => column.rows)
      headings += rows.filter(r => r.node.type === 'header').length
      const tail = rows.filter(r => r.node.type === 'more')
      indicators += tail.length
      if (tail.length > 1) broken.push(`more than one indicator: ${where}`)
      // It summarises the end of the flow, so nothing may come after it. A heading
      // directly above it is allowed: that is a section saying how much of itself did
      // not fit, which is what the count is for.
      if (tail.length === 1 && rows[rows.length - 1] !== tail[0]) {
        broken.push(`indicator is not last: ${where}`)
      }

      // The count is exactly the rest of its own section: the items after the cut and
      // before the next heading, which is where the flow stops being about this day.
      const missed = unfinishedSection(flow, columns).length
      const counted = tail[0]?.node.type === 'more' ? tail[0].node.count : 0
      if (counted > 0 && counted !== missed) {
        broken.push(`counted ${counted} of the ${missed} left in the section: ${where}`)
      }
      if (counted === 0 && tail.length === 1) broken.push(`says "0 more": ${where}`)

      // What is drawn is always a prefix of the flow: rows are dropped off the end,
      // never skipped over in the middle.
      const placed = rows.filter(r => r.node.type !== 'more').map(r => r.node.key)
      if (
        placed.join() !==
        flow
          .slice(0, placed.length)
          .map(n => n.key)
          .join()
      ) {
        broken.push(`not a prefix of the flow: ${where}`)
      }
    }

    expect(broken).toEqual([])
    // Everything above is vacuous on a sample that never overflowed, and the pair is
    // vacuous on one that never drew a day's name in the first place.
    expect(indicators).toBeGreaterThan(1_000)
    expect(headings).toBeGreaterThan(1_000)
  })
})

describe('geometry', () => {
  const DEFAULT_HEIGHT = 248

  it('reproduces Apple’s budgets at the default card height', () => {
    expect(geometryFor('small', DEFAULT_HEIGHT, false).budgets).toEqual([4])
    expect(geometryFor('medium', DEFAULT_HEIGHT, false).budgets).toEqual([4, 7])
  })

  it('gives the left column no budget when today is empty', () => {
    expect(geometryFor('medium', DEFAULT_HEIGHT, true).budgets).toEqual([0, 7])
  })

  it('grows with the card rather than leaving the extra height blank', () => {
    const [left, right] = geometryFor('medium', 400, false).budgets
    expect(right).toBeGreaterThan(7)
    expect(left).toBeGreaterThan(4)
  })

  it('never returns a negative budget for a card squashed flat', () => {
    expect(geometryFor('medium', 40, false).budgets).toEqual([0, 0])
  })

  /**
   * The shortest footprint the Layout tab hands out, which the card has to be able to draw.
   *
   * 184px is 3 grid rows (`min_rows` in `core/size.ts`), so these budgets are not a
   * curiosity at the edge of the arithmetic, they are what a user who drags the card all
   * the way down is looking at: the date and one event beside it, with the second column
   * carrying the day. It is thin at 100% and comfortable at 80%, which is the reason the
   * floor is worth offering at all.
   */
  it('still draws a day at the 3-row floor', () => {
    const FLOOR_HEIGHT = 184
    expect(geometryFor('medium', FLOOR_HEIGHT, false).budgets).toEqual([2, 5])
    expect(geometryFor('small', FLOOR_HEIGHT, false).budgets).toEqual([2])
    expect(geometryFor('medium', FLOOR_HEIGHT, false, 0.8).budgets).toEqual([3, 6])
    // The other end of the trade, and the one worth knowing about: at 130% the date block
    // takes the whole of the left column, so the flow starts in the second one: the same
    // shape an empty today produces, arrived at from the other direction. The small size
    // has no second column to start in, which is the one combination the widget has nothing
    // to say in: the floor and the largest type together leave room for the date and
    // nothing else. Arithmetic arriving at the advice the editor's helper line gives, which
    // is to drag a scaled-up card taller.
    expect(geometryFor('medium', FLOOR_HEIGHT, false, 1.3).budgets).toEqual([0, 3])
    expect(geometryFor('small', FLOOR_HEIGHT, false, 1.3).budgets).toEqual([0])
  })

  /**
   * `scale` buys size out of the row budget, in the same box.
   *
   * Which is the honest exchange and the one the editor's helper line promises: the card
   * cannot draw larger type and the same amount of it without more height, so at 130% the
   * default footprint is worth two rows beside the date instead of four. The numbers are
   * the same arithmetic as above with the box divided by the factor: the extreme scales
   * rather than a sample, because those are the two ends anything else lands between.
   */
  it('spends rows on size: nine at the smallest scale, five at the largest', () => {
    expect(geometryFor('medium', DEFAULT_HEIGHT, false, 0.8).budgets).toEqual([6, 9])
    expect(geometryFor('medium', DEFAULT_HEIGHT, false, 1).budgets).toEqual([4, 7])
    expect(geometryFor('medium', DEFAULT_HEIGHT, false, 1.3).budgets).toEqual([2, 5])
    // The left column is the one that pays first, having the date block over it: at the
    // largest scale it holds a single event where at the smallest it holds three.
    expect(geometryFor('small', DEFAULT_HEIGHT, false, 1.3).budgets).toEqual([2])
  })

  /**
   * The budget is only worth anything if a full column actually fits in the box.
   *
   * The numbers below are measured, not assumed; every one of them is a rendered height
   * out of the card's own CSS, taken through the dev harness at a device pixel ratio of
   * 1, which is the unkindest rounding. Two of them are the reason this test exists at
   * all: the box is 2px shorter than the card, because `ha-card` draws a border and is
   * `box-sizing: border-box`, and a compact row is 56px only while the AM/PM inside it
   * keeps its hands off the line box (see the `.meridiem` rule).
   *
   * The tallest way to spend N rows is on compact rows, which are the dearest per row,
   * and, for an odd budget, on the tallest of the nodes that cost a single row.
   *
   * Run at every scale the option offers, and this is where the CSS and the arithmetic are
   * held to each other: those measured heights are all `calc(… * var(--cw-scale))` now, so
   * the whole rendering scales by the factor while `ha-card`'s border does not. Divide the
   * border along with the rest (the easy version of `geometryFor`), and the column is
   * credited with a couple of design units it never gets, which at 80% is most of a row and
   * lands on a boundary soon enough. That failure is invisible on screen until a column
   * packed exactly full clips its last descender.
   */
  it('never budgets more rows than the column can draw, at any height or scale', () => {
    const INSET = 16
    const BORDER = 1
    const DATE_BLOCK = 84
    const GAP = 6
    const COMPACT = 56
    /**
     * The tallest of the one-row nodes: an all-day chip, 22px of title inside 1px of
     * padding. A `2 more events` is 22px, a heading 20px, and a dated reminder with no time
     * is the same chip with a bullet in it, 24px as well, since the bullet is 13px and the
     * title line is what sets the height.
     */
    const ONE_ROW = 24

    const tallestRendering = (budget: number): number => {
      if (budget <= 0) return 0
      const compacts = Math.floor(budget / 2)
      const single = budget % 2
      const nodes = compacts + single
      return compacts * COMPACT + single * ONE_ROW + (nodes - 1) * GAP
    }

    // The ends of the range and the design size. `scale.test.ts` owns the bounds; what
    // matters here is that the two extremes are as safe as the middle.
    for (const scale of [0.8, 0.9, 1, 1.1, 1.3]) {
      for (let height = 100; height <= 800; height += 1) {
        // In design units, which is what `tallestRendering` counts in: the drawn heights
        // are all multiplied by the factor, and the border is not.
        const content = (height - 2 * BORDER) / scale - 2 * INSET
        const [left, right] = geometryFor('medium', height, false, scale).budgets
        expect(tallestRendering(right!)).toBeLessThanOrEqual(content)
        expect(tallestRendering(left!)).toBeLessThanOrEqual(Math.max(0, content - DATE_BLOCK))
        expect(geometryFor('small', height, false, scale).budgets[0]).toBe(left)
      }
    }
  })
})
