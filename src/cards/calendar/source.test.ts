import { describe, expect, it } from 'vitest'

import type { HassEntity, HomeAssistant } from '../../core/types/ha'
import { dayNumber } from './datetime'
import {
  calendarsFor,
  configuredCalendars,
  discoverCalendars,
  paletteColor,
  subscriptionWindow,
  toCalendarItem,
} from './source'

/** Sunday, 26 July 2026, one minute past midnight in Warsaw: the awkward end of a day. */
const NOW = new Date('2026-07-26T00:01:00+02:00')

const WARSAW = 'Europe/Warsaw'
/** UTC+13 in July. The zone that breaks every "noon UTC is close enough" shortcut. */
const AUCKLAND = 'Pacific/Auckland'
/** UTC-10, so a UTC-midnight instant is still the previous afternoon. */
const HONOLULU = 'Pacific/Honolulu'

const state = (entityId: string, value = 'off'): HassEntity => ({
  entity_id: entityId,
  state: value,
  attributes: {},
  last_changed: '',
  last_updated: '',
})

const hassWith = (states: Record<string, string>, hidden: string[] = []): HomeAssistant =>
  ({
    states: Object.fromEntries(Object.entries(states).map(([id, value]) => [id, state(id, value)])),
    entities: Object.fromEntries(
      Object.keys(states).map(id => [id, { entity_id: id, hidden: hidden.includes(id) }]),
    ),
  }) as unknown as HomeAssistant

describe('configuredCalendars', () => {
  it('takes a list of calendars as written', () => {
    expect(configuredCalendars(['calendar.work', 'calendar.home'])).toEqual([
      'calendar.work',
      'calendar.home',
    ])
  })

  /** Hand-written YAML is not typechecked, and `entities: calendar.work` is legal YAML. */
  it('widens a lone calendar into a list of one', () => {
    expect(configuredCalendars('calendar.work')).toEqual(['calendar.work'])
  })

  /**
   * The distinction the card is built on: nothing configured means EVERY calendar, so
   * "the user chose none" has to be indistinguishable from "the user chose nothing", and
   * `[]` is what `ha-form` sends when the last entity is removed from the picker.
   */
  it('answers nothing for every shape of blank', () => {
    expect(configuredCalendars(undefined)).toBeUndefined()
    expect(configuredCalendars(null)).toBeUndefined()
    expect(configuredCalendars('')).toBeUndefined()
    expect(configuredCalendars([])).toBeUndefined()
    expect(configuredCalendars([null, ''])).toBeUndefined()
  })

  /** A `sensor.` here would be rejected by the subscribe schema, entity set and all. */
  it('drops anything that is not a calendar', () => {
    expect(configuredCalendars(['calendar.work', 'sensor.oops', 42])).toEqual(['calendar.work'])
    expect(configuredCalendars(['light.kitchen'])).toBeUndefined()
  })
})

describe('discoverCalendars', () => {
  it('finds the calendars and leaves everything else alone', () => {
    const hass = hassWith({
      'calendar.work': 'on',
      'sensor.battery': '72',
      'calendar.home': 'off',
      'todo.shopping': 'on',
    })
    expect(discoverCalendars(hass)).toEqual(['calendar.home', 'calendar.work'])
  })

  it('skips an unavailable calendar and one hidden in the registry', () => {
    const hass = hassWith(
      { 'calendar.work': 'unavailable', 'calendar.home': 'off', 'calendar.gym': 'on' },
      ['calendar.gym'],
    )
    expect(discoverCalendars(hass)).toEqual(['calendar.home'])
  })

  /**
   * `unknown` is a quiet calendar, not a broken one: Home Assistant's own helper tests
   * `unavailable` and nothing else, and filtering this would empty the card on a day
   * with no events in it.
   */
  it('keeps a calendar whose state is unknown', () => {
    expect(discoverCalendars(hassWith({ 'calendar.work': 'unknown' }))).toEqual(['calendar.work'])
  })

  /** Sorted, because the sort is what decides which calendar gets which colour. */
  it('sorts by entity id', () => {
    const hass = hassWith({ 'calendar.zoo': 'on', 'calendar.aa': 'on', 'calendar.mm': 'on' })
    expect(discoverCalendars(hass)).toEqual(['calendar.aa', 'calendar.mm', 'calendar.zoo'])
  })
})

describe('calendarsFor', () => {
  const hass = hassWith({ 'calendar.work': 'on', 'calendar.home': 'on' })

  it('prefers what the user chose', () => {
    expect(calendarsFor(['calendar.home'], hass)).toEqual(['calendar.home'])
  })

  it('falls back to every calendar when nothing is chosen', () => {
    expect(calendarsFor(undefined, hass)).toEqual(['calendar.home', 'calendar.work'])
  })

  /**
   * A card is given its config before its `hass`, so this is the state of every card for
   * a moment, and it must not be an exception.
   */
  it('has nothing to show before hass arrives', () => {
    expect(calendarsFor(undefined, undefined)).toEqual([])
    expect(calendarsFor(['calendar.work'], undefined)).toEqual(['calendar.work'])
  })
})

describe('paletteColor', () => {
  it('deals a different colour to each of the first eight calendars', () => {
    const dealt = new Set(Array.from({ length: 8 }, (_, index) => paletteColor(index)))
    expect(dealt.size).toBe(8)
  })

  it('wraps rather than running out', () => {
    expect(paletteColor(8)).toBe(paletteColor(0))
    expect(paletteColor(9)).toBe(paletteColor(1))
  })

  /** No caller passes one, but `--cw-undefined` would be a silent, unreadable row. */
  it('survives a negative index', () => {
    expect(paletteColor(-1)).toBe(paletteColor(7))
  })
})

describe('subscriptionWindow', () => {
  const fortnight = { offsetDays: 0, spanDays: 14 }

  it('covers the whole span with a day to spare at each end', () => {
    const { start, end } = subscriptionWindow(NOW, fortnight)
    expect(start.getTime()).toBeLessThan(NOW.getTime() - 3_600_000)
    const lastDay = NOW.getTime() + 13 * 86_400_000
    expect(end.getTime()).toBeGreaterThan(lastDay + 86_400_000)
  })

  /**
   * The clock ticks every minute and the window is rebuilt on every tick. A key that
   * moved with it would tear down and re-establish every subscription sixty times an
   * hour, which is the whole reason there is a key at all.
   */
  it('keeps one key for a whole day and changes it across the boundary', () => {
    const key = (iso: string): string => subscriptionWindow(new Date(iso), fortnight).key
    expect(key('2026-07-26T00:00:00Z')).toBe(key('2026-07-26T23:59:59Z'))
    expect(key('2026-07-26T23:59:59Z')).not.toBe(key('2026-07-27T00:00:01Z'))
  })

  /**
   * The other half of the same rule, and the one a `day_offset` could break quietly. The
   * key is all `reconcile` compares, so a card re-pointed at tomorrow while the day has
   * not moved has to come out with a different one, or it keeps the subscriptions it had.
   */
  it('changes its key when the window moves rather than when the day does', () => {
    const key = (window: { offsetDays: number; spanDays: number }): string =>
      subscriptionWindow(NOW, window).key
    expect(key({ offsetDays: 1, spanDays: 14 })).not.toBe(key(fortnight))
    expect(key({ offsetDays: 0, spanDays: 1 })).not.toBe(key(fortnight))
    expect(key({ offsetDays: -1, spanDays: 14 })).not.toBe(key({ offsetDays: 1, spanDays: 14 }))
  })

  it('moves the whole span with the offset, in both directions', () => {
    const yesterday = subscriptionWindow(NOW, { offsetDays: -1, spanDays: 1 })
    expect(dayNumber(yesterday.start, WARSAW)).toBeLessThanOrEqual(dayNumber(NOW, WARSAW) - 1)
    // Exclusive: the end has to clear the last local midnight of yesterday, which is the
    // start of today, and nothing beyond it is being asked for.
    expect(dayNumber(yesterday.end, WARSAW)).toBeGreaterThanOrEqual(dayNumber(NOW, WARSAW))

    const tomorrow = subscriptionWindow(NOW, { offsetDays: 1, spanDays: 1 })
    expect(dayNumber(tomorrow.start, WARSAW)).toBeLessThanOrEqual(dayNumber(NOW, WARSAW) + 1)
    expect(dayNumber(tomorrow.end, WARSAW)).toBeGreaterThanOrEqual(dayNumber(NOW, WARSAW) + 2)
  })

  /**
   * A fortnight either side of every zone: the window is computed without one, so the
   * padding is the only thing standing between a reader in Auckland and a missing day.
   * Swept over the offsets too, since those move the same pad rather than adding to it.
   */
  it('reaches local midnight at both ends in every timezone', () => {
    const broken: string[] = []
    for (const zone of [WARSAW, AUCKLAND, HONOLULU, 'UTC', 'Asia/Kathmandu']) {
      for (const offsetDays of [-7, -1, 0, 1, 7]) {
        for (let hour = 0; hour < 24; hour += 1) {
          const now = new Date(Date.UTC(2026, 6, 26, hour))
          const spanDays = 14
          const { start, end } = subscriptionWindow(now, { offsetDays, spanDays })
          const first = dayNumber(now, zone) + offsetDays
          const where = `${zone} @${hour}h ${offsetDays >= 0 ? '+' : ''}${offsetDays}d`
          // The end is exclusive, so it has to reach the local midnight AFTER the last day
          // drawn: landing inside that day would cut the afternoon off it.
          if (dayNumber(start, zone) > first) broken.push(`${where} starts too late`)
          if (dayNumber(end, zone) < first + spanDays) broken.push(`${where} ends too early`)
        }
      }
    }
    expect(broken).toEqual([])
  })
})

describe('toCalendarItem', () => {
  const map = (
    event: Record<string, unknown>,
    timeZone: string | undefined = WARSAW,
  ): ReturnType<typeof toCalendarItem> =>
    toCalendarItem(event, 'calendar.work', 'var(--cw-blue)', timeZone)

  it('maps a timed event', () => {
    const item = map({
      summary: 'Design review',
      location: 'Długa 36, Warsawa',
      start: '2026-07-26T09:30:00+02:00',
      end: '2026-07-26T10:30:00+02:00',
      all_day: false,
    })

    expect(item).toMatchObject({
      // The calendar it was subscribed from, not anything in the payload: a tap on the row
      // is answered from this.
      entityId: 'calendar.work',
      kind: 'event',
      title: 'Design review',
      location: 'Długa 36, Warsawa',
      color: 'var(--cw-blue)',
    })
    expect(item?.start.toISOString()).toBe('2026-07-26T07:30:00.000Z')
    expect(item?.end?.toISOString()).toBe('2026-07-26T08:30:00.000Z')
    expect(item?.allDay).toBeUndefined()
  })

  /**
   * The mapping that pays for itself. An all-day end is exclusive, and passing it
   * through untouched is what lets `isOver` retire the entry at midnight and `buildFlow`
   * carry a multi-day one into today, neither of which works if it is translated to an
   * inclusive last day or dropped.
   */
  it('keeps an all-day event’s exclusive end and files it on the right day', () => {
    const item = map({ summary: 'Poznań trip', start: '2026-07-26', end: '2026-07-28' })

    expect(item).toMatchObject({ title: 'Poznań trip', allDay: true })
    expect(dayNumber(item!.start, WARSAW)).toBe(dayNumber(NOW, WARSAW))
    // Midnight on the 28th in Warsaw: still up for the whole of the 27th, gone on the 28th.
    expect(item?.end?.toISOString()).toBe('2026-07-27T22:00:00.000Z')
  })

  /**
   * `new Date('2026-07-26')` is UTC midnight by the language's own grammar, which is the
   * 25th in Honolulu and the 26th at 12:00 in Auckland. Getting this wrong files an
   * all-day event under the wrong heading for half the planet, and it is invisible from
   * anywhere east of Greenwich.
   */
  it('puts an all-day event on its own date in every timezone', () => {
    const broken: string[] = []
    for (const zone of [WARSAW, AUCKLAND, HONOLULU, 'UTC', 'America/Sao_Paulo']) {
      for (const date of ['2026-01-15', '2026-03-29', '2026-07-26', '2026-10-25', '2026-12-31']) {
        const item = map({ summary: 'All day', start: date, end: date }, zone)
        const expected = dayNumber(new Date(`${date}T12:00:00Z`), 'UTC')
        const actual = item ? dayNumber(item.start, zone) : NaN
        if (actual !== expected) broken.push(`${zone} ${date}: off by ${actual - expected} day(s)`)
      }
    }
    expect(broken).toEqual([])
  })

  /** Two of those dates are DST changeovers in the zones above; neither may shift a day. */
  it('is not moved by a daylight-saving change', () => {
    const spring = map({ summary: 'x', start: '2026-03-29', end: '2026-03-30' }, WARSAW)
    const autumn = map({ summary: 'x', start: '2026-10-25', end: '2026-10-26' }, WARSAW)
    expect(dayNumber(spring!.start, WARSAW)).toBe(dayNumber(new Date('2026-03-29T12:00Z'), 'UTC'))
    expect(dayNumber(autumn!.start, WARSAW)).toBe(dayNumber(new Date('2026-10-25T12:00Z'), 'UTC'))
  })

  /** An all-day row is one line; there is nowhere to draw a location even if it has one. */
  it('does not give an all-day event a location', () => {
    const item = map({ summary: 'Trip', location: 'Poznań', start: '2026-07-26', all_day: true })
    expect(item?.location).toBeUndefined()
  })

  /**
   * `all_day` and the date-only string are the same fact told twice, and Home Assistant
   * sends both. Either alone is enough, so an integration that omits one still gets the
   * single-line row it asked for.
   */
  it('recognises all-day from the flag or from the bare date', () => {
    expect(map({ summary: 'x', start: '2026-07-26' })?.allDay).toBe(true)
    expect(map({ summary: 'x', start: '2026-07-26T09:00:00Z', all_day: true })?.allDay).toBe(true)
  })

  it('leaves out a location that is absent or empty', () => {
    expect(map({ summary: 'x', start: '2026-07-26T09:00:00Z' })?.location).toBeUndefined()
    expect(
      map({ summary: 'x', location: '', start: '2026-07-26T09:00:00Z' })?.location,
    ).toBeUndefined()
  })

  /** A reminder-shaped event: `isOver` must not retire it, so `end` has to stay absent. */
  it('leaves end absent when the wire has none', () => {
    expect(map({ summary: 'x', start: '2026-07-26T09:00:00Z' })?.end).toBeUndefined()
  })

  /**
   * `id` is the keyed-render identity, so two instances of one recurring event (same
   * `uid`, different day) must not collide, and the id must not move between pushes.
   */
  it('gives each occurrence of a recurring event its own stable id', () => {
    const monday = { summary: 'Standup', uid: 'abc', start: '2026-07-27T09:00:00Z' }
    const tuesday = { ...monday, start: '2026-07-28T09:00:00Z' }

    expect(map(monday)?.id).toBe(map(monday)?.id)
    expect(map(monday)?.id).not.toBe(map(tuesday)?.id)
    expect(toCalendarItem(monday, 'calendar.other', 'x', WARSAW)?.id).not.toBe(map(monday)?.id)
  })

  /**
   * The boundary has to hold. An integration is free to be odd, and one malformed event
   * costs its own row, not the card, and not the dashboard around it.
   */
  it('drops what it cannot draw rather than throwing', () => {
    expect(map({ start: '2026-07-26T09:00:00Z' })).toBeUndefined()
    expect(map({ summary: 'x' })).toBeUndefined()
    expect(map({ summary: 'x', start: 'not a date' })).toBeUndefined()
    expect(map({ summary: '', start: '2026-07-26T09:00:00Z' })).toBeUndefined()
    expect(map({ summary: 'x', start: null })).toBeUndefined()
    expect(map({})).toBeUndefined()
  })

  /** A bad `end` must not cost an otherwise fine event its row. */
  it('keeps an event whose end alone is unusable', () => {
    const item = map({ summary: 'x', start: '2026-07-26T09:00:00Z', end: 'rubbish' })
    expect(item?.title).toBe('x')
    expect(item?.end).toBeUndefined()
  })
})
