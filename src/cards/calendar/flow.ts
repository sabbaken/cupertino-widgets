/**
 * Step one of the widget's layout: turn a pile of items into the single ordered
 * stream that both sizes render. Apple's widget is one flow of rows, and the medium
 * layout just pours that flow through two columns.
 *
 * The rules, in order:
 *
 *  1. today and forwards only, out to `LOOKAHEAD_DAYS`;
 *  2. anything the clock has overtaken is dropped, which is halfway through a meeting
 *     rather than at the end of it (`retiresAt` in `model.ts` has the argument), though a
 *     dropped item is still counted, so a day that is over can say so;
 *  3. inside a day: all-day first, then by start time, reminders and events share
 *     one stream rather than being separated;
 *  4. days with nothing in them vanish completely, headings and all, so an empty
 *     Saturday is not a gap between Friday and Sunday;
 *  5. today gets no heading, since the widget's own date block already says which day it is.
 */

import { dayNumber } from './datetime'
import { sectionHeading, type FormatContext } from './format'
import { isOver, lastDay, type CalendarItem } from './model'

export type FlowNode =
  { type: 'header'; key: string; text: string } | { type: 'item'; key: string; item: CalendarItem }

/**
 * Two weeks is comfortably more than any widget can show, and it bounds the window
 * the data source has to subscribe to.
 */
export const LOOKAHEAD_DAYS = 14

export interface FlowOptions {
  now: Date
  ctx: FormatContext
  /** Small never leaves today, no matter what tomorrow holds. */
  todayOnly?: boolean
  horizonDays?: number
}

export interface Flow {
  nodes: FlowNode[]
  /**
   * Today has nothing left in it. The widget says so out loud rather than silently
   * starting with tomorrow, which would read as though tomorrow were today.
   */
  todayEmpty: boolean
  /**
   * Today is empty because it is *over*, not because it was ever free: everything on
   * it has already finished. Only ever true alongside `todayEmpty`, and the whole of
   * the difference between `No Events Today` and `No More Events Today`: the first one,
   * read at six in the evening of a day with three meetings behind it, says the card
   * lost them rather than that the day is done.
   *
   * "Finished" is `isOver`'s reading of it, so the last meeting of a day turns this on
   * halfway through itself. `No More Events Today` while that meeting still has twenty
   * minutes in it is the rule doing what it says: there is nothing after this one.
   */
  todayDone: boolean
}

interface Placed {
  item: CalendarItem
  day: number
}

export function buildFlow(items: readonly CalendarItem[], options: FlowOptions): Flow {
  const { now, ctx, todayOnly = false, horizonDays = LOOKAHEAD_DAYS } = options
  const today = dayNumber(now, ctx.timeZone)
  const horizon = today + horizonDays

  const placed: Placed[] = []
  // Only interesting when nothing is left: it is what tells an empty today from a
  // finished one.
  let anyFinishedToday = false
  for (const item of items) {
    if (isOver(item, now, ctx.timeZone)) {
      // The day it ends on, read off an exclusive end, which is what keeps yesterday's
      // all-day trip from counting as one of today's. The essay is on `lastDay`.
      anyFinishedToday ||= lastDay(item, ctx.timeZone) === today
      continue
    }

    const startDay = dayNumber(item.start, ctx.timeZone)
    // Something with a duration that began before today and has not ended is still
    // happening, so it belongs to today rather than to the day it started on, else it
    // would fall off the back of the widget while it was going on. Something without a
    // duration gets no such reprieve: yesterday's reminder was for yesterday.
    const day = item.end && startDay < today ? today : startDay

    if (day < today || day > horizon) continue
    if (todayOnly && day !== today) continue
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
      if (day !== today) {
        nodes.push({
          type: 'header',
          key: `day-${day}`,
          text: sectionHeading(item.start, now, ctx),
        })
      }
    }
    nodes.push({ type: 'item', key: item.id, item })
  }

  const todayEmpty = placed.length === 0 || placed[0].day !== today
  return { nodes, todayEmpty, todayDone: todayEmpty && anyFinishedToday }
}
