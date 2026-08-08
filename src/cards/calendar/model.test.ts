import { describe, expect, it } from 'vitest'

import { isOver, itemTarget, type CalendarItem } from './model'

const anEventFrom = (entityId: string): CalendarItem => ({
  id: 'e',
  entityId,
  kind: 'event',
  title: 'Design review',
  start: new Date('2026-07-24T09:00:00+02:00'),
  end: new Date('2026-07-24T10:00:00+02:00'),
  color: 'orange',
})

const aReminderFrom = (entityId: string): CalendarItem => ({
  id: 'r',
  entityId,
  kind: 'reminder',
  title: 'Pick up dry cleaning',
  start: new Date('2026-07-24T14:30:00+02:00'),
  color: 'purple',
})

describe('when the clock takes a row down', () => {
  const WARSAW = 'Europe/Warsaw'

  /** A meeting on Friday, 24 July 2026, given as wall-clock hours in Warsaw. */
  const meeting = (from: string, to: string): CalendarItem => ({
    ...anEventFrom('calendar.work'),
    start: new Date(`2026-07-24T${from}:00+02:00`),
    end: new Date(`2026-07-24T${to}:00+02:00`),
  })

  const at = (item: CalendarItem, wallClock: string, timeZone = WARSAW): boolean =>
    isOver(item, new Date(`2026-07-24T${wallClock}:00+02:00`), timeZone)

  it('leaves a meeting up until it is half over', () => {
    const twoToThree = meeting('14:00', '15:00')
    expect(at(twoToThree, '14:00')).toBe(false)
    expect(at(twoToThree, '14:29')).toBe(false)
    expect(at(twoToThree, '14:30')).toBe(true)
    expect(at(twoToThree, '14:31')).toBe(true)
  })

  it('does not take one down before it has even started', () => {
    expect(at(meeting('18:00', '19:00'), '12:00')).toBe(false)
  })

  it('never retires something with no end time at all', () => {
    const reminder = aReminderFrom('todo.chores')
    expect(isOver(reminder, new Date('2026-07-25T09:00:00+02:00'), WARSAW)).toBe(false)
  })

  it('holds an all-day entry to its exclusive end rather than to midday', () => {
    const trip: CalendarItem = {
      ...anEventFrom('calendar.personal'),
      title: 'Poznań trip',
      allDay: true,
      start: new Date('2026-07-24T00:00:00+02:00'),
      end: new Date('2026-07-25T00:00:00+02:00'),
    }
    expect(at(trip, '12:00')).toBe(false)
    expect(at(trip, '23:59')).toBe(false)
    expect(isOver(trip, new Date('2026-07-25T00:00:00+02:00'), WARSAW)).toBe(true)
  })

  it('holds a span across midnight to its end, half of it being the middle of the night', () => {
    // 22:00 to 06:00, so the midpoint is 02:00, a time this shift is very much still on.
    const nightShift: CalendarItem = {
      ...anEventFrom('calendar.work'),
      title: 'Night shift',
      start: new Date('2026-07-24T22:00:00+02:00'),
      end: new Date('2026-07-25T06:00:00+02:00'),
    }
    expect(isOver(nightShift, new Date('2026-07-25T02:00:00+02:00'), WARSAW)).toBe(false)
    expect(isOver(nightShift, new Date('2026-07-25T05:59:00+02:00'), WARSAW)).toBe(false)
    expect(isOver(nightShift, new Date('2026-07-25T06:00:00+02:00'), WARSAW)).toBe(true)
  })

  it('asks the display timezone which of the two a span is', () => {
    // 23:30 to 00:30 in Warsaw crosses midnight and keeps its end; the same instants are
    // 21:30 to 22:30 in UTC, one evening, so there the midpoint at 22:00 UTC retires it.
    const late: CalendarItem = {
      ...anEventFrom('calendar.work'),
      start: new Date('2026-07-24T23:30:00+02:00'),
      end: new Date('2026-07-25T00:30:00+02:00'),
    }
    const tenPast = new Date('2026-07-25T00:10:00+02:00')
    expect(isOver(late, tenPast, WARSAW)).toBe(false)
    expect(isOver(late, tenPast, 'UTC')).toBe(true)
  })
})

describe('the page behind a row', () => {
  it('sends a reminder to its own list rather than to the to-do panel at large', () => {
    expect(itemTarget(aReminderFrom('todo.shopping'))).toEqual({
      panel: 'todo',
      path: '/todo?entity_id=todo.shopping',
    })
  })

  it('names the list even when two rows differ in nothing else', () => {
    const chores = itemTarget(aReminderFrom('todo.chores'))
    const shopping = itemTarget(aReminderFrom('todo.shopping'))
    expect(chores.path).not.toBe(shopping.path)
  })

  it('sends every event to the calendar, whichever calendar it came from', () => {
    // The panel takes no parameter for one (see `itemTarget`), so two calendars have to
    // arrive at the same page, and a test that let them differ would be describing a
    // deep link that does not exist.
    expect(itemTarget(anEventFrom('calendar.work'))).toEqual({
      panel: 'calendar',
      path: '/calendar',
    })
    expect(itemTarget(anEventFrom('calendar.personal')).path).toBe('/calendar')
  })

  it('names a panel that is the key of `hass.panels`, so its absence can be checked', () => {
    expect(itemTarget(anEventFrom('calendar.work')).panel).toBe('calendar')
    expect(itemTarget(aReminderFrom('todo.chores')).panel).toBe('todo')
  })

  it('escapes an id that would otherwise break out of the query string', () => {
    // No real entity id needs it (the domain and object id are both `[a-z0-9_]`), and the
    // encoding is here so that the day something hands this a stranger id, the worst case
    // is a list that does not open rather than a URL with somebody else's parameters on it.
    expect(itemTarget(aReminderFrom('todo.a&b=c')).path).toBe('/todo?entity_id=todo.a%26b%3Dc')
  })
})
