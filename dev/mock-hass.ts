/**
 * A `hass` object good enough to develop cards against.
 *
 * It covers what the real one gives a card: entity states, the entity registry, locale and
 * timezone, the dark-mode flag, and the three ways a card fetches data (`callWS`,
 * `callService`, `callApi`) plus the websocket subscriptions the calendar and reminders cards
 * read. Calls are logged rather than mocked away, so it is obvious in the console when a card
 * asks for something the harness does not answer yet.
 *
 * ## Why it grew a to-do store
 *
 * Everything above is one-way: a card asks, the mock answers, and nothing a card does comes
 * back to it. That was enough for the two cards that only read. The reminders card is the
 * first that writes, and its whole behaviour is a round trip: a tap calls `todo.update_item`,
 * Home Assistant writes the item inside that blocking call and the subscription pushes a fresh
 * snapshot before the call resolves, and the card's five-second linger is layered over that
 * snapshot arriving rather than fighting it (`src/cards/reminders/completion.ts` has the
 * argument). Against a `callService` that only logged and a subscription that pushed one
 * snapshot and threw its callback away, a tap in the showcase did nothing whatsoever, which is
 * the one thing about that card worth showing.
 *
 * So the lists are a mutable store with live subscribers over it, and `todo.update_item` edits
 * the store and re-pushes at the point core does. It is still a mock, and the line is in the
 * same place as everywhere else here: no `todo/item/move`, no optimistic concurrency, and no
 * validation beyond the refusals a card is expected to survive.
 */

import type { FrontendLocaleData, HassEntity, HomeAssistant } from '../src/core/types/ha'
import { BATTERY_STATES } from './battery-devices'
import { REMINDER_ITEMS, REMINDER_STATES, outstanding, type WireTodoItem } from './reminders-lists'

const entity = (
  entityId: string,
  state: string,
  attributes: Record<string, unknown> = {},
): HassEntity => ({
  entity_id: entityId,
  state,
  attributes,
  last_changed: '2026-07-25T06:00:00.000Z',
  last_updated: '2026-07-25T06:00:00.000Z',
})

// ---- Clocks on the wire --------------------------------------------------------

const pad = (value: number): string => String(value).padStart(2, '0')

/** A local `YYYY-MM-DD`, which is the only form an all-day event takes on the wire. */
const wireDate = (offsetDays: number): string => {
  const date = new Date()
  date.setDate(date.getDate() + offsetDays)
  return `${date.getFullYear()}-${pad(date.getMonth() + 1)}-${pad(date.getDate())}`
}

/** A timed instant, `minutes` from now. */
const wireTime = (minutes: number): string => new Date(Date.now() + minutes * 60_000).toISOString()

/**
 * The same instant as a local wall clock with no zone on it: `2026-07-26T10:30:00`.
 *
 * Only a `todo` list sends these: Home Assistant requires a calendar event's datetimes to
 * be aware, while a to-do's `due` is serialised as whatever the integration stored.
 */
const naiveTime = (minutes: number): string => {
  const at = new Date(Date.now() + minutes * 60_000)
  const day = `${at.getFullYear()}-${pad(at.getMonth() + 1)}-${pad(at.getDate())}`
  return `${day}T${pad(at.getHours())}:${pad(at.getMinutes())}:00`
}

// ---- To-do lists ---------------------------------------------------------------

/**
 * The calendar card's two lists, in Home Assistant's OWN wire shape.
 *
 * Written the way `todo/item/subscribe` sends them, which is `asdict` with no dict factory:
 * every field present, the unset ones `null`, `status` spelled out, and `due` either a bare
 * `YYYY-MM-DD` or an ISO datetime. Between them they cover every branch of that card's mapper:
 * a timed item, a dated one with no time, a naive datetime with no offset on it (which is what
 * an integration that stored a wall clock sends), a completed item and an undated one. The
 * last two must never appear on the calendar card: one is done, and the other has no day to be
 * drawn on.
 *
 * Split across two lists for the same reason the events are: picking one in the editor has to
 * visibly drop the other's rows.
 *
 * `demo` provides none of this: it has no `todo` platform at all, so the dev Home Assistant
 * needs the Local To-do integration adding by hand and the showcase needs these.
 */
const CALENDAR_TODOS: Record<string, WireTodoItem[]> = {
  'todo.chores': [
    {
      summary: 'Pick up dry cleaning',
      uid: 'chore-1',
      status: 'needs_action',
      due: wireTime(150),
      description: null,
      completed: null,
    },
    {
      summary: 'Water the plants',
      uid: 'chore-2',
      status: 'needs_action',
      due: wireDate(0),
      description: null,
      completed: null,
    },
    {
      summary: 'Renew library card',
      uid: 'chore-3',
      status: 'needs_action',
      due: wireDate(2),
      description: null,
      completed: null,
    },
    // Neither of these is drawable by the calendar card: the first is done, the second
    // belongs to no day.
    {
      summary: 'Take the bins out',
      uid: 'chore-4',
      status: 'completed',
      due: wireDate(0),
      description: null,
      completed: wireTime(-60),
    },
    {
      summary: 'Sort the cellar out',
      uid: 'chore-5',
      status: 'needs_action',
      due: null,
      description: null,
      completed: null,
    },
  ],
  'todo.shopping': [
    {
      summary: 'Order the birthday cake',
      uid: 'shop-1',
      status: 'needs_action',
      // No offset, which `todo/item/subscribe` will happily send: a naive `datetime` goes
      // out as the wall clock it was stored as, and the browser reads it as local time.
      due: naiveTime(320),
      description: null,
      completed: null,
    },
    {
      summary: 'Buy stamps',
      uid: 'shop-2',
      status: 'needs_action',
      due: wireDate(1),
      description: null,
      completed: null,
    },
  ],
}

/**
 * Every to-do list the harness has, keyed by entity id: the one mutable thing in this file.
 *
 * Two sources, because the two cards want different lists. The dated ones above are the
 * calendar's, and the reminders card's are in `reminders-lists.ts`, beside the config that
 * names them, which is where a fixture belongs when the card reading it has no fixture door.
 *
 * Built once at load rather than per subscription, and that is the change ticking an item off
 * asked for: a fixture that rebuilt itself whenever somebody subscribed could not remember
 * anything that had been done to it. What it costs is that the dated items are anchored to the
 * moment the page opened rather than to the moment a card subscribed, a difference nothing on
 * screen can tell until a tab has been left open for hours.
 *
 * Nothing is copied on the way in either. There is one page and one store, which is what a
 * Home Assistant is; copying would only mean two answers to the question of what is on a list.
 */
const TODO_ITEMS: Record<string, WireTodoItem[]> = { ...CALENDAR_TODOS, ...REMINDER_ITEMS }

/**
 * A to-do entity, whose state is its own count of the items still to do.
 *
 * Derived, never written, which is `reminders-lists.ts`'s rule applied to the two lists that
 * live here. This file used to declare `todo.chores` as `'3'` while handing the same list five
 * items, four of them outstanding, and a harness whose number disagrees with the rows under it
 * is a bug report waiting to be written about a card.
 *
 * `supported_features: 127` is every `TodoListEntityFeature`, which is what `local_todo`
 * reports. The calendar card reads neither the state nor the flags; they are correct here
 * because a value a real one would not have is how you find out that something is quietly
 * reading it.
 */
const todoList = (entityId: string, name: string): HassEntity =>
  entity(entityId, String(outstanding(TODO_ITEMS[entityId] ?? [])), {
    friendly_name: name,
    supported_features: 127,
  })

// ---- States --------------------------------------------------------------------

/** Mirrors what the `demo` integration gives the dev Home Assistant instance. */
const STATES: Record<string, HassEntity> = {
  'calendar.calendar_1': entity('calendar.calendar_1', 'on', {
    friendly_name: 'Work',
    message: 'Design review',
    start_time: '2026-07-25 09:30:00',
    end_time: '2026-07-25 10:30:00',
    all_day: false,
    supported_features: 7,
  }),
  'calendar.calendar_2': entity('calendar.calendar_2', 'off', {
    friendly_name: 'Personal',
    message: 'Dentist',
    start_time: '2026-07-25 15:15:00',
    end_time: '2026-07-25 16:00:00',
    all_day: false,
    supported_features: 7,
  }),
  'todo.chores': todoList('todo.chores', 'Chores'),
  'todo.shopping': todoList('todo.shopping', 'Shopping'),
  // The reminders card's lists and the battery card's devices are lists of their own; see
  // `reminders-lists.ts` and `battery-devices.ts`, where the config that points at each of
  // them lives beside it.
  ...Object.fromEntries(REMINDER_STATES.map(one => [one.entity_id, one])),
  ...Object.fromEntries(BATTERY_STATES.map(one => [one.entity_id, one])),
}

/**
 * Per-calendar colours, as the entity registry holds them.
 *
 * One named token and one calendar with no entry at all, which is the pair worth having:
 * the token proves the registry lookup and its `var(--red-color)` mapping, and the
 * missing entry proves the fallback to the palette. `demo`'s real calendars have no
 * registry entry either (no unique id), so the second case is the common one.
 */
const REGISTRY_OPTIONS: Record<string, { calendar?: { color?: string } }> = {
  'calendar.calendar_1': { calendar: { color: 'red' } },
}

/**
 * Calendar events in Home Assistant's OWN wire shape, per calendar.
 *
 * Not the `CalendarItem` fixtures. This is what `demo_scenario` cannot cover: the
 * fixtures start life on the far side of the mapper, so they exercise the layout rules
 * and nothing about the mapping. These are hand-written the way the subscription sends
 * them: bare `YYYY-MM-DD` with an EXCLUSIVE end for the all-day entry, a full ISO
 * datetime for the rest, `summary` rather than `title`, and `location` absent rather
 * than empty where there is none.
 *
 * Split across the two calendars on purpose, so that picking one in the editor visibly
 * drops the other's rows. That is the whole thing the entity selector is for, and it is
 * not observable in a harness where both calendars carry the same events.
 *
 * Still thunks, unlike the to-do store above: nothing writes to a calendar here, so these
 * can go on being built at subscribe time, which keeps their times fresh in a tab that has
 * been open all day.
 *
 * Timed events are stamped `Z` here; Home Assistant more often sends a local offset,
 * which `new Date` reads identically. Real calendars come from `pnpm ha:up`.
 */
const WIRE_EVENTS: Record<string, () => Record<string, unknown>[]> = {
  'calendar.calendar_1': () => [
    { summary: 'Design review', start: wireTime(45), end: wireTime(105), all_day: false },
    {
      summary: 'Lunch with Anna',
      location: 'Gdańska 12, Warsawa',
      start: wireTime(180),
      end: wireTime(240),
      all_day: false,
    },
    { summary: 'Standup', start: wireTime(1_500), end: wireTime(1_530), all_day: false },
  ],
  'calendar.calendar_2': () => [
    // End is the day AFTER the one it covers: all-day ends are exclusive, and an
    // off-by-one here would either retire this a day early or leave it up a day late.
    { summary: 'Poznań trip', start: wireDate(0), end: wireDate(2), all_day: true },
    { summary: 'Dentist', start: wireTime(300), end: wireTime(360), all_day: false },
    { summary: 'Training', start: wireTime(1_700), end: wireTime(1_760), all_day: false },
  ],
}

// ---- The to-do round trip ------------------------------------------------------

/** One push, from this side of the socket: the card's `TodoPush`, with the wire type in it. */
type TodoListener = (push: { items: WireTodoItem[] }) => void

/**
 * The live subscriptions, per list.
 *
 * A set per entity rather than one flat list, because both operations are per entity: a push
 * goes to everyone watching one list, and an unsubscribe takes one callback out of one set.
 * Two subscribers on one list is the ordinary case on this page, not a corner: the reminders
 * card and the calendar card can both be pointed at `todo.chores`, and the showcase draws
 * several cards at once.
 */
const TODO_LISTENERS = new Map<string, Set<TodoListener>>()

/**
 * A push: the whole list, copied.
 *
 * A snapshot and never a delta, which is what the real handler sends and what makes the
 * card's linger necessary in the first place. `items: []` for a list nobody wrote fixtures
 * for, never `items: null`: the real handler maps over `todo_items or []`, so there is no null
 * case to imitate.
 *
 * Copied because the wire copies. A card handed the store's own objects could hold a reference
 * that changed under it without a push, which is the one habit this harness must not teach.
 */
const snapshot = (entityId: string): { items: WireTodoItem[] } => ({
  items: (TODO_ITEMS[entityId] ?? []).map(item => ({ ...item })),
})

const publishTodo = (entityId: string): void => {
  for (const listener of TODO_LISTENERS.get(entityId) ?? []) listener(snapshot(entityId))
}

/** `TodoListEntityFeature.UPDATE_TODO_ITEM`, which `todo.update_item` is registered against. */
const UPDATE_TODO_ITEM = 4

/** The list a service call is aimed at. A card sends one id; a target may hold several. */
const targetEntity = (target: Record<string, unknown> | undefined): string => {
  const value = target?.entity_id
  if (Array.isArray(value)) return typeof value[0] === 'string' ? value[0] : ''
  return typeof value === 'string' ? value : ''
}

/**
 * `todo.update_item`, as far as a card can tell.
 *
 * Three refusals and one edit, and the refusals are as much the point as the edit: each is a
 * rejected promise, so the card's own failure path (drop the pin, put the row back, warn) can
 * be walked here instead of only in a real Home Assistant. The second one is the one worth
 * having a fixture for, a list whose `supported_features` lacks `UPDATE_TODO_ITEM`: core
 * registers the service with `required_features`, so the call never reaches the entity, and
 * `reminders-lists.ts` ships a list that fails it. What the harness cannot reproduce is the
 * ten-second red toast the real `hass.callService` raises before it re-throws; the console
 * warning the card writes is the whole of the feedback here.
 *
 * The lookup is core's `_find_by_uid_or_summary`, `value in (item.uid, item.summary)`, and
 * copying it exactly is what makes the card's choice of identity testable: it addresses an
 * item by uid when the list keeps one and by summary when it does not.
 *
 * The write is partial, again like core: `status` is overwritten and every field the card
 * never read is left where it was.
 */
const updateTodoItem = (entityId: string, data: Record<string, unknown> | undefined): void => {
  const items = TODO_ITEMS[entityId]
  const state = STATES[entityId]
  if (!items || !state) throw new Error(`[mock-hass] no such to-do list: ${entityId || '(none)'}`)

  const features = Number(state.attributes.supported_features ?? 0)
  if ((features & UPDATE_TODO_ITEM) === 0) {
    throw new Error(`[mock-hass] ${entityId} does not support todo.update_item`)
  }

  const key = typeof data?.item === 'string' ? data.item : ''
  const found = items.find(one => key === one.uid || key === one.summary)
  if (!found) throw new Error(`[mock-hass] unable to find to-do list item: ${key || '(none)'}`)

  const status = data?.status
  if (status === 'completed' || status === 'needs_action') found.status = status

  // The entity's state is Home Assistant's count of what is left, so it moves with the item,
  // in place on the object every `hass` handed out is still holding. The real frontend replaces
  // the whole `hass` on a state change and pushes it down, and imitating that from inside a
  // service call would mean re-rendering the showcase from here. Nothing reads this number
  // while the page is open (the reminders card counts the snapshot it draws, and says why), so
  // the cheap version is honest enough: the store and the states go on telling one story.
  const next = String(outstanding(items))
  state.last_updated = new Date().toISOString()
  if (next !== state.state) {
    // Only when the string actually moved, which is Home Assistant's own rule for it.
    state.state = next
    state.last_changed = state.last_updated
  }

  // Where core pushes: inside the blocking call, before it returns. The card is written
  // against that ordering, so the harness has to keep it.
  publishTodo(entityId)
}

/**
 * The handful of Home Assistant strings our editors reuse, copied out of the `en` table
 * the frontend ships. `localize` answers `''` for anything else, which is what the real
 * one does with a key it does not have, the fallback path an editor has to survive.
 */
const TRANSLATIONS: Record<string, string> = {
  'ui.panel.lovelace.editor.card.calendar.calendar_entities': 'Calendar entities',
  'panel.todo': 'To-do lists',
}

export interface MockHassOptions {
  dark: boolean
  /** Drives the 12/24-hour switch the calendar card formats against. */
  timeFormat: FrontendLocaleData['time_format']
}

export function createMockHass({ dark, timeFormat }: MockHassOptions): HomeAssistant {
  return {
    states: { ...STATES },
    entities: Object.fromEntries(
      Object.keys(STATES).map(id => [id, { entity_id: id, hidden: false }]),
    ),
    /*
     * No panels, and the empty object is the honest answer rather than a gap: the showcase is
     * a page with cards on it, not a Home Assistant, so there is no `/calendar` and no
     * `/todo` behind this document to send anybody to.
     *
     * A card asks before it navigates (`_open` in the calendar card, `_openList` in the
     * reminders card), so this is also what keeps a tap in the harness to its press effect
     * instead of pushing a history entry the showcase cannot serve on reload. Fill it in the
     * day the harness grows something worth navigating to.
     */
    panels: {},
    config: { time_zone: 'Europe/Warsaw', country: 'PL', version: '2026.7.4' },
    themes: { darkMode: dark, theme: 'default' },
    locale: {
      language: 'en',
      time_format: timeFormat,
      first_weekday: 'monday',
      time_zone: 'local',
    },
    language: 'en',
    connection: {
      async subscribeMessage(callback, message) {
        console.debug('[mock-hass] subscribeMessage', message)

        // Asynchronously in both cases, because Home Assistant is: the subscribe resolves
        // first and the snapshot arrives after it, so a card that expected data from the
        // call itself would work here and nowhere else.
        if (message.type === 'calendar/event/subscribe') {
          const entityId = String(message.entity_id)
          queueMicrotask(() => callback({ events: WIRE_EVENTS[entityId]?.() ?? [] } as never))
        }

        if (message.type === 'todo/item/subscribe') {
          const entityId = String(message.entity_id)
          // The generic signature cannot know which command it is answering; this branch
          // does, and the type it casts to is the one `snapshot` builds.
          const listener = callback as unknown as TodoListener
          const listeners = TODO_LISTENERS.get(entityId) ?? new Set<TodoListener>()
          listeners.add(listener)
          TODO_LISTENERS.set(entityId, listeners)

          // Still through a microtask, and still guarded: a card that unsubscribes in the
          // same turn it subscribed (a reconcile landing on a re-pointed card does exactly
          // that) must not be handed a snapshot after it has let go.
          queueMicrotask(() => {
            if (listeners.has(listener)) listener(snapshot(entityId))
          })

          return async () => {
            listeners.delete(listener)
            console.debug('[mock-hass] unsubscribed', message)
          }
        }

        return async () => {
          console.debug('[mock-hass] unsubscribed', message)
        }
      },
    },
    localize: key => TRANSLATIONS[key] ?? '',
    async callWS(message) {
      console.debug('[mock-hass] callWS', message)
      // Answered rather than logged away, so the colour path is exercised: the harness
      // gives one calendar a named token and leaves the other to the palette.
      if (message.type === 'config/entity_registry/get_entries') {
        const ids = Array.isArray(message.entity_ids) ? (message.entity_ids as string[]) : []
        return Object.fromEntries(
          ids.map(id => [id, id in REGISTRY_OPTIONS ? { options: REGISTRY_OPTIONS[id] } : null]),
        ) as never
      }
      return undefined as never
    },
    async callService(domain, service, data, target) {
      console.debug('[mock-hass] callService', `${domain}.${service}`, data, target)
      // The one service the harness performs rather than logs; everything else stays a line
      // in the console, which is how it stays obvious that nothing happened.
      if (domain === 'todo' && service === 'update_item') {
        updateTodoItem(targetEntity(target), data)
      }
    },
    async callApi(method, path) {
      console.debug('[mock-hass] callApi', method, path)
      return undefined as never
    },
  }
}
