import { describe, expect, it } from 'vitest'

import { DEFAULT_DAY_SPAN, MAX_DAY_OFFSET, MAX_DAY_SPAN, buildFlow, dayWindow } from './flow'
import type { FormatContext } from './format'
import type { CalendarItem } from './model'

/** Friday, 24 July 2026, midday in Warsaw: the day the rules were reconstructed on. */
const NOW = new Date('2026-07-24T12:00:00+02:00')

const ctx: FormatContext = { locale: 'en-GB', timeZone: 'Europe/Warsaw', hour12: true }

let counter = 0
const event = (title: string, start: string, end?: string): CalendarItem => ({
  id: `${title}-${(counter += 1)}`,
  entityId: 'calendar.work',
  kind: 'event',
  title,
  start: new Date(start),
  ...(end ? { end: new Date(end) } : {}),
  color: 'orange',
})

/** What the flow comes to, headings marked with a `#`. */
const labels = (items: CalendarItem[], window: Partial<FlowWindow> = {}): string[] =>
  buildFlow(items, { now: NOW, ctx, ...window }).nodes.map(node =>
    node.type === 'header' ? `# ${node.text}` : node.item.title,
  )

interface FlowWindow {
  offsetDays: number
  spanDays: number
}

/** The window the small size passes: the day it is anchored on and no other. */
const ONE_DAY = { spanDays: 1 }

describe('selection', () => {
  it('drops what has finished and keeps what is still running', () => {
    const items = [
      event('Over', '2026-07-24T09:00:00+02:00', '2026-07-24T10:00:00+02:00'),
      event('Running', '2026-07-24T11:30:00+02:00', '2026-07-24T13:00:00+02:00'),
      event('Later', '2026-07-24T15:00:00+02:00', '2026-07-24T16:00:00+02:00'),
    ]
    expect(labels(items)).toEqual(['Running', 'Later'])
  })

  it('keeps a reminder whose moment has passed, since it is still a thing to do', () => {
    const overdue: CalendarItem = {
      id: 'r',
      entityId: 'todo.reminders',
      kind: 'reminder',
      title: 'Pick up dry cleaning',
      start: new Date('2026-07-24T10:30:00+02:00'),
      color: 'purple',
    }
    expect(labels([overdue])).toEqual(['Pick up dry cleaning'])
  })

  it('drops a meeting the reader is already halfway through', () => {
    const items = [
      // Half over at 11:45, so at midday it is behind us; the second is half over at 12:15.
      event('Half over', '2026-07-24T11:00:00+02:00', '2026-07-24T12:30:00+02:00'),
      event('Just started', '2026-07-24T11:30:00+02:00', '2026-07-24T13:00:00+02:00'),
    ]
    expect(labels(items)).toEqual(['Just started'])
  })

  it('holds an all-day entry past midday, its half being no sort of deadline', () => {
    const trip: CalendarItem = {
      id: 'a',
      entityId: 'calendar.work',
      kind: 'event',
      title: 'Poznań trip',
      allDay: true,
      start: new Date('2026-07-24T00:00:00+02:00'),
      end: new Date('2026-07-25T00:00:00+02:00'),
      color: 'blue',
    }
    expect(labels([trip])).toEqual(['Poznań trip'])
  })

  it('leaves yesterday behind', () => {
    const items = [event('Yesterday', '2026-07-23T15:00:00+02:00', '2026-07-23T16:00:00+02:00')]
    expect(labels(items)).toEqual([])
  })

  it('carries a multi-day event that is already under way into today', () => {
    const items = [event('Trip', '2026-07-22T08:00:00+02:00', '2026-07-27T20:00:00+02:00')]
    // Grouped under today, so it is not filed under a day that has already gone.
    expect(labels(items)).toEqual(['Trip'])
  })

  it('carries one that is past its own midpoint, since a trip is not a meeting', () => {
    // Half over on the 23rd at 14:00, and still four days from finishing.
    const items = [event('Trip', '2026-07-20T08:00:00+02:00', '2026-07-26T20:00:00+02:00')]
    expect(labels(items)).toEqual(['Trip'])
  })

  it('does not carry yesterday’s reminder forward for want of an end time', () => {
    const stale: CalendarItem = {
      id: 'r',
      entityId: 'todo.reminders',
      kind: 'reminder',
      title: 'Yesterday’s reminder',
      start: new Date('2026-07-23T10:30:00+02:00'),
      color: 'purple',
    }
    const staleAllDay: CalendarItem = {
      id: 'a',
      entityId: 'calendar.work',
      kind: 'event',
      title: 'Yesterday all day',
      allDay: true,
      start: new Date('2026-07-23T00:00:00+02:00'),
      color: 'blue',
    }
    expect(labels([stale, staleAllDay])).toEqual([])
  })

  it('stops at the horizon', () => {
    const far = event('Far off', '2026-09-01T10:00:00+02:00', '2026-09-01T11:00:00+02:00')
    expect(labels([far])).toEqual([])
  })

  it('groups by the display timezone, not the browser’s', () => {
    // 00:30 on the 25th in Warsaw is still the 24th in UTC.
    const item = event('Late', '2026-07-25T00:30:00+02:00', '2026-07-25T01:30:00+02:00')
    const warsaw = buildFlow([item], { now: NOW, ctx }).nodes
    const utc = buildFlow([item], { now: NOW, ctx: { ...ctx, timeZone: 'UTC' } }).nodes

    expect(warsaw[0]).toMatchObject({ type: 'header', text: 'TOMORROW' })
    // In UTC it lands on today, which has no heading at all.
    expect(utc[0]).toMatchObject({ type: 'item' })
  })
})

describe('order', () => {
  it('puts all-day entries first, then sorts by start time', () => {
    const allDay: CalendarItem = {
      id: 'a',
      entityId: 'calendar.work',
      kind: 'event',
      title: 'Poznań trip',
      allDay: true,
      start: new Date('2026-07-24T00:00:00+02:00'),
      color: 'blue',
    }
    const items = [
      event('Late', '2026-07-24T18:00:00+02:00', '2026-07-24T19:00:00+02:00'),
      event('Early', '2026-07-24T14:00:00+02:00', '2026-07-24T15:00:00+02:00'),
      allDay,
    ]
    expect(labels(items)).toEqual(['Poznań trip', 'Early', 'Late'])
  })

  it('interleaves reminders with events instead of grouping them', () => {
    const reminder: CalendarItem = {
      id: 'r',
      entityId: 'todo.reminders',
      kind: 'reminder',
      title: 'Pick up dry cleaning',
      start: new Date('2026-07-24T14:30:00+02:00'),
      color: 'purple',
    }
    const items = [
      event('Language class', '2026-07-24T16:00:00+02:00', '2026-07-24T17:00:00+02:00'),
      reminder,
    ]
    expect(labels(items)).toEqual(['Pick up dry cleaning', 'Language class'])
  })
})

describe('headings', () => {
  const tomorrow = event('Tomorrow item', '2026-07-25T10:00:00+02:00', '2026-07-25T11:00:00+02:00')
  const sunday = event('Sunday item', '2026-07-26T10:00:00+02:00', '2026-07-26T11:00:00+02:00')

  it('gives today no heading of its own', () => {
    const today = event('Today item', '2026-07-24T14:00:00+02:00', '2026-07-24T15:00:00+02:00')
    expect(labels([today])).toEqual(['Today item'])
  })

  it('says TOMORROW only when the section really is tomorrow', () => {
    expect(labels([tomorrow])).toEqual(['# TOMORROW', 'Tomorrow item'])
  })

  it('skips an empty day completely, heading and all', () => {
    // Nothing on Saturday, so Sunday gets a date rather than inheriting `TOMORROW`.
    expect(labels([sunday])).toEqual(['# SUNDAY, 26 JUL', 'Sunday item'])
  })

  it('follows the locale’s own day/month order', () => {
    const american = buildFlow([sunday], { now: NOW, ctx: { ...ctx, locale: 'en-US' } })
    expect(american.nodes[0]).toMatchObject({ text: 'SUNDAY, JUL 26' })
  })

  it('reports an empty today so the card can say so', () => {
    expect(buildFlow([tomorrow], { now: NOW, ctx }).anchorEmpty).toBe(true)
    const today = event('Today item', '2026-07-24T14:00:00+02:00', '2026-07-24T15:00:00+02:00')
    expect(buildFlow([today, tomorrow], { now: NOW, ctx }).anchorEmpty).toBe(false)
  })
})

describe('a today that is over', () => {
  const over = event('This morning', '2026-07-24T09:00:00+02:00', '2026-07-24T10:00:00+02:00')
  const tomorrow = event('Tomorrow item', '2026-07-25T10:00:00+02:00', '2026-07-25T11:00:00+02:00')

  it('tells a finished today from a free one', () => {
    expect(buildFlow([over, tomorrow], { now: NOW, ctx })).toMatchObject({
      anchorEmpty: true,
      anchorDone: true,
    })
    expect(buildFlow([tomorrow], { now: NOW, ctx })).toMatchObject({
      anchorEmpty: true,
      anchorDone: false,
    })
  })

  it('is never claimed while today still has something left', () => {
    const later = event('This evening', '2026-07-24T19:00:00+02:00', '2026-07-24T20:00:00+02:00')
    expect(buildFlow([over, later], { now: NOW, ctx })).toMatchObject({
      anchorEmpty: false,
      anchorDone: false,
    })
  })

  it('holds in the small size, which never sees tomorrow at all', () => {
    const flow = buildFlow([over, tomorrow], { now: NOW, ctx, ...ONE_DAY })
    expect(flow).toMatchObject({ anchorEmpty: true, anchorDone: true })
  })

  it('is claimed by a last meeting that is only half over', () => {
    // Nothing follows the 11:00, and from 11:45 the widget has nothing left to offer: the
    // line says as much while that meeting still has half an hour in it, which is the
    // selection rule read out loud rather than a second rule about the line.
    const halfOver = event('Standup', '2026-07-24T11:00:00+02:00', '2026-07-24T12:30:00+02:00')
    expect(buildFlow([halfOver], { now: NOW, ctx })).toMatchObject({
      anchorEmpty: true,
      anchorDone: true,
    })
  })

  it('counts something that started yesterday and ended this morning', () => {
    const overnight = event('Night shift', '2026-07-23T22:00:00+02:00', '2026-07-24T06:00:00+02:00')
    expect(buildFlow([overnight], { now: NOW, ctx }).anchorDone).toBe(true)
  })

  it('does not count yesterday, whose end is only exclusively today', () => {
    // An all-day entry for yesterday ends at midnight, which is a moment that belongs to
    // today on the clock and to yesterday on the calendar.
    const yesterday = event('Yesterday', '2026-07-23T00:00:00+02:00', '2026-07-24T00:00:00+02:00')
    expect(buildFlow([yesterday], { now: NOW, ctx }).anchorDone).toBe(false)
  })

  it('follows the display timezone, like everything else here', () => {
    // 01:00 on the 24th in Warsaw is still the 23rd in UTC, so the same event ends a
    // Warsaw today and a UTC yesterday.
    const early = event('Small hours', '2026-07-24T00:30:00+02:00', '2026-07-24T01:00:00+02:00')
    expect(buildFlow([early], { now: NOW, ctx }).anchorDone).toBe(true)
    expect(buildFlow([early], { now: NOW, ctx: { ...ctx, timeZone: 'UTC' } }).anchorDone).toBe(
      false,
    )
  })
})

describe('small', () => {
  it('never leaves today', () => {
    const items = [
      event('Today item', '2026-07-24T14:00:00+02:00', '2026-07-24T15:00:00+02:00'),
      event('Tomorrow item', '2026-07-25T10:00:00+02:00', '2026-07-25T11:00:00+02:00'),
    ]
    expect(labels(items, ONE_DAY)).toEqual(['Today item'])
  })

  it('has nothing to show when today is empty, however busy tomorrow is', () => {
    const items = [event('Tomorrow item', '2026-07-25T10:00:00+02:00', '2026-07-25T11:00:00+02:00')]
    expect(labels(items, ONE_DAY)).toEqual([])
  })
})

/**
 * `day_offset` and `days_to_show`: which days the card is about at all.
 *
 * The three the option was asked for are the three that matter, and they are not
 * symmetrical. Tomorrow is a day nothing has happened on yet, so it draws whole; today
 * draws what is left of itself; yesterday draws whole again, because a day already gone
 * would otherwise be emptied by the very rule that keeps today honest.
 */
describe('the window of days', () => {
  const yesterdayMorning = event(
    'Yesterday morning',
    '2026-07-23T09:00:00+02:00',
    '2026-07-23T10:00:00+02:00',
  )
  const thisMorning = event(
    'This morning',
    '2026-07-24T09:00:00+02:00',
    '2026-07-24T10:00:00+02:00',
  )
  const thisEvening = event(
    'This evening',
    '2026-07-24T19:00:00+02:00',
    '2026-07-24T20:00:00+02:00',
  )
  const tomorrow = event('Tomorrow item', '2026-07-25T10:00:00+02:00', '2026-07-25T11:00:00+02:00')
  const sunday = event('Sunday item', '2026-07-26T10:00:00+02:00', '2026-07-26T11:00:00+02:00')
  const week = [yesterdayMorning, thisMorning, thisEvening, tomorrow, sunday]

  it('draws tomorrow alone, with no heading, when it is the day the card is about', () => {
    // No `# TOMORROW`: the anchor day is headed by the widget's date block instead.
    expect(labels(week, { offsetDays: 1, spanDays: 1 })).toEqual(['Tomorrow item'])
  })

  it('draws the whole of yesterday, clock and all', () => {
    // The morning meeting is hours over, and that is exactly why it has to be here: a day
    // in the past filtered by `isOver` is a card that draws nothing at all.
    expect(labels(week, { offsetDays: -1, spanDays: 1 })).toEqual(['Yesterday morning'])
  })

  it('still retires today’s finished rows when today is inside a longer window', () => {
    // Yesterday whole, today from now on: two readings of the same rule, one card.
    expect(labels(week, { offsetDays: -1, spanDays: 2 })).toEqual([
      'Yesterday morning',
      '# TODAY',
      'This evening',
    ])
  })

  it('heads the days around today with the words for them', () => {
    expect(labels(week, { offsetDays: -1, spanDays: 3 })).toEqual([
      'Yesterday morning',
      '# TODAY',
      'This evening',
      '# TOMORROW',
      'Tomorrow item',
    ])
  })

  it('stops after the days it was asked for', () => {
    expect(labels(week, { offsetDays: 1, spanDays: 2 })).toEqual([
      'Tomorrow item',
      '# SUNDAY, 26 JUL',
      'Sunday item',
    ])
  })

  it('reports the anchor day empty, and never done for a day that is not today', () => {
    const quiet = buildFlow([thisEvening], { now: NOW, ctx, offsetDays: 1, spanDays: 1 })
    expect(quiet).toMatchObject({ anchorEmpty: true, anchorDone: false })

    // Everything on yesterday is over, and the card is drawing it: that is emptiness of
    // neither kind, so both flags stay down.
    const past = buildFlow([yesterdayMorning], { now: NOW, ctx, offsetDays: -1, spanDays: 1 })
    expect(past).toMatchObject({ anchorEmpty: false, anchorDone: false })
  })

  it('anchors on the day the offset names, in the display timezone', () => {
    const flow = buildFlow([], { now: NOW, ctx, offsetDays: 1 })
    expect(flow.anchor.toISOString()).toBe('2026-07-24T22:00:00.000Z')
  })

  it('carries a trip that began before the window into the first day of it', () => {
    const trip = event('Trip', '2026-07-20T08:00:00+02:00', '2026-07-27T20:00:00+02:00')
    // Filed under Sunday rather than under the 20th, which the card is not showing, and
    // so with no heading: the day it is filed under is the anchor.
    expect(labels([trip], { offsetDays: 2, spanDays: 1 })).toEqual(['Trip'])
  })

  it('leaves out a trip that finished before the window began', () => {
    const trip = event('Trip', '2026-07-20T08:00:00+02:00', '2026-07-22T20:00:00+02:00')
    expect(labels([trip], { offsetDays: -1, spanDays: 2 })).toEqual([])
  })
})

/**
 * What a config actually asks for. Hand-written YAML is not typechecked, so this is the
 * one place that has to take whatever it holds and still answer with two whole days.
 */
describe('dayWindow', () => {
  it('is today and a fortnight when the config says nothing', () => {
    expect(dayWindow(undefined)).toEqual({ offsetDays: 0, spanDays: DEFAULT_DAY_SPAN })
    expect(dayWindow({})).toEqual({ offsetDays: 0, spanDays: DEFAULT_DAY_SPAN })
  })

  it('reads the two keys, in either direction', () => {
    expect(dayWindow({ day_offset: 1, days_to_show: 1 })).toEqual({ offsetDays: 1, spanDays: 1 })
    expect(dayWindow({ day_offset: -1 })).toEqual({ offsetDays: -1, spanDays: DEFAULT_DAY_SPAN })
  })

  /** `day_offset: "1"` is what somebody copying the option out of the README writes. */
  it('takes a number that arrived as a string', () => {
    expect(dayWindow({ day_offset: '1', days_to_show: '3' })).toEqual({
      offsetDays: 1,
      spanDays: 3,
    })
  })

  it('falls back rather than inventing a window out of nonsense', () => {
    const fallback = { offsetDays: 0, spanDays: DEFAULT_DAY_SPAN }
    // A bare `day_offset:` in the YAML parses to null; an emptied editor box reports
    // undefined; the rest is a typo.
    expect(dayWindow({ day_offset: null, days_to_show: null })).toEqual(fallback)
    expect(dayWindow({ day_offset: undefined, days_to_show: '' })).toEqual(fallback)
    expect(dayWindow({ day_offset: 'tomorrow', days_to_show: [] })).toEqual(fallback)
  })

  it('clamps to the range the editor can express, and drops a fraction', () => {
    expect(dayWindow({ day_offset: 400 }).offsetDays).toBe(MAX_DAY_OFFSET)
    expect(dayWindow({ day_offset: -400 }).offsetDays).toBe(-MAX_DAY_OFFSET)
    expect(dayWindow({ days_to_show: 0 }).spanDays).toBe(1)
    expect(dayWindow({ days_to_show: 400 }).spanDays).toBe(MAX_DAY_SPAN)
    expect(dayWindow({ day_offset: 1.7, days_to_show: 2.9 })).toEqual({
      offsetDays: 1,
      spanDays: 2,
    })
  })
})
