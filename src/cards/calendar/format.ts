/**
 * Text formatting for the calendar widget, following Apple's typographic habits
 * rather than a plain `toLocaleTimeString`:
 *
 *  - a whole hour drops its `:00`            -> `5 – 6PM`, not `5:00 – 6:00 PM`
 *  - AM/PM prints once for a range that stays in one half of the day
 *  - the range separator is a spaced en dash
 *  - the meridiem is rendered smaller than the digits, which is why it comes back as
 *    its own token instead of being baked into the string
 *
 * All of it stays locale-driven: a 24-hour locale gets `17:00 – 18:00`, and the
 * meridiem can legitimately come *before* the digits (`午後1:00`), which the token
 * carries as a flag.
 */

import { dayNumber, dayStart } from './datetime'
import type { DayWindow } from './flow'

export interface TimeToken {
  /** The digits, e.g. `6` or `6:15`. */
  text: string
  /** `AM` / `PM` and their localised equivalents. Absent on a 24-hour clock. */
  meridiem?: string
  /** True in locales that put the day period first. */
  meridiemFirst?: boolean
}

export type ItemTime =
  | { kind: 'none' }
  | { kind: 'point'; at: TimeToken }
  | { kind: 'range'; from: TimeToken; to: TimeToken }

export interface FormatContext {
  locale: string | undefined
  timeZone: string | undefined
  hour12: boolean
}

/** Range separator: en dash, spaced, as on the phone. */
export const TIME_DASH = '–'

const formatters = new Map<string, Intl.DateTimeFormat>()

const formatter = (key: string, build: () => Intl.DateTimeFormat): Intl.DateTimeFormat => {
  let cached = formatters.get(key)
  if (!cached) {
    cached = build()
    formatters.set(key, cached)
  }
  return cached
}

const zone = (timeZone: string | undefined): { timeZone?: string } => (timeZone ? { timeZone } : {})

const relativeFormatters = new Map<string, Intl.RelativeTimeFormat>()

const relativeDay = (locale: string | undefined): Intl.RelativeTimeFormat => {
  const key = locale ?? ''
  let cached = relativeFormatters.get(key)
  if (!cached) {
    cached = new Intl.RelativeTimeFormat(locale, { numeric: 'auto' })
    relativeFormatters.set(key, cached)
  }
  return cached
}

const timeToken = (date: Date, ctx: FormatContext): TimeToken => {
  const { locale, timeZone, hour12 } = ctx
  const parts = formatter(
    `time|${locale}|${timeZone}|${hour12}`,
    () =>
      new Intl.DateTimeFormat(locale, {
        hour: 'numeric',
        minute: '2-digit',
        hourCycle: hour12 ? 'h12' : 'h23',
        ...zone(timeZone),
      }),
  ).formatToParts(date)

  const hourIndex = parts.findIndex(part => part.type === 'hour')
  const periodIndex = parts.findIndex(part => part.type === 'dayPeriod')
  const hour = parts[hourIndex]?.value ?? ''
  const minute = parts.find(part => part.type === 'minute')?.value ?? ''
  // en-GB and friends hand back a lowercase "pm"; the phone sets it in capitals whatever
  // the locale thinks, and the card renders it a size down to match.
  const rawMeridiem = periodIndex === -1 ? undefined : parts[periodIndex]?.value
  const meridiem = rawMeridiem?.toLocaleUpperCase(locale)
  // The locale's own hour/minute separator: ":" almost everywhere, "." in a few places.
  const afterHour = parts[hourIndex + 1]
  const separator = afterHour?.type === 'literal' ? afterHour.value : ':'

  // Dropping ":00" is a 12-hour-clock idiom; "17 – 18" would read as a range of
  // numbers, not of times, so a 24-hour clock keeps its minutes.
  const text = hour12 && minute === '00' ? hour : `${hour}${separator}${minute}`

  return {
    text,
    ...(meridiem ? { meridiem } : {}),
    ...(meridiem && periodIndex < hourIndex ? { meridiemFirst: true } : {}),
  }
}

/**
 * How an item's time reads on the card.
 *
 * All-day items print no time at all, and anything without a real duration (a
 * reminder, a zero-length event) prints a single time.
 */
export const itemTime = (
  item: { start: Date; end?: Date; allDay?: boolean },
  ctx: FormatContext,
): ItemTime => {
  if (item.allDay) return { kind: 'none' }
  if (!item.end || item.end.getTime() <= item.start.getTime()) {
    return { kind: 'point', at: timeToken(item.start, ctx) }
  }

  const from = timeToken(item.start, ctx)
  const to = timeToken(item.end, ctx)

  // `12 – 1PM`: one meridiem is enough while both ends share a half of the same day.
  // Across days it is not: `5 – 6PM` for a five-day trip would read as one hour.
  const sameDay = dayNumber(item.start, ctx.timeZone) === dayNumber(item.end, ctx.timeZone)
  if (sameDay && from.meridiem && from.meridiem === to.meridiem) {
    // Locales that print the day period first keep it in front of the range, not
    // stranded in the middle of it: `午後1:05 – 2`, never `1:05 – 午後2`.
    return from.meridiemFirst
      ? { kind: 'range', from, to: { text: to.text } }
      : { kind: 'range', from: { text: from.text }, to }
  }

  return { kind: 'range', from, to }
}

/**
 * A section heading inside the flow: `TOMORROW`, else `SUNDAY, 26 JUL`.
 *
 * Never called for the anchor day, whose section is implicitly headed by the widget's own
 * date block. That used to mean "never called for today", and it stopped meaning it when
 * `day_offset` arrived: a card anchored on yesterday has today in the flow under it, and
 * `TODAY` is what that section wants to be called.
 *
 * The relative words stop at one day either side. `numeric: 'auto'` is what produces them
 * at all, and going wider would produce them unevenly: `format(2, 'day')` is `in 2 days`
 * in English, a duration where a heading wants a date, and `übermorgen` in German, a word
 * that is exactly right. Three days is the set every locale agrees on.
 */
export const sectionHeading = (date: Date, today: Date, ctx: FormatContext): string => {
  const { locale, timeZone } = ctx
  const upper = (value: string): string => value.toLocaleUpperCase(locale)

  const away = dayNumber(date, timeZone) - dayNumber(today, timeZone)
  if (Math.abs(away) <= 1) return upper(relativeDay(locale).format(away, 'day'))

  const weekday = formatter(
    `weekday|${locale}|${timeZone}`,
    () => new Intl.DateTimeFormat(locale, { weekday: 'long', ...zone(timeZone) }),
  ).format(date)

  // Day and month in the locale's own order: `26 Jul` here, `Jul 26` in en-US.
  const dayMonth = formatter(
    `daymonth|${locale}|${timeZone}`,
    () => new Intl.DateTimeFormat(locale, { day: 'numeric', month: 'short', ...zone(timeZone) }),
  ).format(date)

  return upper(`${weekday}, ${dayMonth}`)
}

/**
 * The tail indicator: `1 more event`, `2 more events`.
 *
 * English-only, like `No Events Today`: Home Assistant has no string for either and the
 * widget being copied says exactly this. Kept in one place because one open question ends
 * here: whether a tail of nothing but reminders should read `2 more items`. It is always
 * `events`, uglier though that is when everything hidden is a to-do.
 *
 * What the number means is settled and lives in `addMoreRow`: the rest of the one day the
 * row is drawn inside, never the rest of the loaded window.
 */
export const moreLabel = (count: number): string =>
  `${count} more ${count === 1 ? 'event' : 'events'}`

/**
 * The line a day with nothing on it shows instead of a flow.
 *
 * English-only, like `moreLabel`: Home Assistant has no string for any of these and the
 * widget being copied says exactly the first two. Four rather than two, because the day
 * the card is anchored on need not be today any more, and `No Events Today` under a date
 * block reading tomorrow would be the card contradicting itself in two lines.
 *
 * `done` only ever arrives true for today, and the distinction is only ever worth drawing
 * there: yesterday is finished by definition, so `No More Events Yesterday` would be
 * saying nothing. Anything further out than a day either way gets the bare line, the date
 * block above it having already named the day better than a relative word could.
 */
export const emptyLabel = (offsetFromToday: number, done: boolean): string => {
  if (offsetFromToday === 0) return done ? 'No More Events Today' : 'No Events Today'
  if (offsetFromToday === 1) return 'No Events Tomorrow'
  if (offsetFromToday === -1) return 'No Events Yesterday'
  return 'No Events'
}

/**
 * The day an offset lands on, named: `tomorrow`, or `Mon, 10 Aug` once the words run out.
 *
 * The same three relative words `sectionHeading` uses, and for the same reason, in lower
 * case because this one is read inside a sentence rather than as a heading.
 */
const dayPhrase = (offsetFromToday: number, now: Date, ctx: FormatContext): string => {
  const { locale, timeZone } = ctx
  if (Math.abs(offsetFromToday) <= 1) return relativeDay(locale).format(offsetFromToday, 'day')

  return formatter(
    `shortdate|${locale}|${timeZone}`,
    () =>
      new Intl.DateTimeFormat(locale, {
        weekday: 'short',
        day: 'numeric',
        month: 'short',
        ...zone(timeZone),
      }),
  ).format(dayStart(dayNumber(now, timeZone) + offsetFromToday, timeZone))
}

/**
 * What a window comes to, in a sentence: the editor's helper line under **Days shown**.
 *
 * The two numbers are exact and say nothing; this is what makes them legible. `1` and `1`
 * is a card about tomorrow, and a user who has just typed them should be able to read that
 * back without doing the arithmetic in their head, which is the whole reason the pair is
 * two plain numbers rather than a dropdown of presets: the presets would have to stop
 * somewhere, and a sentence does not.
 *
 * English scaffolding around a localised day, the same mongrel `moreLabel` is: there is no
 * translation layer here yet, and the day is the half of the sentence that carries it.
 */
export const windowSummary = (window: DayWindow, now: Date, ctx: FormatContext): string => {
  const { offsetDays, spanDays } = window
  const day = dayPhrase(offsetDays, now, ctx)
  const first = day.charAt(0).toLocaleUpperCase(ctx.locale) + day.slice(1)

  if (spanDays <= 1) return `${first} only.`
  if (spanDays === 2) return `${first} and the day after.`
  return `${first} and the ${spanDays - 1} days after it.`
}

/**
 * The always-present date block in the widget's top-left corner.
 *
 * Whatever day the card is anchored on rather than today, since those parted company when
 * `day_offset` arrived: the block is the anchor day's heading (§3), which is why that day
 * gets none of its own in the flow.
 */
export const widgetDate = (anchor: Date, ctx: FormatContext): { weekday: string; day: string } => {
  const { locale, timeZone } = ctx
  const weekday = formatter(
    `weekday|${locale}|${timeZone}`,
    () => new Intl.DateTimeFormat(locale, { weekday: 'long', ...zone(timeZone) }),
  ).format(anchor)
  const day = formatter(
    `day|${locale}|${timeZone}`,
    () => new Intl.DateTimeFormat(locale, { day: 'numeric', ...zone(timeZone) }),
  ).format(anchor)

  return { weekday: weekday.toLocaleUpperCase(locale), day }
}
