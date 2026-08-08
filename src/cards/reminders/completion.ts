/**
 * What the widget draws, given what the list says and what the user has just done to it.
 *
 * This is the card's `flow.ts`: the layer between the data and the packing, and the only
 * one that knows a tap can be taken back.
 *
 * **Why the five seconds cannot be a delay before the call.** The obvious reading of "hold
 * it for five seconds so it can be undone" is to hold the service call, and it is the wrong
 * one twice over. It loses the tick if the dashboard is left before the timer fires, and no
 * other Home Assistant client learns anything for five seconds. What settles it is the
 * protocol: `local_todo` writes state inside the blocking `todo.update_item` call
 * (`async_update_ha_state(force_refresh=True)`, which reaches `async_update_listeners()`),
 * so the subscription pushes a snapshot already saying `completed` BEFORE `callService`
 * resolves. There is no window in which a card could sit on the change and still be
 * describing the list.
 *
 * So the call goes immediately, and the five seconds are a **pin**: a per-item note saying
 * what the tap asked for and how long the row is held against a snapshot that has already
 * moved on. That buys three things at once, which is the argument for it being one
 * mechanism rather than three:
 *
 *  - the row stays put for five seconds instead of vanishing under the finger;
 *  - the tick appears on the tap rather than a round trip later, because the pin is what
 *    the row is drawn from while it is live;
 *  - a failed call rolls back by dropping the pin, with nothing else to undo.
 *
 * Undo is the same mechanism pointed the other way: a second tap pins `needs_action` and
 * calls the service again with it. That pin's expiry does nothing on its own, because by
 * then the snapshot agrees and the row was never going anywhere.
 *
 * Everything here is pure and takes `now` as a number, which is what makes it testable in
 * node: the element owns the clock and the timer, this owns the rules.
 */

import { COMPLETED, type ReminderItem, type ReminderStatus } from './model'

/**
 * How long a tapped row is held.
 *
 * Not configurable, and it is the one number in this card that is a promise to the user
 * rather than a consequence of the box: long enough to notice the row you did not mean to
 * tick and reach it, short enough that a widget does not become a list of things you have
 * already done.
 */
export const LINGER_MS = 5_000

/** What a tap asked for, and when the row stops being held to it. */
export interface Pin {
  status: ReminderStatus
  until: number
}

/**
 * The pins, keyed by `ReminderItem.id`.
 *
 * A read-only map handed around by value: every change makes a new one, because the card
 * holds this in a `@state()` field and Lit compares by identity. Mutating a map in place
 * would be a change no re-render followed.
 */
export type PinSet = ReadonlyMap<string, Pin>

export const NO_PINS: PinSet = new Map()

/** The pin on an item, if it has one and it has not run out. */
export const livePin = (pins: PinSet, id: string, now: number): Pin | undefined => {
  const pin = pins.get(id)
  return pin && pin.until > now ? pin : undefined
}

/**
 * The status the row is drawn at: what the tap asked for while that is still held,
 * otherwise what the list says.
 */
export const drawnStatus = (pins: PinSet, item: ReminderItem, now: number): ReminderStatus =>
  livePin(pins, item.id, now)?.status ?? item.status

/** The set with `id` pinned to `status` for the linger. Replaces any pin already on it. */
export const withPin = (pins: PinSet, id: string, status: ReminderStatus, now: number): PinSet => {
  const next = new Map(pins)
  next.set(id, { status, until: now + LINGER_MS })
  return next
}

/** The set without `id`, unchanged when it was not pinned. */
export const withoutPin = (pins: PinSet, id: string): PinSet => {
  if (!pins.has(id)) return pins

  const next = new Map(pins)
  next.delete(id)
  return next
}

/**
 * The set with everything that has run out taken out.
 *
 * Answers with the same set when nothing had, so a sweep that finds nothing is not a
 * re-render: this runs off a timer, and a fresh map identity is all Lit needs to repaint.
 */
export const sweptPins = (pins: PinSet, now: number): PinSet => {
  let expired = false
  for (const pin of pins.values()) {
    if (pin.until <= now) {
      expired = true
      break
    }
  }
  if (!expired) return pins

  const next = new Map<string, Pin>()
  for (const [id, pin] of pins) {
    if (pin.until > now) next.set(id, pin)
  }
  return next
}

/**
 * When the earliest pin runs out, or nothing if there are none.
 *
 * The card schedules one timer off this rather than one per pin: a sweep is cheap, the pins
 * are few, and a timer per row is a set of handles to lose track of when the card leaves
 * the DOM mid-linger.
 */
export const nextExpiry = (pins: PinSet): number | undefined => {
  let earliest: number | undefined
  for (const pin of pins.values()) {
    if (earliest === undefined || pin.until < earliest) earliest = pin.until
  }
  return earliest
}

// ---- What the widget draws -----------------------------------------------------

export interface ReminderRow {
  item: ReminderItem
  /** Drawn ticked. True only while a pin is holding it there; see the module comment. */
  done: boolean
}

export interface ReminderList {
  /**
   * Every row the widget would draw with unlimited room, in the list's own order.
   *
   * The order is the one the subscription pushes, which is the order the list is kept in
   * and the order `todo/item/move` rearranges. Nothing is sorted here: a to-do list is
   * already somebody's arrangement of itself, and a widget that re-ordered it would be
   * showing a different list from the panel a tap on it opens.
   */
  rows: ReminderRow[]
  /**
   * The number over the name: how many things are still to do.
   *
   * Counted from the same snapshot the rows come from, and not read off the entity's state,
   * even though the state is exactly this number
   * (`sum(item.status == NEEDS_ACTION)`, stringified). Two reasons, and the second is the
   * one that decides it:
   *
   *  - the state counts `needs_action` alone, so an item whose `status` is `null` is drawn
   *    by this card and counted by nothing, and a widget whose number disagrees with the
   *    rows under it is worse than one that is a moment out of date;
   *  - a pin has to move it. Ticking something off decrements the count under the finger,
   *    which is what the reference widget does, and the state cannot say that while the row
   *    is still being held.
   *
   * What it costs: before the first push there is no snapshot and so no number, and the
   * heading draws its line box empty for one round trip rather than showing a `0` that is
   * about to be wrong.
   */
  count: number
}

/**
 * The rows and the count, from the list and the pins.
 *
 * One pass, because the count is not `rows.length`: a row being held after a tick is drawn
 * and is not something still to do.
 */
export const listFor = (
  items: readonly ReminderItem[],
  pins: PinSet,
  now: number,
): ReminderList => {
  const rows: ReminderRow[] = []
  let count = 0

  for (const item of items) {
    const pin = livePin(pins, item.id, now)
    const status = pin?.status ?? item.status

    // Ticked with nothing holding it: the linger is over, or another client ticked it off
    // and this card never had a pin on it. Either way it is no longer a thing to do.
    if (status === COMPLETED && !pin) continue

    rows.push({ item, done: status === COMPLETED })
    if (status !== COMPLETED) count += 1
  }

  return { rows, count }
}
