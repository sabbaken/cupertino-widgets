/**
 * Where the widget's event rows come from: Home Assistant's calendars.
 *
 * Everything above this file speaks `CalendarItem` and knows nothing about Home
 * Assistant; see `model.ts`. This file and `todo-source.ts` are the two that do, one per
 * domain, because the two subscriptions have nothing in common but their shape. This one
 * carries the calendar protocol, verified by reading
 * `homeassistant/components/calendar/__init__.py` and the frontend bundle inside
 * home-assistant 2026.7.4 rather than from documentation:
 *
 *  - the command is `calendar/event/subscribe`, and its schema is strict
 *    (`vol.PREVENT_EXTRA`): exactly `type`, `entity_id`, `start`, `end`, no more;
 *  - `entity_id` is ONE entity, not a list: `cv.entity_domain` rejects two with
 *    "Expected exactly 1 entity, got 2". So a card showing four calendars opens four
 *    subscriptions, which is what Home Assistant's own calendar card does;
 *  - each push is a FULL SNAPSHOT of the window for that one calendar, never a delta,
 *    so a push replaces that calendar's rows and leaves the others alone;
 *  - the payload is `{ events: [...] }` (an object, not a bare list), and on a backend
 *    failure it is `{ events: null }` on the same subscription rather than an error, so
 *    `msg.events.map(…)` is a crash waiting for a flaky integration;
 *  - `subscribeMessage` resolves BEFORE the first snapshot arrives (the fetch is wrapped
 *    in `hass.async_create_task`), so there is nothing to await for data;
 *  - events are NOT clipped to the requested window: a platform returns anything that
 *    OVERLAPS it. `buildFlow` does the clipping, which is where it belongs.
 *
 * On the wire an event is `CalendarEvent.as_dict()`: `start`, `end`, `summary` and
 * `all_day` always present, `description` / `location` / `uid` / `recurrence_id` /
 * `rrule` omitted entirely when unset. `start` and `end` are PLAIN ISO STRINGS. The
 * nested `{ dateTime }` / `{ date }` form belongs to the REST endpoint, which the
 * frontend does not use and neither do we.
 */

import { fetchEntityColors } from '../../core/entity-color'
import type { HomeAssistant } from '../../core/types/ha'
import { isWireDateOnly, parseWireDate } from './datetime'
import type { DayWindow } from './flow'
import type { CalendarItem } from './model'

/**
 * One calendar event, as the subscription pushes it.
 *
 * Typed loosely on purpose. This is the boundary: an integration is free to be odd, and
 * a card that trusted the shape would take a dashboard down with it rather than drop one
 * row. `toCalendarItem` is what narrows it.
 */
export interface CalendarEventPayload {
  start?: unknown
  end?: unknown
  summary?: unknown
  location?: unknown
  uid?: unknown
  recurrence_id?: unknown
  all_day?: unknown
}

/** What arrives on the subscription. `null` is Home Assistant saying the fetch failed. */
export interface CalendarPush {
  events?: CalendarEventPayload[] | null
}

const CALENDAR_DOMAIN = 'calendar.'

/**
 * The state Home Assistant's own calendar helper refuses to show.
 *
 * `unavailable` and not `unknown`: the helper tests only the former, and a calendar with
 * no current event sits at `off`/`unknown` perfectly happily. Filtering those would hide
 * every quiet calendar in the installation.
 */
const UNAVAILABLE = 'unavailable'

// ---- Which calendars -----------------------------------------------------------

/**
 * The calendars the config asked for, tolerating whatever hand-written YAML holds.
 *
 * A config is not typechecked on its way in, and this is the card's only one, so it is
 * the one place that has to be forgiving. A bare `entities:` parses to `null`,
 * `entities: calendar.work` to a string, and the editor can only promise a `string[]` for
 * configs it wrote itself. Anything that comes to nothing answers `undefined` rather than
 * `[]`, because those two mean opposite things here: no key means "every calendar", and
 * an empty list would mean "no calendars", which is not a thing anybody asks a calendar
 * widget for.
 */
export const configuredCalendars = (value: unknown): string[] | undefined => {
  const list = Array.isArray(value) ? value : [value]
  const ids = list.filter(
    (id): id is string => typeof id === 'string' && id.startsWith(CALENDAR_DOMAIN),
  )
  return ids.length ? ids : undefined
}

/**
 * Every calendar in the installation, in the order that decides their colours.
 *
 * The three predicates and the bare `.sort()` are Home Assistant's own, read out of
 * `getCalendars` in the 2026.7.4 bundle: domain, not `unavailable`, not hidden in the
 * entity registry, then sorted by raw entity id. Copied rather than improved on so that
 * a calendar is the same colour here as it is in Home Assistant's calendar panel,
 * including the awkward part, that adding a calendar re-colours the ones after it.
 */
export const discoverCalendars = (hass: HomeAssistant): string[] =>
  Object.keys(hass.states)
    .filter(
      id =>
        id.startsWith(CALENDAR_DOMAIN) &&
        hass.states[id]?.state !== UNAVAILABLE &&
        hass.entities[id]?.hidden !== true,
    )
    .sort()

/** What the card is actually going to subscribe to. */
export const calendarsFor = (value: unknown, hass: HomeAssistant | undefined): string[] => {
  const configured = configuredCalendars(value)
  if (configured) return configured
  return hass ? discoverCalendars(hass) : []
}

// ---- Colours -------------------------------------------------------------------

/**
 * The Cupertino palette, in the order calendars are dealt from it.
 *
 * Deliberately NOT Home Assistant's `--color-1` … `--color-54`. Those are a data-viz
 * ramp meant to stay distinguishable across fifty series; these are the eight system
 * colours the widget is drawn in, and they already have a dark variant in `tokens.ts`
 * that a saturated `#4269d0` would not. Red comes last because the widget spends it on
 * the weekday above the flow.
 *
 * `todo-source.ts` deals from the same deck by the position of a list in its own list, so
 * a calendar and a to-do list can come out the same hue. That is deliberate: the deck is
 * the widget's, not the calendars', and dealing the to-do lists from where the calendars
 * left off would make a list's colour depend on how many calendars happen to exist.
 *
 * It is the floor under both, not the answer: a calendar with a colour in the entity
 * registry, and a to-do list with one in ours, are drawn in that instead. See
 * `core/entity-color.ts`.
 */
const PALETTE = [
  'var(--cw-blue)',
  'var(--cw-orange)',
  'var(--cw-green)',
  'var(--cw-purple)',
  'var(--cw-pink)',
  'var(--cw-yellow)',
  'var(--cw-indigo)',
  'var(--cw-red)',
] as const

export const paletteColor = (index: number): string =>
  PALETTE[((index % PALETTE.length) + PALETTE.length) % PALETTE.length]

// ---- The window ----------------------------------------------------------------

export interface SubscriptionWindow {
  start: Date
  end: Date
  /** Changes only when the window moves, so a reconcile can tell. */
  key: string
}

/**
 * The span to ask Home Assistant for, and when to ask again.
 *
 * `window` is the card's own window of days (`dayWindow` in `flow.ts`), padded a day at
 * each end and keyed on the UTC day rather than on the display one. All three of those
 * are on purpose:
 *
 *  - the pad is what lets the window be computed without a timezone at all. A day is
 *    more than the ±14 hours any zone is from UTC, so a window this wide covers local
 *    midnight on the first day through local midnight after the last, wherever the
 *    dashboard is being read. Precision here would buy nothing: `buildFlow` decides what
 *    is actually on screen, in the display zone, and it is stricter than this is;
 *  - the key is what stops the re-subscribing. The card's clock ticks every minute, and
 *    a window keyed on the instant would tear down and rebuild every subscription sixty
 *    times an hour. Keyed on the day it moves once, and the move is the midnight
 *    rollover the widget needs anyway;
 *  - the key carries the offset and the span as well as the day, and it has to. It is the
 *    only thing `reconcile` compares, and the span is baked into each subscription: a key
 *    that named the day alone would leave a card whose `day_offset` had just been edited
 *    holding subscriptions to the days it used to show, with nothing to tell it.
 *
 * A multi-day event that began before the window still arrives: Home Assistant returns
 * anything OVERLAPPING the span, and `buildFlow` carries a running event into the first
 * day it draws.
 */
export const subscriptionWindow = (now: Date, window: DayWindow): SubscriptionWindow => {
  const day = Math.floor(now.getTime() / 86_400_000)
  const first = day + window.offsetDays
  return {
    start: new Date((first - 1) * 86_400_000),
    end: new Date((first + window.spanDays + 1) * 86_400_000),
    key: `${day}|${window.offsetDays}|${window.spanDays}`,
  }
}

// ---- The mapping ---------------------------------------------------------------

/**
 * One wire event as a row, or nothing if it cannot be drawn.
 *
 * Three things here are not obvious:
 *
 * **All-day keeps its `end`, and the end is exclusive.** Home Assistant says so in as
 * many words ("The date the all-day event should end (exclusive)") and proves it in
 * `CalendarEvent.__post_init__`, which rewrites a same-day all-day event to end the
 * following day because a zero-length duration is not valid. Passing that end through
 * untouched is what makes the rest work for free: a three-day trip that started
 * yesterday is still running, so `buildFlow` carries it into today, and a trip that
 * ended this morning is retired by `isOver` at the stroke of midnight. Translating it to
 * an inclusive last day, or dropping it as the fixtures do, breaks both.
 *
 * **Everything is `kind: 'event'`.** A reminder comes from a `todo` entity, which is
 * `todo-source.ts`'s subscription and not this one.
 *
 * **The id has to survive a re-render**, because `flow.ts` uses it as the keyed-render
 * identity. `uid` is the natural answer but it is optional on the wire (absent from
 * `demo`'s events, among others), and one uid covers every instance of a recurring
 * event, so the start is folded in to tell Tuesday's stand-up from Wednesday's.
 */
export const toCalendarItem = (
  event: CalendarEventPayload,
  entityId: string,
  color: string,
  timeZone: string | undefined,
): CalendarItem | undefined => {
  const start = parseWireDate(event.start, timeZone)
  if (!start) return undefined

  const title = typeof event.summary === 'string' ? event.summary : ''
  if (!title) return undefined

  const end = parseWireDate(event.end, timeZone)
  // `all_day` is the boolean Home Assistant derives from its own start being a date
  // rather than a datetime; the date-only string is the same fact on the wire. Either
  // one is enough, and taking both means an integration that sends only one still lands
  // on the single-line row it asked for.
  const allDay = event.all_day === true || isWireDateOnly(event.start)
  const location = typeof event.location === 'string' ? event.location : ''
  const uid = typeof event.uid === 'string' ? event.uid : ''

  return {
    id: `${entityId}|${uid || title}|${String(event.start)}`,
    entityId,
    kind: 'event',
    title,
    start,
    ...(end ? { end } : {}),
    ...(allDay ? { allDay: true } : {}),
    ...(location && !allDay ? { location } : {}),
    color,
  }
}

// ---- The subscriptions ---------------------------------------------------------

/**
 * Holds one subscription per calendar and reports the rows they push.
 *
 * Split out of the card because it is the only asynchronous thing in the library and
 * the card has enough to do. The rules it exists to keep:
 *
 *  - one subscription per calendar, since the command takes one entity;
 *  - the latest snapshot per calendar kept separately, since a push replaces one
 *    calendar's rows and must not disturb the others;
 *  - nothing torn down that has not moved. `setConfig` runs again on every keystroke of
 *    an edit, and the clock ticks every minute, so a reconcile that resubscribed
 *    unconditionally would thrash the socket for a living.
 */
export class CalendarFeed {
  private readonly _onChange: (items: CalendarItem[]) => void

  private readonly _snapshots = new Map<string, CalendarItem[]>()
  private readonly _colors = new Map<string, string>()

  /**
   * The live subscription per calendar, identified by the `token`.
   *
   * An identity rather than a counter, and that is the whole point of it. Two things
   * arrive late and have to be told apart from the current state of the world: the
   * unsubscribe handle, which `subscribeMessage` resolves a turn of the event loop after
   * the call, and every push, which arrives for as long as nobody has closed the socket.
   * A card can be dragged out of the DOM or re-pointed at other calendars in that gap.
   *
   * A single counter bumped per reconcile would not do: adding one calendar to the four
   * already subscribed would stamp the new one and leave the other four holding a number
   * that no longer matches, so they would go quietly deaf. Per-subscription identity
   * only ever invalidates the subscription it belongs to.
   */
  private readonly _live = new Map<string, { token: object; unsubscribe?: () => Promise<void> }>()

  /** What the live subscriptions were built for, so an unchanged reconcile is free. */
  private _windowKey = ''

  /** Bumped per reconcile, so a colour lookup overtaken by a later one is discarded. */
  private _revision = 0

  public constructor(onChange: (items: CalendarItem[]) => void) {
    this._onChange = onChange
  }

  /**
   * Point the feed at `entityIds` over `window`, doing as little as possible.
   *
   * A moved window invalidates every subscription (the span is baked into each one), so
   * that case starts over. An unchanged window only adds and drops the calendars that
   * changed, which is what keeps an edit in the entity picker from blanking the card the
   * user is looking at.
   */
  public async reconcile(
    hass: HomeAssistant,
    entityIds: readonly string[],
    window: SubscriptionWindow,
    timeZone: string | undefined,
  ): Promise<void> {
    const wanted = new Set(entityIds)

    if (window.key !== this._windowKey) {
      this._windowKey = window.key
      this._closeAll()
    } else {
      let dropped = false
      for (const entityId of [...this._live.keys()]) {
        if (wanted.has(entityId)) continue
        this._close(entityId)
        dropped = true
      }
      // Deselecting a calendar has to take its rows with it now, not whenever one of the
      // remaining calendars next happens to push. Nothing else would repaint: the
      // subscription that used to answer for those rows is the one just closed.
      if (dropped) this._publish()
      if (entityIds.every(id => this._live.has(id))) return
    }

    // Claimed before the first await, so a reconcile arriving in the gap sees them as
    // taken and does not open a second subscription to the same calendar. The token is
    // carried from here rather than read back later: by the time the subscribe runs, the
    // entry under this id may belong to a reconcile that came after this one.
    const claims = entityIds
      .filter(id => !this._live.has(id))
      .map(entityId => {
        const token = {}
        this._live.set(entityId, { token })
        return { entityId, token }
      })

    // Deliberately NOT a reason to abandon the rest of the reconcile. Only the colour
    // lookup can be overtaken; the calendars claimed above are this call's to subscribe,
    // and a later reconcile has already skipped them as taken. Returning here instead
    // would leave them claimed by nobody and permanently silent.
    await this._loadColors(hass, entityIds, (this._revision += 1))

    await Promise.all(
      claims.map(({ entityId, token }) => this._subscribe(hass, entityId, token, window, timeZone)),
    )
  }

  /** Called when the card leaves the DOM; safe to call when nothing is running. */
  public stop(): void {
    this._revision += 1
    this._windowKey = ''
    this._closeAll()
  }

  /**
   * Colours for the calendars we are about to subscribe to.
   *
   * The palette is laid down first and the stored colours go over it, so a calendar
   * without one keeps its position in the deck. `core/entity-color.ts` has where the
   * stored one comes from and why `hass.entities` cannot answer it; failure there is
   * swallowed, which leaves this holding the palette and drawing.
   *
   * Deliberately a fetch per reconcile rather than the `EntityColors` holder the to-do
   * lists use, and the difference is not laziness: this feed maps a row to a `CalendarItem`
   * as it arrives, so a colour landing later would have to re-map every snapshot on the
   * card rather than repaint. A colour edited in Home Assistant's settings dialog reaches
   * this card at the next window rollover or config edit. The lists get the live version
   * because `TodoFeed` maps at publish and can simply publish again.
   */
  private async _loadColors(
    hass: HomeAssistant,
    entityIds: readonly string[],
    revision: number,
  ): Promise<void> {
    this._colors.clear()
    entityIds.forEach((id, index) => this._colors.set(id, paletteColor(index)))

    if (!entityIds.length) return

    const stored = await fetchEntityColors(hass, entityIds)
    // Overtaken by a later reconcile, whose palette fill is already in place. Writing
    // this answer over it would colour the card for a calendar list it no longer has.
    if (revision !== this._revision) return

    for (const [entityId, color] of stored) this._colors.set(entityId, color)
  }

  private async _subscribe(
    hass: HomeAssistant,
    entityId: string,
    token: object,
    window: SubscriptionWindow,
    timeZone: string | undefined,
  ): Promise<void> {
    // Superseded before this even started: the colour lookup is awaited first, and a
    // window rollover in that gap closes every claim and makes fresh ones.
    if (this._live.get(entityId)?.token !== token) return

    try {
      const unsubscribe = await hass.connection.subscribeMessage<CalendarPush>(
        push => this._receive(entityId, push, timeZone, token),
        {
          type: 'calendar/event/subscribe',
          entity_id: entityId,
          // What the frontend sends, and `cv.datetime` takes it: UTC with a `Z`.
          start: window.start.toISOString(),
          end: window.end.toISOString(),
        },
      )

      // Superseded while the handle was in flight, so it is ours to close and nobody
      // else's: the entry in `_live` now belongs to a newer subscription, and writing
      // this handle onto it would strand that one with nothing to close it.
      const live = this._live.get(entityId)
      if (live?.token !== token) {
        await unsubscribe()
        return
      }
      live.unsubscribe = unsubscribe
    } catch (error) {
      // A rejection here is Home Assistant refusing the command, not a dropped
      // connection: `not_found` for a calendar that no longer exists, `invalid_format`
      // for one the schema will not take. The card carries on with the calendars that
      // did work; a config pointing at a deleted calendar should cost that calendar's
      // rows and nothing else.
      if (this._live.get(entityId)?.token === token) this._live.delete(entityId)
      console.warn(`[cupertino-widgets] cannot read ${entityId}`, error)
    }
  }

  private _receive(
    entityId: string,
    push: CalendarPush,
    timeZone: string | undefined,
    token: object,
  ): void {
    // A push from a subscription that has been closed or replaced. The socket can still
    // be delivering for it: an unsubscribe is itself a round trip.
    if (this._live.get(entityId)?.token !== token) return

    const events = push?.events
    if (!events) {
      // `{ events: null }`, which is how the subscription reports that the integration
      // failed to fetch. Not an error frame, and not the end of the subscription: the
      // next poll may well succeed, so the calendar is emptied rather than forgotten.
      this._snapshots.set(entityId, [])
      console.warn(`[cupertino-widgets] ${entityId} could not be read by Home Assistant`)
      this._publish()
      return
    }

    const color = this._colors.get(entityId) ?? paletteColor(0)
    const items: CalendarItem[] = []
    for (const event of events) {
      const item = toCalendarItem(event, entityId, color, timeZone)
      if (item) items.push(item)
    }

    this._snapshots.set(entityId, items)
    this._publish()
  }

  private _publish(): void {
    this._onChange([...this._snapshots.values()].flat())
  }

  private _close(entityId: string): void {
    const live = this._live.get(entityId)
    this._live.delete(entityId)
    this._snapshots.delete(entityId)
    // Nothing to do about a failed unsubscribe: the socket may already be gone, which
    // is the case that closed the subscription for us.
    void live?.unsubscribe?.().catch(() => {})
  }

  private _closeAll(): void {
    for (const entityId of [...this._live.keys()]) this._close(entityId)
    this._publish()
  }
}
