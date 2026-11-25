/**
 * Each tile owns a single entity. The grid can change shape as a unit while the
 * keyed buttons keep their identity, even when the dashboard is resized.
 */
import { mdiTuneVariant } from '@mdi/js'
import { css, html, nothing, type PropertyValues } from 'lit'
import { repeat } from 'lit/directives/repeat.js'
import { styleMap } from 'lit/directives/style-map.js'

import { CupertinoCard } from '../../core/base-card'
import { pickerState } from '../../core/picker-state'
import { registerCard } from '../../core/register'
import type { HassEntity, HomeAssistant } from '../../core/types/ha'
import { baseStyles } from '../../theme/base-styles'
import { controlsStateColor, tokens } from '../../theme/tokens'
import { CONTROLS_SPACING, controlsGrid } from './layout'
import {
  controlsActive,
  controlsAreaId,
  controlsEntities,
  controlsState,
  type ControlsConfig,
} from './model'
import { CONTROLS_EDITOR_TAG } from './controls-editor'
import { controlsRecommendations } from './recommendations'

export const CONTROLS_CARD_TAG = 'cupertino-widgets-controls'

const PICKER_CONTROLS = [
  {
    area: 'Study',
    state: pickerState('light.cw_picker', 'on', {
      friendly_name: 'Desk lamp',
      icon: 'mdi:desk-lamp',
      brightness: 192,
    }),
  },
  {
    area: 'Bedroom',
    state: pickerState('fan.cw_picker', 'off', { friendly_name: 'Fan', icon: 'mdi:fan' }),
  },
  {
    area: 'Living room',
    state: pickerState('cover.cw_picker', 'open', {
      friendly_name: 'Blinds',
      icon: 'mdi:blinds-open',
    }),
  },
  {
    area: 'Kitchen',
    state: pickerState('switch.cw_picker', 'off', {
      friendly_name: 'Coffee maker',
      icon: 'mdi:coffee-maker',
    }),
  },
]
const PICKER_BY_ID = new Map(PICKER_CONTROLS.map(control => [control.state.entity_id, control]))
const PICKER_IDS = [...PICKER_BY_ID.keys()]

const TOGGLE_CONFIRMATION_MS = 5_000

interface PendingToggle {
  from: 'on' | 'off'
  to: 'on' | 'off'
  timer: ReturnType<typeof setTimeout>
}

class CupertinoControlsCard extends CupertinoCard<ControlsConfig> {
  static override styles = [
    tokens,
    baseStyles,
    css`
      :host(:not([dark])) ha-card {
        background-color: var(--cw-controls-surface);
      }

      .grid {
        flex: 1 1 0;
        min-height: 0;
        display: grid;
        padding: var(--cw-controls-spacing);
        gap: var(--cw-controls-spacing);
        grid-template-rows: repeat(var(--cw-controls-rows), minmax(0, 1fr));
        grid-template-columns: repeat(var(--cw-controls-columns), minmax(0, 1fr));
        align-content: start;
        overflow: clip;
      }

      button {
        min-width: 0;
        box-sizing: border-box;
        border: 0;
        /* The inset starts at the inside of the card's border. */
        --cw-tile-radius: max(
          0px,
          calc(var(--cw-radius) - var(--cw-card-border-width) - var(--cw-controls-spacing))
        );
        border-radius: var(--cw-tile-radius);
        @supports (corner-shape: superellipse(1.3)) {
          corner-shape: superellipse(1.3);
        }

        @supports (not (corner-shape: superellipse(1.3))) and (clip-path: shape(from 0 0, close)) {
          /* A cubic corner keeps the curve on browsers that support shape() first. */
          border-radius: 0;
          --cw-corner: min(var(--cw-tile-radius), 50%);
          --cw-corner-handle: calc(var(--cw-corner) * 0.32);
          clip-path: shape(
            from var(--cw-corner) 0,
            line to calc(100% - var(--cw-corner)) 0,
            curve to 100% var(--cw-corner) with calc(100% - var(--cw-corner-handle)) 0 / 100%
              var(--cw-corner-handle),
            line to 100% calc(100% - var(--cw-corner)),
            curve to calc(100% - var(--cw-corner)) 100% with 100%
              calc(100% - var(--cw-corner-handle)) / calc(100% - var(--cw-corner-handle)) 100%,
            line to var(--cw-corner) 100%,
            curve to 0 calc(100% - var(--cw-corner)) with var(--cw-corner-handle) 100% / 0
              calc(100% - var(--cw-corner-handle)),
            line to 0 var(--cw-corner),
            curve to var(--cw-corner) 0 with 0 var(--cw-corner-handle) / var(--cw-corner-handle) 0,
            close
          );
        }

        padding: calc(4px * var(--cw-scale)) calc(7px * var(--cw-scale));
        background: var(--cw-fill);
        color: var(--cw-label);
        font: var(--cw-text-caption-1);
        text-align: start;
        display: flex;
        align-items: center;
        gap: calc(5px * var(--cw-scale));
        overflow: hidden;
        touch-action: pan-y;
        user-select: none;
        -webkit-touch-callout: none;
      }

      button.active {
        background: var(--cw-controls-active-surface);
        color: var(--cw-controls-active-label);
      }

      .rectangle button {
        padding-inline: calc(10px * var(--cw-scale));
        gap: calc(8px * var(--cw-scale));
      }

      .square button {
        --cw-tile-radius: var(--cw-radius);
        /* Keep space for a 24px icon and two 16px lines in denser grids. */
        padding-block: clamp(
          0px,
          calc((var(--cw-controls-tile-height) - 56px * var(--cw-scale)) / 2),
          var(--cw-inset)
        );
        padding-inline: min(var(--cw-inset), calc(var(--cw-controls-tile-height) / 5));
        gap: 0;
        flex-direction: column;
        align-items: stretch;
        justify-content: space-between;
      }

      .square.icon-only button {
        align-items: center;
        justify-content: center;
      }

      .square.icon-only .icon {
        align-self: center;
      }

      button:focus-visible {
        border-radius: var(--cw-tile-radius);
        outline-offset: -2px;
      }

      .icon {
        flex: none;
        align-self: flex-start;
        display: flex;
        max-width: 100%;
        color: var(--cw-controls-inactive-icon);
      }

      button.active .icon,
      button.unavailable .icon {
        color: var(--cw-controls-state);
      }

      .rectangle .icon {
        align-self: center;
      }

      ha-state-icon,
      ha-icon {
        --mdc-icon-size: calc(24px * var(--cw-scale));
      }

      .square.icon-only :is(ha-state-icon, ha-icon) {
        --mdc-icon-size: min(
          calc(36px * var(--cw-scale)),
          calc(var(--cw-controls-tile-height) / 2)
        );
      }

      .labels {
        min-width: 0;
      }

      .line {
        display: block;
        overflow: hidden;
        white-space: nowrap;
      }

      .line.overflow {
        mask-image: linear-gradient(
          to right,
          black calc(100% - 16px * var(--cw-scale)),
          transparent
        );
      }

      .line.overflow:dir(rtl) {
        mask-image: linear-gradient(
          to left,
          black calc(100% - 16px * var(--cw-scale)),
          transparent
        );
      }

      .area,
      .status {
        color: var(--cw-label-secondary);
        font: var(--cw-text-caption-1);
      }

      button.active .area,
      button.active .status {
        color: var(--cw-controls-active-secondary);
      }

      .name {
        font: 650 calc(14px * var(--cw-scale)) / calc(16px * var(--cw-scale)) var(--cw-font);
      }

      .empty {
        flex: 1;
        display: grid;
        place-content: center;
        justify-items: center;
        gap: calc(8px * var(--cw-scale));
        padding: var(--cw-inset);
        margin: 0;
        text-align: center;
        color: var(--cw-label-secondary);
        font: var(--cw-text-footnote);
      }

      .empty svg {
        width: calc(24px * var(--cw-scale));
        height: calc(24px * var(--cw-scale));
        fill: currentColor;
      }
    `,
  ]

  static getStubConfig(): ControlsConfig {
    return { type: `custom:${CONTROLS_CARD_TAG}` }
  }

  static getConfigElement(): HTMLElement {
    return document.createElement(CONTROLS_EDITOR_TAG)
  }

  private _press:
    { pointer: number; x: number; y: number; timer: ReturnType<typeof setTimeout> } | undefined
  private _suppressClick = false

  private _recommended: string[] = []
  private readonly _pendingToggles = new Map<string, PendingToggle>()

  private _grid(config: ControlsConfig, count: number) {
    return controlsGrid(
      this.boxWidth,
      this.boxHeight,
      this.scaleFactor,
      count,
      config.format ?? 'auto',
      config,
    )
  }

  protected override watchedEntities(): string[] {
    return [
      ...controlsEntities(this._config?.entities),
      ...this._recommended,
      ...this._pendingToggles.keys(),
    ]
  }

  protected override shouldUpdate(changed: PropertyValues): boolean {
    if (super.shouldUpdate(changed)) return true
    if (!this._config || !changed.has('hass')) return false
    const previous = changed.get('hass') as HomeAssistant | undefined
    return (
      previous?.entities !== this.hass?.entities ||
      previous?.devices !== this.hass?.devices ||
      previous?.areas !== this.hass?.areas ||
      previous?.services !== this.hass?.services ||
      (previous?.states !== this.hass?.states && this._recommendationsChanged())
    )
  }

  private _recommendationsChanged(): boolean {
    const config = this._config
    const hass = this.hass
    if (!config || !hass || config.recommend_devices === false) return false
    const manual = controlsEntities(config.entities)
    const next = controlsRecommendations(
      hass,
      config,
      manual,
      this._grid(config, manual.length).capacity,
    )
    return (
      next.length !== this._recommended.length || next.some((id, i) => id !== this._recommended[i])
    )
  }

  protected override updated(): void {
    for (const line of this.renderRoot.querySelectorAll('.line')) {
      line.classList.toggle('overflow', line.scrollWidth > line.clientWidth)
    }
  }

  protected override willUpdate(changed: PropertyValues): void {
    super.willUpdate(changed)
    for (const [id, pending] of this._pendingToggles) {
      if (this.preview || this.hass?.states[id]?.state !== pending.from) {
        this._clearToggle(id, pending)
      }
    }
  }

  public override disconnectedCallback(): void {
    this._cancelPress()
    for (const [id, pending] of this._pendingToggles) this._clearToggle(id, pending)
    this.requestUpdate()
    super.disconnectedCallback()
  }

  private _clearToggle(id: string, pending: PendingToggle): boolean {
    if (this._pendingToggles.get(id) !== pending) return false
    clearTimeout(pending.timer)
    this._pendingToggles.delete(id)
    return true
  }

  private _displayEntity(entity?: HassEntity): HassEntity | undefined {
    if (!entity) return undefined
    const pending = this._pendingToggles.get(entity.entity_id)
    if (!pending) return entity
    return {
      ...entity,
      state: pending.to,
      attributes: { ...entity.attributes, brightness: undefined, percentage: undefined },
    }
  }

  private _moreInfo(entityId: string): void {
    if (this.inCardPicker) return
    this.dispatchEvent(
      new CustomEvent('hass-more-info', {
        detail: { entityId },
        bubbles: true,
        composed: true,
      }),
    )
  }

  private _toggleService(id: string): string | undefined {
    const domain = id.split('.')[0]
    return this.hass?.services?.[domain]?.toggle ? domain : undefined
  }

  private _activate(event: MouseEvent, id: string): void {
    if (this.inCardPicker || this.preview || (event.detail > 0 && this._suppressClick)) return
    const entity = this.hass?.states[id]
    const domain = this._toggleService(id)
    if (!domain || !entity || ['unavailable', 'unknown'].includes(entity.state)) {
      this._moreInfo(id)
      return
    }
    // A second toggle before confirmation would depend on when the first reaches the device.
    if (this._pendingToggles.has(id)) return
    let pending: PendingToggle | undefined
    const rollback = () => {
      if (pending && this._clearToggle(id, pending)) this.requestUpdate()
    }
    if (entity.state === 'on' || entity.state === 'off') {
      const from = entity.state
      pending = {
        from,
        to: from === 'on' ? 'off' : 'on',
        timer: setTimeout(rollback, TOGGLE_CONFIRMATION_MS),
      }
      this._pendingToggles.set(id, pending)
      this.requestUpdate()
    }
    // Home Assistant already presents service errors in its own notification.
    void this.hass?.callService(domain, 'toggle', {}, { entity_id: id }).catch(rollback)
  }

  private _startPress(event: PointerEvent, id: string): void {
    if (this.inCardPicker || this.preview || event.button !== 0 || !event.isPrimary) return
    this._cancelPress()
    this._suppressClick = false
    this._press = {
      pointer: event.pointerId,
      x: event.clientX,
      y: event.clientY,
      timer: setTimeout(() => {
        this._suppressClick = true
        this._moreInfo(id)
      }, 500),
    }
  }

  private _movePress(event: PointerEvent): void {
    if (
      this._press?.pointer === event.pointerId &&
      Math.hypot(event.clientX - this._press.x, event.clientY - this._press.y) > 10
    ) {
      this._suppressClick = true
      this._cancelPress(event)
    }
  }

  private _cancelPress(event?: PointerEvent): void {
    if (!this._press || (event && event.pointerId !== this._press.pointer)) return
    clearTimeout(this._press.timer)
    this._press = undefined
  }

  protected override render() {
    const hass = this.hass
    const config = this._config
    if (!hass || !config) return nothing
    const sample = this.inCardPicker
    const manual = sample ? PICKER_IDS : controlsEntities(config.entities)
    const grid = this._grid(config, manual.length)
    this._recommended = sample ? [] : controlsRecommendations(hass, config, manual, grid.capacity)
    const ids = [...manual.slice(0, grid.capacity), ...this._recommended]
    const iconOnly =
      grid.shape === 'square' && config.show_name === false && config.show_area === false
    const lengths = styleMap({
      '--cw-controls-spacing': `calc(${CONTROLS_SPACING}px * var(--cw-scale))`,
      '--cw-controls-columns': grid.columns,
      '--cw-controls-rows': grid.rows,
      '--cw-controls-tile-height': `calc(${grid.tileHeight}px * var(--cw-scale))`,
    })

    return html`
      <ha-card style=${lengths}>
        ${
          ids.length
            ? html`
                <div class=${`grid ${grid.shape}${iconOnly ? ' icon-only' : ''}`}>
                  ${repeat(
                    ids,
                    id => id,
                    id => {
                      const sampleControl = sample ? PICKER_BY_ID.get(id) : undefined
                      const entity = sampleControl?.state ?? this._displayEntity(hass.states[id])
                      const state = entity?.state ?? 'unavailable'
                      const available = state !== 'unavailable' && state !== 'unknown'
                      const active = entity && available ? controlsActive(entity) : false
                      const domain = id.split('.')[0]
                      const name =
                        (sample
                          ? undefined
                          : (entity && hass.formatEntityName?.(entity)) ||
                            hass.entities?.[id]?.name) ||
                        entity?.attributes.friendly_name ||
                        id
                      const areaId = sample ? undefined : controlsAreaId(hass, id)
                      const area =
                        sampleControl?.area ?? (areaId ? hass.areas?.[areaId]?.name : undefined)
                      const status = controlsState(hass, entity)
                      const label = [config.show_area !== false ? area : undefined, name, status]
                        .filter(Boolean)
                        .join(', ')
                      return html`
                        <button
                          type="button"
                          ?disabled=${sample}
                          class=${`cw-pressable ${active ? 'active' : available ? '' : 'unavailable'}`}
                          style=${styleMap({ '--cw-controls-state': controlsStateColor(domain, state, active, entity?.attributes.device_class, entity?.attributes.rgb_color) })}
                          title=${label}
                          aria-label=${label}
                          aria-keyshortcuts="Shift+Enter"
                          @click=${(event: MouseEvent) => this._activate(event, id)}
                          @pointerdown=${(event: PointerEvent) => this._startPress(event, id)}
                          @pointermove=${this._movePress}
                          @pointerup=${this._cancelPress}
                          @pointercancel=${this._cancelPress}
                          @pointerleave=${this._cancelPress}
                          @contextmenu=${(event: MouseEvent) => {
                            event.preventDefault()
                            if (!this.preview && event.button === 2 && !this._press)
                              this._moreInfo(id)
                          }}
                          @keydown=${(event: KeyboardEvent) => {
                            if (this.preview || event.key !== 'Enter' || !event.shiftKey) return
                            event.preventDefault()
                            if (!event.repeat) this._moreInfo(id)
                          }}
                        >
                          <span class="icon" aria-hidden="true">
                            ${
                              entity
                                ? html`<ha-state-icon
                                    .hass=${hass}
                                    .stateObj=${entity}
                                  ></ha-state-icon>`
                                : html`<ha-icon icon="mdi:help-circle-outline"></ha-icon>`
                            }
                          </span>
                          ${
                            iconOnly
                              ? nothing
                              : html`<span class="labels" aria-hidden="true">
                                  ${area && config.show_area !== false ? html`<span class="line area">${area}</span>` : nothing}
                                  ${config.show_name !== false ? html`<span class="line name">${name}</span>` : nothing}
                                  ${grid.shape === 'rectangle' ? html`<span class="line status">${status}</span>` : nothing}
                                </span>`
                          }
                        </button>
                      `
                    },
                  )}
                </div>
              `
            : html`<p class="empty">
                <svg viewBox="0 0 24 24" aria-hidden="true">
                  <path d=${mdiTuneVariant}></path>
                </svg>
                <span>
                  ${
                    config.recommend_devices === false
                      ? 'Choose entities in the card editor.'
                      : 'No devices to recommend.'
                  }
                </span>
              </p>`
        }
      </ha-card>
    `
  }
}

registerCard(CONTROLS_CARD_TAG, CupertinoControlsCard, {
  name: 'Cupertino Controls',
  description: 'Control an ordered set of Home Assistant entities.',
})
