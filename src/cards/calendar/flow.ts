/**
 * Step one of the widget's layout: turn a pile of items into the single ordered
 * stream that both sizes render. Apple's widget is one flow of rows, and the medium
 * layout just pours that flow through two columns.
 *
 * The rules, in order:
 *
 *  1. the card's own window of days, and nothing outside it: the **anchor day**, which is
 *     today unless `day_offset` moves it, and the `days_to_show` days from there;
 *  2. anything the clock has overtaken is dropped, which is halfway through a meeting
 *     rather than at the end of it (`retiresAt` in `model.ts` has the argument), though a
 *     dropped item is still counted, so a day that is over can say so. **Only on today**:
 *     see the comment at the test itself;
 *  3. inside a day: all-day first, then by start time, reminders and events share
 *     one stream rather than being separated;
 *  4. days with nothing in them vanish completely, headings and all, so an empty
 *     Saturday is not a gap between Friday and Sunday;
 *  5. the anchor day gets no heading, since the widget's own date block already says
 *     which day it is.
 */

import { dayNumber, dayStart } from './datetime'
import { sectionHeading, type FormatContext } from './format'
import { isOver, lastDay, type CalendarItem } from './model'

export type FlowNode =
  { type: 'header'; key: string; text: string } | { type: 'item'; key: string; item: CalendarItem }

// ---- The window of days --------------------------------------------------------

/**
 * How many days the card covers when the config says nothing.
 *
 * A fortnight counting today, which is comfortably more than any widget can show, and it
 * bounds the window the data source has to subscribe to.
 */
export const DEFAULT_DAY_SPAN = 14

/**
 * How far the anchor may be dragged either way, and how many days it may then cover.
 *
 * A month each way rather than a year, and the same number for both so there is one bound
 * to remember. What decides it is what the option is *for*: a card pinned to yesterday,
 * today or tomorrow, which is the request this exists to answer, and a "last month" widget
 * is not a thing a home screen holds. The editor's two boxes offer exactly this range, so
 * the control can express everything the card accepts and hand-written YAML has nothing
 * to reach for that the dialog cannot show.
 */
export const MIN_DAY_OFFSET = -31
export const MAX_DAY_OFFSET = 31
export const MIN_DAY_SPAN = 1
export const MAX_DAY_SPAN = 31

export interface DayWindow {
  /** Days from today to the first day drawn. Negative looks back. */
  offsetDays: number
  /** How many days are drawn, counting the first. */
  spanDays: number
}

/**
 * One whole number of days out of whatever a config holds, or the fallback.
 *
 * Forgiving in the same three ways `configuredCalendars` is, and for the same reason: a
 * config is not typechecked on its way in. `day_offset: "1"` is what somebody copying the
 * option out of the README writes, a bare `days_to_show:` parses to `null`, and `1.5` days
 * is not a thing. Clamping rather than refusing, because a card that drew nothing over a
 * typo would be the worse answer.
 */
const wholeDays = (value: unknown, fallback: number, min: number, max: number): number => {
  const text = typeof value === 'string' ? value.trim() : value
  const parsed = typeof text === 'number' || (typeof text === 'string' && text) ? Number(text) : NaN
  if (!Number.isFinite(parsed)) return fallback
  return Math.min(max, Math.max(min, Math.trunc(parsed)))
}

/** The window a card config asks for. Both keys are optional and both are clamped. */
export const dayWindow = (
  config: { day_offset?: unknown; days_to_show?: unknown } | undefined,
): DayWindow => ({
  offsetDays: wholeDays(config?.day_offset, 0, MIN_DAY_OFFSET, MAX_DAY_OFFSET),
  spanDays: wholeDays(config?.days_to_show, DEFAULT_DAY_SPAN, MIN_DAY_SPAN, MAX_DAY_SPAN),
})

// ---- The flow ------------------------------------------------------------------

export interface FlowOptions {
  now: Date
  ctx: FormatContext
  /** Days from today to the anchor day. See `DayWindow`. */
  offsetDays?: number
  /**
   * How many days from the anchor, counting it. The small size passes 1: it never leaves
   * the day it is anchored on, no matter what the next one holds.
   */
  spanDays?: number
}

export interface Flow {
  nodes: FlowNode[]
  /**
   * The anchor day itself, as its first moment in the display zone: what the date block
   * prints, and the one day in the window that gets no heading of its own.
   */
  anchor: Date
  /**
   * The anchor day has nothing left in it. The widget says so out loud rather than
   * silently starting with the day after, which would read as though that day were this
   * one.
   */
  anchorEmpty: boolean
  /**
   * The anchor day is empty because it is *over*, not because it was ever free:
   * everything on it has already finished. Only ever true alongside `anchorEmpty`, only
   * ever when the anchor is today (nothing else can be half-finished), and the whole of
   * the difference between `No Events Today` and `No More Events Today`: the first one,
   * read at six in the evening of a day with three meetings behind it, says the card
   * lost them rather than that the day is done.
   *
   * "Finished" is `isOver`'s reading of it, so the last meeting of a day turns this on
   * halfway through itself. `No More Events Today` while that meeting still has twenty
   * minutes in it is the rule doing what it says: there is nothing after this one.
   */
  anchorDone: boolean
}

interface Placed {
  item: CalendarItem
  day: number
}

export function buildFlow(items: readonly CalendarItem[], options: FlowOptions): Flow {
  const { now, ctx, offsetDays = 0, spanDays = DEFAULT_DAY_SPAN } = options
  const today = dayNumber(now, ctx.timeZone)
  const first = today + offsetDays
  const last = first + Math.max(1, spanDays) - 1

  const placed: Placed[] = []
  // Only interesting when nothing is left: it is what tells an empty anchor day from a
  // finished one.
  let anyFinishedOnAnchor = false
  for (const item of items) {
    const startDay = dayNumber(item.start, ctx.timeZone)
    // The last day it is still on, read off an exclusive end (the essay is on `lastDay`).
    // Something with no end is a moment rather than a span, so it begins and ends on the
    // one day, which is what drops yesterday's reminder without a rule of its own.
    const endDay = lastDay(item, ctx.timeZone) ?? startDay
    if (endDay < first || startDay > last) continue

    // Something with a duration that began before the window is still going on inside it,
    // so it belongs to the first day of the window rather than to the day it started on,
    // which is off the back of the card: a trip that started on Monday is what Wednesday
    // is about too.
    const day = Math.max(startDay, first)

    // The clock only ever retires something on **today**, and that is the whole of what
    // makes a window in the past readable. A day already gone is over by definition, so
    // asking this of one would empty it; a day still to come has nothing on it that has
    // happened yet. So `day_offset: -1` draws the whole of yesterday, while today goes on
    // showing only what is left of itself, which is the reading each of those days wants.
    if (day === today && isOver(item, now, ctx.timeZone)) {
      // `endDay`, not the item's own last day: they are the same thing here (only an item
      // with an end can be retired at all), and this asks whether the day that finished is
      // the one the card is anchored on. It can only be true when the anchor IS today.
      anyFinishedOnAnchor ||= endDay === first
      continue
    }

    placed.push({ item, day })
  }

  placed.sort((a, b) => {
    if (a.day !== b.day) return a.day - b.day
    const allDay = Number(b.item.allDay ?? false) - Number(a.item.allDay ?? false)
    if (allDay !== 0) return allDay
    const start = a.item.start.getTime() - b.item.start.getTime()
    if (start !== 0) return start
    // Only to keep the order stable when two things start at the same minute.
    return a.item.title.localeCompare(b.item.title, ctx.locale)
  })

  const nodes: FlowNode[] = []
  let currentDay: number | undefined
  for (const { item, day } of placed) {
    if (day !== currentDay) {
      currentDay = day
      if (day !== first) {
        // `item.start` is the right date for the heading whatever the window is: a node
        // whose day is not its own start day was carried forward, and carrying only ever
        // lands on `first`, which is the one day with no heading.
        nodes.push({
          type: 'header',
          key: `day-${day}`,
          text: sectionHeading(item.start, now, ctx),
        })
      }
    }
    nodes.push({ type: 'item', key: item.id, item })
  }

  const anchorEmpty = placed.length === 0 || placed[0].day !== first
  return {
    nodes,
    anchor: dayStart(first, ctx.timeZone),
    anchorEmpty,
    anchorDone: anchorEmpty && anyFinishedOnAnchor,
  }
}
