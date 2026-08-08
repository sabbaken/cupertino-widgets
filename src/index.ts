/**
 * Bundle entry point.
 *
 * Home Assistant loads exactly one URL, so every card in the library is imported
 * here and registers itself on import. Adding a widget means adding one line.
 */
import { printBanner } from './core/register'

import './cards/battery/battery-card'
import './cards/calendar/calendar-card'
import './cards/reminders/reminders-card'

printBanner()

export { BATTERY_CARD_TAG } from './cards/battery/battery-card'
export { CALENDAR_CARD_TAG } from './cards/calendar/calendar-card'
export { REMINDERS_CARD_TAG } from './cards/reminders/reminders-card'
export type { WidgetLayout } from './core/size'
