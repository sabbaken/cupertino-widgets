/**
 * The battery card's device list, as one control.
 *
 * A device is four things (which sensor, which icon, which charging sensor, what to call it),
 * and this draws each of them as one row of a sortable list: an `ha-expansion-panel`
 * carrying the four fields, with a drag handle beside it and a delete button in its summary.
 * A picker at the bottom adds the next one.
 *
 * ## Why an element of its own rather than `ha-form` rows
 *
 * `ha-form` can nest: a named `expandable` node draws a panel and its rows read an object
 * of their own (`docs/ha-api-notes.md` has the mechanism), and the card was built that way
 * first, with a multiple entity picker above the panels for adding and reordering. It worked
 * and it read as two controls for one list: the device's identity in the picker, the rest of
 * it in a panel further down, and a delete that meant unticking a checkbox somewhere else.
 * Nothing in `ha-form` can hang a handle or a bin off a panel, so the panels could never be
 * the list itself.
 *
 * Home Assistant hand-rolls this same element for its entities card
 * (`hui-entities-card-row-editor`), and everything below is borrowed from it: `ha-sortable`
 * around a wrapper the rows sit in, an `item-moved` event carrying two indices, an empty
 * picker as the add control (behind a button, as theirs is once the list is not empty), and
 * clearing a row's entity as the way to say delete. Its own rows open a dialog to be edited;
 * ours expand in place, which is the one departure and the reason this exists.
 *
 * ## What it may render
 *
 * Only elements Home Assistant has already defined by the time an editor is open:
 * `ha-sortable`, `ha-expansion-panel`, `ha-icon-button`, `ha-svg-icon`, `ha-icon` and
 * `ha-form` all ride in the `lovelace` panel's own chunk group, checked with the script in
 * `docs/ha-api-notes.md`. `ha-entity-picker` and `ha-icon-picker` do **not**: a bare
 * `<ha-entity-picker>` is an undefined element until something has caused its chunk to load,
 * and an undefined element renders as nothing at all, which looks like a bug in this file.
 *
 * Inside a device's panel that is somebody else's problem: those pickers are `ha-form` rows,
 * and `ha-selector` does the lazy import it exists to do. The **add** control is the one place
 * it matters, because what it wants is the picker's own `addButton` mode: a button that opens
 * the list on one press, which is a property of `ha-entity-picker` and cannot be reached
 * through a selector. So `_pickerReady` below waits for the definition rather than assuming
 * it, and until then the add control is the same picker as a plain field, through `ha-form`,
 * which is also the thing that causes the definition to arrive.
 */

import { mdiDrag, mdiTrashCanOutline } from '@mdi/js'
import { LitElement, css, html, nothing, type CSSResultGroup, type TemplateResult } from 'lit'
import { property, state } from 'lit/decorators.js'
import { repeat } from 'lit/directives/repeat.js'

import { defineElement } from '../../core/register'
import type { HaFormSchema, HomeAssistant } from '../../core/types/ha'
import {
  deviceRows,
  inheritedIcon,
  inheritedName,
  moveRow,
  readDevice,
  type BatteryDeviceConfig,
} from './model'

export const BATTERY_DEVICES_TAG = 'cupertino-widgets-battery-devices'

/** The event this element reports with. The detail is the whole list, in order. */
export interface DevicesChangedDetail {
  devices: (string | BatteryDeviceConfig)[]
}

/**
 * What both of the card's battery pickers offer, and a trade with a known loser.
 *
 * A list of every sensor in an installation is a haystack, so this asks for the device class
 * an integration that knows publishes. The cost is a battery percentage published without
 * one, which cannot be picked here at all; the card itself checks neither domain nor class,
 * so such a config is still a working one, and the helper line says where to write it.
 */
const BATTERY_FILTER = { domain: 'sensor', device_class: 'battery' } as const

/**
 * The four fields of one device.
 *
 * `entity` first because it is what the row *is*; the icon next because it is the one thing
 * on this card that says which device a ring belongs to; the name last because it is the
 * only one of the four that changes nothing on screen (§6 of the rules: it is the tooltip).
 *
 * The two placeholders are what the card would draw if the fields were left empty, so the
 * panel reads as "this is what you will get" rather than as a blank to be guessed at. They
 * are passed rather than left to `context: { icon_entity: … }`, which Home Assistant would
 * answer with the entity's *state* icon: for a battery sensor that is computed from the
 * level, so it would offer `mdi:battery-70` where this card draws `mdi:battery`.
 */
const deviceSchema = (
  hass: HomeAssistant | undefined,
  config: BatteryDeviceConfig,
  taken: readonly string[],
): readonly HaFormSchema[] => [
  {
    name: 'entity',
    required: true,
    // Every other device's sensor is left out of the list, so a row cannot be edited into
    // a duplicate of its neighbour. Its own is not excluded: `exclude_entities` hides
    // candidates rather than values, but a row that hid its own sensor would still be
    // showing it as the one thing the list denies exists.
    selector: {
      entity: {
        filter: BATTERY_FILTER,
        exclude_entities: taken.filter(entity => entity !== config.entity),
      },
    },
  },
  { name: 'icon', selector: { icon: { placeholder: inheritedIcon(hass, config.entity) } } },
  {
    name: 'charging_entity',
    selector: {
      entity: { filter: { domain: 'binary_sensor', device_class: 'battery_charging' } },
    },
  },
  { name: 'name', selector: { text: { placeholder: inheritedName(hass, config.entity) } } },
]

const LABELS: Record<string, string> = {
  entity: 'Battery sensor',
  icon: 'Icon',
  charging_entity: 'Charging sensor',
  name: 'Name',
}

/**
 * Not localised, like the rest of the library's own words: Home Assistant has a translated
 * string for a list of entities and none for any of this.
 */
const HELPERS: Record<string, string> = {
  icon: 'Says which device this is; the ring already says the level.',
  charging_entity:
    'A binary sensor that is on while this device is charging. Only needed when the ' +
    'battery sensor does not report it itself.',
  name: 'The tooltip and the screen-reader label. The card never draws it.',
}

const ADD_LABEL = 'Add a device'

const ADD_HELPER =
  'Pick a battery sensor and it joins the list. One already in the list is not offered ' +
  'again, and a sensor published without the battery device class is not offered at all; ' +
  'that one still works if you add it in YAML.'

class CupertinoBatteryDevices extends LitElement {
  /**
   * Home Assistant's own furniture, not ours: no `--cw-*` token appears here, for the
   * reason `CupertinoCardEditor` gives: a widget that looks like a phone's should still have
   * a config panel that looks like the dialog it is sitting in. The spacing scale, the
   * divider and the secondary text colour are all HA's.
   */
  static override styles: CSSResultGroup = css`
    :host {
      display: block;
    }

    .devices {
      display: flex;
      flex-direction: column;
      gap: 8px;
    }

    /* The handle and the panel side by side, aligned to the top rather than centred: the
       panel grows downwards when it is opened, and a handle that centred itself against an
       expanded panel would drift away from the row it drags. 48px is ha-expansion-panel's
       own summary height, so the handle sits against the middle of the summary line. */
    .device {
      display: flex;
      align-items: flex-start;
    }

    .handle {
      display: flex;
      align-items: center;
      height: 48px;
      padding-inline-end: 8px;
      color: var(--secondary-text-color);
      cursor: grab;
    }

    /* Otherwise a drag that starts on the glyph is a drag of the glyph, and the row stays
       where it is. */
    .handle > * {
      pointer-events: none;
    }

    ha-expansion-panel {
      flex: 1;
      min-width: 0;
    }

    ha-expansion-panel ha-icon {
      color: var(--secondary-text-color);
    }

    .remove {
      --ha-icon-button-size: 36px;
      color: var(--secondary-text-color);
    }

    .fields {
      display: block;
      padding: 8px 0 16px;
    }

    .add {
      margin-top: 16px;
    }

    /* The add control's own line, rather than the helper of whichever of the two controls is
       standing there: the button mode draws no helper, and a hint that came and went with the
       control would be a hint nobody reads. */
    .hint {
      margin: 6px 0 0;
      color: var(--secondary-text-color);
      font-size: 12px;
    }

    .empty {
      margin: 0 0 16px;
      color: var(--secondary-text-color);
      font-size: 13px;
    }
  `

  @property({ attribute: false }) public hass?: HomeAssistant

  /** Normalised by the editor, so every row here is known to have an entity in it. */
  @property({ attribute: false }) public devices: readonly BatteryDeviceConfig[] = []

  /**
   * Whether `ha-entity-picker` has been defined yet, and so whether the add control can be
   * the button.
   *
   * It resolves itself: the field this renders in the meantime is an `ha-form` whose entity
   * row makes `ha-selector` import the picker, so the definition arrives because of the
   * fallback. Read synchronously first, because on the second editor of a session it is
   * already there and the field should never be seen.
   */
  @state() private _pickerReady = customElements.get('ha-entity-picker') !== undefined

  /**
   * Which panels are open, by entity id.
   *
   * Held here rather than left to each `ha-expansion-panel`, because this element re-renders
   * from the config on every keystroke: an `expanded` that only lived in the panel would be
   * whatever the recycled DOM node happened to have. By entity id and not by position so a
   * dragged row keeps its panel open, which is also why the rows are keyed below.
   */
  private readonly _open = new Set<string>()

  protected readonly filter: { domain?: string | string[]; device_class?: string } = BATTERY_FILTER
  protected readonly allowDuplicates: boolean = false
  protected readonly addLabel: string = ADD_LABEL
  protected readonly addHelper: string = ADD_HELPER
  protected readonly emptyLabel: string = 'No devices yet. The card will say so too.'

  protected schema = deviceSchema
  protected normaliseRows = deviceRows
  protected summary: (
    hass: HomeAssistant | undefined,
    config: BatteryDeviceConfig,
  ) => { name: string; icon?: string; secondary?: string } = readDevice
  protected labels = LABELS
  protected helpers = HELPERS

  private _key(index: number): string {
    const entity = this.devices[index]?.entity ?? ''
    if (!this.allowDuplicates) return entity
    const ordinal = this.devices.slice(0, index).filter(row => row.entity === entity).length
    return `${entity}:${ordinal}`
  }

  private readonly _computeLabel = (schema: HaFormSchema): string =>
    this.labels[schema.name] ?? schema.name

  private readonly _computeHelper = (schema: HaFormSchema): string | undefined =>
    this.helpers[schema.name]

  private readonly _computeAddLabel = (): string => this.addLabel

  /**
   * Ask for the picker, once, and re-render as the button when it arrives.
   *
   * `whenDefined` cannot be relied on to settle by itself: nothing in Home Assistant loads
   * `ha-entity-picker` unless something asks for one, so the field this renders in the
   * meantime is not merely a fallback: it is what makes the promise resolve. If it somehow
   * never does, the field stays, which is a working control and was this editor's own
   * behaviour one version ago.
   */
  public override connectedCallback(): void {
    super.connectedCallback()
    if (this._pickerReady) return
    void customElements.whenDefined('ha-entity-picker').then(() => {
      this._pickerReady = true
    })
  }

  private _emit(rows: readonly unknown[]): void {
    this.dispatchEvent(
      new CustomEvent<DevicesChangedDetail>('devices-changed', {
        detail: { devices: this.normaliseRows(rows) },
        bubbles: true,
        composed: true,
      }),
    )
  }

  /**
   * One row's form reported. It carries the whole row, so it replaces the whole row.
   *
   * A row whose entity has been cleared is dropped rather than kept as a device with no
   * sensor (see `deviceRow`, and note that `deviceRows` would drop it anyway). Doing it here
   * as well is not belt-and-braces: it keeps `_open` from holding an id nothing will render.
   */
  private readonly _rowChanged = (
    event: CustomEvent<{ value: Record<string, unknown> }>,
    index: number,
  ): void => {
    event.stopPropagation()
    const value = event.detail.value
    const previous = this.devices[index]
    const next = [...this.devices]

    if (typeof value.entity !== 'string' || value.entity === '') {
      next.splice(index, 1)
      if (previous) this._open.delete(this._key(index))
    } else {
      next[index] = value as unknown as BatteryDeviceConfig
      // The panel stays open across the rename that a changed entity amounts to.
      if (previous && previous.entity !== value.entity && this._open.delete(this._key(index))) {
        const ordinal = next.slice(0, index).filter(row => row.entity === value.entity).length
        this._open.add(this.allowDuplicates ? `${value.entity}:${ordinal}` : value.entity)
      }
    }

    this._emit(next)
  }

  private readonly _remove = (event: Event, index: number): void => {
    // `ha-expansion-panel` toggles on any click inside its summary unless the event has
    // been defaulted away: `_toggleContainer` opens with `if (e.defaultPrevented) return`.
    // Without this the row would be deleted and the panel above it would open.
    event.preventDefault()
    event.stopPropagation()

    const going = this.devices[index]
    if (going) this._open.delete(this._key(index))
    const next = [...this.devices]
    next.splice(index, 1)
    this._emit(next)
  }

  private readonly _moved = (event: CustomEvent<{ oldIndex: number; newIndex: number }>): void => {
    event.stopPropagation()
    this._emit(moveRow(this.devices, event.detail.oldIndex, event.detail.newIndex))
  }

  /**
   * The native picker in `addButton` mode reports the id it was given, as a bare string.
   *
   * Nothing to reset afterwards: in that mode the picker passes `undefined` down as its
   * value whatever it holds, so it goes back to being a button by itself.
   */
  private readonly _addPicked = (event: CustomEvent<{ value?: string }>): void => {
    event.stopPropagation()
    this._addDevice(event.detail.value)
  }

  /** The same thing through the `ha-form` field, which reports the row as an object. */
  private readonly _addFromField = (
    event: CustomEvent<{ value: Record<string, unknown> }>,
  ): void => {
    event.stopPropagation()
    const entity = event.detail.value.entity
    this._addDevice(typeof entity === 'string' ? entity : undefined)
  }

  /**
   * Nothing happens for the empty value a cleared picker reports, and a duplicate is refused:
   * neither control offers one, and this is the rule behind that rather than a second guess
   * at it: two rings for one sensor is not something anybody means, and the rows are keyed by
   * entity id.
   *
   * The new device's panel opens itself, because a device that has just been added is the one
   * whose icon somebody is most likely about to set.
   */
  private _addDevice(entity: string | undefined): void {
    if (entity === undefined || entity === '') return
    const copies = this.devices.filter(device => device.entity === entity).length
    if (!this.allowDuplicates && copies > 0) return

    this._open.add(this.allowDuplicates ? `${entity}:${copies}` : entity)
    this._emit([...this.devices, { entity }])
  }

  private readonly _toggled = (event: CustomEvent<{ expanded: boolean }>, entity: string): void => {
    if (event.detail.expanded) this._open.add(entity)
    else this._open.delete(entity)
  }

  private _renderDevice(
    config: BatteryDeviceConfig,
    index: number,
    taken: readonly string[],
  ): TemplateResult {
    // Name and icon as the card is drawing them right now, overrides included, so a row is
    // recognisable in the editor by the same glyph it has on the widget.
    const device = this.summary(this.hass, config)
    const key = this._key(index)

    return html`
      <div class="device">
        <div class="handle">
          <ha-svg-icon .path=${mdiDrag}></ha-svg-icon>
        </div>
        <ha-expansion-panel
          outlined
          .header=${device.name}
          .secondary=${device.secondary ?? config.entity}
          .expanded=${this._open.has(key)}
          @expanded-changed=${(event: CustomEvent<{ expanded: boolean }>) =>
            this._toggled(event, key)}
        >
          <ha-icon slot="leading-icon" .icon=${device.icon}></ha-icon>
          <ha-icon-button
            slot="icons"
            class="remove"
            .path=${mdiTrashCanOutline}
            .label=${`Remove ${device.name}`}
            @click=${(event: Event) => this._remove(event, index)}
          ></ha-icon-button>
          <ha-form
            class="fields"
            .hass=${this.hass}
            .data=${config}
            .schema=${this.schema(this.hass, config, taken)}
            .computeLabel=${this._computeLabel}
            .computeHelper=${this._computeHelper}
            @value-changed=${(event: CustomEvent<{ value: Record<string, unknown> }>) =>
              this._rowChanged(event, index)}
          ></ha-form>
        </ha-expansion-panel>
      </div>
    `
  }

  protected override render(): TemplateResult | typeof nothing {
    if (!this.hass) return nothing

    // Battery excludes configured sensors; Gauge can read different aspects of one entity.
    const taken = this.allowDuplicates ? [] : this.devices.map(device => device.entity)

    return html`
      ${this.devices.length === 0 ? html`<p class="empty">${this.emptyLabel}</p>` : nothing}
      <!-- The wrapper is required rather than tidy: ha-sortable makes its FIRST child
           sortable, so without one the rows would not be the things being dragged. The rows
           are keyed by entity id so that a drag moves the row rather than rewriting every
           row's contents, which is what keeps an open panel open and the caret where it
           was. ha-sortable rolls its own DOM change back on drop and leaves the reordering
           to this render, so the key is the whole of what makes a drag land. -->
      <ha-sortable handle-selector=".handle" @item-moved=${this._moved}>
        <div class="devices">
          ${repeat(
            this.devices,
            (_, index) => this._key(index),
            (device, index) => this._renderDevice(device, index, taken),
          )}
        </div>
      </ha-sortable>
      <div class="add">
        ${
          this._pickerReady
            ? // Home Assistant's own add control, and the reason for the wait above: with
              // `add-button` the picker renders as a button whose press opens the list, all
              // inside the one element. Nothing here reaches into it: the filter, the
              // exclusions and the label are its own properties, and `includeDomains` /
              // `includeDeviceClasses` are the picker's spelling of the selector's `filter`.
              html`
                <ha-entity-picker
                  add-button
                  .hass=${this.hass}
                  .addButtonLabel=${this.addLabel}
                  .includeDomains=${[this.filter.domain].flat().filter(Boolean)}
                  .includeDeviceClasses=${this.filter.device_class ? [this.filter.device_class] : undefined}
                  .excludeEntities=${taken}
                  @value-changed=${this._addPicked}
                ></ha-entity-picker>
              `
            : html`
                <ha-form
                  .hass=${this.hass}
                  .data=${{}}
                  .schema=${[{ name: 'entity', selector: { entity: { filter: this.filter, exclude_entities: taken } } }]}
                  .computeLabel=${this._computeAddLabel}
                  @value-changed=${this._addFromField}
                ></ha-form>
              `
        }
        ${this.addHelper ? html`<p class="hint">${this.addHelper}</p>` : nothing}
      </div>
    `
  }
}

defineElement(BATTERY_DEVICES_TAG, CupertinoBatteryDevices)

export { CupertinoBatteryDevices }
