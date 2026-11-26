/** Shared complication rendering and forecast subscriptions for cards that show entity readings. */
import { css, html, type PropertyValues, type TemplateResult } from 'lit'
import { styleMap } from 'lit/directives/style-map.js'
import { CupertinoCard, type CupertinoCardConfig } from '../../core/base-card'
import type { HassEntity, HomeAssistant } from '../../core/types/ha'
import { CHARGING_BADGE, chargingStyles } from '../../ui/complication/charging'
import { complicationStyles, renderComplication } from '../../ui/complication/complication'
import { ComplicationForecasts, todaysRange } from './forecast'
import { complicationReadingScale } from './layout'
import {
  automaticSun,
  available,
  formatComplicationNumber,
  complicationRows,
  readComplication,
  weatherMetric,
  type ComplicationRow,
} from './model'

export interface ComplicationsCardConfig extends CupertinoCardConfig {
  entities?: string | ComplicationRow | readonly (string | ComplicationRow)[]
}

export abstract class CupertinoComplicationCardBase<
  C extends ComplicationsCardConfig,
> extends CupertinoCard<C> {
  static override styles = [
    CupertinoCard.styles,
    complicationStyles,
    chargingStyles,
    css`
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
      .cell:is([data-weather-dial], [data-co2-dial]) .cw-gauge-center {
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
    `,
  ]

  protected readonly complicationLimit: number = Infinity

  protected complicationRows(): ComplicationRow[] {
    return complicationRows(this._config?.entities).slice(0, this.complicationLimit)
  }

  private readonly _forecast = new ComplicationForecasts(() => this.requestUpdate())
  private readonly _lastStates = new Map<string, HassEntity>()
  private readonly _beforeSolarRollover = new Map<string, HassEntity>()
  private _clock?: ReturnType<typeof setInterval>

  public override connectedCallback(): void {
    super.connectedCallback()
    this.requestUpdate()
    // The forecast day and the solar grace period can end between entity updates.
    this._clock = setInterval(() => {
      if (
        this.complicationRows().some(
          row => automaticSun(row) || weatherMetric(row) === 'temperature',
        )
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
    return this.complicationRows().flatMap(row =>
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
    const rows = this.complicationRows()
    const ids = new Set(rows.map(row => row.entity))
    const candidates = new Set(
      rows.filter(row => weatherMetric(row) === 'temperature').map(row => row.entity),
    )
    const sun = new Set(rows.filter(automaticSun).map(row => row.entity))
    const weather = new Set<string>()
    for (const id of this._beforeSolarRollover.keys()) {
      if (!sun.has(id) || !this.hass?.states[id]) this._beforeSolarRollover.delete(id)
    }
    for (const id of this._lastStates.keys()) {
      if (!ids.has(id)) this._lastStates.delete(id)
    }
    for (const id of ids) {
      const state = this.hass?.states[id]
      const previous = this._lastStates.get(id)
      if (
        sun.has(id) &&
        state &&
        available(state) &&
        previous &&
        (state.attributes.next_rising !== previous.attributes.next_rising ||
          state.attributes.next_setting !== previous.attributes.next_setting)
      ) {
        this._beforeSolarRollover.set(id, previous)
      }
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

  protected renderComplicationCell(
    row: ComplicationRow,
    diameter: number,
    hass = this.hass,
  ): TemplateResult {
    const zone = this.hass?.config.time_zone ?? 'UTC'
    const now = Date.now()
    const forecast = todaysRange(this._forecast.read(row.entity), now, zone)
    const complication = readComplication(
      hass,
      row,
      forecast,
      this._lastStates.get(row.entity),
      now,
      this._beforeSolarRollover.get(row.entity),
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
      (diameter < 54 && reading && !automaticSun(row)) || (weatherDial && automaticIcon)
        ? undefined
        : complication.glyph
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
        ?disabled=${this.inCardPicker || !hass?.states[row.entity]}
        ?data-unavailable=${!complication.available}
        ?data-degree=${sensorTemperature}
        ?data-weather-dial=${weatherDial}
        ?data-co2-dial=${complication.key === 'co2' && complication.form === 'dial'}
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
}
