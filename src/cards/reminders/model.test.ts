import { describe, expect, it } from 'vitest'

import type { HassEntity, HomeAssistant } from '../../core/types/ha'
import {
  COMPLETED,
  NEEDS_ACTION,
  listCanComplete,
  listExists,
  listIcon,
  listName,
  listTarget,
  readItem,
  readItems,
  readStatus,
  type TodoItemPayload,
} from './model'

const entity = (
  entityId: string,
  state: string,
  attributes: Record<string, unknown> = {},
): HassEntity => ({
  entity_id: entityId,
  state,
  attributes,
  last_changed: '2026-07-24T09:41:00.000Z',
  last_updated: '2026-07-24T09:41:00.000Z',
})

/** Only `states` is ever read here, so only `states` is stood up. */
const withStates = (...entities: HassEntity[]): HomeAssistant =>
  ({
    states: Object.fromEntries(entities.map(one => [one.entity_id, one])),
  }) as unknown as HomeAssistant

const SHOPPING = 'todo.shopping'

/** A list as the entity registry has it: a name, an icon, and what it will let a card do. */
const aList = (attributes: Record<string, unknown>): HomeAssistant =>
  withStates(entity(SHOPPING, '3', attributes))

/**
 * One item as `todo/item/subscribe` pushes it, with every field the card reads present and
 * nothing else. The wire carries `description`, `due` and `completed` too; this module reads
 * none of them, and a builder that supplied them would suggest otherwise.
 */
const onTheWire = (payload: TodoItemPayload): TodoItemPayload => payload

describe('what a wire item becomes', () => {
  it('reads a summary, a uid and a status off the push', () => {
    const item = readItem(onTheWire({ summary: 'Buy milk', uid: 'a1', status: 'needs_action' }))
    expect(item).toEqual({ id: 'a1', title: 'Buy milk', status: NEEDS_ACTION })
  })

  /**
   * A row is a tick and a line of text, and `TodoItem.summary` is `str | None`, so an item with
   * nothing to print is not a row. Dropping it beats drawing an empty one, which would be a
   * tappable nothing.
   */
  it('is not a row at all when there is no summary to print', () => {
    expect(readItem(onTheWire({ uid: 'a1', status: 'needs_action' }))).toBeUndefined()
    expect(readItem(onTheWire({ summary: '', uid: 'a1' }))).toBeUndefined()
    expect(readItem(onTheWire({ summary: null, uid: 'a1' }))).toBeUndefined()
    expect(readItem(onTheWire({ summary: 42, uid: 'a1' }))).toBeUndefined()
  })

  /**
   * The id is what `todo.update_item` is addressed with, and that service resolves its `item`
   * field through `_find_by_uid_or_summary`. So a summary is a legitimate identity for a store
   * that keeps no uids: the service will accept it, where a synthesised id would tick nothing.
   */
  it('falls back to the summary for its id when the list keeps no uid', () => {
    expect(readItem(onTheWire({ summary: 'Buy milk' }))).toEqual({
      id: 'Buy milk',
      title: 'Buy milk',
      status: NEEDS_ACTION,
    })
    expect(readItem(onTheWire({ summary: 'Buy milk', uid: '' }))?.id).toBe('Buy milk')
    expect(readItem(onTheWire({ summary: 'Buy milk', uid: 7 }))?.id).toBe('Buy milk')
  })

  /** `status` is `Optional` on the dataclass, so an absent one is a shape core permits. */
  it('reads an item that said nothing about its status as something still to do', () => {
    expect(readItem(onTheWire({ summary: 'Buy milk', status: null }))?.status).toBe(NEEDS_ACTION)
    expect(readItem(onTheWire({ summary: 'Buy milk' }))?.status).toBe(NEEDS_ACTION)
    expect(readStatus(undefined)).toBe(NEEDS_ACTION)
    expect(readStatus('in_progress')).toBe(NEEDS_ACTION)
  })

  /** The one status that is not the fallback, and it has to survive: the linger needs it. */
  it('keeps a completed item rather than dropping it here', () => {
    const item = readItem(onTheWire({ summary: 'Buy milk', uid: 'a1', status: 'completed' }))
    expect(item).toEqual({ id: 'a1', title: 'Buy milk', status: COMPLETED })
  })
})

describe('a push, as rows', () => {
  it('keeps the list in the order it arrived in', () => {
    const rows = readItems([
      onTheWire({ summary: 'Water the plants', uid: 'c' }),
      onTheWire({ summary: 'Buy milk', uid: 'a' }),
      onTheWire({ summary: 'Ring the vet', uid: 'b' }),
    ])
    expect(rows.map(row => row.title)).toEqual(['Water the plants', 'Buy milk', 'Ring the vet'])
  })

  it('leaves out the items that were not rows, keeping the ones that were', () => {
    const rows = readItems([
      onTheWire({ summary: 'Buy milk', uid: 'a' }),
      onTheWire({ uid: 'b' }),
      onTheWire({ summary: 'Ring the vet', uid: 'c' }),
    ])
    expect(rows.map(row => row.id)).toEqual(['a', 'c'])
  })

  /**
   * A push is a socket callback, so anything that throws in it throws where nothing is waiting
   * to catch it. The guard costs one `Array.isArray` and is why `source.ts` can hand this a
   * payload straight off the wire.
   */
  it('comes to nothing for a payload that is not a list of items', () => {
    expect(readItems(undefined)).toEqual([])
    expect(readItems(null)).toEqual([])
    expect(readItems([])).toEqual([])
    expect(readItems({ items: [] } as unknown as TodoItemPayload[])).toEqual([])
  })
})

describe('the name and the glyph on the badge', () => {
  it('answers the list’s own name and icon', () => {
    const hass = aList({ friendly_name: 'Shopping', icon: 'mdi:cart' })
    expect(listName(hass, SHOPPING)).toBe('Shopping')
    expect(listIcon(hass, SHOPPING)).toBe('mdi:cart')
  })

  /**
   * Almost no list carries an icon: the `mdi:clipboard-list` the frontend draws a to-do list
   * with comes out of the domain's `icons.json` and is resolved frontend-side, so it never
   * reaches `attributes` and this fallback is where the badge's glyph has to come from.
   */
  it('falls back to the entity id and to the glyph the frontend uses everywhere else', () => {
    const hass = aList({})
    expect(listName(hass, SHOPPING)).toBe(SHOPPING)
    expect(listIcon(hass, SHOPPING)).toBe('mdi:clipboard-list')
  })

  /** A config outliving its list, and the card's first paint, which has no `hass` yet. */
  it('answers rather than throwing for a list that is not there', () => {
    expect(listName(withStates(), SHOPPING)).toBe(SHOPPING)
    expect(listIcon(withStates(), SHOPPING)).toBe('mdi:clipboard-list')
    expect(listName(undefined, SHOPPING)).toBe(SHOPPING)
    expect(listIcon(undefined, SHOPPING)).toBe('mdi:clipboard-list')
  })
})

/**
 * `TodoListEntityFeature.UPDATE_TODO_ITEM` is 4, and `todo.update_item` is registered with it as
 * a required feature: a list without it answers a tap with `ServiceNotSupported`, which is a red
 * toast rather than a tick. So the card asks first, exactly as Home Assistant's own to-do card
 * does before it enables its checkbox.
 */
describe('whether a tick may be offered at all', () => {
  it('reads the one bit it cares about out of the flags', () => {
    expect(listCanComplete(aList({ supported_features: 4 }), SHOPPING)).toBe(true)
    // CREATE | UPDATE, and the whole IntFlag a `local_todo` list reports.
    expect(listCanComplete(aList({ supported_features: 5 }), SHOPPING)).toBe(true)
    expect(listCanComplete(aList({ supported_features: 127 }), SHOPPING)).toBe(true)
  })

  /**
   * `?? 0` rather than a default of "yes": a list that has not said what it supports has not
   * said it supports this, and offering a checkbox that toasts is the worse failure.
   */
  it('says no for a list that has not said what it supports', () => {
    expect(listCanComplete(aList({}), SHOPPING)).toBe(false)
    expect(listCanComplete(aList({ supported_features: 0 }), SHOPPING)).toBe(false)
  })

  /** CREATE | DELETE | MOVE: a list that can be rearranged and still cannot be ticked off. */
  it('says no for flags that are set around it but not on it', () => {
    expect(listCanComplete(aList({ supported_features: 11 }), SHOPPING)).toBe(false)
    expect(listCanComplete(aList({ supported_features: 8 }), SHOPPING)).toBe(false)
  })

  it('says no when there is no list to ask', () => {
    expect(listCanComplete(aList({ supported_features: 4 }), undefined)).toBe(false)
    expect(listCanComplete(withStates(), SHOPPING)).toBe(false)
    expect(listCanComplete(undefined, SHOPPING)).toBe(false)
  })
})

/**
 * What the card draws its placeholder on. A widget naming a list that no longer exists is worse
 * than one saying it has none, so this is asked before anything else is drawn.
 */
describe('whether the list is there at all', () => {
  it('is true only for an entity `hass` actually has', () => {
    expect(listExists(aList({}), SHOPPING)).toBe(true)
    expect(listExists(withStates(), SHOPPING)).toBe(false)
    expect(listExists(aList({}), 'todo.deleted')).toBe(false)
  })

  it('is false for a config that named no list, and before there is a `hass`', () => {
    expect(listExists(aList({}), undefined)).toBe(false)
    expect(listExists(undefined, SHOPPING)).toBe(false)
  })
})

describe('the page behind the count, the name and the badge', () => {
  /**
   * The parameter is not a courtesy: `ha-panel-todo` opens whichever list was looked at last
   * (it keeps that in local storage) unless `entity_id` says otherwise, so without it a tap
   * opens a list rather than this list.
   */
  it('opens the to-do panel on this list rather than on the last one looked at', () => {
    expect(listTarget(SHOPPING)).toEqual({
      panel: 'todo',
      path: '/todo?entity_id=todo.shopping',
    })
  })

  /** The panel is named so `hass.panels` can be asked about it; see `core/navigate.ts`. */
  it('names a panel that is the key of `hass.panels`, so its absence can be checked', () => {
    expect(listTarget(SHOPPING).panel).toBe('todo')
    expect(listTarget(SHOPPING).path.startsWith('/todo')).toBe(true)
  })

  it('escapes an id that would otherwise break out of the query string', () => {
    // No real entity id needs it (the domain and object id are both `[a-z0-9_]`), and the
    // encoding is here so that the day something hands this a stranger id, the worst case is a
    // list that does not open rather than a URL with somebody else's parameters on it.
    expect(listTarget('todo.a&b=c').path).toBe('/todo?entity_id=todo.a%26b%3Dc')
  })
})
