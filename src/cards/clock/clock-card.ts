/** The clock fits the date, time and one row of complications into the measured box. */
import * as mdi from '@mdi/js'
import { css, html, nothing, type TemplateResult } from 'lit'
import { styleMap } from 'lit/directives/style-map.js'
import { registerCard } from '../../core/register'
import { MAX_SCALE, scaleFactor } from '../../core/scale'
import type { LovelaceCardEditor } from '../../core/types/ha'
import { displayTimeZone, timePreferences } from '../calendar/datetime'
import { CupertinoComplicationCardBase } from '../complications/complication-card-base'
import { available, formatComplicationNumber } from '../complications/model'
import { CLOCK_EDITOR_TAG } from './clock-editor'
import {
  CLOCK_COMPLICATION_APPEARANCE,
  CLOCK_COMPLICATION_LIMIT,
  clockFontFamily,
  clockTypography,
  type ClockCardConfig,
} from './config'

export const CLOCK_CARD_TAG = 'cupertino-clock-card'

const COMPLICATION_GAP = 12
const MAX_COMPLICATION_DIAMETER = 56
const MAX_CLOCK_SCALE = scaleFactor(MAX_SCALE)

const weatherIcons: Record<string, string> = {
  'clear-night': mdi.mdiWeatherNight,
  cloudy: mdi.mdiWeatherCloudy,
  exceptional: mdi.mdiAlertCircleOutline,
  fog: mdi.mdiWeatherFog,
  hail: mdi.mdiWeatherHail,
  lightning: mdi.mdiWeatherLightning,
  'lightning-rainy': mdi.mdiWeatherLightningRainy,
  partlycloudy: mdi.mdiWeatherPartlyCloudy,
  pouring: mdi.mdiWeatherPouring,
  rainy: mdi.mdiWeatherRainy,
  snowy: mdi.mdiWeatherSnowy,
  'snowy-rainy': mdi.mdiWeatherSnowyRainy,
  sunny: mdi.mdiWeatherSunny,
  windy: mdi.mdiWeatherWindy,
  'windy-variant': mdi.mdiWeatherWindyVariant,
}

class CupertinoClockCard extends CupertinoComplicationCardBase<ClockCardConfig> {
  static override styles = [
    CupertinoComplicationCardBase.styles,
    css`
      :host {
        /* Let a narrow grid track constrain the clock before its first measurement. */
        min-width: 0;
      }
      ha-card[data-transparent] {
        background: transparent;
        border: 0;
        box-shadow: none;
        backdrop-filter: none;
      }
      .clock {
        display: flex;
        flex-direction: column;
        justify-content: center;
        align-items: center;
        flex: 1;
        min-height: 0;
        padding: var(--cw-inset);
        box-sizing: border-box;
        gap: calc(6px * var(--cw-scale));
      }
      .context,
      .weather,
      .readings {
        display: flex;
        align-items: center;
        justify-content: center;
      }
      .context {
        max-width: 100%;
        font: var(--cw-text-title-3);
        color: var(--cw-label);
        gap: calc(8px * var(--cw-scale));
      }
      .weather {
        gap: calc(4px * var(--cw-scale));
        white-space: nowrap;
      }
      .weather svg {
        width: calc(22px * var(--cw-scale));
        height: calc(22px * var(--cw-scale));
        fill: currentColor;
      }
      .time {
        font-family: var(--cw-clock-font);
        font-size: var(--cw-clock-size);
        font-weight: var(--cw-clock-weight);
        line-height: 1;
        letter-spacing: var(--cw-clock-tracking);
        font-variant-numeric: tabular-nums;
        white-space: nowrap;
      }
      .readings {
        margin-top: calc(6px * var(--cw-scale));
        gap: calc(${COMPLICATION_GAP}px * var(--cw-scale));
      }
      .readings .cell {
        width: var(--cw-gauge-size);
        height: var(--cw-gauge-size);
      }
    `,
  ]

  protected override readonly complicationLimit = CLOCK_COMPLICATION_LIMIT
  private _minuteTimer?: ReturnType<typeof setTimeout>

  public static getStubConfig(): ClockCardConfig {
    return { type: `custom:${CLOCK_CARD_TAG}` }
  }

  public static getConfigElement(): LovelaceCardEditor {
    return document.createElement(CLOCK_EDITOR_TAG) as LovelaceCardEditor
  }

  public override connectedCallback(): void {
    super.connectedCallback()
    this._tick()
  }

  public override disconnectedCallback(): void {
    clearTimeout(this._minuteTimer)
    super.disconnectedCallback()
  }

  private readonly _tick = (): void => {
    this.requestUpdate()
    // Recalculate the delay after each tick so a suspended tab does not shift the next minute.
    this._minuteTimer = setTimeout(this._tick, 60_000 - (Date.now() % 60_000))
  }

  protected override watchedEntities(): string[] {
    const weather = this._config?.weather_entity
    return [...super.watchedEntities(), ...(weather ? [weather] : [])]
  }

  private _weather(): TemplateResult | typeof nothing {
    const id = this._config?.weather_entity
    const state = id ? this.hass?.states[id] : undefined
    if (!state || !available(state)) return nothing
    const icon = Object.hasOwn(weatherIcons, state.state)
      ? weatherIcons[state.state]
      : mdi.mdiWeatherCloudyAlert
    const label =
      state.state === 'partlycloudy' ? 'Partly cloudy' : state.state.replaceAll('-', ' ')
    const temperature = state.attributes.temperature
    return html`<span class="weather">
      <svg viewBox="0 0 24 24" role="img" aria-label=${label}><path d=${icon}></path></svg>
      ${
        typeof temperature === 'number' && Number.isFinite(temperature)
          ? `${formatComplicationNumber(temperature, this.hass?.locale?.language, 0)}°`
          : nothing
      }
    </span>`
  }

  protected override render(): TemplateResult {
    const now = new Date()
    const { locale, hour12 } = timePreferences(this.hass?.locale)
    const timeZone = displayTimeZone(this.hass)
    const weather = this._weather()
    const date =
      this._config?.show_date === false
        ? nothing
        : new Intl.DateTimeFormat(locale, {
            weekday: 'short',
            day: 'numeric',
            ...(weather === nothing ? { month: 'short' } : {}),
            timeZone,
          }).format(now)
    const formatter = new Intl.DateTimeFormat(locale, {
      hour: 'numeric',
      minute: '2-digit',
      hour12,
      timeZone,
    })
    const parts = formatter.formatToParts(now)
    const time = parts
      .filter(part => part.type !== 'dayPeriod')
      .map(part => part.value)
      .join('')
      .trim()
    const rows = this.complicationRows()
    const showContext = date !== nothing || weather !== nothing
    const showBackground = this._config?.show_background === true
    const border = showBackground ? 2 : 0
    const budgetAt = (scale: number) => {
      const width = Math.max(0, (this.boxWidth - border) / scale - 32)
      // Budget for the header even when hidden so the time keeps its size.
      const timeAndReadings = (this.boxHeight - border) / scale - 32 - 31 - (rows.length ? 12 : 0)
      const diameter = rows.length
        ? Math.max(
            0,
            Math.min(
              MAX_COMPLICATION_DIAMETER,
              (width - (rows.length - 1) * COMPLICATION_GAP) / rows.length,
              timeAndReadings * 0.36,
            ),
          )
        : 0
      return { width, timeAndReadings, diameter }
    }
    const { diameter } = budgetAt(this.scaleFactor)
    // Fit at the top of the slider so a tight box still leaves room for the time to grow.
    const largest = budgetAt(MAX_CLOCK_SCALE)
    const { tracking, weight } = clockTypography(this._config)
    // Extra positive tracking takes up space on each character, including the separator.
    const widthPerEm = 3.25 + [...time].length * Math.max(0, tracking)
    const clockSize = Math.max(
      0,
      Math.min(128, largest.width / widthPerEm, largest.timeAndReadings - largest.diameter),
    )

    return html`<ha-card ?data-transparent=${!showBackground}>
      <div
        class="clock"
        style=${styleMap({
          '--cw-clock-font': clockFontFamily(this._config?.font),
          '--cw-clock-tracking': `${tracking}em`,
          '--cw-clock-weight': weight,
          '--cw-clock-size': `calc(${clockSize}px * var(--cw-scale))`,
          '--cw-gauge-size': `calc(${diameter}px * var(--cw-scale))`,
        })}
      >
        ${
          showContext
            ? html`<div class="context">
                ${date === nothing ? nothing : html`<span class="cw-truncate">${date}</span>`}${weather}
              </div>`
            : nothing
        }
        <time class="time" datetime=${now.toISOString()}>${time}</time>
        ${
          rows.length
            ? html`<div class="readings">
                ${rows.map(row =>
                  this.renderComplicationCell(
                    {
                      ...row,
                      color_mode: row.color_mode ?? CLOCK_COMPLICATION_APPEARANCE,
                    },
                    diameter,
                  ),
                )}
              </div>`
            : nothing
        }
      </div>
    </ha-card>`
  }
}

registerCard(CLOCK_CARD_TAG, CupertinoClockCard, {
  name: 'Cupertino Clock',
  description: 'Show the time with optional weather and up to four complications.',
})
