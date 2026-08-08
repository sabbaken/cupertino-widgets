import { describe, expect, it } from 'vitest'

import { buildFlow } from './flow'
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

const labels = (items: CalendarItem[], todayOnly = false): string[] =>
  buildFlow(items, { now: NOW, ctx, todayOnly }).nodes.map(node =>
    node.type === 'header' ? `# ${node.text}` : node.item.title,
  )

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
    expect(buildFlow([tomorrow], { now: NOW, ctx }).todayEmpty).toBe(true)
    const today = event('Today item', '2026-07-24T14:00:00+02:00', '2026-07-24T15:00:00+02:00')
    expect(buildFlow([today, tomorrow], { now: NOW, ctx }).todayEmpty).toBe(false)
  })
})

describe('a today that is over', () => {
  const over = event('This morning', '2026-07-24T09:00:00+02:00', '2026-07-24T10:00:00+02:00')
  const tomorrow = event('Tomorrow item', '2026-07-25T10:00:00+02:00', '2026-07-25T11:00:00+02:00')

  it('tells a finished today from a free one', () => {
    expect(buildFlow([over, tomorrow], { now: NOW, ctx })).toMatchObject({
      todayEmpty: true,
      todayDone: true,
    })
    expect(buildFlow([tomorrow], { now: NOW, ctx })).toMatchObject({
      todayEmpty: true,
      todayDone: false,
    })
  })

  it('is never claimed while today still has something left', () => {
    const later = event('This evening', '2026-07-24T19:00:00+02:00', '2026-07-24T20:00:00+02:00')
    expect(buildFlow([over, later], { now: NOW, ctx })).toMatchObject({
      todayEmpty: false,
      todayDone: false,
    })
  })

  it('holds in the small size, which never sees tomorrow at all', () => {
    const flow = buildFlow([over, tomorrow], { now: NOW, ctx, todayOnly: true })
    expect(flow).toMatchObject({ todayEmpty: true, todayDone: true })
  })

  it('is claimed by a last meeting that is only half over', () => {
    // Nothing follows the 11:00, and from 11:45 the widget has nothing left to offer: the
    // line says as much while that meeting still has half an hour in it, which is the
    // selection rule read out loud rather than a second rule about the line.
    const halfOver = event('Standup', '2026-07-24T11:00:00+02:00', '2026-07-24T12:30:00+02:00')
    expect(buildFlow([halfOver], { now: NOW, ctx })).toMatchObject({
      todayEmpty: true,
      todayDone: true,
    })
  })

  it('counts something that started yesterday and ended this morning', () => {
    const overnight = event('Night shift', '2026-07-23T22:00:00+02:00', '2026-07-24T06:00:00+02:00')
    expect(buildFlow([overnight], { now: NOW, ctx }).todayDone).toBe(true)
  })

  it('does not count yesterday, whose end is only exclusively today', () => {
    // An all-day entry for yesterday ends at midnight, which is a moment that belongs to
    // today on the clock and to yesterday on the calendar.
    const yesterday = event('Yesterday', '2026-07-23T00:00:00+02:00', '2026-07-24T00:00:00+02:00')
    expect(buildFlow([yesterday], { now: NOW, ctx }).todayDone).toBe(false)
  })

  it('follows the display timezone, like everything else here', () => {
    // 01:00 on the 24th in Warsaw is still the 23rd in UTC, so the same event ends a
    // Warsaw today and a UTC yesterday.
    const early = event('Small hours', '2026-07-24T00:30:00+02:00', '2026-07-24T01:00:00+02:00')
    expect(buildFlow([early], { now: NOW, ctx }).todayDone).toBe(true)
    expect(buildFlow([early], { now: NOW, ctx: { ...ctx, timeZone: 'UTC' } }).todayDone).toBe(false)
  })
})

describe('small', () => {
  it('never leaves today', () => {
    const items = [
      event('Today item', '2026-07-24T14:00:00+02:00', '2026-07-24T15:00:00+02:00'),
      event('Tomorrow item', '2026-07-25T10:00:00+02:00', '2026-07-25T11:00:00+02:00'),
    ]
    expect(labels(items, true)).toEqual(['Today item'])
  })

  it('has nothing to show when today is empty, however busy tomorrow is', () => {
    const items = [event('Tomorrow item', '2026-07-25T10:00:00+02:00', '2026-07-25T11:00:00+02:00')]
    expect(labels(items, true)).toEqual([])
  })
})
