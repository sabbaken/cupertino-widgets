/**
 * The to-do lists the reminders card is developed against, and the sets the harness points it
 * at.
 *
 * It lives here for the reason `battery-devices.ts` sets out at length: the card has no
 * fixture door and needs none. Everything it draws arrives from `hass.states` and from one
 * `todo/item/subscribe` subscription, both of which the harness already answers, so a fixture
 * is a mock entity, the items on it, and the config naming it. None of it ships in the bundle,
 * and there is no key on the card that a real dashboard could trip over.
 *
 * The rule that is this file's own: **a list's state is derived, never written.** A
 * `TodoListEntity`'s state is its own count of the items still needing action, as a string,
 * and the card's number comes from the snapshot it is drawing. Writing that count out by hand
 * beside a hand-written list of items is a number that disagrees with the rows under it the
 * first time either is edited, which is the failure `completion.ts` explains the card counting
 * for itself to avoid. Deriving it costs one `filter` and cannot drift.
 *
 * Two more, taken from the fixtures next door:
 *
 *  - **A neutral invented household**, as in `demo-data.ts`'s week: errands somebody would
 *    really keep a list of, a couple of them long enough to run out of row.
 *  - **One list per branch, not one per idea.** Four lists, and each is the shortest way to
 *    see one thing the card does: more items than any footprint draws, fewer than the smallest
 *    one holds, nothing left to do, and a list that will not accept a tick.
 */

import type { HassEntity } from '../src/core/types/ha'

// ---- The wire ------------------------------------------------------------------

/**
 * One item as `todo/item/subscribe` sends it: `dataclasses.asdict` of a `TodoItem`, so every
 * field is present and the unset ones are `null`.
 *
 * Written out here rather than imported from the card, which types the same payload as loosely
 * as it can because it is a boundary. A fixture is the other side of that boundary and has to
 * be exact: a fixture typed as loosely as the reader would only ever prove the card copes with
 * whatever this file happens to send. `mock-hass.ts` types the calendar's two lists with it as
 * well, so there is one description of the wire in the harness rather than two.
 */
export interface WireTodoItem {
  summary: string
  uid: string
  status: 'needs_action' | 'completed'
  /** On the wire, and read by nothing this card draws; see `item` below. */
  due: string | null
  description: string | null
  completed: string | null
}

/**
 * How many things are still to do, which is the whole of a to-do entity's state.
 *
 * `needs_action` rather than "anything not completed", because that is core's own sum and a
 * harness that were kinder than core would hide a real disagreement: an item whose status is
 * `null` is drawn by this card (`readStatus` reads silence as something still to do) and
 * counted by neither Home Assistant nor this. Every item below states its status, so the two
 * readings cannot part company here, and `mock-hass.ts` recounts with this after every tick.
 */
export const outstanding = (items: readonly WireTodoItem[]): number =>
  items.filter(item => item.status === 'needs_action').length

// ---- The lists -----------------------------------------------------------------

/** Frozen, like the battery sensors' stamps: nothing in the harness reads either. */
const STAMP = '2026-07-24T09:41:00.000Z'

/**
 * One thing still to do.
 *
 * `due` is `null` on every item in this file, and that is a decision and not an omission. The
 * reminders card never reads a date (`model.ts` says why: the list is the list, in its owner's
 * order), so a date here would be a field nothing on screen could show. The two lists that do
 * carry dates are the calendar card's, in `mock-hass.ts`, and they are on the same socket, so
 * the dated case is a list away rather than missing.
 */
const item = (uid: string, summary: string): WireTodoItem => ({
  summary,
  uid,
  status: 'needs_action',
  due: null,
  description: null,
  completed: null,
})

/** One already ticked off, by somebody or by an earlier session. */
const ticked = (uid: string, summary: string): WireTodoItem => ({
  ...item(uid, summary),
  status: 'completed',
  completed: STAMP,
})

export const HOME = 'todo.home'
export const ERRANDS = 'todo.errands'
export const PACKING = 'todo.packing'
export const SHARED = 'todo.shared'

/**
 * The items on each list, which are also the store `mock-hass.ts` serves the subscription
 * from and edits when something is ticked off.
 *
 * `home` is longer than any footprint the showcase offers draws, so the row budget can be
 * watched cutting it; `errands` is shorter than the smallest of them holds, which is the other
 * end of the same rule and the only way to see the list run out before the box does.
 *
 * `packing` is the trip in `demo-data.ts`, finished: every item completed, so the card counts
 * zero and draws its `No Reminders` line. An empty array would reach the same screen by an
 * easier road and would prove less, because it never asks the card to drop a completed item.
 */
export const REMINDER_ITEMS: Record<string, WireTodoItem[]> = {
  [HOME]: [
    item('home-1', 'Water the plants'),
    item('home-2', 'Book the car in for its service'),
    item('home-3', 'Take the recycling down to the bins'),
    item('home-4', 'Ask the caretaker for a second bike store key'),
    item('home-5', 'Descale the kettle'),
    item('home-6', 'Buy a birthday card for Marta'),
    item('home-7', 'Put the winter coats in the cellar and bring the fans up'),
    ticked('home-8', 'Pay the electricity bill'),
  ],
  [ERRANDS]: [
    item('errands-1', 'Post the parcel at Podwale 5, Warsawa'),
    item('errands-2', 'Collect the prescription'),
    item('errands-3', 'Return the library books'),
  ],
  [PACKING]: [
    ticked('packing-1', 'Print the train tickets to Poznań'),
    ticked('packing-2', 'Chargers and adapters'),
    ticked('packing-3', 'Ask Ola to feed the cat'),
    ticked('packing-4', 'Umbrella'),
  ],
  [SHARED]: [
    item('shared-1', 'Milk, bread and coffee'),
    item('shared-2', 'Find out the parcel locker code'),
    item('shared-3', 'Order a filter for the extractor hood'),
    item('shared-4', 'Return the ladder to the neighbours'),
  ],
}

/** Every `TodoListEntityFeature`, which is what a list kept by `local_todo` reports. */
const ALL_FEATURES = 127

/**
 * CREATE and DELETE, and so no UPDATE_TODO_ITEM: a list that can be added to and cleared out
 * but not ticked off, which is what `listCanComplete` turns down. The rows still get their
 * circles, because Home Assistant's own to-do card disables its checkboxes on this flag rather
 * than removing them; what they lose is the role, the tab stop and the handler, none of which
 * a screenshot can show, so this fixture is checked by looking at the DOM rather than at the
 * card.
 *
 * Three rather than nothing at all, deliberately. A list with no `supported_features`
 * attribute reaches the same screen through the `?? 0` default, and would leave the mask
 * itself untested: a card that had asked `supported_features !== undefined` would pass that
 * fixture and fail this one.
 */
const READ_ONLY_FEATURES = 3

const list = (
  entityId: string,
  name: string,
  attributes: Record<string, unknown> = {},
): HassEntity => ({
  entity_id: entityId,
  state: String(outstanding(REMINDER_ITEMS[entityId] ?? [])),
  attributes: { friendly_name: name, supported_features: ALL_FEATURES, ...attributes },
  last_changed: STAMP,
  last_updated: STAMP,
})

/**
 * The mock installation's to-do lists.
 *
 * `errands` publishes no icon, which is the common case rather than an unhappy one: the glyph
 * the frontend draws a to-do list with comes out of the domain's `icons.json` and never
 * reaches `attributes`, so almost every real list arrives here with nothing on it and the
 * card's `mdi:clipboard-list` fallback is what a visitor usually sees. The other three carry
 * one, because a badge that changed with the list is the reason the card reads the attribute
 * at all.
 */
export const REMINDER_STATES: readonly HassEntity[] = [
  list(HOME, 'Home', { icon: 'mdi:home' }),
  list(ERRANDS, 'Errands'),
  list(PACKING, 'Packing', { icon: 'mdi:bag-suitcase' }),
  list(SHARED, 'Shared list', {
    icon: 'mdi:account-multiple',
    supported_features: READ_ONLY_FEATURES,
  }),
]

// ---- What the showcase offers --------------------------------------------------

/**
 * The named lists the showcase's dropdown switches between, one entity id each.
 *
 * One and not a list of them, unlike the battery card's sets: this card is a portrait of a
 * single list, so the thing being chosen between is which list, and a set of one would be a
 * container invented for the sake of the symmetry.
 *
 * `none` is the empty string, and the catalog turns that into a config with no `entity` key
 * rather than one naming nothing. That is what a card looks like before it has been told
 * anything, and it is the only way to see the `No List` placeholder without deleting a fixture.
 */
export const REMINDER_LISTS: Record<string, string> = {
  home: HOME,
  errands: ERRANDS,
  packing: PACKING,
  shared: SHARED,
  none: '',
}

export const DEFAULT_REMINDER_LIST = 'home'

export const reminderList = (name: string): string =>
  REMINDER_LISTS[name] ?? REMINDER_LISTS[DEFAULT_REMINDER_LIST] ?? ''
