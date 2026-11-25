/** The clock adds a weather selector to the same sortable complication editor. */
import { defineElement } from '../../core/register'
import type { HaFormSchema } from '../../core/types/ha'
import { CupertinoComplicationsEditor } from '../complications/complications-editor'
import {
  CLOCK_COMPLICATION_APPEARANCE,
  CLOCK_COMPLICATION_LIMIT,
  type ClockCardConfig,
} from './config'

export const CLOCK_EDITOR_TAG = 'cupertino-clock-card-editor'

class CupertinoClockEditor extends CupertinoComplicationsEditor<ClockCardConfig> {
  protected override readonly complicationLimit = CLOCK_COMPLICATION_LIMIT

  protected override readonly complicationAppearance = CLOCK_COMPLICATION_APPEARANCE

  protected override defaults(): Partial<ClockCardConfig> {
    return { ...super.defaults(), show_date: true, show_background: false }
  }

  protected override fields(): readonly HaFormSchema[] {
    return [
      { name: 'show_date', selector: { boolean: {} } },
      { name: 'weather_entity', selector: { entity: { filter: { domain: 'weather' } } } },
      { name: 'show_background', selector: { boolean: {} } },
    ]
  }

  protected override label(schema: HaFormSchema): string {
    switch (schema.name) {
      case 'show_date':
        return 'Show date'
      case 'weather_entity':
        return 'Weather'
      case 'show_background':
        return 'Show card background'
      default:
        return super.label(schema)
    }
  }
}

defineElement(CLOCK_EDITOR_TAG, CupertinoClockEditor)
