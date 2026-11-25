/**
 * Complication profiles turn entity states into readings. Ranges stay in the source unit so
 * manual overrides and forecast labels use the same numbers as Home Assistant.
 */
import { displayTimeZone, timePreferences } from '../calendar/datetime'
import { readDevice, type BatteryDeviceConfig } from '../battery/model'
import type { HassEntity, HomeAssistant } from '../../core/types/ha'
import type { ComplicationForm, ComplicationMark } from '../../ui/complication/complication'
import type { TemperatureRange } from './forecast'

import { aqiStops, co2Stops, colourAt, humidityStops, temperatureStops, uvStops } from './palettes'

type Range = readonly [number, number]
type Context = { fahrenheit: boolean; usAqi: boolean }
type Profile = {
  classes?: readonly string[]
  form: ComplicationForm
  unit?: string
  icon?: string
  caption?: string
  range?: (context: Context) => Range | undefined
  palette?: (value: number, context: Context) => string | undefined
  accent?: string
}

export const temperatureColour = (value: number, fahrenheit = false): string =>
  colourAt(temperatureStops, fahrenheit ? ((value - 32) * 5) / 9 : value)

const profiles = {
  battery: {
    classes: ['battery'],
    form: 'ring',
    unit: '%',
    range: () => [0, 100],
    accent: 'var(--cw-green)',
  },
  temperature: {
    classes: ['temperature'],
    form: 'dial',
    unit: '°C',
    icon: 'mdi:thermometer',
    accent: '#ee6b53',
    range: ({ fahrenheit }) => (fahrenheit ? [-4, 104] : [-20, 40]),
    palette: (value, { fahrenheit }) => temperatureColour(value, fahrenheit),
  },
  humidity: {
    classes: ['humidity'],
    form: 'dial',
    unit: '%',
    icon: 'mdi:water-percent',
    accent: 'var(--cw-blue)',
    range: () => [0, 100],
    palette: value => colourAt(humidityStops, value),
  },
  co2: {
    classes: ['carbon_dioxide'],
    form: 'dial',
    unit: 'ppm',
    icon: 'mdi:molecule-co2',
    range: () => [400, 2500],
    palette: value => colourAt(co2Stops, value),
    accent: '#e4b500',
  },
  aqi: {
    classes: ['aqi'],
    form: 'dial',
    caption: 'AQI',
    range: ({ usAqi }) => (usAqi ? [0, 500] : undefined),
    palette: (value, { usAqi }) => (usAqi ? colourAt(aqiStops, value) : undefined),
    accent: 'var(--cw-green)',
  },
  uv_index: {
    form: 'dial',
    icon: 'mdi:weather-sunny',
    accent: '#d88c18',
    range: () => [0, 11],
    palette: value => colourAt(uvStops, value),
  },
  wind_bearing: { form: 'disc', accent: 'var(--cw-blue)' },
  sun: { classes: ['timestamp'], form: 'disc', accent: '#dc982d' },
  generic: { form: 'disc' },
} satisfies Record<string, Profile>

export type ComplicationProfile = keyof typeof profiles
const complicationProfiles = Object.keys(profiles) as ComplicationProfile[]

export const WEATHER_METRICS = {
  temperature: 'Temperature',
  humidity: 'Humidity',
  uv_index: 'UV index',
  wind_bearing: 'Wind',
} as const

export const weatherMetric = (row: ComplicationRow): keyof typeof WEATHER_METRICS | undefined =>
  row.entity.startsWith('weather.')
    ? row.weather_metric && Object.hasOwn(WEATHER_METRICS, row.weather_metric)
      ? row.weather_metric
      : 'temperature'
    : undefined

export const COMPLICATION_APPEARANCES = {
  color: 'Gradient',
  solid: 'Solid colour',
  monochrome: 'Monochrome',
} as const

export interface ComplicationRow extends BatteryDeviceConfig {
  weather_metric?: keyof typeof WEATHER_METRICS
  profile?: ComplicationProfile | 'auto' | 'aqi_us'
  shape?: ComplicationForm | 'auto'
  color_mode?: keyof typeof COMPLICATION_APPEARANCES
  caption?: string
  icon_position?: 'top' | 'bottom' | 'hidden' | 'auto'
  mark?: ComplicationMark | 'auto'
  min?: number
  max?: number
  show_percentage?: boolean
  sun_event?: 'sunrise' | 'sunset'
}

export const complicationRows = (value: unknown): ComplicationRow[] =>
  (Array.isArray(value) ? value : [value]).flatMap(row => {
    const config = typeof row === 'string' ? { entity: row } : row
    return config && typeof config.entity === 'string' && config.entity.includes('.')
      ? [config]
      : []
  })

export const finiteNumber = (value: unknown): number | undefined => {
  if (typeof value !== 'number' && (typeof value !== 'string' || !value.trim())) return undefined
  const number = Number(value)
  return Number.isFinite(number) ? number : undefined
}

export const available = (state?: HassEntity): boolean =>
  !!state && state.state !== 'unknown' && state.state !== 'unavailable'

const profileFor = (row: ComplicationRow, state?: HassEntity): ComplicationProfile => {
  const metric = weatherMetric(row)
  if (metric) return metric
  if (row.profile === 'aqi_us') return 'aqi'
  if (row.profile && complicationProfiles.includes(row.profile as ComplicationProfile))
    return row.profile as ComplicationProfile
  if (row.entity.startsWith('sun.')) return 'sun'
  return (
    complicationProfiles.find(key =>
      (profiles[key] as Profile).classes?.some(
        deviceClass => state?.attributes.device_class === deviceClass,
      ),
    ) ?? 'generic'
  )
}

export const formatComplicationNumber = (
  value: number,
  language?: string,
  maximumFractionDigits = 1,
  minimumFractionDigits = 0,
): string =>
  new Intl.NumberFormat(language, {
    maximumFractionDigits,
    minimumFractionDigits,
    useGrouping: false,
  }).format(maximumFractionDigits === 0 && Math.abs(value) < 0.5 ? 0 : value)

const solarTime = (instant: number, hass?: HomeAssistant) => {
  const clock = timePreferences(hass?.locale)
  const parts = new Intl.DateTimeFormat(clock.locale, {
    hour: clock.hour12 ? 'numeric' : '2-digit',
    minute: '2-digit',
    timeZone: displayTimeZone(hass),
    hourCycle: clock.hour12 ? 'h12' : 'h23',
  }).formatToParts(instant)
  return {
    reading: parts
      .filter(part => part.type !== 'dayPeriod')
      .map(part => part.value)
      .join('')
      .trim(),
    period: parts.find(part => part.type === 'dayPeriod')?.value,
    full: parts.map(part => part.value).join(''),
  }
}

const COMPASS = [
  'N',
  'NNE',
  'NE',
  'ENE',
  'E',
  'ESE',
  'SE',
  'SSE',
  'S',
  'SSW',
  'SW',
  'WSW',
  'W',
  'WNW',
  'NW',
  'NNW',
]

const windDirection = (value: unknown): string | undefined => {
  const degrees = finiteNumber(value)
  if (degrees !== undefined) return COMPASS[((Math.round(degrees / 22.5) % 16) + 16) % 16]
  const direction = typeof value === 'string' ? value.trim().toUpperCase() : ''
  return COMPASS.includes(direction) ? direction : undefined
}

const WIND_TO_KMH = new Map([
  ['km/h', 1],
  ['m/s', 3.6],
  ['ft/s', 1.09728],
  ['mph', 1.609344],
  ['kn', 1.852],
])

export const readComplication = (
  hass: HomeAssistant | undefined,
  row: ComplicationRow,
  forecast?: TemperatureRange,
  previous?: HassEntity,
) => {
  const state = hass?.states[row.entity]
  const source = available(state) ? state : (previous ?? state)
  const attrs = source?.attributes
  const key = profileFor(row, source)
  const profile: Profile = profiles[key]
  const battery = key === 'battery' ? readDevice(hass, row) : undefined
  const metric = weatherMetric(row)
  const weatherTemperature = metric === 'temperature'
  const wind = metric === 'wind_bearing'
  const sourceUnit = metric
    ? weatherTemperature
      ? attrs?.temperature_unit
      : wind
        ? attrs?.wind_speed_unit
        : undefined
    : attrs?.unit_of_measurement
  const reportedUnit = typeof sourceUnit === 'string' ? sourceUnit : (profile.unit ?? '')
  const speedFactor = wind ? WIND_TO_KMH.get(reportedUnit) : undefined
  const unit = speedFactor === undefined ? reportedUnit : 'km/h'
  const fahrenheit = unit === '°F' || unit === 'F'
  const context = { fahrenheit, usAqi: row.profile === 'aqi_us' }
  const defaults = profile.range?.(context)
  const min = finiteNumber(row.min) ?? defaults?.[0]
  const max = finiteNumber(row.max) ?? defaults?.[1]
  const range =
    min !== undefined && max !== undefined && min < max ? ([min, max] as const) : undefined
  const ends = weatherTemperature && available(state) ? forecast : undefined
  const scale = ends ? ([ends.min, ends.max] as const) : range
  const form = wind
    ? 'disc'
    : row.shape === 'ring' || row.shape === 'dial' || row.shape === 'disc'
      ? row.shape
      : key === 'generic' && range
        ? 'dial'
        : profile.form
  const sun = key === 'sun'
  const sunEntity = row.entity.startsWith('sun.')
  const translation = hass?.entities?.[row.entity]?.translation_key
  const event = row.sun_event ?? (translation === 'next_rising' ? 'sunrise' : 'sunset')
  const timestamp = sunEntity
    ? attrs?.[event === 'sunrise' ? 'next_rising' : 'next_setting']
    : state?.state
  const instant = sun && typeof timestamp === 'string' ? Date.parse(timestamp) : NaN
  const numeric = wind
    ? attrs?.wind_speed
    : metric
      ? attrs?.[metric]
      : battery
        ? battery.level
        : state?.state
  const raw = available(state) && !sun ? finiteNumber(numeric) : undefined
  const value = raw === undefined ? undefined : raw * (speedFactor ?? 1)
  const heading = wind && available(state) ? windDirection(attrs?.wind_bearing) : undefined
  const language = hass?.locale?.language ?? hass?.language
  const solar =
    sun && available(state) && Number.isFinite(instant) ? solarTime(instant, hass) : undefined
  const ok = solar !== undefined || value !== undefined
  const sensorCelsius = key === 'temperature' && !metric && !fahrenheit
  const digits = sensorCelsius ? 1 : key === 'temperature' || key === 'uv_index' || wind ? 0 : 1
  const reading =
    solar?.reading ??
    (value === undefined
      ? '–'
      : `${formatComplicationNumber(value, language, digits, sensorCelsius ? 1 : 0)}${unit === '%' || unit.startsWith('°') ? unit : ''}`)
  const solarEvent =
    sunEntity || row.sun_event || translation === 'next_rising' || translation === 'next_setting'
  const solarIcon = solarEvent
    ? event === 'sunrise'
      ? 'mdi:weather-sunset-up'
      : 'mdi:weather-sunset-down'
    : 'mdi:clock-outline'
  const glyph =
    row.icon ||
    battery?.icon ||
    profile.icon ||
    (wind ? undefined : attrs?.icon) ||
    (sun ? solarIcon : undefined)
  const palette = profile.palette
  const hasPalette = form === 'dial' && palette?.(0, context) !== undefined
  const accent =
    !ok || row.color_mode === 'monochrome' || (key === 'aqi' && !context.usAqi)
      ? undefined
      : profile.accent
  const track =
    hasPalette && accent && scale && row.color_mode !== 'solid' && palette
      ? Array.from({ length: 49 }, (_, i) =>
          palette(scale[0] + ((scale[1] - scale[0]) * i) / 48, context)!,
        )
      : undefined
  const colour =
    hasPalette && accent && scale && value !== undefined
      ? palette?.(Math.max(scale[0], Math.min(scale[1], value)), context)
      : accent

  return {
    key,
    metric,
    form,
    value,
    scale,
    reading,
    solar,
    unit,
    language,
    available: ok,
    showReading: !battery || row.show_percentage === true || !ok,
    name:
      row.name ??
      (metric
        ? `${source?.attributes.friendly_name ?? row.entity} · ${WEATHER_METRICS[metric]}`
        : (source?.attributes.friendly_name ?? row.entity)),
    glyph: row.icon_position === 'hidden' ? undefined : glyph,
    caption:
      row.caption ?? profile.caption ?? (key === 'generic' ? attrs?.friendly_name : undefined),
    mark: hasPalette
      ? 'dot'
      : row.mark === 'arc' || row.mark === 'dot'
        ? row.mark
        : metric
          ? 'dot'
          : 'arc',
    charging: battery?.charging === true,
    hasPalette,
    heading,
    accent,
    colour,
    ends,
    track,
  } as const
}
