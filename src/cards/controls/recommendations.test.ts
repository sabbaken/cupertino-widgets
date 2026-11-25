/**
 * The manual list and the room resolver are independent inputs to the available slots.
 */
import { describe, expect, it } from 'vitest'

import type { HassEntity } from '../../core/types/ha'
import { controlsRecommendations } from './recommendations'

const stateOf = (id: string, state = 'off'): HassEntity => ({
  entity_id: id,
  state,
  attributes: {},
  last_changed: '',
  last_updated: '',
})

const home = () => ({
  states: Object.fromEntries(
    [
      stateOf('fan.office'),
      stateOf('light.kitchen'),
      stateOf('light.counter', 'on'),
      stateOf('switch.plug'),
      stateOf('light.hidden'),
      stateOf('light.disabled'),
      stateOf('switch.diagnostic'),
      stateOf('switch.setting'),
      stateOf('cover.offline', 'unavailable'),
      stateOf('climate.unknown', 'unknown'),
      stateOf('sensor.temperature', '20'),
    ].map(entity => [entity.entity_id, entity]),
  ),
  entities: {
    'fan.office': { entity_id: 'fan.office', area_id: 'office', device_id: 'kitchen_device' },
    'light.kitchen': { entity_id: 'light.kitchen', device_id: 'kitchen_device' },
    'light.counter': { entity_id: 'light.counter', area_id: 'kitchen' },
    'light.hidden': { entity_id: 'light.hidden', hidden: true },
    'light.disabled': { entity_id: 'light.disabled', disabled_by: 'user' },
    'switch.diagnostic': { entity_id: 'switch.diagnostic', entity_category: 'diagnostic' },
    'switch.setting': { entity_id: 'switch.setting', entity_category: 'config' },
  },
  areas: { kitchen: { name: 'Kitchen' }, office: { name: 'Office' }, study: { name: 'Office' } },
  devices: { kitchen_device: { area_id: 'kitchen' } },
})

const config = {
  type: 'custom:cupertino-widgets-controls',
  recommendation_areas: ['kitchen'],
}

describe('device recommendations', () => {
  it('fills whole-home slots in domain and entity ID order', () => {
    const hass = home()
    const expected = ['light.counter', 'light.kitchen', 'fan.office', 'switch.plug']
    expect(controlsRecommendations(hass, { type: config.type }, [], 10)).toEqual(expected)
    hass.states['light.counter'] = stateOf('light.counter', 'off')
    hass.states['light.kitchen'] = stateOf('light.kitchen', 'on')
    expect(controlsRecommendations(hass, { type: config.type }, [], 10)).toEqual(expected)
  })

  it('excludes manual tiles and respects the remaining capacity', () => {
    const hass = home()
    const manual = ['fan.office', 'light.kitchen']
    expect(controlsRecommendations(hass, config, manual, 3)).toEqual(['light.counter'])
    expect(controlsRecommendations(hass, config, manual, 1)).toEqual([])
    expect(controlsRecommendations(hass, { ...config, recommend_devices: false }, [], 10)).toEqual(
      [],
    )
  })

  it('filters by one or more areas and prefers the entity area over the device area', () => {
    const hass = home()
    expect(controlsRecommendations(hass, config, [], 10)).toEqual([
      'light.counter',
      'light.kitchen',
    ])
    expect(
      controlsRecommendations(hass, { ...config, recommendation_areas: ['office'] }, [], 10),
    ).toEqual(['fan.office'])
    expect(
      controlsRecommendations(
        hass,
        { ...config, recommendation_areas: ['kitchen', 'office'] },
        [],
        10,
      ),
    ).toEqual(['light.counter', 'light.kitchen', 'fan.office'])
  })

  it('uses the whole home when no valid areas are selected', () => {
    const hass = home()
    const expected = ['light.counter', 'light.kitchen', 'fan.office', 'switch.plug']
    for (const recommendation_areas of [[], ['removed']]) {
      expect(controlsRecommendations(hass, { ...config, recommendation_areas }, [], 10)).toEqual(
        expected,
      )
    }
  })
})
