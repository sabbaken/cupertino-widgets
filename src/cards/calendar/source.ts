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
 *    OVERLAPS it. `buildFlow` does the clipping, which is where it belongs;
 *  - a subscription does NOT outlive its entity. A config entry reload removes the entity
 *    object the listener hangs off and adds a new one without it, and nothing is sent to
 *    say so: the card sees the state go `unavailable` and come back, and has to subscribe
 *    again itself. Read in core's `dev` branch; `docs/ha-api-notes.md` has the lines.
 *
 * On the wire an event is `CalendarEvent.as_dict()`: `start`, `end`, `summary` and
 * `all_day` always present, `description` / `location` / `uid` / `recurrence_id` /
 * `rrule` omitted entirely when unset. `start` and `end` are PLAIN ISO STRINGS. The
 * nested `{ dateTime }` / `{ date }` form belongs to the REST endpoint, which the
 * frontend does not use and neither do we.
 */

import { fetchEntityColors } from '../../core/entity-color'
import type { HassEntity, HomeAssistant } from '../../core/types/ha'
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
 * The state an entity sits in while it cannot be read.
 *
 * `unavailable` and not `unknown`: a calendar with no current event sits at `off`/`unknown`
 * perfectly happily, and treating that as broken would hide every quiet calendar in the
 * installation. It is also what a reload looks like from a card: core writes it over an
 * entity whose integration is being unloaded (with `restored: true`, for anything in the
 * entity registry), and the new entity writes its real state over it once it is added.
 */
const UNAVAILABLE = 'unavailable'

/**
 * Whether an entity can be subscribed to right now. `todo-source.ts` asks the same question.
 *
 * Absent means Home Assistant has no such entity (a typo in the config, a deleted
 * integration), and asking would be refused on every reconcile, which the clock alone runs
 * once a minute. Unavailable is most often a reload in progress, when the entity object the
 * command looks up is gone and asking is refused too; when it is an integration failing to
 * poll instead, the card still has the rows it had and loses nothing by waiting.
 */
export const isSubscribable = (entity: HassEntity | undefined): boolean =>
  entity !== undefined && entity.state !== UNAVAILABLE

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
 * The last walk over `hass.states`, kept per states object.
 *
 * Discovery is asked on every `hass` swap, which is every state change anywhere in the
 * installation, and asked more than once per swap: by the re-render filter, again by the
 * reconcile behind it, and once more by each calendar card on the dashboard. The answer can
 * only move when the set of entities or the registry does, and the frontend replaces both
 * objects rather than editing them (`processEvent` in `home-assistant-js-websocket` spreads
 * the store into a new object per message, and `connection-mixin.ts` builds a new `entities`
 * per registry push), so their identity is a sound key and one walk serves every card. A
 * walk measured 0.1ms at 3,000 entities and 0.5ms at 10,000 on a laptop; a wall tablet is an
 * order of magnitude slower, and a busy installation swaps several times a second.
 *
 * A `WeakMap`, so a states object the frontend has moved on from takes its entry with it.
 */
const discovered = new WeakMap<object, { entities: object; ids: readonly string[] }>()

/**
 * Every calendar in the installation, in the order that decides their colours.
 *
 * In the calendar domain, not hidden in the entity registry, sorted by raw entity id: Home
 * Assistant's own `getCalendars` (read out of the 2026.7.4 bundle) less one of its three
 * predicates. That helper also drops a calendar whose state is `unavailable`, and this one
 * keeps it. The helper lists calendars for a panel to fetch from; this decides which
 * calendars a card holds rows for, and a reload is where the two part company. Filtered, a
 * calendar mid-reload took its rows off the card and put them back a moment later, which is
 * the card flickering every time an integration synced by reloading. Kept, it holds its rows
 * and its place in the deck, and `CalendarFeed` is what declines to subscribe until it is
 * back. The cost is a calendar that stays broken keeping a colour nobody sees.
 *
 * Shared between callers through `discovered`, hence read-only.
 */
export const discoverCalendars = (hass: HomeAssistant): readonly string[] => {
  const cached = discovered.get(hass.states)
  if (cached?.entities === hass.entities) return cached.ids

  const ids = Object.keys(hass.states)
    .filter(id => id.startsWith(CALENDAR_DOMAIN) && hass.entities[id]?.hidden !== true)
    .sort()
  discovered.set(hass.states, { entities: hass.entities, ids })
  return ids
}

/** What the card is actually going to subscribe to. */
export const calendarsFor = (
  value: unknown,
  hass: HomeAssistant | undefined,
): readonly string[] => {
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
 *    unconditionally would thrash the socket for a living;
 *  - a calendar's rows leave with the calendar and with nothing else. A subscription is
 *    closed for four reasons: the window moved, the card left the DOM, the calendar went
 *    unavailable, or it was deselected or deleted. Only the last is news to the reader, so
 *    the other three keep the snapshot on screen until the next subscription pushes over
 *    it. Emptying on every close was a blank card for a round trip at each of them, and a
 *    reload of the calendar's integration is the one that happens without anybody asking.
 */
export class CalendarFeed {
  private readonly _onChange: (items: CalendarItem[]) => void

  private readonly _snapshots = new Map<string, CalendarItem[]>()

  /**
   * What each snapshot was mapped from: the push as it arrived, with the colour and the zone
   * it was mapped in.
   *
   * Core re-sends the whole window on every state write to the entity, whether or not an
   * event moved (`docs/ha-api-notes.md` has the debounce), so the usual push is the previous
   * one again. Serialising it measured a twentieth of the cost of mapping it, and that is
   * before the repaint a fresh array hands the card.
   */
  private readonly _sources = new Map<string, string>()

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
   * A moved window closes every subscription, since the span is baked into each one, and
   * leaves every snapshot where it is. Then each calendar the feed holds anything for is
   * looked up in `hass.states`: deselected or gone takes its rows with it, unavailable closes
   * its subscription and keeps them. Whatever is wanted, there and not subscribed to, is
   * subscribed to, which is how a calendar coming back from a reload is picked up again.
   */
  public async reconcile(
    hass: HomeAssistant,
    entityIds: readonly string[],
    window: SubscriptionWindow,
    timeZone: string | undefined,
  ): Promise<void> {
    if (window.key !== this._windowKey) {
      this._windowKey = window.key
      for (const entityId of [...this._live.keys()]) this._unsubscribe(entityId)
    }

    const wanted = new Set(entityIds)
    let dropped = false
    for (const entityId of new Set([...this._snapshots.keys(), ...this._live.keys()])) {
      const entity = hass.states[entityId]
      if (!wanted.has(entityId) || !entity) {
        // Deselected, or deleted. The rows go now rather than whenever another calendar next
        // pushes: nothing else would repaint, since the subscription that answered for them
        // is the one being closed.
        this._unsubscribe(entityId)
        dropped = this._forget(entityId) || dropped
      } else if (!isSubscribable(entity)) {
        // A reload, most likely, and core does not end a subscription when it removes the
        // entity: the listener stays on the object being thrown away and nothing pushes on it
        // again. Closed here, so the claims below open a new one once the calendar is back.
        this._unsubscribe(entityId)
      }
    }
    if (dropped) this._publish()

    // Claimed before the first await, so a reconcile arriving in the gap sees them as
    // taken and does not open a second subscription to the same calendar. The token is
    // carried from here rather than read back later: by the time the subscribe runs, the
    // entry under this id may belong to a reconcile that came after this one.
    const claims = entityIds
      .filter(id => !this._live.has(id) && isSubscribable(hass.states[id]))
      .map(entityId => {
        const token = {}
        this._live.set(entityId, { token })
        return { entityId, token }
      })
    if (!claims.length) return

    // Deliberately NOT a reason to abandon the rest of the reconcile. Only the colour
    // lookup can be overtaken; the calendars claimed above are this call's to subscribe,
    // and a later reconcile has already skipped them as taken. Returning here instead
    // would leave them claimed by nobody and permanently silent.
    await this._loadColors(hass, entityIds, (this._revision += 1))

    await Promise.all(
      claims.map(({ entityId, token }) => this._subscribe(hass, entityId, token, window, timeZone)),
    )
  }

  /**
   * Called when the card leaves the DOM and while it draws fixtures; safe to call when
   * nothing is running.
   *
   * Closes every subscription, keeps every row and publishes nothing. The card is on its way
   * out or drawing something else, so there is nobody to tell, and a card that was only moved
   * in the DOM comes back through `reconcile` holding the rows it had rather than blank until
   * its new subscriptions push. Clearing the key is what makes that reconcile resubscribe.
   */
  public stop(): void {
    this._revision += 1
    this._windowKey = ''
    for (const entityId of [...this._live.keys()]) this._unsubscribe(entityId)
  }

  /**
   * Colours for the calendars we are about to subscribe to.
   *
   * The palette is laid down first and the stored colours go over it, so a calendar
   * without one keeps its position in the deck. `core/entity-color.ts` has where the
   * stored one comes from and why `hass.entities` cannot answer it; failure there is
   * swallowed, which leaves this holding the palette and drawing.
   *
   * Built to one side and swapped in whole once the lookup is back, rather than cleared
   * first. The clear opened a round trip in which every calendar already on screen had only
   * its palette colour, and a push landing inside it was mapped in that shade and kept it
   * until the calendar next pushed. Several calendars coming back from one reload each start
   * a lookup, so the gap was open exactly while their pushes were arriving. A calendar new to
   * the card is still dealt its palette colour up front, because a reconcile this one
   * overtook goes ahead with its subscribes and needs something to map in.
   *
   * Deliberately a fetch per reconcile that opens a subscription, rather than the
   * `EntityColors` holder the to-do lists use, and the difference is not laziness: this feed
   * maps a row to a `CalendarItem` as it arrives, so a colour landing later would have to
   * re-map every snapshot on the card rather than repaint. A colour edited in Home
   * Assistant's settings dialog reaches this card the next time a subscription is opened,
   * which is at least the window rollover. The lists get the live version because
   * `TodoFeed` maps at publish and can simply publish again.
   */
  private async _loadColors(
    hass: HomeAssistant,
    entityIds: readonly string[],
    revision: number,
  ): Promise<void> {
    const colors = new Map(entityIds.map((id, index) => [id, paletteColor(index)]))
    for (const [entityId, color] of colors) {
      if (!this._colors.has(entityId)) this._colors.set(entityId, color)
    }

    const stored = await fetchEntityColors(hass, entityIds)
    // Overtaken by a later reconcile, whose lookup is about the calendars the card has now.
    // Writing this answer over it would colour the card for a list it no longer holds.
    if (revision !== this._revision) return

    for (const [entityId, color] of stored) colors.set(entityId, color)
    this._colors.clear()
    for (const [entityId, color] of colors) this._colors.set(entityId, color)
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
      // connection: `not_found` for a calendar removed since the state that said it was
      // there, `invalid_format` for one the schema will not take. The card carries on with
      // the calendars that did work; one bad calendar should cost its own rows and nothing
      // else.
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
      // failed to fetch. Not an error frame, and not the end of the subscription: the next
      // poll may well succeed. The rows on screen are the last good read of this calendar,
      // and they stay; emptying them turned one failed poll into a blank card until the
      // next. A calendar that goes on failing keeps its last rows, and the clock retires
      // them as their times pass.
      console.warn(`[cupertino-widgets] ${entityId} could not be read by Home Assistant`)
      return
    }

    const color = this._colors.get(entityId) ?? paletteColor(0)
    const source = `${color}|${timeZone ?? ''}|${JSON.stringify(events)}`
    if (this._sources.get(entityId) === source) return

    const items: CalendarItem[] = []
    for (const event of events) {
      const item = toCalendarItem(event, entityId, color, timeZone)
      if (item) items.push(item)
    }

    this._snapshots.set(entityId, items)
    this._sources.set(entityId, source)
    this._publish()
  }

  private _publish(): void {
    this._onChange([...this._snapshots.values()].flat())
  }

  /** Close one calendar's subscription and leave its rows where they are. */
  private _unsubscribe(entityId: string): void {
    const live = this._live.get(entityId)
    if (!live) return
    this._live.delete(entityId)
    // Nothing to do about a failed unsubscribe: the socket may already be gone, which
    // is the case that closed the subscription for us.
    void live.unsubscribe?.().catch(() => {})
  }

  /** Take one calendar's rows off the card, answering whether it had any to take. */
  private _forget(entityId: string): boolean {
    this._sources.delete(entityId)
    return this._snapshots.delete(entityId)
  }
}
