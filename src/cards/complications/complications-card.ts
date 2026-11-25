/** One measured grid for all complication shapes, with shared forecast subscriptions per entity. */
import { css, html, type PropertyValues, type TemplateResult } from 'lit'
import { styleMap } from 'lit/directives/style-map.js'
import { CupertinoCard, type CupertinoCardConfig } from '../../core/base-card'
import { defineElement, registerCard } from '../../core/register'
import type { HassEntity, HomeAssistant, LovelaceCardEditor } from '../../core/types/ha'
import { CHARGING_BADGE, chargingStyles } from '../../ui/complication/charging'
import { complicationStyles, renderComplication } from '../../ui/complication/complication'
import { ComplicationForecasts, todaysRange } from './forecast'
import { COMPLICATION_EDITOR_TAG } from './complications-editor'
import { complicationGrid, complicationReadingScale } from './layout'
import {
  available,
  formatComplicationNumber,
  complicationRows,
  readComplication,
  weatherMetric,
  type ComplicationRow,
} from './model'

export const COMPLICATIONS_CARD_TAG = 'cupertino-complications-card'
export const LEGACY_GAUGE_CARD_TAG = 'cupertino-gauge-card'

export interface ComplicationsCardConfig extends CupertinoCardConfig {
  entities?: string | ComplicationRow | readonly (string | ComplicationRow)[]
}

class CupertinoComplicationsCard extends CupertinoCard<ComplicationsCardConfig> {
  static override styles = [
    CupertinoCard.styles,
    complicationStyles,
    chargingStyles,
    css`
      .widget {
        display: flex;
        align-items: center;
        justify-content: center;
        padding: var(--cw-inset);
        box-sizing: border-box;
        width: 100%;
        height: 100%;
      }
      .grid {
        display: grid;
        grid-template-columns: repeat(var(--cw-gauge-columns), var(--cw-gauge-size));
        gap: calc(14px * var(--cw-scale));
      }
      .cell {
        border: 0;
        padding: 0;
        color: inherit;
        background: transparent;
        cursor: pointer;
      }
      .cell[data-unavailable] :is(.cw-gauge-center, .cw-gauge-footer) {
        opacity: 0.55;
      }
      .cell[data-weather-dial] .cw-gauge-center {
        top: 50%;
      }
      .cell[data-weather-dial] .cw-gauge-value {
        font-variant-numeric: proportional-nums;
      }
      .cell[data-degree] .cw-gauge-reading-suffix {
        position: relative;
        top: -0.4em;
      }
      .cw-gauge-end {
        margin-inline: calc(var(--cw-gauge-size) * 0.07);
      }
      .cw-gauge-footer .cw-gauge-caption {
        --cw-gauge-caption-scale: 0.09;
      }
      .cw-gauge-caption {
        max-width: calc(var(--cw-gauge-size) * 0.59);
        overflow: hidden;
        text-overflow: ellipsis;
      }
      .empty {
        font: var(--cw-text-callout);
        color: var(--cw-label-secondary);
      }
    `,
  ]

  private readonly _forecast = new ComplicationForecasts(() => this.requestUpdate())
  private readonly _lastStates = new Map<string, HassEntity>()
  private _clock?: ReturnType<typeof setInterval>

  public static getStubConfig(): ComplicationsCardConfig {
    return { type: `custom:${COMPLICATIONS_CARD_TAG}` }
  }

  public static getConfigElement(): LovelaceCardEditor {
    return document.createElement(COMPLICATION_EDITOR_TAG) as LovelaceCardEditor
  }

  public override connectedCallback(): void {
    super.connectedCallback()
    this.requestUpdate()
    // A fresh render also reselects the daily range if midnight passed between pushes.
    this._clock = setInterval(() => {
      if (
        complicationRows(this._config?.entities).some(row => weatherMetric(row) === 'temperature')
      )
        this.requestUpdate()
    }, 15_000)
  }

  public override disconnectedCallback(): void {
    clearInterval(this._clock)
    this._forecast.stop()
    super.disconnectedCallback()
  }

  protected override watchedEntities(): string[] {
    return complicationRows(this._config?.entities).flatMap(row =>
      row.charging_entity ? [row.entity, row.charging_entity] : [row.entity],
    )
  }

  protected override shouldUpdate(changed: PropertyValues): boolean {
    const previous = changed.get('hass') as HomeAssistant | undefined
    return (
      !!this._config &&
      (super.shouldUpdate(changed) ||
        previous?.connection !== this.hass?.connection ||
        previous?.entities !== this.hass?.entities ||
        previous?.config.time_zone !== this.hass?.config.time_zone)
    )
  }

  protected override willUpdate(changed: PropertyValues): void {
    super.willUpdate(changed)
    const rows = complicationRows(this._config?.entities)
    const ids = new Set(rows.map(row => row.entity))
    const candidates = new Set(
      rows.filter(row => weatherMetric(row) === 'temperature').map(row => row.entity),
    )
    const weather = new Set<string>()
    for (const id of this._lastStates.keys()) {
      if (!ids.has(id)) this._lastStates.delete(id)
    }
    for (const id of ids) {
      const state = this.hass?.states[id]
      if (state && (available(state) || !this._lastStates.has(id))) this._lastStates.set(id, state)
      if (
        candidates.has(id) &&
        available(state) &&
        (state?.attributes.supported_features === undefined ||
          (state.attributes.supported_features & 1) !== 0)
      ) {
        weather.add(id)
      }
    }
    if (this.isConnected) this._forecast.sync(this.hass?.connection, weather)
  }

  private _renderCell(row: ComplicationRow, diameter: number): TemplateResult {
    const zone = this.hass?.config.time_zone ?? 'UTC'
    const forecast = todaysRange(this._forecast.read(row.entity), Date.now(), zone)
    const complication = readComplication(
      this.hass,
      row,
      forecast,
      this._lastStates.get(row.entity),
    )
    const temperature = complication.key === 'temperature'
    const sensorTemperature =
      temperature && !complication.metric && complication.reading.includes('°')
    const readingSuffix = sensorTemperature
      ? '°'
      : complication.key === 'humidity' && complication.reading.endsWith('%')
        ? '%'
        : ''
    const reading = complication.showReading
      ? sensorTemperature
        ? complication.reading.slice(0, complication.reading.indexOf('°'))
        : complication.metric === 'temperature' && complication.value !== undefined
          ? formatComplicationNumber(complication.value, complication.language, 0)
          : readingSuffix
            ? complication.reading.slice(0, -1)
            : complication.reading
      : undefined
    const ends = complication.form === 'dial' && diameter >= 64 ? complication.ends : undefined
    const endLabel = (value: number) => formatComplicationNumber(value, complication.language, 0)
    const endLabels = ends ? { min: endLabel(ends.min), max: endLabel(ends.max) } : undefined
    const endScale = endLabels
      ? Math.min(0.14, 0.64 / (endLabels.min.length + endLabels.max.length))
      : undefined
    const unit =
      complication.unit && complication.unit !== '%' && !complication.unit.startsWith('°')
        ? complication.unit
        : ''
    const caption = [
      diameter >= 56 ? complication.caption : undefined,
      complication.solar?.period ??
        (complication.available && !temperature && complication.key !== 'co2' ? unit : ''),
    ]
      .filter(Boolean)
      .join(' · ')
    const automaticIcon = !row.icon && (!row.icon_position || row.icon_position === 'auto')
    const weatherDial = complication.form === 'dial' && complication.metric === 'temperature'
    const glyph =
      (diameter < 54 && reading) || (weatherDial && automaticIcon) ? undefined : complication.glyph
    const glyphPosition =
      row.icon_position === 'top' ||
      (row.icon_position !== 'bottom' && complication.form === 'disc')
        ? 'top'
        : 'bottom'
    const maxReadingScale = complication.key === 'sun' ? 0.28 : complication.heading ? 0.32 : 0.4
    const valueScale = complicationReadingScale(reading ?? '', readingSuffix, maxReadingScale)
    const colour = complication.colour
    const solidTrack =
      complication.hasPalette && row.color_mode === 'solid' && colour
        ? `color-mix(in srgb, ${colour} 16%, var(--cw-track))`
        : undefined
    const spokenReading =
      complication.solar?.full ??
      [complication.heading, complication.reading, unit].filter(Boolean).join(' ')
    const name = `${complication.name}: ${complication.available ? spokenReading : 'Unavailable'}`

    return html`
      <button
        type="button"
        class="cell cw-pressable"
        title=${name}
        aria-label=${name}
        ?disabled=${!this.hass?.states[row.entity]}
        ?data-unavailable=${!complication.available}
        ?data-degree=${sensorTemperature}
        ?data-weather-dial=${weatherDial}
        style=${styleMap({
          '--cw-gauge-value-scale': valueScale,
          '--cw-gauge-end-scale': endScale,
          '--cw-gauge-glyph-ink': complication.accent,
          '--cw-gauge-track': solidTrack,
          '--cw-gauge-glyph-scale':
            complication.key === 'sun' && complication.form === 'disc' ? 0.25 : undefined,
          '--cw-gauge-mark': colour,
          '--cw-gauge-bolt-ink': row.color_mode === 'monochrome' ? 'var(--cw-label)' : undefined,
          '--cw-gauge-ink':
            complication.form === 'disc' && !glyph && !complication.heading ? colour : undefined,
        })}
        @click=${() =>
          this.dispatchEvent(
            new CustomEvent('hass-more-info', {
              detail: { entityId: row.entity },
              bubbles: true,
              composed: true,
            }),
          )}
      >
        ${renderComplication({
          form: complication.form,
          value: complication.scale ? complication.value : undefined,
          ...(complication.scale ? { min: complication.scale[0], max: complication.scale[1] } : {}),
          mark: complication.mark,
          ...(reading ? { reading, ...(readingSuffix ? { readingSuffix } : {}) } : {}),
          ...(caption ? { caption } : {}),
          ...(complication.heading ? { heading: complication.heading } : {}),
          ...(glyph ? { glyph, glyphPosition } : {}),
          ...(complication.track ? { trackColours: complication.track } : {}),
          ...(endLabels ? { ends: endLabels } : {}),
          ...(complication.charging && complication.form === 'ring'
            ? { overlay: CHARGING_BADGE }
            : {}),
        })}
      </button>
    `
  }

  protected override render(): TemplateResult {
    const rows = complicationRows(this._config?.entities)
    const grid = complicationGrid(rows.length, this.boxWidth, this.boxHeight, this.scaleFactor)
    const content = rows.length
      ? html`
          <div
            class="grid"
            style=${styleMap({
              '--cw-gauge-columns': grid.columns,
              '--cw-gauge-size': `calc(${grid.diameter}px * var(--cw-scale))`,
            })}
          >
            ${rows.slice(0, grid.visible).map(row => this._renderCell(row, grid.diameter))}
          </div>
        `
      : html`<div class="empty">Choose entities to display.</div>`
    return html`<ha-card><div class="widget">${content}</div></ha-card>`
  }
}

registerCard(COMPLICATIONS_CARD_TAG, CupertinoComplicationsCard, {
  name: 'Cupertino Complications',
  description: 'Read multiple entities in rings, dials and discs.',
})

// Saved dashboards can still load the original tag. Only the new tag appears in the picker.
defineElement(LEGACY_GAUGE_CARD_TAG, class extends CupertinoComplicationsCard {})
