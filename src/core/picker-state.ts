/** Sample entity states for the card picker's renderers. */
import type { HassEntity } from './types/ha'

export const pickerState = (
  entity_id: string,
  state: string,
  attributes: HassEntity['attributes'],
): HassEntity => ({
  entity_id,
  state,
  attributes,
  last_changed: '2026-01-01T00:00:00Z',
  last_updated: '2026-01-01T00:00:00Z',
})
