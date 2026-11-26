/** Profile fixtures use the same metadata as Home Assistant states. */
import { describe, expect, it } from 'vitest'
import type { HassEntity, HomeAssistant } from '../../core/types/ha'
import { fractionFor } from '../../ui/complication/geometry'
import { complicationRows, readComplication, temperatureColour } from './model'
import { complicationGrid, complicationReadingScale } from './layout'

const sensor = (state: string, attributes: HassEntity['attributes']): HassEntity => ({
  entity_id: 'sensor.reading',
  state,
  attributes,
  last_changed: '',
  last_updated: '',
})

const dashboard = (reading: HassEntity): HomeAssistant =>
  ({
    states: { [reading.entity_id]: reading },
    config: { time_zone: 'Europe/Warsaw' },
    locale: { language: 'en-GB', time_format: '24', time_zone: 'server', first_weekday: 'monday' },
  }) as HomeAssistant

const humidity = (value: number) =>
  sensor(String(value), { device_class: 'humidity', unit_of_measurement: '%' })

describe('complication profiles', () => {
  it('retains the reading, scale and icon accent when humidity changes form', () => {
    for (const value of [0, 50, 100]) {
      const hass = dashboard(humidity(value))
      const entity = 'sensor.reading'
      const automatic = readComplication(hass, { entity })
      expect(automatic).toMatchObject({
        form: 'dial',
        reading: `${value}%`,
        scale: [0, 100],
        value,
      })
      for (const shape of ['ring', 'disc'] as const) {
        expect(readComplication(hass, { entity, shape })).toMatchObject({
          form: shape,
          reading: automatic.reading,
          accent: automatic.accent,
          scale: [0, 100],
        })
      }
    }
  })

  it('keeps the same CO₂ icon colour across readings and removes it in monochrome', () => {
    const entity = 'sensor.reading'
    const low = dashboard(sensor('1000', { device_class: 'carbon_dioxide' }))
    const high = dashboard(sensor('1801', { device_class: 'carbon_dioxide' }))
    const first = readComplication(low, { entity })
    const second = readComplication(high, { entity })
    expect(first.accent).toBeDefined()
    expect(first.accent).toBe(second.accent)
    expect(first.colour).not.toBe(second.colour)
    expect(readComplication(high, { entity, color_mode: 'monochrome' }).accent).toBeUndefined()
  })

  it('classifies AQI only after the source standard is selected', () => {
    const hass = dashboard(sensor('151', { device_class: 'aqi' }))
    const entity = 'sensor.reading'
    expect(readComplication(hass, { entity })).toMatchObject({
      key: 'aqi',
      form: 'dial',
      reading: '151',
      caption: 'AQI',
    })
    expect(readComplication(hass, { entity }).colour).toBeUndefined()
    expect(readComplication(hass, { entity, profile: 'aqi_us' })).toMatchObject({
      scale: [0, 500],
      mark: 'dot',
    })
  })

  it('matches temperatures on equivalent Celsius and Fahrenheit ranges', () => {
    for (const [celsius, fahrenheit] of [
      [-15, 5],
      [20, 68],
    ] as const) {
      const entity = 'sensor.reading'
      const temperature = (value: number, unit: string) =>
        readComplication(
          dashboard(
            sensor(String(value), { device_class: 'temperature', unit_of_measurement: unit }),
          ),
          { entity },
        )
      const metric = temperature(celsius, '°C')
      const imperial = temperature(fahrenheit, '°F')
      expect(temperatureColour(celsius)).toBe(temperatureColour(fahrenheit, true))
      expect(metric.colour).toBe(imperial.colour)
      expect(fractionFor(metric.value, ...metric.scale!)).toBeCloseTo(
        Number(fractionFor(imperial.value, ...imperial.scale!)),
      )
      expect(metric.ends).toBeUndefined()
      expect(imperial.reading).toBe(`${fahrenheit}°F`)
    }
  })

  it('keeps one decimal and a thermometer on Celsius sensors without forecast endpoints', () => {
    const temperature = { device_class: 'temperature', unit_of_measurement: '°C' }
    for (const [raw, label] of [
      ['21.54', '21.5°C'],
      ['-1.56', '-1.6°C'],
      ['18', '18.0°C'],
    ] as const) {
      expect(
        readComplication(dashboard(sensor(raw, temperature)), { entity: 'sensor.reading' }),
      ).toMatchObject({
        value: Number(raw),
        reading: label,
        form: 'dial',
        glyph: 'mdi:thermometer',
        mark: 'dot',
        ends: undefined,
      })
    }
  })

  it('keeps the current weather reading when the forecast clamps its mark', () => {
    const entity = 'weather.home'
    const state = {
      ...sensor('sunny', { temperature: 27, temperature_unit: '°C' }),
      entity_id: entity,
    }
    const forecast = { min: 8, max: 22 }
    const complication = readComplication(dashboard(state), { entity }, forecast)
    expect(complication).toMatchObject({ reading: '27°C', ends: forecast, mark: 'dot' })
    expect(fractionFor(complication.value, ...complication.scale!)).toBe(1)
    expect(new Set(complication.track).size).toBeGreaterThan(2)
    expect(readComplication(dashboard(state), { entity }).scale).toEqual([-20, 40])
  })

  it('reads each weather attribute independently and reserves forecast ends for temperature', () => {
    const entity = 'weather.home'
    const hass = dashboard({
      ...sensor('sunny', { humidity: 72, uv_index: 5, wind_bearing: 'SW' }),
      entity_id: entity,
    })
    for (const [weather_metric, value] of [
      ['humidity', 72],
      ['uv_index', 5],
    ] as const) {
      const complication = readComplication(hass, { entity, weather_metric }, { min: 8, max: 22 })
      expect(complication).toMatchObject({ value, mark: 'dot', form: 'dial', ends: undefined })
      expect(new Set(complication.track).size).toBeGreaterThan(2)
    }
  })

  it('keeps the gradient fixed while moving the dot for AQI, CO₂ and humidity', () => {
    const entity = 'sensor.reading'
    for (const [device_class, profile, low, high] of [
      ['aqi', 'aqi_us', 49, 151],
      ['carbon_dioxide', 'auto', 800, 1801],
      ['humidity', 'auto', 25, 72],
    ] as const) {
      const read = (value: number) =>
        readComplication(dashboard(sensor(String(value), { device_class })), { entity, profile })
      expect(read(low).mark).toBe('dot')
      expect(new Set(read(low).track).size).toBeGreaterThan(2)
      expect(read(low).track).toEqual(read(high).track)
    }
  })

  it('pairs wind direction with speed in a disc and converts supported units to km/h', () => {
    const entity = 'weather.home'
    const weather = (bearing: number | string, speed: number, unit: string) =>
      dashboard({
        ...sensor('windy', { wind_bearing: bearing, wind_speed: speed, wind_speed_unit: unit }),
        entity_id: entity,
      })
    const row = { entity, weather_metric: 'wind_bearing', shape: 'dial' } as const
    expect(readComplication(weather(270, 5, 'm/s'), row)).toMatchObject({
      form: 'disc',
      heading: 'W',
      reading: '18',
      unit: 'km/h',
      scale: undefined,
    })
    expect(readComplication(weather('NNE', 0, 'mph'), row)).toMatchObject({
      heading: 'NNE',
      reading: '0',
      unit: 'km/h',
    })
    expect(readComplication(weather('SW', 3, 'Beaufort'), row)).toMatchObject({
      heading: 'SW',
      reading: '3',
      unit: 'Beaufort',
    })
  })

  it('keeps the dot in all three appearances even when an older row sets fill', () => {
    const entity = 'sensor.reading'
    const hass = dashboard(humidity(50))
    const gradient = readComplication(hass, { entity, mark: 'arc' })
    const solid = readComplication(hass, { entity, color_mode: 'solid', mark: 'arc' })
    const mono = readComplication(hass, { entity, color_mode: 'monochrome', mark: 'arc' })
    expect([gradient.mark, solid.mark, mono.mark]).toEqual(['dot', 'dot', 'dot'])
    expect(gradient.track).toBeDefined()
    expect(gradient.colour).not.toBe(gradient.accent)
    expect(solid).toMatchObject({
      track: undefined,
      colour: gradient.colour,
      accent: gradient.accent,
    })
    expect(mono).toMatchObject({ track: undefined, colour: undefined, accent: undefined })
  })

  it('keeps a known form when its source is missing', () => {
    expect(
      readComplication(undefined, { entity: 'sensor.reading' }, undefined, humidity(55)),
    ).toMatchObject({
      form: 'dial',
      available: false,
      reading: '–',
    })
  })

  it('uses a neutral gauge when a coloured dial has no reading', () => {
    const entity = 'sensor.reading'
    const previous = humidity(55)
    const sources = [
      undefined,
      ...['unavailable', 'unknown', 'invalid'].map(state =>
        dashboard(sensor(state, previous.attributes)),
      ),
    ]
    for (const color_mode of ['color', 'solid'] as const) {
      for (const hass of sources) {
        expect(readComplication(hass, { entity, color_mode }, undefined, previous)).toMatchObject({
          form: 'dial',
          available: false,
          reading: '–',
          accent: undefined,
          colour: undefined,
          track: undefined,
        })
      }
    }
  })

  it('keeps battery percentages inside the gauge only when enabled', () => {
    const hass = dashboard(sensor('100', { device_class: 'battery', is_charging: true }))
    const entity = 'sensor.reading'
    expect(readComplication(hass, { entity })).toMatchObject({
      showReading: false,
      charging: true,
      form: 'ring',
    })
    expect(readComplication(hass, { entity, shape: 'disc', show_percentage: true })).toMatchObject({
      showReading: true,
      reading: '100%',
      form: 'disc',
    })
  })

  it('localises the selected solar event with the server time zone', () => {
    const entity = 'sun.sun'
    const sun = {
      ...sensor('below_horizon', {
        next_rising: '2026-11-25T06:30:00Z',
        next_setting: '2026-11-25T15:00:00Z',
      }),
      entity_id: entity,
    }
    const hass = dashboard(sun)
    expect(readComplication(hass, { entity, sun_event: 'sunrise' })).toMatchObject({
      form: 'disc',
      reading: '07:30',
      glyph: 'mdi:weather-sunset-up',
    })
    expect(readComplication(hass, { entity, shape: 'ring', sun_event: 'sunset' })).toMatchObject({
      reading: '16:00',
      value: undefined,
      scale: undefined,
    })
  })

  it.each([
    ['sunrise', 'next_rising', 'above_horizon', '07:30', 'mdi:weather-sunset-up'],
    ['sunset', 'next_setting', 'below_horizon', '16:00', 'mdi:weather-sunset-down'],
  ] as const)(
    'holds %s through the timestamp rollover for fifteen minutes',
    (event, attribute, horizon, reading, glyph) => {
      const entity = 'sun.sun'
      const rising = '2026-11-25T06:30:00Z'
      const setting = '2026-11-25T15:00:00Z'
      const instant = event === 'sunrise' ? rising : setting
      const at = Date.parse(instant)
      const before = {
        ...sensor('sun', {
          next_rising: event === 'sunrise' ? rising : '2026-11-26T06:31:00Z',
          next_setting: setting,
          icon: 'mdi:white-balance-sunny',
        }),
        entity_id: entity,
      }
      const after = {
        ...before,
        state: horizon,
        last_changed: new Date(at + 30_000).toISOString(),
        attributes: { ...before.attributes, [attribute]: new Date(at + 86_400_000).toISOString() },
      }
      const read = (state: HassEntity, now: number, cached?: HassEntity) =>
        readComplication(dashboard(state), { entity }, undefined, undefined, now, cached)
      expect(read(before, at - 1)).toMatchObject({ reading, glyph })
      expect(read(after, at + 14 * 60_000, before)).toMatchObject({ reading, glyph })
      expect(read({ ...after, last_changed: instant }, at + 60_000)).toMatchObject({
        reading,
        glyph,
      })
      expect(read(after, at + 15 * 60_000, before)).toMatchObject({
        reading: event === 'sunrise' ? '16:00' : '07:31',
        glyph: event === 'sunrise' ? 'mdi:weather-sunset-down' : 'mdi:weather-sunset-up',
      })
    },
  )

  it('keeps generic readings neutral and uses a dial only with a valid range', () => {
    const hass = dashboard(sensor('42', { unit_of_measurement: 'W' }))
    const [row] = complicationRows([
      'sensor.reading',
      { entity: 'sensor.reading', min: 0, max: 100 },
    ])
    expect(readComplication(hass, row!)).toMatchObject({
      form: 'disc',
      value: 42,
      unit: 'W',
      colour: undefined,
    })
    expect(readComplication(hass, { ...row!, min: 0, max: 100 }).form).toBe('dial')
    expect(readComplication(hass, { ...row!, min: 100, max: 0 }).form).toBe('disc')
  })
})

describe('complication grid', () => {
  it('fits its visible circles at every supported scale', () => {
    const broken: string[] = []
    for (const [width, height] of [
      [252, 224],
      [510, 224],
      [104, 224],
      [510, 330],
    ] as const) {
      for (const scale of [0.8, 1, 1.3]) {
        const { columns, diameter, visible } = complicationGrid(8, width, height, scale)
        const rows = Math.ceil(visible / columns)
        if (
          visible < 1 ||
          (columns * diameter + (columns - 1) * 14 + 32) * scale + 2 > width ||
          (rows * diameter + (rows - 1) * 14 + 32) * scale + 2 > height
        )
          broken.push(`${width}×${height} @ ${scale}`)
      }
    }
    expect(broken).toEqual([])
    expect(complicationGrid(4, 252, 224, 1).visible).toBe(4)
  })
})

describe('complication reading size', () => {
  it('gives a single digit more room than a signed reading with a degree mark', () => {
    const single = complicationReadingScale('5', '', 0.4)
    const decimal = complicationReadingScale('18,6', '°', 0.4)
    expect(single).toBe(0.4)
    expect(decimal).toBeLessThan(single)
    expect(complicationReadingScale('−18,6', '°', 0.4)).toBeLessThan(decimal)
    expect(complicationReadingScale('18.6', '°', 0.4)).toBe(decimal)
  })
})
