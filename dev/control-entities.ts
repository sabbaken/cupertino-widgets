/**
 * The showcase feeds ordinary states into Controls. Its long labels exercise the
 * same overflow behaviour as names from the entity registry.
 */
import type { HassEntity } from '../src/core/types/ha'

const tile = (
  entity_id: string,
  state: string,
  friendly_name: string,
  icon: string,
  attributes: Record<string, unknown> = {},
): HassEntity => ({
  entity_id,
  state,
  attributes: { friendly_name, icon, ...attributes },
  last_changed: '2026-07-25T06:00:00.000Z',
  last_updated: '2026-07-25T06:00:00.000Z',
})

export const CONTROL_STATES = [
  tile('light.reading', 'on', 'Лампа над креслом у окна', 'mdi:lightbulb', { brightness: 151 }),
  tile('fan.ceiling', 'on', 'Ceiling fan', 'mdi:fan', { percentage: 50 }),
  tile('switch.desk', 'off', 'Desk power strip', 'mdi:power-plug'),
  tile('light.hallway', 'unavailable', 'Hallway lamp', 'mdi:lightbulb'),
  tile('light.table', 'on', 'Table lamp', 'mdi:lightbulb'),
  tile('switch.speakers', 'off', 'Speakers', 'mdi:power-plug'),
  tile('fan.window', 'off', 'Window fan', 'mdi:fan'),
  tile('light.shelf', 'on', 'Shelf lighting', 'mdi:lightbulb', { brightness: 102 }),
]
