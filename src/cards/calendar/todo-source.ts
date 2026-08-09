/**
 * Where the widget's reminder rows come from: Home Assistant's to-do lists.
 *
 * `source.ts`'s sibling: same job, same seam, a simpler protocol. Verified the same way,
 * by reading `homeassistant/components/todo/__init__.py` and the frontend bundle inside
 * home-assistant 2026.7.4 rather than from documentation:
 *
 *  - the command is `todo/item/subscribe`, and its schema is as strict as the calendar's:
 *    `type` and ONE `entity_id` (`cv.entity_domain`), and nothing else. So a card showing
 *    three lists opens three subscriptions, which is what Home Assistant's own to-do card
 *    does with the one list it shows;
 *  - **there is no window.** A to-do list has no span to ask for, so what arrives is the
 *    WHOLE list however far out its due dates reach. `buildFlow` cuts it to the horizon,
 *    which it does to the events as well;
 *  - each push is `{ items: [...] }` (a full snapshot of that one list, never a delta),
 *    so a push replaces that list's rows and leaves the others alone;
 *  - the payload is `{ items: [] }` for a list that cannot be read, not `{ items: null }`:
 *    the handler is `[asdict(i) for i in todo_items or []]`, so unlike the calendar
 *    subscription there is no null case. Guarded anyway, at the cost of one `Array.isArray`:
 *    a push is a socket callback, and a `for … of` over something that turned out not to
 *    be a list would throw where nothing is waiting to catch it;
 *  - the subscribe handler pushes an initial snapshot itself, but only after
 *    `send_result`, so, as with the calendar, there is nothing to await for data;
 *  - a to-do list has no colour anywhere in Home Assistant. There is no `options.todo` in
 *    the entity registry and no colour in the to-do panel (both checked in the bundle), so
 *    the palette is not a fallback here, it is the whole answer.
 *
 * On the wire an item is `dataclasses.asdict(TodoItem)` with **no dict factory**, which is
 * the one place this differs from the calendar in a way that matters: every field is
 * present, and the unset ones are `null` rather than omitted. `due` is whatever
 * `datetime.date | datetime.datetime` the integration stored, serialised by orjson, so a
 * bare `2026-07-26` for a date, an ISO datetime otherwise, and that datetime may be naive
 * (`2026-07-26T10:30:00`) because nothing on the way out makes it aware. `status` is the
 * `TodoItemStatus` enum's value, `needs_action` or `completed`.
 *
 * One detail from `local_todo` worth knowing, because it looks like the calendar's
 * exclusive-end trap and is not: rfc5545 due dates are exclusive, so the store keeps a
 * date-only due a day forward, and shifts it back again on the way out
 * (`due -= timedelta(days=1)` in its `_convert_item`). The date that arrives here is the
 * day the item is due, inclusive, and needs no correction of its own.
 */

import { EntityColors } from '../../core/entity-color'
import type { HomeAssistant } from '../../core/types/ha'
import { isWireDateOnly, parseWireDate } from './datetime'
import type { CalendarItem } from './model'
import { paletteColor } from './source'

/**
 * One to-do item, as the subscription pushes it.
 *
 * Typed as loosely as `CalendarEventPayload` and for the same reason: this is the
 * boundary. `description` and `completed` are on the wire too and are not read: a
 * reminder row has one line for a title and nothing else.
 */
export interface TodoItemPayload {
  summary?: unknown
  uid?: unknown
  status?: unknown
  due?: unknown
}

/** What arrives on the subscription. */
export interface TodoPush {
  items?: TodoItemPayload[] | null
}

const TODO_DOMAIN = 'todo.'

/** Same state and the same reasoning as `discoverCalendars`; see `source.ts`. */
const UNAVAILABLE = 'unavailable'

/** The one status that means this is no longer a thing you have to do. */
const COMPLETED = 'completed'

// ---- Whether reminders are drawn at all ----------------------------------------

/**
 * Whether the card draws reminders.
 *
 * Absent means yes, so a dashboard that says nothing about to-do lists gets them the way
 * it gets every calendar. The switch exists because "every list" is not a sensible thing
 * to be unable to opt out of: a shopping list with dates on it is a legitimate thing to
 * keep out of a calendar widget, and the entity picker cannot say *none*: `ha-form`
 * reports an emptied list as `[]`, which is exactly what "I chose nothing" and "I chose
 * everything" both look like there (see `applyFormData`).
 *
 * `!== false` rather than a truthiness test: the only value that has to mean off is the
 * one the toggle writes, and Home Assistant's YAML loader resolves `no` and `off` to a
 * real `false` on the way in, so nothing else needs coercing.
 */
export const remindersEnabled = (value: unknown): boolean => value !== false

// ---- Which lists ---------------------------------------------------------------

/**
 * The to-do lists the config asked for, tolerating whatever hand-written YAML holds.
 *
 * `configuredCalendars`' twin, down to the distinction it is built on: nothing configured
 * answers `undefined`, meaning every list, and never `[]`. The two are kept apart rather
 * than generalised over a domain string because they answer to different keys and read
 * better in their own file than a `configuredEntities(value, 'todo.')` would in neither.
 */
export const configuredTodoLists = (value: unknown): string[] | undefined => {
  const list = Array.isArray(value) ? value : [value]
  const ids = list.filter(
    (id): id is string => typeof id === 'string' && id.startsWith(TODO_DOMAIN),
  )
  return ids.length ? ids : undefined
}

/**
 * Every to-do list in the installation, in the order that decides their colours.
 *
 * The same three predicates as `discoverCalendars`, for the same reasons, sorted by raw
 * entity id so the colours are stable.
 *
 * Deliberately NOT filtered by `supported_features`. `SET_DUE_DATE_ON_ITEM` and
 * `SET_DUE_DATETIME_ON_ITEM` would look like exactly the filter for a card that only
 * draws dated items, and they are not: the flags say what can be *written* to a list, so
 * an integration serving read-only items with due dates on them advertises none of them
 * and would vanish. A list with no dated items in it costs one subscription and draws
 * nothing, which is the cheaper mistake by far.
 */
export const discoverTodoLists = (hass: HomeAssistant): string[] =>
  Object.keys(hass.states)
    .filter(
      id =>
        id.startsWith(TODO_DOMAIN) &&
        hass.states[id]?.state !== UNAVAILABLE &&
        hass.entities[id]?.hidden !== true,
    )
    .sort()

/** What the card is actually going to subscribe to. */
export const todoListsFor = (value: unknown, hass: HomeAssistant | undefined): string[] => {
  const configured = configuredTodoLists(value)
  if (configured) return configured
  return hass ? discoverTodoLists(hass) : []
}

// ---- The mapping ---------------------------------------------------------------

/**
 * One to-do item as a reminder row, or nothing if it does not belong on a calendar.
 *
 * Two of the three ways out of here are the point of the feature rather than defensive
 * plumbing:
 *
 * **No `due`, no row.** A calendar widget files things under days, and an item with no
 * due date has no day to be filed under. That is most of any real to-do list, so this is
 * the filter that keeps a shopping list from becoming a wall of undated rows, not an
 * error case.
 *
 * **A ticked item is done.** `completed` is dropped, and dropped by name rather than by
 * testing for `needs_action`: `status` is optional on the dataclass, so an integration
 * that omits it would lose every item to the stricter test, and an item with no status is
 * still an item that has to be drawn.
 *
 * **A date with no time is `allDay`.** It is the same fact the flag carries for an event
 * (this belongs to a day, not to a moment), and it buys the two behaviours that go with it:
 * the row prints no time (there is none to print, and `12:00AM` would be an invention) and
 * sorts to the top of its day with the all-day entries. What it does NOT get is an `end`:
 * a reminder without one is never retired by `isOver`, so an item due at ten this morning
 * is still up this evening, which is the whole of §2's rule about overdue reminders.
 */
export const toReminderItem = (
  todo: TodoItemPayload,
  entityId: string,
  color: string,
  timeZone: string | undefined,
): CalendarItem | undefined => {
  if (todo.status === COMPLETED) return undefined

  const title = typeof todo.summary === 'string' ? todo.summary : ''
  if (!title) return undefined

  const start = parseWireDate(todo.due, timeZone)
  if (!start) return undefined

  const allDay = isWireDateOnly(todo.due)
  const uid = typeof todo.uid === 'string' ? todo.uid : ''

  return {
    // The same shape as an event's, and stable for the same reason: `flow.ts` keys its
    // render on it. `uid` is `null` on the wire for a store that does not keep one, and
    // the due date is folded in because re-dating an item should redraw the row.
    id: `${entityId}|${uid || title}|${String(todo.due)}`,
    entityId,
    kind: 'reminder',
    title,
    start,
    ...(allDay ? { allDay: true } : {}),
    color,
  }
}

// ---- The subscriptions ---------------------------------------------------------

/**
 * Holds one subscription per to-do list and reports the reminder rows they push.
 *
 * `CalendarFeed`'s counterpart, and it keeps the same three rules (one subscription per
 * entity, one snapshot per entity, nothing torn down that has not moved) while being
 * shorter in two ways that follow from the protocol:
 *
 *  - no window, so no key to compare and no rollover that invalidates everything. The
 *    entity list is the only thing a reconcile has to look at;
 *  - the colour lookup is not awaited before subscribing, and needs no revision counter of
 *    its own: `EntityColors` holds both, and an answer that lands late simply publishes.
 *
 * The one place it is deliberately *unlike* `CalendarFeed`: it keeps the wire payloads per
 * list and maps them on the way out, rather than mapping on the way in. A row's colour is
 * a property of the CURRENT list of lists (the palette is positional), so a list
 * appearing has to re-colour the rows already on screen, and rows mapped when they
 * arrived would keep the old shade until their own list happened to push again.
 *
 * That is also what lets this one hold a LIVE colour where `CalendarFeed` settles for one
 * per reconcile: a list's stored colour can change while the card is on screen, and here
 * the whole of reacting to it is publishing again.
 */
export class TodoFeed {
  private readonly _onChange: (items: CalendarItem[]) => void

  private readonly _snapshots = new Map<string, TodoItemPayload[]>()

  /**
   * The live subscription per list, identified by the `token`.
   *
   * The identity is doing the same job as `CalendarFeed`'s and is worth no less here: the
   * unsubscribe handle resolves a turn of the event loop after the call, pushes arrive for
   * as long as the socket is open, and a card can be dragged out of the DOM or re-pointed
   * at other lists in that gap.
   */
  private readonly _live = new Map<string, { token: object; unsubscribe?: () => Promise<void> }>()

  /** The lists in the order that colours them, and the zone their dates are read in. */
  private _order: readonly string[] = []
  private _orderKey = ''
  private _timeZone: string | undefined

  /**
   * What a list is drawn in when its owner has said, kept current while the card is up.
   *
   * The palette below is the floor under it rather than the answer, which is the same
   * arrangement `CalendarFeed` has with `options.calendar.color`. A to-do list has no
   * colour of Home Assistant's own, so what this reads is the library's own namespace, and
   * a list coloured in a reminders card's editor comes out the same shade here.
   */
  private readonly _colors = new EntityColors(() => this._publish())

  public constructor(onChange: (items: CalendarItem[]) => void) {
    this._onChange = onChange
  }

  /**
   * Point the feed at `entityIds`, doing as little as possible.
   *
   * Called on every `hass` swap, every config edit and every minute of the clock, so the
   * unchanged case has to cost nothing and in particular must not publish: a fresh array
   * handed to the card would repaint it on every state change in the installation, which
   * is exactly what the card's re-render filter exists to prevent.
   */
  public async reconcile(
    hass: HomeAssistant,
    entityIds: readonly string[],
    timeZone: string | undefined,
  ): Promise<void> {
    const orderKey = entityIds.join(' ')
    const moved = orderKey !== this._orderKey || timeZone !== this._timeZone

    this._order = [...entityIds]
    this._orderKey = orderKey
    this._timeZone = timeZone

    const wanted = new Set(entityIds)
    for (const entityId of [...this._live.keys()]) {
      if (!wanted.has(entityId)) this._close(entityId)
    }

    // Not awaited, unlike `CalendarFeed`'s: the rows are mapped at publish, so a colour
    // that arrives after them repaints instead of being missed.
    void this._colors.reconcile(hass, entityIds)

    // One publish for the whole reconcile, and before the new subscriptions rather than
    // after: deselecting a list has to take its rows with it now, and the lists that
    // stayed may have been re-coloured by the ones that left.
    if (moved) this._publish()

    // Claimed before the first await, so a reconcile arriving in the gap sees them as
    // taken. The token travels with the claim because by the time the subscribe runs the
    // entry under this id may belong to a later reconcile.
    const claims = entityIds
      .filter(id => !this._live.has(id))
      .map(entityId => {
        const token = {}
        this._live.set(entityId, { token })
        return { entityId, token }
      })

    await Promise.all(claims.map(claim => this._subscribe(hass, claim.entityId, claim.token)))
  }

  /**
   * Called when the card leaves the DOM, when it is drawing fixtures, and on every
   * reconcile while reminders are switched off, which is why it answers early when there
   * is nothing to stop. Publishing an empty list over an empty list is a repaint for
   * nothing, and this one would be doing it per state change.
   */
  public stop(): void {
    // Above the guard below, and idempotent, so a card that switches reminders off closes
    // its registry watch even when it had no rows to clear.
    this._colors.stop()

    if (!this._live.size && !this._snapshots.size && !this._order.length) return

    this._order = []
    this._orderKey = ''
    for (const entityId of [...this._live.keys()]) this._close(entityId)
    this._snapshots.clear()
    this._publish()
  }

  private async _subscribe(hass: HomeAssistant, entityId: string, token: object): Promise<void> {
    try {
      const unsubscribe = await hass.connection.subscribeMessage<TodoPush>(
        push => this._receive(entityId, push, token),
        { type: 'todo/item/subscribe', entity_id: entityId },
      )

      // Superseded while the handle was in flight, so it is ours to close and nobody
      // else's; the entry in `_live` now belongs to a newer subscription.
      const live = this._live.get(entityId)
      if (live?.token !== token) {
        await unsubscribe()
        return
      }
      live.unsubscribe = unsubscribe
    } catch (error) {
      // Home Assistant refusing the command rather than a dropped connection:
      // `invalid_entity_id` for a list that is not there, which is what a config pointing
      // at a deleted list looks like. It costs that list's rows and nothing else.
      if (this._live.get(entityId)?.token === token) this._live.delete(entityId)
      console.warn(`[cupertino-widgets] cannot read ${entityId}`, error)
    }
  }

  private _receive(entityId: string, push: TodoPush, token: object): void {
    // A push from a subscription that has been closed or replaced. The socket can still be
    // delivering for it. An unsubscribe is itself a round trip.
    if (this._live.get(entityId)?.token !== token) return

    this._snapshots.set(entityId, Array.isArray(push?.items) ? push.items : [])
    this._publish()
  }

  private _publish(): void {
    const items: CalendarItem[] = []
    this._order.forEach((entityId, index) => {
      const color = this._colors.get(entityId) ?? paletteColor(index)
      for (const todo of this._snapshots.get(entityId) ?? []) {
        const item = toReminderItem(todo, entityId, color, this._timeZone)
        if (item) items.push(item)
      }
    })
    this._onChange(items)
  }

  private _close(entityId: string): void {
    const live = this._live.get(entityId)
    this._live.delete(entityId)
    this._snapshots.delete(entityId)
    // Nothing to do about a failed unsubscribe: the socket may already be gone, which is
    // the case that closed the subscription for us.
    void live?.unsubscribe?.().catch(() => {})
  }
}
