/**
 * What the calendar widget draws, independent of where it came from.
 *
 * The layout engine (`flow.ts`, `layout.ts`) only ever sees `CalendarItem`, so the data
 * source stays a swappable seam. Three produce these: `source.ts`, from the
 * `calendar/event/subscribe` websocket; `todo-source.ts`, from `todo/item/subscribe`; and
 * `demo-data.ts`, for the harness. The two protocols are documented on those files, which
 * are the only ones in the card that know Home Assistant exists.
 *
 * `kind` is the whole of what the two sources disagree about, and it is a statement about
 * the *thing* rather than about where it came from: an event is a span of a day, a
 * reminder is something you tick off. A to-do item has a `due` and no duration, which is
 * why the shape below fits both without a second interface.
 */

import { dayNumber } from './datetime'

export type CalendarItemKind = 'event' | 'reminder'

export interface CalendarItem {
  /** Stable across re-renders; used as the keyed-render identity. */
  id: string
  /**
   * The `calendar.…` or `todo.…` entity this came out of.
   *
   * Its job is `itemTarget` below: a tap on a reminder opens the list it belongs to, and
   * this is the only thing that says which list that is. It is already the first field of
   * `id`, kept there because the id has to be unique across every subscribed entity, and
   * splitting it back out of that string would mean reading a key for one of its parts,
   * which is the sort of thing that survives until somebody changes the separator.
   */
  entityId: string
  kind: CalendarItemKind
  title: string
  location?: string
  start: Date
  /** Absent for reminders, and for events with no duration. */
  end?: Date
  /**
   * This belongs to a day rather than to a moment: an all-day event, or a to-do due on a
   * date with no time on it. Both print no time and sort to the top of their day.
   */
  allDay?: boolean
  /** The calendar's (or to-do list's) colour, as a CSS colour value. */
  color: string
}

/**
 * The calendar day an item's last moment falls on, or nothing if it has no end.
 *
 * The end is exclusive, here as it is on the wire: Home Assistant's all-day events end at
 * the following midnight, so the last moment of a span is the tick before its end rather
 * than the end itself. `start` floors it for the zero-length case, where a
 * stroke-of-midnight event would otherwise be dated to the day before.
 *
 * Two rules turn on this one question. Which day an item that is over ended on, which is
 * `flow.ts`'s `No More Events Today`; and whether a span is one sitting or a stretch of the
 * calendar, which is `retiresAt` below.
 */
export const lastDay = (item: CalendarItem, timeZone?: string): number | undefined => {
  if (!item.end) return undefined
  const last = Math.max(item.start.getTime(), item.end.getTime() - 1)
  return dayNumber(new Date(last), timeZone)
}

/**
 * The moment the clock takes a row down, or nothing if the clock never can.
 *
 * **A meeting retires halfway through, not at its end.** At ten past two you are sitting
 * in the two-to-three meeting, and what the widget owes you from that minute is the thing
 * after it: holding the row to 3PM spends the second half of every appointment telling the
 * reader where they already are. This is the phone's reading of a running event, and the
 * one place in the card where something still happening is treated as spent. The
 * alternative, the exclusive end, is what this card did first; it is more literal, and what
 * it cost was the next row, which is the row worth having.
 *
 * **Two shapes keep their full end**, for the same reason twice: half of them is not a
 * moment anything stops mattering. An all-day entry's half is midday, and an all-day thing
 * is about the day rather than about a moment in it. A span across midnight (an overnight
 * shift, a multi-day trip with times on it) has its half somewhere in the middle of itself,
 * while `buildFlow` is still carrying it into today for being under way, so retiring it
 * there would hide a trip the reader is on. The half therefore prices one sitting, and the
 * end prices a stretch of the calendar.
 */
const retiresAt = (item: CalendarItem, timeZone?: string): number | undefined => {
  if (!item.end) return undefined
  const start = item.start.getTime()
  const end = item.end.getTime()
  if (item.allDay || lastDay(item, timeZone) !== dayNumber(item.start, timeZone)) return end
  return start + (end - start) / 2
}

/**
 * Whether an item has been overtaken by the clock: see `retiresAt` for when that is.
 *
 * Only a real end time can retire an item. Something without one (a reminder, an
 * all-day entry) stays up for the rest of its day and is dropped by the day filter,
 * not by this: an overdue reminder is still a thing you have to do, and hiding it at
 * the stroke of its due time would be the wrong help.
 */
export const isOver = (item: CalendarItem, now: Date, timeZone?: string): boolean => {
  const retires = retiresAt(item, timeZone)
  return retires !== undefined && retires <= now.getTime()
}

/**
 * Whether a location line is even on the table for this item.
 *
 * Reminders never get one: a to-do has a place in a list, not a place on a map, so
 * the budget must not reserve a row for one either. Nor does an all-day entry: it is a
 * single line by definition, and there is no expanded form of it to print one on.
 */
export const hasLocation = (item: CalendarItem): boolean =>
  item.kind === 'event' && !item.allDay && Boolean(item.location)

// ---- Where a row goes when it is tapped ------------------------------------

/**
 * The page behind an item: a panel to check for, and a path to go to.
 *
 * `panel` comes back beside the path because a panel only exists while its integration is
 * loaded, and a card has no business landing the user on Home Assistant's not-found page.
 * It is the panel's `url_path`, which is also its key in `hass.panels`. See `PanelInfo` in
 * `core/types/ha.ts` for why presence is asked this way.
 */
export interface ItemTarget {
  panel: string
  path: string
}

/**
 * Two kinds of row, two different things to open.
 *
 * **A reminder opens its own list.** `ha-panel-todo` reads `entity_id` out of the query
 * string on its first update and selects that list, and writes the same parameter back when
 * the user picks one from its menu, so this is the panel's own address for a list rather
 * than a parameter we hope it honours. It also remembers the last list in local storage
 * under `selectedTodoEntity`, which is exactly why the parameter has to be passed: without
 * it the panel opens whichever list the user looked at last, and the row would have been a
 * link to nothing in particular.
 *
 * **An event opens the calendar, and nothing narrower exists.** `ha-panel-calendar` reads
 * nothing at all from the URL: which calendars are shown lives in local storage under
 * `deSelectedCalendars`, and there is no parameter for a date or an event, so `/calendar` is
 * the whole of what can be addressed. It opens on today, which is the day the widget is
 * about, so the gap between this and a deep link is smaller than it looks.
 */
export const itemTarget = (item: CalendarItem): ItemTarget =>
  item.kind === 'reminder'
    ? { panel: 'todo', path: `/todo?entity_id=${encodeURIComponent(item.entityId)}` }
    : { panel: 'calendar', path: '/calendar' }
