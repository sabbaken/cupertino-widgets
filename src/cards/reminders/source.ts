/**
 * Where the rows come from: one `todo/item/subscribe` subscription, on one list.
 *
 * The protocol is written up on `src/cards/calendar/todo-source.ts`, which reads the same
 * socket for the calendar's reminder rows, and the notes behind both are in
 * `docs/ha-api-notes.md`. The four facts this file is built on:
 *
 *  - the command's schema is exactly `type` and one `entity_id` (`cv.entity_domain`), so a
 *    subscription is per list and there is nothing else to send;
 *  - there is no window. A to-do list has no span to ask for, so what arrives is the whole
 *    list, and nothing here has a clock in it;
 *  - each push is `{ items: [...] }`, a full snapshot of that list rather than a delta, so a
 *    push replaces the rows outright. Every mutation produces one, which is what the
 *    five-second linger is layered over rather than fighting (see `completion.ts`);
 *  - the subscribe handler pushes its first snapshot itself, after `send_result`, so there
 *    is nothing to await for data.
 *
 * This is the calendar's `TodoFeed` with the parts a one-list card does not need taken out,
 * rather than that class reused: gone are the per-list snapshot map, the positional palette
 * and the ordering key that goes with it, and the timezone, which leaves the entity id as
 * the only thing a reconcile has to compare. What is deliberately kept, line for line, is
 * the identity discipline, because none of it is optional at one list either: the
 * unsubscribe handle resolves a turn of the event loop after the call, pushes keep arriving
 * for as long as the socket is open, and a card can be dragged out of the DOM or re-pointed
 * at another list inside that gap.
 *
 * It also maps on the way in rather than at publish, which is the one place it differs from
 * `TodoFeed` on purpose: that one holds raw payloads because a row's colour depends on the
 * current list of lists, and a row here depends on nothing outside itself.
 */

import type { HomeAssistant } from '../../core/types/ha'
import { readItems, type ReminderItem, type TodoPush } from './model'

/**
 * The live subscription, identified by its `token`.
 *
 * The token is what tells "the subscription I opened" from "the subscription that is open
 * now", and the two are different objects whenever a reconcile lands while a subscribe is
 * still in flight.
 */
interface Live {
  entityId: string
  token: object
  unsubscribe?: () => Promise<void>
}

export class ReminderFeed {
  private readonly _onChange: (items: ReminderItem[]) => void

  private _live: Live | undefined

  public constructor(onChange: (items: ReminderItem[]) => void) {
    this._onChange = onChange
  }

  /**
   * Point the feed at `entityId`, doing as little as possible.
   *
   * Called on every `hass` swap and every config edit, so the unchanged case has to cost
   * nothing and in particular must not publish: a fresh array handed to the card would
   * repaint it on every state change in the installation, which is exactly what the card's
   * re-render filter exists to prevent.
   */
  public async reconcile(hass: HomeAssistant, entityId: string | undefined): Promise<void> {
    if (this._live?.entityId === entityId) return

    if (this._live) this._close()
    if (!entityId) {
      // The list was cleared out of the config. Its rows go with it, now rather than when
      // the next push does not arrive.
      this._onChange([])
      return
    }

    // Claimed before the first await, so a reconcile arriving in the gap sees it as taken.
    // The token travels with the claim because by the time the subscribe runs the entry may
    // belong to a later reconcile.
    const token = {}
    this._live = { entityId, token }

    try {
      const unsubscribe = await hass.connection.subscribeMessage<TodoPush>(
        push => this._receive(push, token),
        { type: 'todo/item/subscribe', entity_id: entityId },
      )

      // Superseded while the handle was in flight, so it is ours to close and nobody
      // else's; `_live` now belongs to a newer subscription, or to none.
      if (this._live?.token !== token) {
        await unsubscribe()
        return
      }
      this._live.unsubscribe = unsubscribe
    } catch (error) {
      // Home Assistant refusing the command rather than a dropped connection:
      // `invalid_entity_id` for a list that is not there, which is what a config pointing at
      // a deleted list looks like. It is a rejected command, not an error frame on a live
      // subscription, so there is nothing left open to tidy up.
      if (this._live?.token === token) this._live = undefined
      console.warn(`[cupertino-widgets] cannot read ${entityId}`, error)
      this._onChange([])
    }
  }

  /**
   * Called when the card leaves the DOM.
   *
   * Closes the subscription and publishes nothing, which is where this parts company with
   * the calendar's `TodoFeed.stop()`: that one has to clear its rows because a card can stop
   * its feed and stay on screen (it switches to fixtures), and this card has no such door.
   * Here the only caller is a card that is leaving, so there is nobody to tell, and holding
   * the last snapshot is what keeps a card that was merely dragged from one section to
   * another from flashing its placeholder before the resubscription lands.
   */
  public stop(): void {
    if (!this._live) return
    this._close()
  }

  private _receive(push: TodoPush, token: object): void {
    // A push from a subscription that has been closed or replaced. The socket can still be
    // delivering for it: an unsubscribe is itself a round trip.
    if (this._live?.token !== token) return

    // `{ items: null }` cannot happen (the handler is `[asdict(i) for i in todo_items or []]`,
    // with the `or []` inside the comprehension), and `readItems` guards anyway, at the cost
    // of one `Array.isArray`: a push is a socket callback, and a `for … of` over something
    // that turned out not to be a list would throw where nothing is waiting to catch it.
    this._onChange(readItems(push?.items))
  }

  private _close(): void {
    const live = this._live
    this._live = undefined
    // Nothing to do about a failed unsubscribe: the socket may already be gone, which is
    // the case that closed the subscription for us.
    void live?.unsubscribe?.().catch(() => {})
  }
}
