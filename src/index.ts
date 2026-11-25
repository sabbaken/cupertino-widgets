/**
 * Bundle entry point.
 *
 * Home Assistant loads exactly one URL, so every card in the library is imported
 * here and registers itself on import. Adding a widget means adding one line.
 */
import { printBanner } from './core/register'

import './cards/battery/battery-card'
import './cards/calendar/calendar-card'
import './cards/controls/controls-card'
import './cards/complications/complications-card'
import './cards/reminders/reminders-card'

printBanner()

export { BATTERY_CARD_TAG } from './cards/battery/battery-card'
export { CALENDAR_CARD_TAG } from './cards/calendar/calendar-card'
export { CONTROLS_CARD_TAG } from './cards/controls/controls-card'
export {
  COMPLICATIONS_CARD_TAG,
  LEGACY_GAUGE_CARD_TAG as GAUGE_CARD_TAG,
} from './cards/complications/complications-card'
export { REMINDERS_CARD_TAG } from './cards/reminders/reminders-card'
export type { WidgetLayout } from './core/size'
