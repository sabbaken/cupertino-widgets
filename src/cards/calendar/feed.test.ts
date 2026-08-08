import { describe, expect, it } from 'vitest'

import type { HomeAssistant } from '../../core/types/ha'
import type { CalendarItem } from './model'
import { CalendarFeed, subscriptionWindow, type CalendarPush } from './source'

/**
 * The subscription controller, driven through a fake `hass`.
 *
 * The rest of the card is untested for the reason `vitest.config.ts` gives: there is no
 * DOM here. This file is the exception, though, since `HassConnection` is one method, so
 * the whole lifecycle is reachable from node. It is also the part with no pixels to check
 * it, and every rule it keeps is about a sequence rather than a value. A push arriving for a
 * calendar the user just deselected cannot be seen by looking at a screenshot.
 */

const WARSAW = 'Europe/Warsaw'
const NOW = new Date('2026-07-26T12:00:00+02:00')
const FORTNIGHT = { offsetDays: 0, spanDays: 14 }
const WINDOW = subscriptionWindow(NOW, FORTNIGHT)
/** A day later, so the window key moves: the midnight-rollover case. */
const NEXT_WINDOW = subscriptionWindow(new Date('2026-07-27T12:00:00+02:00'), FORTNIGHT)

const timed = (summary: string): Record<string, unknown> => ({
  summary,
  start: '2026-07-26T14:00:00+02:00',
  end: '2026-07-26T15:00:00+02:00',
  all_day: false,
})

interface Subscription {
  entityId: string
  start: string
  end: string
  push: (message: CalendarPush) => void
  closed: boolean
}

interface Harness {
  feed: CalendarFeed
  hass: HomeAssistant
  /** Every subscribe that was accepted, in the order it was made. */
  subscriptions: Subscription[]
  /** Entity ids the command was asked for, including the ones that were refused. */
  requested: string[]
  /** Held-open subscribe calls, when `defer` is on. */
  releases: (() => void)[]
  live: () => Subscription[]
  titles: () => string[]
  items: () => readonly CalendarItem[]
}

interface HarnessOptions {
  /** Entity ids the fake Home Assistant refuses, the way `not_found` does. */
  reject?: string[]
  colors?: Record<string, string>
  /** Hold the subscribe promises open, so the async gap can be driven by hand. */
  defer?: boolean
}

const harness = (options: HarnessOptions = {}): Harness => {
  const subscriptions: Subscription[] = []
  const requested: string[] = []
  const releases: (() => void)[] = []
  let items: readonly CalendarItem[] = []

  const feed = new CalendarFeed(next => {
    items = next
  })

  const hass = {
    async callWS(message: Record<string, unknown>) {
      if (message.type !== 'config/entity_registry/get_entries') return undefined
      const ids = message.entity_ids as string[]
      return Object.fromEntries(
        ids.map(id => {
          const color = options.colors?.[id]
          return [id, color ? { options: { calendar: { color } } } : null]
        }),
      )
    },
    connection: {
      async subscribeMessage(
        callback: (message: CalendarPush) => void,
        message: Record<string, unknown>,
      ) {
        const entityId = String(message.entity_id)
        requested.push(entityId)

        if (options.reject?.includes(entityId)) throw { code: 'not_found', message: entityId }

        if (options.defer) {
          await new Promise<void>(resolve => releases.push(resolve))
        }

        const subscription: Subscription = {
          entityId,
          start: String(message.start),
          end: String(message.end),
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
    hass,
    subscriptions,
    requested,
    releases,
    live: () => subscriptions.filter(s => !s.closed),
    titles: () => items.map(item => item.title),
    items: () => items,
  }
}

const reconcile = async (h: Harness, ids: string[], window = WINDOW): Promise<void> => {
  await h.feed.reconcile(h.hass, ids, window, WARSAW)
}

/**
 * Let the awaits inside a reconcile run without letting the deferred subscribe finish.
 *
 * There is a real await between `reconcile` being called and `subscribeMessage` being
 * reached (the colour lookup), so a test that released the deferred subscribes
 * immediately would release nothing and then wait forever for a call that had not
 * happened yet.
 */
const settle = async (): Promise<void> => {
  for (let turn = 0; turn < 5; turn += 1) await Promise.resolve()
}

describe('one subscription per calendar', () => {
  /**
   * `cv.entity_domain` takes exactly one entity, throwing "Expected exactly 1 entity, got 2"
   * otherwise, so a card showing three calendars really does open three subscriptions.
   */
  it('opens one per calendar, with the window on each', async () => {
    const h = harness()
    await reconcile(h, ['calendar.a', 'calendar.b', 'calendar.c'])

    expect(h.subscriptions.map(s => s.entityId)).toEqual(['calendar.a', 'calendar.b', 'calendar.c'])
    expect(h.subscriptions.every(s => s.start === WINDOW.start.toISOString())).toBe(true)
    expect(h.subscriptions.every(s => s.end === WINDOW.end.toISOString())).toBe(true)
  })

  /**
   * Every push is a FULL SNAPSHOT of one calendar. Merging them by replacing only that
   * calendar's rows is the whole reason the snapshots are kept apart.
   */
  it('keeps each calendar’s rows apart and merges them', async () => {
    const h = harness()
    await reconcile(h, ['calendar.a', 'calendar.b'])

    h.subscriptions[0]!.push({ events: [timed('A1'), timed('A2')] })
    h.subscriptions[1]!.push({ events: [timed('B1')] })
    expect(h.titles().sort()).toEqual(['A1', 'A2', 'B1'])

    // A second snapshot for A replaces A's rows and must leave B's alone.
    h.subscriptions[0]!.push({ events: [timed('A3')] })
    expect(h.titles().sort()).toEqual(['A3', 'B1'])
  })
})

describe('reconciling', () => {
  /**
   * The trap this exists for. `setConfig` runs again on every keystroke of an edit and
   * the clock ticks every minute, so a reconcile that resubscribed unconditionally would
   * thrash the socket and blank the card on every tick.
   */
  it('does nothing when nothing has moved', async () => {
    const h = harness()
    await reconcile(h, ['calendar.a'])
    h.subscriptions[0]!.push({ events: [timed('A1')] })

    await reconcile(h, ['calendar.a'])
    await reconcile(h, ['calendar.a'])

    expect(h.subscriptions).toHaveLength(1)
    expect(h.titles()).toEqual(['A1'])
  })

  /**
   * The bug a single generation counter would have caused: stamping the newcomer left
   * every calendar already subscribed holding a stale number, and they went deaf.
   */
  it('adds a calendar without disturbing the ones already running', async () => {
    const h = harness()
    await reconcile(h, ['calendar.a'])
    h.subscriptions[0]!.push({ events: [timed('A1')] })

    await reconcile(h, ['calendar.a', 'calendar.b'])

    expect(h.live()).toHaveLength(2)
    expect(h.titles()).toEqual(['A1'])

    // The point: the original subscription is still being listened to.
    h.subscriptions[0]!.push({ events: [timed('A2')] })
    h.subscriptions[1]!.push({ events: [timed('B1')] })
    expect(h.titles().sort()).toEqual(['A2', 'B1'])
  })

  it('drops a deselected calendar, its subscription and its rows', async () => {
    const h = harness()
    await reconcile(h, ['calendar.a', 'calendar.b'])
    h.subscriptions[0]!.push({ events: [timed('A1')] })
    h.subscriptions[1]!.push({ events: [timed('B1')] })

    await reconcile(h, ['calendar.a'])

    expect(h.titles()).toEqual(['A1'])
    expect(h.subscriptions[1]!.closed).toBe(true)
    expect(h.subscriptions[0]!.closed).toBe(false)
  })

  /**
   * A push can still arrive after an unsubscribe, because an unsubscribe is itself a
   * round trip. It must not put the calendar's rows back.
   */
  it('ignores a push from a subscription that has been closed', async () => {
    const h = harness()
    await reconcile(h, ['calendar.a', 'calendar.b'])
    h.subscriptions[0]!.push({ events: [timed('A1')] })
    await reconcile(h, ['calendar.a'])

    h.subscriptions[1]!.push({ events: [timed('B-late')] })

    expect(h.titles()).toEqual(['A1'])
  })

  /** The window is baked into each subscription, so a moved one invalidates them all. */
  it('rebuilds everything when the window rolls over midnight', async () => {
    const h = harness()
    await reconcile(h, ['calendar.a', 'calendar.b'])
    await reconcile(h, ['calendar.a', 'calendar.b'], NEXT_WINDOW)

    expect(h.subscriptions).toHaveLength(4)
    expect(h.subscriptions.slice(0, 2).every(s => s.closed)).toBe(true)
    expect(h.live().every(s => s.start === NEXT_WINDOW.start.toISOString())).toBe(true)
  })
})

describe('stop', () => {
  it('closes everything and forgets the rows', async () => {
    const h = harness()
    await reconcile(h, ['calendar.a'])
    h.subscriptions[0]!.push({ events: [timed('A1')] })

    h.feed.stop()

    expect(h.subscriptions[0]!.closed).toBe(true)
    expect(h.titles()).toEqual([])
  })

  /** A card dragged elsewhere in the dashboard disconnects and reconnects. */
  it('can be started again after stopping', async () => {
    const h = harness()
    await reconcile(h, ['calendar.a'])
    h.feed.stop()
    await reconcile(h, ['calendar.a'])

    expect(h.live()).toHaveLength(1)
    h.subscriptions.at(-1)!.push({ events: [timed('A1')] })
    expect(h.titles()).toEqual(['A1'])
  })

  it('is safe with nothing running', async () => {
    const h = harness()
    expect(() => h.feed.stop()).not.toThrow()
    await reconcile(h, [])
    expect(() => h.feed.stop()).not.toThrow()
  })
})

describe('the async gap', () => {
  /**
   * `subscribeMessage` resolves its unsubscribe handle a turn of the event loop after the
   * call. A card torn out of the DOM in that gap would otherwise be left holding a live
   * subscription with nothing to close it; that is the leak this guard exists for.
   */
  it('closes a handle that arrives after the card has gone', async () => {
    const h = harness({ defer: true })
    const pending = reconcile(h, ['calendar.a'])
    await settle()

    h.feed.stop()
    h.releases.forEach(release => release())
    await pending

    expect(h.subscriptions).toHaveLength(1)
    expect(h.subscriptions[0]!.closed).toBe(true)
    expect(h.titles()).toEqual([])
  })

  /** Two reconciles racing must not leave the same calendar subscribed twice. */
  it('does not subscribe twice when reconciles overlap', async () => {
    const h = harness({ defer: true })
    const first = reconcile(h, ['calendar.a'])
    const second = reconcile(h, ['calendar.a'])
    await settle()

    h.releases.forEach(release => release())
    await Promise.all([first, second])

    expect(h.requested).toEqual(['calendar.a'])
    expect(h.live()).toHaveLength(1)
  })

  /**
   * The reconcile that gets overtaken still owes its calendars a subscription.
   *
   * A second reconcile adding a calendar skips the ones the first already claimed (that
   * is what stops a double subscribe), so if the first then gave up on being
   * overtaken, those calendars would be claimed by nobody and stay silent for as long as
   * the card lived. Nothing would ever retry them: a later reconcile sees them as taken.
   */
  it('still subscribes the calendars it claimed after being overtaken', async () => {
    const h = harness({ defer: true })
    const first = reconcile(h, ['calendar.a', 'calendar.b'])
    const second = reconcile(h, ['calendar.a', 'calendar.b', 'calendar.c'])
    await settle()

    h.releases.forEach(release => release())
    await Promise.all([first, second])
    await settle()

    expect(
      h
        .live()
        .map(s => s.entityId)
        .sort(),
    ).toEqual(['calendar.a', 'calendar.b', 'calendar.c'])
    for (const subscription of h.live())
      subscription.push({ events: [timed(subscription.entityId)] })
    expect(h.titles().sort()).toEqual(['calendar.a', 'calendar.b', 'calendar.c'])
  })

  /**
   * A window rollover landing in the async gap replaces every claim. The subscribe still
   * in flight for the old window must close its own handle and not overwrite the new
   * one's, which is why the token is carried in rather than read back.
   */
  it('does not strand a subscription when the window rolls over mid-flight', async () => {
    const h = harness({ defer: true })
    const first = reconcile(h, ['calendar.a'])
    await settle()
    const second = reconcile(h, ['calendar.a'], NEXT_WINDOW)
    await settle()

    h.releases.forEach(release => release())
    await Promise.all([first, second])
    await settle()

    expect(h.subscriptions).toHaveLength(2)
    expect(h.live()).toHaveLength(1)
    const survivor = h.live()[0]!
    expect(survivor.start).toBe(NEXT_WINDOW.start.toISOString())

    survivor.push({ events: [timed('A1')] })
    expect(h.titles()).toEqual(['A1'])
  })
})

describe('failure', () => {
  /**
   * One bad entity id in the config (a calendar the user deleted) costs that
   * calendar's rows and nothing else. The alternative is a card that goes blank because
   * of a line the user forgot to remove.
   */
  it('carries on with the calendars that worked', async () => {
    const h = harness({ reject: ['calendar.gone'] })
    await reconcile(h, ['calendar.gone', 'calendar.a'])

    expect(h.requested).toEqual(['calendar.gone', 'calendar.a'])
    expect(h.live().map(s => s.entityId)).toEqual(['calendar.a'])

    h.subscriptions[0]!.push({ events: [timed('A1')] })
    expect(h.titles()).toEqual(['A1'])
  })

  /** A refused calendar must not be treated as claimed, or it is never retried. */
  it('retries a calendar that was refused', async () => {
    const h = harness({ reject: ['calendar.gone'] })
    await reconcile(h, ['calendar.gone'])
    await reconcile(h, ['calendar.gone'])

    expect(h.requested).toEqual(['calendar.gone', 'calendar.gone'])
  })

  /**
   * `{ events: null }` is how a failed fetch arrives: on the subscription, not as an
   * error. Emptied rather than forgotten: the next poll may well succeed.
   */
  it('empties a calendar that Home Assistant could not read', async () => {
    const h = harness()
    await reconcile(h, ['calendar.a', 'calendar.b'])
    h.subscriptions[0]!.push({ events: [timed('A1')] })
    h.subscriptions[1]!.push({ events: [timed('B1')] })

    h.subscriptions[0]!.push({ events: null })
    expect(h.titles()).toEqual(['B1'])

    h.subscriptions[0]!.push({ events: [timed('A2')] })
    expect(h.titles().sort()).toEqual(['A2', 'B1'])
  })

  it('survives a push with nothing in it at all', async () => {
    const h = harness()
    await reconcile(h, ['calendar.a'])
    expect(() => h.subscriptions[0]!.push({} as CalendarPush)).not.toThrow()
    expect(h.titles()).toEqual([])
  })
})

describe('colours', () => {
  it('prefers the colour the user set in Home Assistant', async () => {
    const h = harness({ colors: { 'calendar.b': 'red' } })
    await reconcile(h, ['calendar.a', 'calendar.b'])

    h.subscriptions[0]!.push({ events: [timed('A1')] })
    h.subscriptions[1]!.push({ events: [timed('B1')] })

    const byTitle = new Map(h.items().map(item => [item.title, item.color]))
    expect(byTitle.get('B1')).toBe('var(--red-color)')
    expect(byTitle.get('A1')).toBe('var(--cw-blue)')
  })

  /** Two calendars must not come out the same colour just because neither set one. */
  it('deals distinct palette colours when nobody set one', async () => {
    const h = harness()
    await reconcile(h, ['calendar.a', 'calendar.b'])
    h.subscriptions[0]!.push({ events: [timed('A1')] })
    h.subscriptions[1]!.push({ events: [timed('B1')] })

    const colors = h.items().map(item => item.color)
    expect(new Set(colors).size).toBe(2)
  })

  /**
   * The registry is a nicety, not a dependency. A card that refused to draw because it
   * could not learn a shade would be worse than one drawing the palette.
   */
  it('falls back to the palette when the registry cannot be read', async () => {
    const h = harness()
    ;(h.hass as unknown as { callWS: () => Promise<never> }).callWS = async () => {
      throw new Error('nope')
    }
    await reconcile(h, ['calendar.a'])

    h.subscriptions[0]!.push({ events: [timed('A1')] })
    expect(h.items()[0]?.color).toBe('var(--cw-blue)')
  })
})
