import { css, html, nothing, type CSSResultGroup, type TemplateResult } from 'lit'

import { CupertinoCard, type CupertinoCardConfig } from '../../core/base-card'
import { registerCard } from '../../core/register'
import type { LovelaceCardEditor } from '../../core/types/ha'
import { FULL_TURN } from '../../ui/gauge/geometry'
import { gaugeStyles, renderGauge } from '../../ui/gauge/gauge'
import { BATTERY_EDITOR_TAG } from './battery-card-editor'
import { gridFor, type BatteryView } from './layout'
import { readDevices, watchedIds, type BatteryDevice, type BatteryDeviceConfig } from './model'

export const BATTERY_CARD_TAG = 'cupertino-widgets-battery'

export interface BatteryCardConfig extends CupertinoCardConfig {
  /**
   * The devices to draw, in the order they are drawn.
   *
   * A row is an entity id, or an object when it has to carry more than one: see
   * `BatteryDeviceConfig`. Empty or absent means the placeholder, and it deliberately does
   * NOT mean "every battery in the installation": the calendar can show every calendar
   * because a calendar is a thing you want to see all of, while an installation's battery
   * sensors are every remote, every valve and every door contact, and no order over them is
   * the order somebody meant. So this is the one card in the library that asks a question
   * before it can draw anything.
   */
  entities?: (string | BatteryDeviceConfig)[]
}

/**
 * Not localised, like the rest of the library's own words: Home Assistant has no string
 * for it. The widget being copied says exactly this.
 */
const NO_DEVICES = 'No Devices'

/**
 * An em dash for a level that cannot be read, and it is doing a job the ring cannot.
 *
 * An empty track means 0% and it means "no reading", which are opposite facts about a
 * battery. The percentage is where they are told apart: `0%` against the dash, and it is
 * why a device with nothing to say is still given a ring.
 */
const LEVEL_DASH = '—'

/**
 * The bolt, and the one glyph in this library that does not come from `@mdi/js`.
 *
 * It is Material's own `Bolt`: the path Material Symbols ships and `@mui/icons-material`
 * re-exports, on the same 24-unit grid as MDI, taken verbatim from that package's
 * `Bolt.js`. Apache-2.0, which is compatible with this repository's licence, and one path
 * string rather than a dependency: `@mui/icons-material` is a React package of some ten
 * megabytes and this is the whole of what we want from it.
 *
 * MDI's own bolts were the obvious first answer and are not this shape. `mdiFlash` and
 * `mdiLightningBolt` are both harder-edged, with a flat top and a straight leading edge;
 * Material's tapers and kinks, which is what makes it read as a charging mark next to a
 * round gauge rather than as a hazard sign. Everything else about how it is drawn (inlined
 * rather than handed to `<ha-icon>`, so nothing waits on the icon registry) is the same
 * arrangement as the calendar's all-day badge.
 */
const BOLT_PATH =
  'M11 21h-1l1-7H7.5c-.58 0-.57-.32-.38-.66s.05-.08.07-.12C8.48 10.94 10.42 7.54 13 3h1l-1 ' +
  '7h3.5c.49 0 .56.33.47.51l-.07.15C12.96 17.55 11 21 11 21'

/**
 * How that bolt is centred in its badge.
 *
 * It inks x 7.1–17.5 and y 3–21, so its centre is (12.3, 12) rather than the grid's (12, 12):
 * the glyph leans right, and centring it on the nominal middle leaves the badge visibly
 * lopsided. Its furthest corner is 10.4 units from that centre, and 0.95 brings it to 9.9
 * inside a disc of radius 12: a bolt that fills the badge without its tips touching the rim.
 */
const BOLT = 'translate(12 12) scale(0.95) translate(-12.3 -12)'

/**
 * The charging badge: a bolt on a disc of the card's own surface.
 *
 * The disc is what makes it work at all. The badge sits at twelve o'clock, which is where
 * the arc starts, so a green bolt laid straight on it is invisible at exactly the moment it
 * matters most: a device left on the charger overnight, at 100%, whose arc runs all the way
 * round. Punching the surface through first costs a notch out of the arc and buys a badge
 * that reads at every level. It is drawn over the arc rather than replacing part of it, so
 * the length of the arc still means what it means.
 */
const CHARGING_BADGE = html`
  <svg class="bolt" viewBox="0 0 24 24" aria-hidden="true">
    <circle cx="12" cy="12" r="12" fill="var(--cw-surface)" />
    <path d=${BOLT_PATH} transform=${BOLT} fill="var(--cw-green)" />
  </svg>
`

/**
 * The battery widget: a ring per device, and a percentage under each when they fit on one
 * row.
 *
 * The rules are in `layout.ts` (how many rings, how big, captioned or not), `ui/gauge/` (the
 * arc, which this card is the first and so far the only consumer of) and `model.ts`
 * (what a Home Assistant state means). This class measures the box, asks those three, and
 * draws the answer. See `docs/battery-widget-rules.md`.
 */
class CupertinoBatteryCard extends CupertinoCard<BatteryCardConfig> {
  static override styles: CSSResultGroup = [
    CupertinoCard.styles,
    // The gauge draws the ring, and its stylesheet lands in this card's shadow root rather
    // than behind a shadow boundary of its own; `ui/gauge/gauge.ts` has the argument, and the
    // `.cell.unknown` rule at the bottom of this sheet is what it buys.
    gaugeStyles,
    css`
      /* Every px in this stylesheet is a design unit multiplied by --cw-scale, and
         layout.ts holds the same numbers unscaled: it divides the measured box by the
         factor instead. The one length that arrives already scaled is --cw-gauge-size,
         which the template sets from the grid: it is the only number this card and the
         gauge share, and it travels rather than being restated. */
      .widget {
        /* layout.ts prices the grid off these two and off the label's line box. Change one
           here and the arithmetic stops describing what gets drawn. */
        --cw-ring-gap: calc(14px * var(--cw-scale));
        --cw-ring-label-gap: calc(8px * var(--cw-scale));

        flex: 1;
        min-height: 0;
        display: flex;
        align-items: center;
        justify-content: center;
        padding: var(--cw-inset);
      }

      /* Exactly as wide as its widest row, which is what lets a short row be told where to
         sit inside it: with the grid shrunk to fit, a two-ring row and a one-ring row would
         both simply be centred and the grid's tail rule would have nothing to say. */
      .grid {
        display: flex;
        flex-direction: column;
        gap: var(--cw-ring-gap);
        width: max-content;
        max-width: 100%;
      }

      .row {
        display: flex;
        gap: var(--cw-ring-gap);
      }

      /* The ring's width, unless the caption under it is wider: a 40px ring with a full
         hundred per cent beneath it is a 61px cell. Taken from max-content rather than from
         a number, so the two never disagree about the type: layout.ts only has to keep a
         captioned column wide enough for the wider of them, which is its LABEL_WIDTH. */
      .cell {
        flex: none;
        display: flex;
        flex-direction: column;
        align-items: center;
        gap: var(--cw-ring-label-gap);
        width: var(--cw-gauge-size);
        min-width: max-content;

        /* **The ring is always green.** Not amber at 20 and not red at 5, and this is the
           design being copied rather than an omission: the level is read off the length of
           the arc, which is a quantity, and a colour that changed underneath it would be a
           second, coarser reading of the same number: one that says "low" at 19% and "fine"
           at 21% when the arc has already said 19 and 21. A widget of six devices in three
           colours also stops being a glance and becomes a thing to interpret. The traffic
           light belongs on the notification that fires at 20%, where it is about what to do
           rather than about what is. §7 of the card's rules is the same argument at length.

           It is declared here rather than in the gauge because it is this card's decision:
           the gauge draws in one colour at every value and has no opinion on which. */
        --cw-gauge-mark: var(--cw-green);
      }

      .bolt {
        --cw-bolt-size: calc(var(--cw-gauge-size) * 0.34);
        position: absolute;
        left: 50%;
        /* Centred on the stroke's centreline, which the gauge publishes rather than this
           card working it out from a stroke it no longer owns. Straddling it that way leaves
           about an eighth of the ring's width standing above the box, which the card's inset
           absorbs. */
        top: var(--cw-gauge-centerline);
        width: var(--cw-bolt-size);
        height: var(--cw-bolt-size);
        transform: translate(-50%, -50%);
      }

      /* 22px semibold, and it does not shrink for a three-digit reading, which is why
         layout.ts prices a captioned column against the width that reading needs. Tabular
         figures so the numeral does not shift between 9% and 90%. */
      .level {
        font: 600 calc(22px * var(--cw-scale)) / calc(28px * var(--cw-scale)) var(--cw-font);
        font-variant-numeric: tabular-nums;
        letter-spacing: -0.01em;
        white-space: nowrap;
        color: var(--cw-label);
      }

      /* A device that is not reporting: the icon and the dash both step back, so the ring
         reads as "nothing to say" rather than as "empty". Reaching into the gauge's own
         class, which is the whole point of it not having a shadow root of its own. */
      .cell.unknown .cw-gauge-glyph {
        opacity: 0.4;
      }

      .cell.unknown .level {
        color: var(--cw-label-secondary);
      }

      /* Secondary, not tertiary: with nothing configured this line is the entire card, so
         it has to be as readable as the content it stands in for. */
      .empty {
        font: var(--cw-text-callout);
        color: var(--cw-label-secondary);
      }
    `,
  ]

  /** The `custom:` prefix is load-bearing (see the calendar card's note on it). */
  public static getStubConfig(): BatteryCardConfig {
    return { type: `custom:${BATTERY_CARD_TAG}` }
  }

  /**
   * Worth more here than anywhere else in the library: this is the one card that draws
   * nothing at all until it has been told which devices, so the picker is not a convenience
   * but the only route to a working card short of writing YAML. And a card that answered
   * this with nothing would lose its **Visibility** and **Layout** tabs as well; see the
   * calendar card, where the contract is written up.
   */
  public static getConfigElement(): LovelaceCardEditor {
    return document.createElement(BATTERY_EDITOR_TAG) as LovelaceCardEditor
  }

  /**
   * Every entity the rendering reads, the charging sensors included.
   *
   * Derived on each call rather than cached: `setConfig` and this are the only two things
   * that know the config changed, and a list that went stale would filter out the states of
   * a device the user has just added.
   */
  protected override watchedEntities(): string[] {
    return watchedIds(this._config?.entities)
  }

  /**
   * Open the device's own more-info dialog.
   *
   * `hass-more-info` with an `entityId`, which is the event Home Assistant's own cards fire
   * for this (verified in the 2026.7.4 bundle rather than taken from documentation), and
   * `bubbles`/`composed` are what carry it out of this shadow root to the dashboard that
   * listens for it.
   *
   * A cell rather than the whole card, because the whole card has no single subject: six
   * devices behind one dialog would have to pick one of them, and picking the first is a
   * card that opens the wrong thing five times out of six.
   */
  private _openMoreInfo(entityId: string): void {
    this.dispatchEvent(
      new CustomEvent('hass-more-info', {
        detail: { entityId },
        bubbles: true,
        composed: true,
      }),
    )
  }

  /**
   * The ring, which is a gauge drawn the way a battery wants one.
   *
   * A full turn from twelve o'clock rather than the notched dial the shared component
   * defaults to, an arc rather than a dot, and a level that is already a percentage, so the
   * scale is the one the gauge assumes and is not passed. Everything else that used to be
   * here (the rotation, the dash, lit's `svg` tag and the reason for it) moved into
   * `ui/gauge/gauge.ts` with the drawing itself.
   */
  private _renderRing(device: BatteryDevice): TemplateResult {
    return renderGauge({
      value: device.level,
      sweep: FULL_TURN,
      mark: 'arc',
      glyph: device.icon,
      overlay: device.charging ? CHARGING_BADGE : nothing,
    })
  }

  /**
   * One device.
   *
   * The name is never drawn: it is the tooltip and the accessible name, and §6 of the rules
   * says why: six device names at a size that fits under a ring are six lines of truncated
   * text, and the icon inside the ring is already the answer to "which one is this".
   */
  private _renderCell(device: BatteryDevice, view: BatteryView): TemplateResult {
    const reading = device.level === null ? LEVEL_DASH : `${Math.round(device.level)}%`
    const unknown = device.level === null

    return html`
      <div
        class=${unknown ? 'cell cw-pressable unknown' : 'cell cw-pressable'}
        role="button"
        tabindex="0"
        title=${device.name}
        aria-label=${`${device.name}: ${unknown ? 'unavailable' : reading}`}
        @click=${() => this._openMoreInfo(device.id)}
        @keydown=${(event: KeyboardEvent) => {
          if (event.key !== 'Enter' && event.key !== ' ') return
          // Space scrolls the dashboard otherwise, and Enter would submit a form the card
          // may be sitting inside.
          event.preventDefault()
          this._openMoreInfo(device.id)
        }}
      >
        ${this._renderRing(device)}
        ${view === 'labeled' ? html`<div class="level">${reading}</div>` : nothing}
      </div>
    `
  }

  protected override render(): TemplateResult | typeof nothing {
    if (!this._config) return nothing

    const devices = readDevices(this.hass, this._config.entities)

    if (devices.length === 0) {
      return html`
        <ha-card>
          <div class="widget"><div class="empty">${NO_DEVICES}</div></div>
        </ha-card>
      `
    }

    // The scale goes in as a factor, not as scaled constants: `layout.ts` prices the grid in
    // design units and divides the box it was handed, so the rings shrink with the room
    // rather than either side restating the other's numbers.
    const grid = gridFor(
      this.cwLayout,
      devices.length,
      { width: this.boxWidth, height: this.boxHeight },
      this.scaleFactor,
    )

    const shown = devices.slice(0, grid.visible)
    const rows = Array.from({ length: grid.rows }, (_, index) =>
      shown.slice(index * grid.columns, (index + 1) * grid.columns),
    ).filter(row => row.length > 0)

    // `flex-start` rather than the shorter `start`: both are correct, and this is the
    // spelling every browser Home Assistant supports has always had.
    const tail = grid.tail === 'center' ? 'center' : 'flex-start'

    return html`
      <ha-card>
        <div class="widget" style=${`--cw-gauge-size: calc(${grid.ring}px * var(--cw-scale))`}>
          <div class="grid">
            ${rows.map(
              row => html`
                <div class="row" style=${`justify-content: ${tail}`}>
                  ${row.map(device => this._renderCell(device, grid.view))}
                </div>
              `,
            )}
          </div>
        </div>
      </ha-card>
    `
  }
}

registerCard(BATTERY_CARD_TAG, CupertinoBatteryCard, {
  name: 'Cupertino Batteries',
  description: 'A Cupertino-style battery widget for the devices you care about.',
})

export { CupertinoBatteryCard }
