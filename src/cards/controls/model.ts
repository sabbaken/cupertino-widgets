/**
 * The service catalogue determines whether a tile can toggle. Reading the
 * catalogue also covers integrations that expose a toggle without an on/off state.
 */
import type { CupertinoCardConfig } from '../../core/base-card'
import type { HomeAssistant, HassEntity } from '../../core/types/ha'
import type { ControlsDensity, ControlsFormat } from './layout'

export interface ControlsConfig extends CupertinoCardConfig, ControlsDensity {
  entities?: string[] | string
  format?: ControlsFormat
  show_name?: boolean
  show_area?: boolean
}

export const controlsEntities = (entities: ControlsConfig['entities']): string[] => [
  ...new Set(
    (Array.isArray(entities) ? entities : [entities]).filter(
      (id): id is string => typeof id === 'string' && id.includes('.'),
    ),
  ),
]

export const controlsArea = (hass: HomeAssistant, id: string): string | undefined => {
  const entity = hass.entities?.[id]
  const device = entity?.device_id ? hass.devices?.[entity.device_id] : undefined
  const area = entity?.area_id || device?.area_id
  return area ? hass.areas?.[area]?.name : undefined
}

export const controlsActive = (entity: HassEntity): boolean => {
  switch (entity.entity_id.split('.')[0]) {
    case 'cover':
    case 'valve':
      return entity.state !== 'closed' && entity.state !== 'off'
    case 'lock':
      return entity.state !== 'locked'
    case 'climate':
      return entity.state !== 'off'
    default:
      return [
        'on',
        'playing',
        'cleaning',
        'active',
        'running',
        'open',
        'home',
        'not_home',
      ].includes(entity.state)
  }
}

export const controlsState = (hass: HomeAssistant, entity?: HassEntity): string => {
  if (!entity) {
    return hass.localize('state.default.unavailable') || 'Unavailable'
  }
  const domain = entity.entity_id.split('.')[0]
  const {
    brightness,
    percentage,
    device_class: deviceClass,
    unit_of_measurement: unit,
  } = entity.attributes
  if (entity.state === 'on') {
    const fraction =
      domain === 'light' && typeof brightness === 'number'
        ? brightness / 255
        : domain === 'fan' && typeof percentage === 'number'
          ? percentage / 100
          : undefined
    if (fraction !== undefined && Number.isFinite(fraction)) {
      return new Intl.NumberFormat(hass.locale.language, { style: 'percent' }).format(fraction)
    }
  }
  return (
    hass.formatEntityState?.(entity) ||
    (deviceClass &&
      hass.localize(`component.${domain}.entity_component.${deviceClass}.state.${entity.state}`)) ||
    hass.localize(`component.${domain}.entity_component._.state.${entity.state}`) ||
    hass.localize(`state.default.${entity.state}`) ||
    (typeof unit === 'string' ? `${entity.state} ${unit}` : entity.state)
  )
}
