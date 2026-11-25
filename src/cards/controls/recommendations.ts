/**
 * Recommendations use the live registries and states. Domain priority and entity IDs
 * give the grid a stable order while users operate the tiles.
 */
import type { HassEntity, HomeAssistant } from '../../core/types/ha'
import { controlsAreaId, type ControlsConfig } from './model'

type ControlsHass = Pick<HomeAssistant, 'states' | 'entities' | 'devices' | 'areas'>

const priority = new Map(
  ['light', 'fan', 'switch', 'climate', 'cover'].map((domain, index) => [domain, index]),
)

const controlsAvailable = (entity?: HassEntity): entity is HassEntity =>
  !!entity && entity.state !== 'unknown' && entity.state !== 'unavailable'

export const controlsRecommendations = (
  hass: ControlsHass,
  config: ControlsConfig,
  manual: readonly string[],
  capacity: number,
): string[] => {
  const remaining = capacity - manual.length
  if (config.recommend_devices === false || remaining <= 0) return []

  const configuredAreas = [config.recommendation_areas ?? []].flat()
  const areas = new Set(configuredAreas.filter(id => Object.hasOwn(hass.areas ?? {}, id)))
  const selected = new Set(manual)
  const eligible = Object.keys(hass.states).flatMap(id => {
    const rank = priority.get(id.split('.')[0])
    const entry = hass.entities?.[id]
    const area = areas.size ? controlsAreaId(hass, id) : undefined
    if (
      rank === undefined ||
      selected.has(id) ||
      entry?.hidden ||
      entry?.disabled_by ||
      entry?.entity_category ||
      !controlsAvailable(hass.states[id]) ||
      (areas.size > 0 && (!area || !areas.has(area)))
    )
      return []
    return [{ id, rank }]
  })
  eligible.sort((a, b) => a.rank - b.rank || (a.id < b.id ? -1 : 1))
  return eligible.slice(0, remaining).map(({ id }) => id)
}
