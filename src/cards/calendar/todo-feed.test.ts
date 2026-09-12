import { describe, expect, it } from 'vitest'

import type { HassEntity, HomeAssistant } from '../../core/types/ha'
import type { CalendarItem } from './model'
import { TodoFeed, type TodoPush } from './todo-source'

/**
 * `TodoFeed`, driven through a fake `hass` the way `feed.test.ts` drives `CalendarFeed`.
 *
 * Only the sequences the two feeds share a reason for: what a list's rows survive, when a
 * list is subscribed to again, and what a repeated push costs. Which lists there are and
 * what a row looks like are pure functions, tested beside them in `todo-source.test.ts`.
 */

const WARSAW = 'Europe/Warsaw'

/** One to-do in the wire shape, due on a day, with its summary standing in as its uid. */
const due = (summary: string): Record<string, unknown> => ({
  summary,
  uid: summary,
  status: 'needs_action',
  due: '2026-07-26',
  description: null,
  completed: null,
})

const entity = (entityId: string, state: string): HassEntity => ({
  entity_id: entityId,
  state,
  attributes: {},
  last_changed: '',
  last_updated: '',
})

interface Subscription {
  entityId: string
  push: (message: TodoPush) => void
  closed: boolean
}

const harness = () => {
  const subscriptions: Subscription[] = []
  const states: Record<string, HassEntity> = {}
  let items: readonly CalendarItem[] = []
  let publishes = 0

  const feed = new TodoFeed(next => {
    items = next
    publishes += 1
  })

  const hass = {
    states,
    // No list has a stored colour, so every row is dealt from the palette.
    async callWS() {
      return {}
    },
    connection: {
      async subscribeMessage(
        callback: (message: TodoPush) => void,
        message: Record<string, unknown>,
      ) {
        // The colour holder's registry watch rides the same connection and is not under test.
        if (message.type !== 'todo/item/subscribe') return async () => {}

        const subscription: Subscription = {
          entityId: String(message.entity_id),
          push: callback,
          closed: false,
        }
        subscriptions.push(subscription)
        return async () => {
          subscription.closed = true
        }
      },
    },
  } as unknown as HomeAssistant

  return {
    feed,
    subscriptions,
    reconcile: (entityIds: string[]): Promise<void> => feed.reconcile(hass, entityIds, WARSAW),
    live: () => subscriptions.filter(s => !s.closed),
    titles: () => items.map(item => item.title).sort(),
    publishes: () => publishes,
    set: (entityId: string, state: string) => {
      states[entityId] = entity(entityId, state)
    },
    remove: (entityId: string) => {
      delete states[entityId]
    },
  }
}

describe('a list that reloads', () => {
  /**
   * A config entry reload as a card sees it: `unavailable`, then back. The reminders are the
   * same either side, and taking them off in between was the card blinking.
   */
  it('keeps a list’s rows while it is unavailable', async () => {
    const h = harness()
    h.set('todo.chores', '1')
    h.set('todo.errands', '1')
    await h.reconcile(['todo.chores', 'todo.errands'])
    h.subscriptions[0]!.push({ items: [due('Hoover')] })
    h.subscriptions[1]!.push({ items: [due('Post office')] })

    h.set('todo.chores', 'unavailable')
    await h.reconcile(['todo.chores', 'todo.errands'])

    expect(h.titles()).toEqual(['Hoover', 'Post office'])
    expect(h.subscriptions[0]!.closed).toBe(true)
  })

  /** `TodoListEntity` has no removal hook, so the old listener hangs off an entity that is gone. */
  it('subscribes afresh when the list is back and swaps the rows on its first push', async () => {
    const h = harness()
    h.set('todo.chores', '1')
    await h.reconcile(['todo.chores'])
    h.subscriptions[0]!.push({ items: [due('Hoover')] })

    h.set('todo.chores', 'unavailable')
    await h.reconcile(['todo.chores'])
    h.set('todo.chores', '1')
    await h.reconcile(['todo.chores'])

    expect(h.subscriptions).toHaveLength(2)
    expect(h.live()).toHaveLength(1)
    expect(h.titles()).toEqual(['Hoover'])

    h.live()[0]!.push({ items: [due('Dust')] })
    expect(h.titles()).toEqual(['Dust'])
  })

  /** Deleted is not reloading, and the rows go at once. */
  it('takes the rows of a list that is gone from Home Assistant', async () => {
    const h = harness()
    h.set('todo.chores', '1')
    await h.reconcile(['todo.chores'])
    h.subscriptions[0]!.push({ items: [due('Hoover')] })

    h.remove('todo.chores')
    await h.reconcile(['todo.chores'])

    expect(h.titles()).toEqual([])
    expect(h.subscriptions[0]!.closed).toBe(true)
  })
})

describe('switching reminders off', () => {
  /** A reconcile onto no lists: the one close that is news to the reader. */
  it('takes every row and every subscription away', async () => {
    const h = harness()
    h.set('todo.chores', '1')
    await h.reconcile(['todo.chores'])
    h.subscriptions[0]!.push({ items: [due('Hoover')] })

    await h.reconcile([])

    expect(h.titles()).toEqual([])
    expect(h.live()).toHaveLength(0)
  })
})

describe('stop', () => {
  /** A card dragged between sections leaves the DOM and comes straight back. */
  it('closes the subscriptions and keeps the rows', async () => {
    const h = harness()
    h.set('todo.chores', '1')
    await h.reconcile(['todo.chores'])
    h.subscriptions[0]!.push({ items: [due('Hoover')] })

    h.feed.stop()

    expect(h.live()).toHaveLength(0)
    expect(h.titles()).toEqual(['Hoover'])
  })
})

describe('repeated snapshots', () => {
  /**
   * Core pushes the whole list on every state write, with no debounce, whether or not an item
   * moved. Each of those used to re-map every list on the card and repaint it.
   */
  it('publishes nothing for a push identical to the one on screen', async () => {
    const h = harness()
    h.set('todo.chores', '1')
    await h.reconcile(['todo.chores'])
    h.subscriptions[0]!.push({ items: [due('Hoover')] })
    const before = h.publishes()

    h.subscriptions[0]!.push({ items: [due('Hoover')] })

    expect(h.publishes()).toBe(before)
  })

  it('publishes a push that changed', async () => {
    const h = harness()
    h.set('todo.chores', '1')
    await h.reconcile(['todo.chores'])
    h.subscriptions[0]!.push({ items: [due('Hoover')] })
    const before = h.publishes()

    h.subscriptions[0]!.push({ items: [due('Hoover'), due('Dust')] })

    expect(h.publishes()).toBe(before + 1)
    expect(h.titles()).toEqual(['Dust', 'Hoover'])
  })
})
