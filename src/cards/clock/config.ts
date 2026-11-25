/** Clock configuration uses the same entity rows as the standalone complications card. */
import type { ComplicationsCardConfig } from '../complications/complication-card-base'

export const CLOCK_COMPLICATION_LIMIT = 4
export const CLOCK_COMPLICATION_APPEARANCE = 'monochrome'

export interface ClockCardConfig extends ComplicationsCardConfig {
  weather_entity?: string
  show_date?: boolean
  show_background?: boolean
}
