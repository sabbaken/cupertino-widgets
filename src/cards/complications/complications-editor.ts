/** The Complications editor uses the battery editor's sortable panels. */
import { t } from '../../core/i18n'
import { html, nothing, type TemplateResult } from 'lit'
import { property } from 'lit/decorators.js'
import { CupertinoCardEditor } from '../../core/card-editor'
import { defineElement } from '../../core/register'
import type { HaFormSchema, HomeAssistant } from '../../core/types/ha'
import { CupertinoBatteryDevices, type DevicesChangedDetail } from '../battery/device-list-editor'
import type { ComplicationsCardConfig } from './complication-card-base'
import {
  COMPLICATION_APPEARANCES,
  complicationRows,
  readComplication,
  WEATHER_METRICS,
  weatherMetric,
  type ComplicationRow,
} from './model'

export const COMPLICATION_EDITOR_TAG = 'cupertino-complications-card-editor'

const select = (name: string, options: Record<string, string>): HaFormSchema => ({
  name,
  selector: {
    select: {
      mode: 'dropdown',
      options: Object.entries(options).map(([value, label]) => ({ value, label })),
    },
  },
})
const shapeNames = {
  ring: t('complications.ring'),
  dial: t('complications.dial'),
  disc: t('complications.disc'),
}

type ComplicationAppearance = NonNullable<ComplicationRow['color_mode']>

class CupertinoComplicationRows extends CupertinoBatteryDevices {
  @property({ attribute: false }) public defaultAppearance: ComplicationAppearance = 'color'

  protected override readonly filter = {
    domain: ['sensor', 'number', 'input_number', 'weather', 'sun'],
  }
  protected override readonly allowDuplicates = true
  protected override readonly addLabel = t('complications.add')
  protected override readonly addHelper = ''
  protected override readonly emptyLabel = t('complications.addHelp')
  protected override labels = {
    entity: t('complications.entity'),
    weather_metric: t('complications.weatherReading'),
    profile: t('complications.profile'),
    shape: t('complications.shape'),
    color_mode: t('complications.appearance'),
    caption: t('complications.caption'),
    name: t('common.entityName'),
    icon: t('common.icon'),
    icon_position: t('complications.iconPosition'),
    mark: t('complications.indicator'),
    min: t('complications.min'),
    max: t('complications.max'),
    charging_entity: t('common.chargingSensor'),
    show_percentage: t('complications.showPercentage'),
    sun_event: t('complications.sunEvent'),
  }
  protected override helpers = {}
  protected override normaliseRows = (rows: readonly unknown[]) =>
    complicationRows(rows).map(row => {
      const config = Object.fromEntries(
        Object.entries(row).filter(
          ([key, value]) =>
            value !== '' &&
            value !== undefined &&
            value !== null &&
            !(
              value === 'auto' &&
              ['profile', 'shape', 'icon_position', 'mark', 'sun_event'].includes(key)
            ) &&
            !(key === 'weather_metric' && value === 'temperature') &&
            !(key === 'color_mode' && value === this.defaultAppearance),
        ),
      ) as unknown as ComplicationRow
      return Object.keys(config).length === 1 ? config.entity : config
    })
  protected override summary = (hass: HomeAssistant | undefined, row: ComplicationRow) => {
    const complication = readComplication(hass, row)
    return {
      name: complication.name,
      icon: complication.glyph ?? 'mdi:gauge',
      secondary: `${row.entity} · ${shapeNames[complication.form]}`,
    }
  }

  protected override schema = (
    hass: HomeAssistant | undefined,
    row: ComplicationRow,
  ): readonly HaFormSchema[] => {
    const complication = readComplication(hass, row)
    const auto = readComplication(hass, { ...row, shape: 'auto' })
    const numeric = complication.key !== 'sun'
    const track = complication.form !== 'disc'
    return [
      { name: 'entity', required: true, selector: { entity: { filter: this.filter } } },
      ...(weatherMetric(row)
        ? [select('weather_metric', WEATHER_METRICS)]
        : [
            select('profile', {
              auto: t('common.auto'),
              battery: t('complications.battery'),
              temperature: t('complications.temperature'),
              humidity: t('complications.humidity'),
              co2: 'CO₂',
              aqi: t('complications.aqi'),
              aqi_us: t('complications.aqiUs'),
              sun: t('complications.dateTime'),
              generic: t('complications.generic'),
              uv_index: t('complications.uv'),
            }),
          ]),
      ...(complication.metric === 'wind_bearing'
        ? []
        : [
            select('shape', {
              auto: t('complications.autoShape', { shape: shapeNames[auto.form] }),
              ...shapeNames,
            }),
          ]),
      select('color_mode', COMPLICATION_APPEARANCES),
      { name: 'name', selector: { text: { placeholder: complication.name } } },
      {
        name: 'caption',
        selector: {
          text: { ...(complication.caption ? { placeholder: complication.caption } : {}) },
        },
      },
      {
        name: 'icon',
        selector: { icon: { ...(complication.glyph ? { placeholder: complication.glyph } : {}) } },
      },
      select('icon_position', {
        auto: t('common.auto'),
        top: t('complications.above'),
        bottom: t('complications.below'),
        hidden: t('complications.hidden'),
      }),
      ...(numeric && track && !complication.hasPalette
        ? [
            select('mark', {
              auto: t('common.auto'),
              arc: t('complications.fill'),
              dot: t('complications.dot'),
            }),
          ]
        : []),
      ...(numeric && complication.metric !== 'wind_bearing'
        ? ['min', 'max'].map(name => ({
            name,
            selector: { number: { mode: 'box' as const } },
          }))
        : []),
      ...(complication.key === 'battery'
        ? [
            {
              name: 'charging_entity',
              selector: { entity: { filter: { domain: 'binary_sensor' } } },
            },
            { name: 'show_percentage', selector: { boolean: {} } },
          ]
        : []),
      ...(complication.key === 'sun' && row.entity.startsWith('sun.')
        ? [
            select('sun_event', {
              auto: t('common.auto'),
              sunset: t('complications.sunset'),
              sunrise: t('complications.sunrise'),
            }),
          ]
        : []),
    ]
  }
}

export class CupertinoComplicationsEditor<
  C extends ComplicationsCardConfig = ComplicationsCardConfig,
> extends CupertinoCardEditor<C> {
  protected readonly complicationLimit: number = Infinity
  protected readonly complicationAppearance: ComplicationAppearance = 'color'

  protected override fields(): readonly HaFormSchema[] {
    return []
  }

  protected override beforeForm(): TemplateResult | typeof nothing {
    if (!this.hass || !this._config) return nothing
    return html`
      <cupertino-complication-rows
        .hass=${this.hass}
        .maxDevices=${this.complicationLimit}
        .defaultAppearance=${this.complicationAppearance}
        .devices=${complicationRows(this._config.entities)
          .slice(0, this.complicationLimit)
          .map(row => ({
            profile: 'auto',
            ...(weatherMetric(row) ? { weather_metric: 'temperature' } : {}),
            shape: 'auto',
            color_mode: this.complicationAppearance,
            icon_position: 'auto',
            mark: 'auto',
            ...(row.entity.startsWith('sun.') ? { sun_event: 'auto' } : {}),
            ...row,
          }))}
        @devices-changed=${this._rowsChanged}
      ></cupertino-complication-rows>
    `
  }

  private readonly _rowsChanged = (event: CustomEvent<DevicesChangedDetail>): void => {
    event.stopPropagation()
    if (!this._config) return
    const next = { ...this._config }
    if (event.detail.devices.length)
      next.entities = event.detail.devices.slice(0, this.complicationLimit)
    else delete next.entities
    this.emitConfig(next)
  }
}

defineElement('cupertino-complication-rows', CupertinoComplicationRows)
defineElement(COMPLICATION_EDITOR_TAG, CupertinoComplicationsEditor)
