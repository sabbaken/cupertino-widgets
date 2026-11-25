/** Showcase entities and a daily forecast on the same wire as a live dashboard. */
import { dayNumber, dayStart } from '../src/cards/calendar/datetime'
import type { DailyForecast } from '../src/cards/complications/forecast'
import type { HassEntity } from '../src/core/types/ha'
import { EARBUDS } from './battery-devices'

export const COMPLICATION_WEATHER = 'weather.neighbourhood'
export const COMPLICATION_ZONE = 'Europe/Warsaw'

const entity = (
  entity_id: string,
  state: string,
  attributes: HassEntity['attributes'],
): HassEntity => ({
  entity_id,
  state,
  attributes,
  last_changed: '2026-07-25T06:00:00Z',
  last_updated: '2026-07-25T06:00:00Z',
})

const today = () => dayNumber(new Date(), COMPLICATION_ZONE)

export const complicationForecast = (): DailyForecast[] => [
  { datetime: dayStart(today(), COMPLICATION_ZONE).toISOString(), temperature: 22, templow: 8 },
  {
    datetime: dayStart(today() + 1, COMPLICATION_ZONE).toISOString(),
    temperature: 25,
    templow: 12,
  },
]

export const COMPLICATION_STATES = [
  entity('binary_sensor.earbuds_charging', 'on', {
    friendly_name: 'Earbuds charging',
    device_class: 'battery_charging',
  }),
  entity('sensor.study_humidity', '62', {
    friendly_name: 'Study humidity',
    device_class: 'humidity',
    unit_of_measurement: '%',
  }),
  entity('sensor.study_temperature', '21.5', {
    friendly_name: 'Study temperature',
    device_class: 'temperature',
    unit_of_measurement: '°C',
  }),
  entity('sensor.study_carbon_dioxide', '1120', {
    friendly_name: 'Study CO₂',
    device_class: 'carbon_dioxide',
    unit_of_measurement: 'ppm',
  }),
  entity('sensor.neighbourhood_aqi', '49', {
    friendly_name: 'Neighbourhood AQI',
    device_class: 'aqi',
  }),
  entity(COMPLICATION_WEATHER, 'partlycloudy', {
    friendly_name: 'Neighbourhood weather',
    temperature: 16,
    humidity: 72,
    uv_index: 5,
    wind_bearing: 270,
    wind_speed: 18,
    wind_speed_unit: 'km/h',
    temperature_unit: '°C',
    supported_features: 1,
  }),
  entity('sun.sun', 'above_horizon', {
    friendly_name: 'Sun',
    next_setting: new Date(
      dayStart(today(), COMPLICATION_ZONE).getTime() + 16 * 3_600_000,
    ).toISOString(),
    next_rising: new Date(
      dayStart(today() + 1, COMPLICATION_ZONE).getTime() + 7 * 3_600_000,
    ).toISOString(),
  }),
]

export const COMPLICATION_SETS = {
  mixed: [
    { entity: EARBUDS, charging_entity: 'binary_sensor.earbuds_charging' },
    { entity: 'sensor.neighbourhood_aqi', profile: 'aqi_us' },
    'sensor.study_humidity',
    'sun.sun',
  ],
  weather: [
    COMPLICATION_WEATHER,
    { entity: COMPLICATION_WEATHER, weather_metric: 'humidity' },
    { entity: COMPLICATION_WEATHER, weather_metric: 'uv_index' },
    { entity: COMPLICATION_WEATHER, weather_metric: 'wind_bearing' },
  ],
  indoor: ['sensor.study_humidity', 'sensor.study_temperature', 'sensor.study_carbon_dioxide'],
}
