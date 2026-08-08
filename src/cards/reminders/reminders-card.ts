import { mdiCheck } from '@mdi/js'
import {
  css,
  html,
  nothing,
  type CSSResultGroup,
  type PropertyValues,
  type TemplateResult,
} from 'lit'
import { state } from 'lit/decorators.js'

import { CupertinoCard, type CupertinoCardConfig } from '../../core/base-card'
import { cwNavigate } from '../../core/navigate'
import { registerCard } from '../../core/register'
import type { LovelaceCardEditor } from '../../core/types/ha'
import {
  NO_PINS,
  drawnStatus,
  listFor,
  nextExpiry,
  sweptPins,
  withPin,
  withoutPin,
  type PinSet,
  type ReminderRow,
} from './completion'
import { geometryFor, type ReminderView } from './layout'
import {
  COMPLETED,
  NEEDS_ACTION,
  listCanComplete,
  listExists,
  listIcon,
  listName,
  listTarget,
  type ReminderItem,
} from './model'
import { REMINDERS_EDITOR_TAG } from './reminders-card-editor'
import { ReminderFeed } from './source'

export const REMINDERS_CARD_TAG = 'cupertino-widgets-reminders'

export interface RemindersCardConfig extends CupertinoCardConfig {
  /**
   * The one to-do list this widget is about.
   *
   * One rather than many, and that is the design rather than a first version. The widget's
   * whole heading is a list's name over a count of its items, so a card over two lists
   * would have to be told what to call itself and what its number meant, and would open a
   * panel that can only ever show one of them anyway. Two lists are two cards, which is
   * also how the reference does it.
   *
   * Absent means the placeholder. It deliberately does not mean "every list", unlike the
   * calendar card's `todo_entities`: that card pours several lists into one flow, and this
   * one is a portrait of a single list.
   */
  entity?: string
}

/**
 * Not localised, like the rest of the library's own words: Home Assistant has no string for
 * either. The widget being copied says exactly the second one, and the first is the shape
 * the battery card's `No Devices` already gave a card with nothing to draw.
 */
const NO_LIST = 'No List'
const NO_REMINDERS = 'No Reminders'

/**
 * The tick inside a completed row's circle.
 *
 * Inlined from `@mdi/js` rather than handed to `<ha-icon>`, unlike the badge glyph above
 * it, and the difference is the row budget: `layout.ts` prices a row at its line box, and an
 * icon arriving a frame late out of Home Assistant's icon registry would be measured at the
 * wrong height. The badge is priced by nothing, so it can afford to wait.
 *
 * A whole `<svg>` in its own template, which is what keeps rule 11 satisfied without lit's
 * `svg` tag: the tag that has to be nested here is `<svg>` itself, and an `html` template
 * whose root is that creates the namespace for everything under it. It is a bare `<circle>`
 * or `<path>` at the root of a nested template that lands in the HTML namespace with every
 * presentation attribute ignored.
 */
const CHECK = html`
  <svg class="check" viewBox="0 0 24 24" aria-hidden="true">
    <path d=${mdiCheck} />
  </svg>
`

/**
 * The reminders widget: one to-do list, its count, and as many of its items as fit.
 *
 * The rules are in `layout.ts` (which of the three shapes, and how many rows),
 * `completion.ts` (what a tap does and what is drawn while it can be taken back),
 * `model.ts` (what a Home Assistant to-do list means) and `source.ts` (the subscription).
 * This class measures the box, owns the clock and the timer, and draws the answer. See
 * `docs/reminders-widget-rules.md`.
 */
class CupertinoRemindersCard extends CupertinoCard<RemindersCardConfig> {
  static override styles: CSSResultGroup = [
    CupertinoCard.styles,
    css`
      /* Every px in this stylesheet is a design unit multiplied by --cw-scale, and
         layout.ts holds the same numbers unscaled: it divides the measured box by the
         factor instead. The view is a class on .widget rather than a reflected attribute
         like cwLayout, because it and the row budget come out of one call to geometryFor
         in one render, and so cannot disagree about which shape is being drawn. */
      .widget {
        /* layout.ts prices its budget off this one and off the line boxes of the type
           below. Change any of them here and the arithmetic stops describing what gets
           drawn. */
        --cw-item-gap: calc(16px * var(--cw-scale));

        /* The wide card's left-hand column, and the space between it and the rows. A fixed
           width rather than a fraction: what the column holds is two lines of type, so the
           room they need is a property of the type and not of the card, and a fraction
           would re-wrap the name at every footprint. */
        --cw-lead-width: calc(80px * var(--cw-scale));
        --cw-lead-gap: calc(20px * var(--cw-scale));

        /* The reference's badge is a shade under a fifth of its small widget's width, and
           its glyph a little over half of that. The tick is the row's own height rather than
           a size of its own: the circle is the tallest thing on a row, so letting the two be
           one number is what keeps a row from being taller than anything in it. */
        --cw-badge-size: calc(32px * var(--cw-scale));
        --cw-tick-size: calc(24px * var(--cw-scale));

        flex: 1;
        min-height: 0;
        display: flex;
        gap: var(--cw-lead-gap);
        padding: var(--cw-inset);
      }

      .blank {
        align-items: center;
        justify-content: center;
      }

      /* The wide card's heading, and the only view where it is a column rather than a band:
         the badge at the top, the count and the name at the foot of it, which is the
         reference's arrangement and the one that leaves the rows the full height. */
      .lead {
        flex: none;
        width: var(--cw-lead-width);
        min-width: 0;
        display: flex;
        flex-direction: column;
        align-items: flex-start;
        justify-content: space-between;
        gap: var(--cw-item-gap);
      }

      .column {
        flex: 1;
        min-width: 0;
        min-height: 0;
        display: flex;
        flex-direction: column;
      }

      .head {
        flex: none;
        display: flex;
        align-items: flex-start;
        justify-content: space-between;
        gap: var(--cw-lead-gap);
      }

      /* The square has no rule under its heading, so the gap between rows is what separates
         it from the first of them. layout.ts prices exactly this. */
      .small .head {
        margin-bottom: var(--cw-item-gap);
      }

      .identity {
        display: flex;
        flex-direction: column;
        min-width: 0;
      }

      /* The square has no room to stack them, so it sets the two on one line: the name to
         the left, the count hard right. A reversed row rather than a reordered template, so
         that both arrangements are the same two elements in the same order and only the
         axis changes. */
      .small .identity {
        flex: 1;
        flex-direction: row-reverse;
        align-items: baseline;
        justify-content: space-between;
        gap: var(--cw-item-gap);
      }

      .count {
        font: var(--cw-text-title-1);
        color: var(--cw-label);
        /* So the numeral does not shift width between 8 and 11. */
        font-variant-numeric: tabular-nums;
        letter-spacing: -0.02em;
        /* Holds the line box while there is no number in it, which is the one round trip
           before the first snapshot arrives: an empty block has no line box of its own, and
           the heading would otherwise settle a row upward and back. */
        min-height: calc(34px * var(--cw-scale));
      }

      .small .count {
        font: var(--cw-text-headline);
        min-height: calc(22px * var(--cw-scale));
      }

      /* The one place the widget is coloured, and it is the reference's colour rather than
         the theme's: a to-do list has no colour anywhere in Home Assistant (there is no
         options.todo in the entity registry and none in the panel), so there is nothing to
         inherit, and --cw-accent would make the heading the user's primary colour, which is
         a different card in every installation. */
      .name {
        font: var(--cw-text-headline);
        color: var(--cw-purple);
      }

      .small .name {
        flex: 1;
      }

      /* Two lines and then stop: the wide card's column is 80 units, which is one line for
         most list names and two for the rest, and a name that took three would be pushing
         the count off the bottom of a column it shares. */
      .medium .name {
        white-space: normal;
        display: -webkit-box;
        -webkit-box-orient: vertical;
        -webkit-line-clamp: 2;
        line-clamp: 2;
      }

      .badge {
        flex: none;
        width: var(--cw-badge-size);
        height: var(--cw-badge-size);
        border-radius: var(--cw-radius-pill);
        background: var(--cw-purple);
        color: var(--cw-on-accent);
        display: flex;
        align-items: center;
        justify-content: center;
        /* The only handle ha-icon offers; it defaults to 24px, so a card that forgot this
           would draw the glyph larger than the disc it sits in. */
        --mdc-icon-size: calc(18px * var(--cw-scale));
      }

      /* Hugs the name a little more closely than it does the first row, which is the
         reference's spacing. layout.ts prices all three numbers. */
      .rule {
        flex: none;
        height: calc(1px * var(--cw-scale));
        margin: calc(8px * var(--cw-scale)) 0 calc(12px * var(--cw-scale));
        background: var(--cw-separator);
      }

      .list {
        flex: 1;
        min-height: 0;
        display: flex;
        flex-direction: column;
        gap: var(--cw-item-gap);
      }

      .item {
        display: flex;
        align-items: center;
        gap: calc(12px * var(--cw-scale));
        /* The row's box, and the number layout.ts budgets against. Taller than the title's
           22px line box on purpose: it is the tick's diameter, and the title is centred
           against the circle rather than the circle fitted to the title. */
        min-height: calc(24px * var(--cw-scale));
      }

      .tick {
        flex: none;
        box-sizing: border-box;
        width: var(--cw-tick-size);
        height: var(--cw-tick-size);
        border-radius: var(--cw-radius-pill);
        border: calc(1.5px * var(--cw-scale)) solid var(--cw-label-secondary);
        display: flex;
        align-items: center;
        justify-content: center;
        transition: background-color var(--cw-duration-fast) var(--cw-ease-out);
      }

      .item.done .tick {
        background: var(--cw-purple);
        border-color: var(--cw-purple);
      }

      .check {
        width: 68%;
        height: 68%;
        fill: var(--cw-on-accent);
      }

      .title {
        font: var(--cw-text-body);
        color: var(--cw-label);
      }

      /* Stepped back for the five seconds it is still there, so the row reads as done and
         going rather than as done and staying. */
      .item.done .title {
        color: var(--cw-label-secondary);
      }

      /* Secondary rather than tertiary: with nothing to draw this line is the whole of the
         card, so it has to be as readable as the content it stands in for. */
      .none {
        flex: 1;
        min-height: 0;
        display: flex;
        align-items: center;
        justify-content: center;
        font: var(--cw-text-callout);
        color: var(--cw-label-secondary);
      }

      @media (prefers-reduced-motion: reduce) {
        .tick {
          transition: none;
        }
      }
    `,
  ]

  /**
   * The items the subscription has pushed, or `undefined` before the first push.
   *
   * The two are told apart on purpose: an empty list is a card saying "nothing to do", and
   * no list yet is a card that does not know, which is the difference between drawing a `0`
   * and drawing nothing where the count goes. A `@state()` field written by a callback
   * needs no help from `watchedEntities()` to be seen: `shouldUpdate` waves through
   * anything that is not solely a `hass` swap, and this is not one.
   */
  @state() private _items: readonly ReminderItem[] | undefined = undefined

  /** What has been tapped and is still being held. See `completion.ts`. */
  @state() private _pins: PinSet = NO_PINS

  private readonly _feed = new ReminderFeed(items => {
    this._items = items
  })

  private _sweep: ReturnType<typeof setTimeout> | undefined

  /** The `custom:` prefix is load-bearing (see the calendar card's note on it). */
  public static getStubConfig(): RemindersCardConfig {
    return { type: `custom:${REMINDERS_CARD_TAG}` }
  }

  /**
   * As with the battery card, this is the only route to a working card short of writing
   * YAML: the widget draws its placeholder until it has been told which list. And a card
   * answering with nothing would lose its **Visibility** and **Layout** tabs as well.
   */
  public static getConfigElement(): LovelaceCardEditor {
    return document.createElement(REMINDERS_EDITOR_TAG) as LovelaceCardEditor
  }

  /**
   * Pointing the card at another list starts it over.
   *
   * The pins are keyed by item id, and an id from the list that was there before is either
   * meaningless on this one or, worse, matches something with the same summary. The
   * snapshot goes back to `undefined` for the same reason it starts there: the card does
   * not know this list's items yet, and drawing the old list's count over them for a round
   * trip would be a number about somebody else.
   */
  public override setConfig(config: RemindersCardConfig): void {
    const previous = this._config?.entity
    super.setConfig(config)

    if (config.entity !== previous) {
      this._items = undefined
      this._pins = NO_PINS
      this._scheduleSweep()
    }
  }

  /**
   * The one entity the card reads out of `hass`.
   *
   * The rows do not come from here at all, they arrive on the subscription; the name, the
   * badge's glyph, whether the list is there and whether it will accept a tick all do. Left
   * out, a rename or a list going unavailable would never reach the card, because `hass` is
   * replaced on every state change in the installation and `shouldUpdate` filters on
   * exactly this list.
   */
  protected override watchedEntities(): string[] {
    const entityId = this._config?.entity
    return entityId ? [entityId] : []
  }

  // ---- Lifecycle -----------------------------------------------------------

  public override connectedCallback(): void {
    super.connectedCallback()
    // A move in the DOM disconnects and reconnects the card without changing a single
    // reactive property, so no update runs and `willUpdate` never fires. This is the only
    // hook that sees it.
    void this._reconcileFeed()
    // And the timer that was cleared on the way out has to be put back, because a card
    // dragged from one section to another mid-linger keeps its pins. Without this the rows
    // they are holding come off on the next repaint for some other reason, rather than five
    // seconds after the tap, which is a widget that forgets what it promised.
    this._scheduleSweep()
  }

  public override disconnectedCallback(): void {
    clearTimeout(this._sweep)
    this._sweep = undefined
    this._feed.stop()
    super.disconnectedCallback()
  }

  protected override willUpdate(changed: PropertyValues): void {
    super.willUpdate(changed)
    if (changed.has('hass') || changed.has('_config')) void this._reconcileFeed()
  }

  private async _reconcileFeed(): Promise<void> {
    if (!this.hass) return
    await this._feed.reconcile(this.hass, this._config?.entity)
  }

  // ---- What a tap does -----------------------------------------------------

  /**
   * Open this list in the to-do panel.
   *
   * Two guards, and each is a different way of landing the user nowhere. The panel exists
   * only while its integration is loaded, which is the check `core/navigate.ts` documents
   * and the one that keeps a tap in the showcase (`panels: {}`) to its press effect. The
   * entity is the card's own: `ha-panel-todo` assigns a URL-supplied `entity_id` without
   * checking it exists, so a config that outlived its list would open the panel on nothing
   * at all, and that check is ours to make rather than the panel's.
   */
  private readonly _openList = (): void => {
    const entityId = this._config?.entity
    if (!entityId || !this.hass?.states[entityId]) return

    const target = listTarget(entityId)
    if (!this.hass.panels?.[target.panel]) return
    cwNavigate(target.path)
  }

  private readonly _openKey = (event: KeyboardEvent): void => {
    if (event.key !== 'Enter' && event.key !== ' ') return
    // Space scrolls the dashboard otherwise, and Enter would submit a form the card may be
    // sitting inside.
    event.preventDefault()
    this._openList()
  }

  /**
   * Tick an item off, or put it back.
   *
   * The call goes first and the pin is what holds the row: `completion.ts` has the whole
   * argument, and the short version is that the snapshot saying `completed` arrives before
   * `callService` resolves, so there is no window in which a card could sit on the change.
   *
   * The payload is `item` and `status` and nothing else. `todo.update_item` is a partial
   * update server-side (it starts from `asdict` of the item it found and overwrites only
   * what was sent), so a due date and a description this card never reads are left alone.
   * Home Assistant's own to-do card re-sends both along with the summary, which is the one
   * thing here that deliberately does not copy it: re-sending a field we did not read is
   * how a card corrupts one.
   *
   * A failure drops the pin, which puts the row back to whatever the list says. Nothing
   * else has to be undone, which is the point of the row being drawn from the pin in the
   * first place. `hass.callService` has already shown the user a toast by then and
   * re-thrown, so this only has the card's own state to put right.
   */
  private _toggle(item: ReminderItem): void {
    const entityId = this._config?.entity
    const hass = this.hass
    if (!entityId || !hass) return

    const now = Date.now()
    const wanted = drawnStatus(this._pins, item, now) === COMPLETED ? NEEDS_ACTION : COMPLETED

    this._pins = withPin(this._pins, item.id, wanted, now)
    this._scheduleSweep()

    void hass
      .callService(
        'todo',
        'update_item',
        { item: item.id, status: wanted },
        { entity_id: entityId },
      )
      .catch((error: unknown) => {
        this._pins = withoutPin(this._pins, item.id)
        this._scheduleSweep()
        console.warn(`[cupertino-widgets] cannot update ${entityId}`, error)
      })
  }

  /**
   * One timer for the whole card, set to the earliest pin's expiry.
   *
   * A timer per row would be a set of handles to lose track of when the card leaves the DOM
   * mid-linger; this one is cleared in `disconnectedCallback` and there is only ever the
   * one. The extra millisecond is for a timer that fires a hair early: `sweptPins` drops a
   * pin whose expiry has been *reached*, and a callback arriving just before it would find
   * nothing to drop, get the same set back (so no repaint) and reschedule for the same
   * moment.
   */
  private _scheduleSweep(): void {
    clearTimeout(this._sweep)
    this._sweep = undefined

    const next = nextExpiry(this._pins)
    if (next === undefined) return

    this._sweep = setTimeout(
      () => {
        this._sweep = undefined
        this._pins = sweptPins(this._pins, Date.now())
        this._scheduleSweep()
      },
      Math.max(0, next - Date.now()) + 1,
    )
  }

  // ---- Drawing -------------------------------------------------------------

  private _renderIdentity(name: string, count: number | undefined): TemplateResult {
    return html`
      <div
        class="identity cw-pressable"
        role="button"
        tabindex="0"
        title=${name}
        @click=${this._openList}
        @keydown=${this._openKey}
      >
        <div class="count">${count ?? nothing}</div>
        <div class="name cw-truncate">${name}</div>
      </div>
    `
  }

  /**
   * The round badge, and a second way to the same page.
   *
   * A tap target of its own rather than decoration, because it is one on the reference and
   * because an icon that looks like an app icon and does nothing is a small lie. It is a
   * second tab stop for the same destination, which is the ordinary shape of an icon and a
   * title both linking to the thing they name.
   */
  private _renderBadge(name: string, icon: string): TemplateResult {
    return html`
      <div
        class="badge cw-pressable"
        role="button"
        tabindex="0"
        aria-label=${`Open ${name}`}
        @click=${this._openList}
        @keydown=${this._openKey}
      >
        <ha-icon .icon=${icon}></ha-icon>
      </div>
    `
  }

  /**
   * One item.
   *
   * The row is the tap target rather than the circle inside it: a 24-unit circle is a
   * miss waiting to happen on a phone, and the reference takes the whole row too. A list
   * that will not accept an update is drawn without any of it, which is what Home
   * Assistant's own card does with its checkbox and is kinder than a control that answers
   * with a toast.
   *
   * `role="checkbox"` rather than `button`, because that is what it is: it has a state, the
   * state is announced, and Space is the key that toggles one.
   */
  private _renderRow(row: ReminderRow, live: boolean): TemplateResult {
    const classes = `item${row.done ? ' done' : ''}${live ? ' cw-pressable' : ''}`

    return html`
      <div
        class=${classes}
        title=${row.item.title}
        role=${live ? 'checkbox' : nothing}
        aria-checked=${live ? String(row.done) : nothing}
        tabindex=${live ? '0' : nothing}
        @click=${live ? () => this._toggle(row.item) : nothing}
        @keydown=${
          live
            ? (event: KeyboardEvent) => {
                if (event.key !== 'Enter' && event.key !== ' ') return
                event.preventDefault()
                this._toggle(row.item)
              }
            : nothing
        }
      >
        <div class="tick">${row.done ? CHECK : nothing}</div>
        <div class="title cw-truncate">${row.item.title}</div>
      </div>
    `
  }

  /**
   * The rows, or the one line that stands in for them.
   *
   * `empty` is asked about the whole list rather than about the rows handed over, and the
   * two are different in the corner where the budget came back with nothing: a box squashed
   * below one row still has items in it, and answering that with "No Reminders" would be the
   * card telling the user something false about their list because it could not draw it.
   * That box gets an empty column and is clipped by `ha-card`, which is the same failure the
   * battery card takes for the same reason.
   */
  private _renderList(rows: readonly ReminderRow[], live: boolean, empty: boolean): TemplateResult {
    if (empty) return html`<div class="none">${NO_REMINDERS}</div>`

    return html` <div class="list">${rows.map(row => this._renderRow(row, live))}</div> `
  }

  private _renderBlank(): TemplateResult {
    return html`
      <ha-card>
        <div class="widget blank"><div class="none">${NO_LIST}</div></div>
      </ha-card>
    `
  }

  protected override render(): TemplateResult | typeof nothing {
    if (!this._config) return nothing

    const entityId = this._config.entity
    // A config with no list, and a config pointing at one that is no longer there, are the
    // same card: there is nothing to name and nothing to count. Naming a deleted list over
    // an empty widget would be worse than admitting there is none.
    if (entityId === undefined || !listExists(this.hass, entityId)) return this._renderBlank()

    const geometry = geometryFor({ width: this.boxWidth, height: this.boxHeight }, this.scaleFactor)
    const list = listFor(this._items ?? [], this._pins, Date.now())
    const name = listName(this.hass, entityId)
    const badge = this._renderBadge(name, listIcon(this.hass, entityId))
    const identity = this._renderIdentity(name, this._items === undefined ? undefined : list.count)
    const view: ReminderView = geometry.view

    return html`
      <ha-card>
        <div class=${`widget ${view}`}>
          ${view === 'medium' ? html`<div class="lead">${badge}${identity}</div>` : nothing}
          <div class="column">
            ${
              view === 'medium'
                ? nothing
                : html`<div class="head">${identity}${view === 'large' ? badge : nothing}</div>`
            }
            ${view === 'large' ? html`<div class="rule"></div>` : nothing}
            ${this._renderList(
              list.rows.slice(0, geometry.rows),
              listCanComplete(this.hass, entityId),
              // Only once there is a snapshot to be empty. Before the first push the card
              // does not know the list is empty, and saying so for one round trip is a
              // statement it would have to take back.
              this._items !== undefined && list.rows.length === 0,
            )}
          </div>
        </div>
      </ha-card>
    `
  }
}

registerCard(REMINDERS_CARD_TAG, CupertinoRemindersCard, {
  name: 'Cupertino Reminders',
  description: 'A Cupertino-style widget for one of your to-do lists.',
})

export { CupertinoRemindersCard }
