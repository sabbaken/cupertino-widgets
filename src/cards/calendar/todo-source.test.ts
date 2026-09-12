import { describe, expect, it } from 'vitest'

import type { HassEntity, HomeAssistant } from '../../core/types/ha'
import { dayNumber } from './datetime'
import {
  configuredTodoLists,
  discoverTodoLists,
  remindersEnabled,
  toReminderItem,
  todoListsFor,
} from './todo-source'

/** Sunday, 26 July 2026, one minute past midnight in Warsaw: the awkward end of a day. */
const NOW = new Date('2026-07-26T00:01:00+02:00')

const WARSAW = 'Europe/Warsaw'
/** UTC+13 in July. The zone that breaks every "noon UTC is close enough" shortcut. */
const AUCKLAND = 'Pacific/Auckland'
/** UTC-10, so a UTC-midnight instant is still the previous afternoon. */
const HONOLULU = 'Pacific/Honolulu'

const state = (entityId: string, value = '0'): HassEntity => ({
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

describe('remindersEnabled', () => {
  /** A dashboard that says nothing gets reminders, the way it gets every calendar. */
  it('reads a config with no opinion as yes', () => {
    expect(remindersEnabled(undefined)).toBe(true)
    expect(remindersEnabled(null)).toBe(true)
    expect(remindersEnabled(true)).toBe(true)
  })

  it('is off only for the value the switch writes', () => {
    expect(remindersEnabled(false)).toBe(false)
  })
})

describe('configuredTodoLists', () => {
  it('takes a list of to-do lists as written', () => {
    expect(configuredTodoLists(['todo.shopping', 'todo.chores'])).toEqual([
      'todo.shopping',
      'todo.chores',
    ])
  })

  /** Hand-written YAML is not typechecked, and `todo_entities: todo.chores` is legal YAML. */
  it('widens a lone list into a list of one', () => {
    expect(configuredTodoLists('todo.chores')).toEqual(['todo.chores'])
  })

  /**
   * The same distinction the calendars are built on: nothing configured means EVERY list,
   * so "the user chose none" has to be indistinguishable from "the user chose nothing".
   * Saying *no lists at all* is `show_reminders`' job, not this one's.
   */
  it('answers nothing for every shape of blank', () => {
    expect(configuredTodoLists(undefined)).toBeUndefined()
    expect(configuredTodoLists(null)).toBeUndefined()
    expect(configuredTodoLists('')).toBeUndefined()
    expect(configuredTodoLists([])).toBeUndefined()
    expect(configuredTodoLists([null, ''])).toBeUndefined()
  })

  /** A `calendar.` here would be refused by the subscribe schema, entity set and all. */
  it('drops anything that is not a to-do list', () => {
    expect(configuredTodoLists(['todo.chores', 'calendar.work', 7])).toEqual(['todo.chores'])
    expect(configuredTodoLists(['sensor.oops'])).toBeUndefined()
  })
})

describe('discoverTodoLists', () => {
  it('finds the to-do lists and leaves everything else alone', () => {
    const hass = hassWith({
      'todo.shopping': '3',
      'calendar.work': 'on',
      'todo.chores': '0',
      'sensor.battery': '72',
    })
    expect(discoverTodoLists(hass)).toEqual(['todo.chores', 'todo.shopping'])
  })

  it('skips a list hidden in the registry', () => {
    const hass = hassWith({ 'todo.chores': '0', 'todo.work': '2' }, ['todo.work'])
    expect(discoverTodoLists(hass)).toEqual(['todo.chores'])
  })

  /**
   * `unavailable` is what a list looks like while its integration reloads. Dropping it took
   * its rows off the card and re-coloured every list after it until the reload was over.
   */
  it('keeps an unavailable list', () => {
    const hass = hassWith({ 'todo.shopping': 'unavailable', 'todo.chores': '0' })
    expect(discoverTodoLists(hass)).toEqual(['todo.chores', 'todo.shopping'])
  })

  it('walks the same states once, and walks again for new states or a new registry', () => {
    const hass = hassWith({ 'todo.chores': '0' })
    const first = discoverTodoLists(hass)

    expect(discoverTodoLists(hass)).toBe(first)
    expect(discoverTodoLists({ ...hass, states: { ...hass.states } })).not.toBe(first)
    expect(discoverTodoLists({ ...hass, entities: { ...hass.entities } })).not.toBe(first)
  })

  /**
   * A to-do entity's state is the count of unfinished items, so `0` is the state of every
   * list somebody has just cleared, and `unknown` is one that has not been read yet.
   * Neither is a broken list.
   */
  it('keeps a list that is empty or has not been read', () => {
    expect(discoverTodoLists(hassWith({ 'todo.a': '0', 'todo.b': 'unknown' }))).toEqual([
      'todo.a',
      'todo.b',
    ])
  })

  /** Sorted, because the sort is what decides which list gets which colour. */
  it('sorts by entity id', () => {
    const hass = hassWith({ 'todo.zoo': '1', 'todo.aa': '1', 'todo.mm': '1' })
    expect(discoverTodoLists(hass)).toEqual(['todo.aa', 'todo.mm', 'todo.zoo'])
  })

  /**
   * The feature flags say what can be WRITTEN to a list. An integration serving read-only
   * items with due dates on them advertises none of them, so filtering on
   * `SET_DUE_DATE_ON_ITEM` would hide exactly the lists this card exists to read.
   */
  it('does not ask whether a list can have due dates set on it', () => {
    const hass = hassWith({ 'todo.readonly': '4' })
    expect(discoverTodoLists(hass)).toEqual(['todo.readonly'])
  })
})

describe('todoListsFor', () => {
  const hass = hassWith({ 'todo.shopping': '3', 'todo.chores': '0' })

  it('prefers what the user chose', () => {
    expect(todoListsFor(['todo.chores'], hass)).toEqual(['todo.chores'])
  })

  it('falls back to every list when nothing is chosen', () => {
    expect(todoListsFor(undefined, hass)).toEqual(['todo.chores', 'todo.shopping'])
  })

  /** A card is given its config before its `hass`, so this is the state of every card
   * for a moment, and it must not be an exception. */
  it('has nothing to show before hass arrives', () => {
    expect(todoListsFor(undefined, undefined)).toEqual([])
    expect(todoListsFor(['todo.chores'], undefined)).toEqual(['todo.chores'])
  })
})

describe('toReminderItem', () => {
  const map = (
    todo: Record<string, unknown>,
    timeZone: string | undefined = WARSAW,
  ): ReturnType<typeof toReminderItem> =>
    toReminderItem(todo, 'todo.chores', 'var(--cw-orange)', timeZone)

  /** The wire shape in full: `asdict` with no factory, so the unset fields are `null`. */
  const wire = {
    summary: 'Pick up dry cleaning',
    uid: 'abc',
    status: 'needs_action',
    due: '2026-07-26T10:30:00+02:00',
    description: null,
    completed: null,
  }

  it('maps an item due at a time', () => {
    const item = map(wire)

    expect(item).toMatchObject({
      // The list it was subscribed from, which is the one thing a tap on the row needs and
      // the one thing the payload does not carry.
      entityId: 'todo.chores',
      kind: 'reminder',
      title: 'Pick up dry cleaning',
      color: 'var(--cw-orange)',
    })
    expect(item?.start.toISOString()).toBe('2026-07-26T08:30:00.000Z')
    expect(item?.allDay).toBeUndefined()
  })

  /**
   * The rule that keeps an overdue reminder up for the rest of its day: only a real end
   * time can retire a row, and a to-do has no duration to give it one.
   */
  it('gives a reminder no end, ever', () => {
    expect(map(wire)?.end).toBeUndefined()
    expect(map({ ...wire, due: '2026-07-26' })?.end).toBeUndefined()
  })

  /**
   * A date with no time is a day, not midnight. `allDay` is what says so, and it buys both
   * halves of the rendering: no time printed, and sorted to the top of its day.
   */
  it('treats a due date with no time as an all-day row', () => {
    const item = map({ ...wire, due: '2026-07-26' })
    expect(item).toMatchObject({ allDay: true })
    expect(dayNumber(item!.start, WARSAW)).toBe(dayNumber(NOW, WARSAW))
  })

  /**
   * `new Date('2026-07-26')` is UTC midnight by the language's own grammar, which is the
   * 25th in Honolulu and noon on the 26th in Auckland. Getting this wrong files a to-do
   * under the wrong day for half the planet, invisibly from anywhere near Greenwich.
   */
  it('puts a dated item on its own date in every timezone', () => {
    const broken: string[] = []
    for (const zone of [WARSAW, AUCKLAND, HONOLULU, 'UTC', 'America/Sao_Paulo']) {
      for (const date of ['2026-01-15', '2026-03-29', '2026-07-26', '2026-10-25', '2026-12-31']) {
        const item = map({ ...wire, due: date }, zone)
        const expected = dayNumber(new Date(`${date}T12:00:00Z`), 'UTC')
        const actual = item ? dayNumber(item.start, zone) : NaN
        if (actual !== expected) broken.push(`${zone} ${date}: off by ${actual - expected} day(s)`)
      }
    }
    expect(broken).toEqual([])
  })

  /**
   * `local_todo` keeps a date-only due a day forward, because rfc5545 due dates are
   * exclusive, and shifts it back on the way out. So the date that arrives is the day the
   * item is due, and correcting it here the way an all-day event's end is corrected would
   * put every to-do on the wrong day.
   */
  it('takes a due date as the day it is due, not as an exclusive end', () => {
    const item = map({ ...wire, due: '2026-07-28' })
    expect(dayNumber(item!.start, WARSAW)).toBe(dayNumber(new Date('2026-07-28T12:00Z'), 'UTC'))
  })

  /** A ticked item is not a thing you have to do. */
  it('drops a completed item', () => {
    expect(map({ ...wire, status: 'completed' })).toBeUndefined()
  })

  /**
   * `status` is optional on the dataclass, so testing for `needs_action` instead of
   * against `completed` would lose every item from an integration that omits it.
   */
  it('keeps an item whose status is missing or unfamiliar', () => {
    expect(map({ ...wire, status: null })?.title).toBe('Pick up dry cleaning')
    expect(map({ ...wire, status: 'in-process' })?.title).toBe('Pick up dry cleaning')
  })

  /**
   * The feature, rather than a defensive branch: a calendar files things under days, and
   * most of a real to-do list has no day. Those rows are the ones nobody asked for.
   */
  it('drops an item with no due date', () => {
    expect(map({ ...wire, due: null })).toBeUndefined()
    expect(map({ summary: 'Buy milk' })).toBeUndefined()
  })

  /** The boundary has to hold: one odd item costs its own row and nothing else. */
  it('drops what it cannot draw rather than throwing', () => {
    expect(map({ ...wire, summary: '' })).toBeUndefined()
    expect(map({ ...wire, summary: null })).toBeUndefined()
    expect(map({ ...wire, due: 'sometime next week' })).toBeUndefined()
    expect(map({ ...wire, due: 42 })).toBeUndefined()
    expect(map({})).toBeUndefined()
  })

  /**
   * `id` is the keyed-render identity. Two lists can hold the same task, an item can be
   * re-dated, and `uid` is `null` in a store that does not keep one.
   */
  it('gives each item a stable id of its own', () => {
    expect(map(wire)?.id).toBe(map(wire)?.id)
    expect(map({ ...wire, due: '2026-07-27T10:30:00+02:00' })?.id).not.toBe(map(wire)?.id)
    expect(toReminderItem(wire, 'todo.shopping', 'x', WARSAW)?.id).not.toBe(map(wire)?.id)
    expect(map({ ...wire, uid: null })?.id).toBeTruthy()
  })
})
