import { describe, expect, it } from 'vitest'

import {
  LINGER_MS,
  NO_PINS,
  listFor,
  nextExpiry,
  sweptPins,
  withPin,
  withoutPin,
  type PinSet,
  type ReminderList,
} from './completion'
import { COMPLETED, NEEDS_ACTION, readItems, type ReminderItem } from './model'

/** The moment of the tap, so every other time in the file reads as an offset from it. */
const TAP = 1_600_000_000_000

const aThingToDo = (title: string): ReminderItem => ({ id: title, title, status: NEEDS_ACTION })

/**
 * The same row once the list itself says it is done.
 *
 * Which is what the snapshot says almost at once: `local_todo` writes state inside the
 * blocking service call, so the push saying `completed` arrives before `callService`
 * resolves. A test that only ever ticked rows the snapshot still called `needs_action`
 * would be describing a round trip this card never sees.
 */
const alreadyTicked = (title: string): ReminderItem => ({ id: title, title, status: COMPLETED })

/** The tap: the row is asked to be completed, and held to that for the linger. */
const tapped = (pins: PinSet, item: ReminderItem, now: number): PinSet =>
  withPin(pins, item.id, COMPLETED, now)

/** The second tap on the same row, which is undo. */
const untapped = (pins: PinSet, item: ReminderItem, now: number): PinSet =>
  withPin(pins, item.id, NEEDS_ACTION, now)

/** What a reader would see, row by row, with a tick on the ones drawn done. */
const drawn = (list: ReminderList): string[] =>
  list.rows.map(row => `${row.done ? '[x]' : '[ ]'} ${row.item.title}`)

const MILK = aThingToDo('Buy milk')
const VET = aThingToDo('Ring the vet')

describe('the tick under the finger', () => {
  /**
   * The tap draws itself. Nothing here waits for a snapshot, which is the whole point of the
   * pin being what the row is drawn from while it is live: the alternative, drawing from the
   * snapshot alone, puts a round trip between the finger and the tick.
   */
  it('draws a tapped row ticked before the list has said anything back', () => {
    const pins = tapped(NO_PINS, MILK, TAP)
    expect(drawn(listFor([MILK, VET], pins, TAP))).toEqual(['[x] Buy milk', '[ ] Ring the vet'])
  })

  it('draws it ticked just the same once the list agrees', () => {
    const pins = tapped(NO_PINS, MILK, TAP)
    const snapshot = [alreadyTicked('Buy milk'), VET]
    expect(drawn(listFor(snapshot, pins, TAP))).toEqual(['[x] Buy milk', '[ ] Ring the vet'])
  })
})

/**
 * The one behaviour where the number and the rows deliberately disagree: a row being held
 * after a tick is still drawn and is no longer something still to do. The count is what the
 * reference widget decrements under the finger, and a row that vanished instead would take
 * the undo with it.
 */
describe('the count, against the rows', () => {
  it('drops the moment the row is pinned, and the row it dropped is still drawn', () => {
    const list = listFor([MILK, VET], tapped(NO_PINS, MILK, TAP), TAP)
    expect(list.count).toBe(1)
    expect(drawn(list)).toEqual(['[x] Buy milk', '[ ] Ring the vet'])
  })

  it('counts every row before anything has been tapped', () => {
    expect(listFor([MILK, VET], NO_PINS, TAP).count).toBe(2)
  })

  /** Nothing left to do, and two rows still on the widget for as long as the linger lasts. */
  it('reaches zero with rows still on the card', () => {
    const pins = tapped(tapped(NO_PINS, MILK, TAP), VET, TAP)
    const list = listFor([MILK, VET], pins, TAP)
    expect(list.count).toBe(0)
    expect(list.rows).toHaveLength(2)
  })
})

describe('the linger', () => {
  /** The list after the tap, which is the state the pin is actually holding a row against. */
  const snapshot = [alreadyTicked('Buy milk'), VET]

  it('holds a ticked row for five seconds and then drops it', () => {
    const pins = tapped(NO_PINS, MILK, TAP)
    const broken: string[] = []
    let held = 0

    for (let offset = 0; offset < LINGER_MS; offset += 100) {
      const list = listFor(snapshot, pins, TAP + offset)
      if (drawn(list).join(', ') !== '[x] Buy milk, [ ] Ring the vet') {
        broken.push(`drawn as ${drawn(list).join(', ')} at +${offset}ms`)
      }
      if (list.count !== 1) broken.push(`count of ${list.count} at +${offset}ms`)
      held += 1
    }

    expect(broken).toEqual([])
    // A sweep that took one sample proves nothing about a window.
    expect(held).toBe(50)

    expect(drawn(listFor(snapshot, pins, TAP + LINGER_MS))).toEqual(['[ ] Ring the vet'])
  })

  /**
   * The row goes on the stroke rather than after it, which is `livePin`'s `until > now`. Worth
   * pinning because the boundary is what a timer fires on: the card schedules its sweep for
   * exactly this millisecond, and a pin that were still live at it would draw one more frame
   * of a row that has already been swept out from under it.
   */
  it('lets the pin go on the stroke of five seconds, not after it', () => {
    const pins = tapped(NO_PINS, MILK, TAP)
    expect(drawn(listFor(snapshot, pins, TAP + LINGER_MS - 1))).toContain('[x] Buy milk')
    expect(drawn(listFor(snapshot, pins, TAP + LINGER_MS))).not.toContain('[x] Buy milk')
  })
})

describe('undo', () => {
  it('puts the row back to unticked and the count back with it', () => {
    const snapshot = [alreadyTicked('Buy milk'), VET]
    const pins = untapped(tapped(NO_PINS, MILK, TAP), MILK, TAP + 1_000)
    const list = listFor(snapshot, pins, TAP + 1_000)

    expect(drawn(list)).toEqual(['[ ] Buy milk', '[ ] Ring the vet'])
    expect(list.count).toBe(2)
  })

  /**
   * An undo pin's expiry does nothing on its own: the second service call has already pushed
   * a snapshot saying `needs_action`, so by the time the pin runs out the row is not being
   * held against anything.
   */
  it('leaves the row where it is when its own pin runs out', () => {
    const pins = untapped(NO_PINS, MILK, TAP)
    const list = listFor([MILK, VET], pins, TAP + LINGER_MS)

    expect(drawn(list)).toEqual(['[ ] Buy milk', '[ ] Ring the vet'])
    expect(list.count).toBe(2)
  })
})

/**
 * The list is shared, and a to-do list is the sort of thing two people are in at once. An item
 * ticked off somewhere else is not a tap this card can take back, so it gets no linger: it is
 * simply not on the list any more.
 */
describe('a list that moved without this card', () => {
  it('drops an item somebody else ticked off, with no linger at all', () => {
    const snapshot = [alreadyTicked('Buy milk'), VET]
    expect(drawn(listFor(snapshot, NO_PINS, TAP))).toEqual(['[ ] Ring the vet'])
    expect(listFor(snapshot, NO_PINS, TAP).count).toBe(1)
  })

  /** And not because a pin ran out somewhere: there was never one to run out. */
  it('drops it just the same long after the tap that was not made', () => {
    const snapshot = [alreadyTicked('Buy milk'), VET]
    expect(drawn(listFor(snapshot, NO_PINS, TAP + 10 * LINGER_MS))).toEqual(['[ ] Ring the vet'])
  })

  /** The pin outlives the row it was on: the item left the list while it was held. */
  it('draws nothing for a pin whose item is no longer on the list', () => {
    const pins = tapped(NO_PINS, MILK, TAP)
    expect(drawn(listFor([VET], pins, TAP))).toEqual(['[ ] Ring the vet'])
  })
})

/**
 * `TodoItem.status` is `Optional` on the dataclass, so an integration may leave it off. Home
 * Assistant's own card files those items under a heading of their own; here they are things on
 * a to-do list, which is the only claim the widget makes about them.
 */
describe('an item that said nothing about itself', () => {
  it('is drawn unticked and counted as still to do', () => {
    const wire = readItems([{ summary: 'Book the ferry', uid: 'ferry', status: null }])
    const list = listFor(wire, NO_PINS, TAP)

    expect(drawn(list)).toEqual(['[ ] Book the ferry'])
    expect(list.count).toBe(1)
  })
})

/**
 * A to-do list is already somebody's arrangement of itself, and it is the arrangement the panel
 * a tap opens will show. So nothing here sorts: not by title, and in particular not by whether a
 * row is ticked, which would make a held row jump to the bottom on its way out.
 */
describe('the order of the rows', () => {
  const list = [aThingToDo('Water the plants'), MILK, aThingToDo('Post the parcel'), VET]

  it('is the list’s own, whatever the titles are', () => {
    expect(listFor(list, NO_PINS, TAP).rows.map(row => row.item.title)).toEqual([
      'Water the plants',
      'Buy milk',
      'Post the parcel',
      'Ring the vet',
    ])
  })

  it('keeps a ticked row in its place rather than sinking it', () => {
    const pins = tapped(NO_PINS, MILK, TAP)
    expect(drawn(listFor(list, pins, TAP))).toEqual([
      '[ ] Water the plants',
      '[x] Buy milk',
      '[ ] Post the parcel',
      '[ ] Ring the vet',
    ])
  })
})

/**
 * The pins as a value. The card holds them in a `@state()` field, so identity is what decides
 * whether Lit repaints, and these three helpers are the only things that ever hand it a new one.
 */
describe('the pins as a set', () => {
  const twoPins = tapped(tapped(NO_PINS, MILK, TAP), VET, TAP + 2_000)

  it('answers the same set when there was nothing to take out', () => {
    expect(withoutPin(twoPins, 'Post the parcel')).toBe(twoPins)
  })

  it('answers a set without the pin, leaving the one it was given alone', () => {
    const next = withoutPin(twoPins, MILK.id)
    expect(next.has(MILK.id)).toBe(false)
    expect(next.has(VET.id)).toBe(true)
    expect(twoPins.has(MILK.id)).toBe(true)
  })

  /**
   * The identity assertions are the point of the sweep, not a detail of it: this runs off a
   * timer, and a fresh map is all Lit needs to repaint. A sweep that found nothing must be a
   * repaint for nothing.
   */
  it('sweeps to the same set while every pin is still live', () => {
    expect(sweptPins(twoPins, TAP)).toBe(twoPins)
    expect(sweptPins(twoPins, TAP + LINGER_MS - 1)).toBe(twoPins)
    expect(sweptPins(NO_PINS, TAP)).toBe(NO_PINS)
  })

  it('sweeps to a fresh set the moment one has run out, and keeps the rest', () => {
    const swept = sweptPins(twoPins, TAP + LINGER_MS)
    expect(swept).not.toBe(twoPins)
    expect([...swept.keys()]).toEqual([VET.id])

    expect([...sweptPins(twoPins, TAP + 2_000 + LINGER_MS).keys()]).toEqual([])
  })

  /** One timer off the earliest, rather than one handle per row to lose when the card leaves. */
  it('names the earliest expiry, and nothing at all when there are no pins', () => {
    expect(nextExpiry(twoPins)).toBe(TAP + LINGER_MS)
    expect(nextExpiry(tapped(twoPins, VET, TAP - 3_000))).toBe(TAP - 3_000 + LINGER_MS)
    expect(nextExpiry(NO_PINS)).toBeUndefined()
  })

  /** A second tap replaces the first, so an undo is held for a full five seconds of its own. */
  it('gives a re-pinned row the whole linger again', () => {
    const pins = untapped(tapped(NO_PINS, MILK, TAP), MILK, TAP + 4_000)
    expect(pins.size).toBe(1)
    expect(nextExpiry(pins)).toBe(TAP + 4_000 + LINGER_MS)
  })
})
