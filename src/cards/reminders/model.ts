/**
 * One to-do list, and the items on it, as the widget understands them.
 *
 * The card draws four things it did not invent, and each has exactly one source in Home
 * Assistant. All four were read out of core 2026.7.4 and the frontend bundle that ships
 * with it rather than out of documentation; `docs/ha-api-notes.md` carries the notes.
 *
 *  - the **items**, over `todo/item/subscribe` (`source.ts`), which is the only way to have
 *    them: `TodoListEntity` defines no `state_attributes`, no `capability_attributes` and
 *    no `extra_state_attributes`, and none of core's twelve to-do platforms adds any, so
 *    the entity carries no item data at all;
 *  - the **name**, `attributes.friendly_name`;
 *  - the **glyph** on the round badge, `attributes.icon`. Almost no list has one: the
 *    `mdi:clipboard-list` the frontend draws a to-do list with everywhere else comes out of
 *    the domain's `icons.json` and is resolved frontend-side, so it never reaches
 *    `attributes` and the fallback below is where it has to come from;
 *  - whether a tick may be offered at all, `supported_features & UPDATE_TODO_ITEM`.
 *
 * What is deliberately NOT read here is the count. The entity's state is Home Assistant's
 * own count of the items still to do (`sum(item.status == NEEDS_ACTION)` on the entity, a
 * string on the wire), and `completion.ts` explains why the widget counts the snapshot it
 * is already drawing from instead.
 *
 * `due` is on the wire and is not read, which is the whole difference between this card and
 * the calendar's reminder rows: there, an item without a due date has no day to be filed
 * under and is dropped; here the list is the list, in the order its owner put it in, and a
 * date would be a second line the reference widget does not draw. `src/cards/calendar/` is
 * where a to-do item's date earns a row.
 */

import type { HomeAssistant } from '../../core/types/ha'

// ---- The wire ------------------------------------------------------------------

/**
 * One item as `todo/item/subscribe` pushes it.
 *
 * Typed as loosely as the calendar's `TodoItemPayload` and for the same reason: this is the
 * boundary, and a hand-written integration is on the other side of it. Deliberately a second
 * declaration rather than an import from `cards/calendar/todo-source.ts`, because the two
 * cards disagree about what an item *is*: that one reads `summary`, `uid`, `status` and
 * `due`, this one reads `summary`, `uid` and `status` and never looks at a date. One shared
 * interface would have to be the union of both, and would tell each card it has fields it
 * does not use. `description` and `completed` are on the wire as well and are read by
 * neither: the payload is `dataclasses.asdict` with no dict factory, so every field of
 * `TodoItem` is present and the unset ones are `null`.
 */
export interface TodoItemPayload {
  summary?: unknown
  uid?: unknown
  status?: unknown
}

/** What arrives on the subscription: a full snapshot of one list, never a delta. */
export interface TodoPush {
  items?: TodoItemPayload[] | null
}

// ---- The list ------------------------------------------------------------------

export const TODO_DOMAIN = 'todo.'

/** The to-do panel's key in `hass.panels`, which is also its `url_path`. */
const TODO_PANEL = 'todo'

/**
 * `TodoListEntityFeature.UPDATE_TODO_ITEM`, the one flag this card asks about.
 *
 * The service that ticks an item off is registered with
 * `required_features=[UPDATE_TODO_ITEM]`, so a list without it answers a tap with
 * `ServiceNotSupported`: a rejected promise and a ten-second red toast, because
 * `hass.callService` notifies before it re-throws. Home Assistant's own to-do card disables
 * its checkbox on exactly this flag instead, and that is the behaviour copied here.
 *
 * The other flags in the IntFlag, for whoever needs one: CREATE 1, DELETE 2, UPDATE 4,
 * MOVE 8, SET_DUE_DATE 16, SET_DUE_DATETIME 32, SET_DESCRIPTION 64.
 */
const UPDATE_TODO_ITEM = 4

/**
 * What Home Assistant draws a to-do list with when nothing else has said.
 *
 * Not from `@mdi/js` like the rest of the library's glyphs, because it is not handed to a
 * renderer here: it is a name passed to `<ha-icon>`, which resolves it out of Home
 * Assistant's own icon set, and that is also what makes a user's chosen icon work without
 * this card knowing anything about it.
 */
const DEFAULT_LIST_ICON = 'mdi:clipboard-list'

/** The name to put on the widget: the list's own, and the id when it has none yet. */
export const listName = (hass: HomeAssistant | undefined, entityId: string): string =>
  hass?.states[entityId]?.attributes.friendly_name ?? entityId

/** The glyph for the badge. See `DEFAULT_LIST_ICON` for why the fallback is not optional. */
export const listIcon = (hass: HomeAssistant | undefined, entityId: string): string =>
  hass?.states[entityId]?.attributes.icon ?? DEFAULT_LIST_ICON

/**
 * Whether the list is here at all.
 *
 * A config outliving the list it points at is the ordinary way this goes false, and the
 * card answers it with its placeholder rather than with a heading over nothing: a widget
 * naming a list that no longer exists is worse than one saying it has none.
 */
export const listExists = (
  hass: HomeAssistant | undefined,
  entityId: string | undefined,
): boolean => entityId !== undefined && hass?.states[entityId] !== undefined

/**
 * Whether this list will accept an item being ticked off.
 *
 * `?? 0` rather than a default of "yes": the attribute is set whenever the entity has a
 * value for it, and a list that has not said what it supports has not said it supports
 * this. Offering a checkbox that toasts is the worse failure.
 */
export const listCanComplete = (
  hass: HomeAssistant | undefined,
  entityId: string | undefined,
): boolean => {
  if (entityId === undefined) return false
  const features = hass?.states[entityId]?.attributes.supported_features ?? 0
  return (features & UPDATE_TODO_ITEM) !== 0
}

// ---- Where a tap on the heading goes -------------------------------------------

/**
 * The page behind the widget's name, count and badge: a panel to check for, and a path.
 *
 * The same shape and the same reasoning as the calendar card's `itemTarget`, and the same
 * destination for the same reason: `ha-panel-todo` reads `entity_id` out of the query
 * string on its first update and selects that list, and writes the parameter back when the
 * user picks another. Without it the panel opens whichever list was looked at last (it
 * keeps that in local storage under `selectedTodoEntity`), so the parameter is not a
 * courtesy, it is the difference between opening this list and opening a list.
 *
 * `panel` travels beside the path because a panel exists only while its integration is
 * loaded, and the check belongs at the call site: see `core/navigate.ts`.
 */
export interface ListTarget {
  panel: string
  path: string
}

export const listTarget = (entityId: string): ListTarget => ({
  panel: TODO_PANEL,
  path: `/${TODO_PANEL}?entity_id=${encodeURIComponent(entityId)}`,
})

// ---- An item -------------------------------------------------------------------

/**
 * The two statuses `TodoItemStatus` serialises to, verbatim off the `StrEnum`.
 *
 * The field is `Optional` on the dataclass, so an integration may omit it, and Home
 * Assistant's own card gives those items a section of their own headed "no status". Here an
 * item that has said nothing about itself is read as something still to do: it is on a
 * to-do list, which is the only claim the widget makes about it.
 */
export const NEEDS_ACTION = 'needs_action'
export const COMPLETED = 'completed'

export type ReminderStatus = typeof NEEDS_ACTION | typeof COMPLETED

export const readStatus = (value: unknown): ReminderStatus =>
  value === COMPLETED ? COMPLETED : NEEDS_ACTION

export interface ReminderItem {
  /**
   * The item's identity, doing three jobs at once, which is why it is one field.
   *
   * It is the keyed-render identity, it is the key the five-second linger pins on, and it
   * is what `todo.update_item` is addressed with. That last one is what decides its value:
   * the service resolves its `item` field through `_find_by_uid_or_summary`, which matches
   * `value in (item.uid, item.summary)`, so a uid when the store keeps one and the summary
   * when it does not are both things the service will accept.
   *
   * The failure it cannot avoid: two items with the same summary on a list that keeps no
   * uids are one identity here, and the service ticks off the first of them. `local_todo`
   * and every other core platform keep uids, so this is the shape of a hand-rolled
   * integration rather than of anything shipped.
   */
  id: string
  title: string
  status: ReminderStatus
}

/**
 * One wire item as a row, or nothing when there is no row in it.
 *
 * The only way out is an item with no summary. It is not a row because there would be
 * nothing on it: the widget draws a tick and a line of text, and `TodoItem.summary` is
 * `str | None` so an empty one is a shape the dataclass permits. A completed item is NOT
 * dropped here, unlike in the calendar card: the linger needs it, and `completion.ts` is
 * where an item stops being drawn.
 */
export const readItem = (payload: TodoItemPayload): ReminderItem | undefined => {
  const title = typeof payload.summary === 'string' ? payload.summary : ''
  if (!title) return undefined

  const uid = typeof payload.uid === 'string' ? payload.uid : ''

  return { id: uid || title, title, status: readStatus(payload.status) }
}

/** A push, as rows. Guarded against a payload that is not a list; see `source.ts`. */
export const readItems = (items: TodoItemPayload[] | null | undefined): ReminderItem[] => {
  if (!Array.isArray(items)) return []

  const rows: ReminderItem[] = []
  for (const payload of items) {
    const item = readItem(payload)
    if (item) rows.push(item)
  }
  return rows
}
