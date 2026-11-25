/** The clock adds a weather selector to the same sortable complication editor. */
import { mdiTune } from '@mdi/js'
import { defineElement } from '../../core/register'
import type { HaFormSchema } from '../../core/types/ha'
import { CupertinoComplicationsEditor } from '../complications/complications-editor'
import {
  CLOCK_COMPLICATION_APPEARANCE,
  CLOCK_COMPLICATION_LIMIT,
  CLOCK_FONTS,
  CLOCK_FONT_WEIGHT,
  CLOCK_TRACKING,
  type ClockCardConfig,
} from './config'

export const CLOCK_EDITOR_TAG = 'cupertino-clock-card-editor'

class CupertinoClockEditor extends CupertinoComplicationsEditor<ClockCardConfig> {
  protected override readonly complicationLimit = CLOCK_COMPLICATION_LIMIT

  protected override readonly complicationAppearance = CLOCK_COMPLICATION_APPEARANCE

  protected override defaults(): Partial<ClockCardConfig> {
    return {
      ...super.defaults(),
      show_date: true,
      show_background: false,
      font: 'system',
      tracking: CLOCK_TRACKING.default,
      font_weight: CLOCK_FONT_WEIGHT.default,
    }
  }

  protected override fields(): readonly HaFormSchema[] {
    return [
      { name: 'show_date', selector: { boolean: {} } },
      { name: 'weather_entity', selector: { entity: { filter: { domain: 'weather' } } } },
      { name: 'show_background', selector: { boolean: {} } },
    ]
  }

  protected override trailingFields(): readonly HaFormSchema[] {
    const options = CLOCK_FONTS.map<{ value: string; label: string }>(({ value, label }) => ({
      value,
      label,
    }))
    const savedFont = this._config?.font
    if (savedFont && !options.some(option => option.value === savedFont)) {
      options.push({ value: savedFont, label: savedFont === 'serif' ? 'Serif' : savedFont })
    }
    return [
      {
        name: 'advanced',
        type: 'expandable',
        flatten: true,
        title: 'Advanced',
        iconPath: mdiTune,
        schema: [
          { name: 'font', selector: { select: { mode: 'dropdown', options } } },
          {
            name: 'tracking',
            selector: {
              number: {
                min: CLOCK_TRACKING.min,
                max: CLOCK_TRACKING.max,
                step: CLOCK_TRACKING.step,
                mode: 'slider',
              },
            },
          },
          {
            name: 'font_weight',
            selector: {
              number: {
                min: CLOCK_FONT_WEIGHT.min,
                max: CLOCK_FONT_WEIGHT.max,
                step: CLOCK_FONT_WEIGHT.step,
                mode: 'slider',
              },
            },
          },
        ],
      },
    ]
  }

  protected override helper(schema: HaFormSchema): string | undefined {
    if (schema.name === 'tracking') return 'Space between digits in thousandths of an em.'
    return super.helper(schema)
  }

  protected override label(schema: HaFormSchema): string {
    switch (schema.name) {
      case 'font':
        return 'Time font'
      case 'tracking':
        return 'Tracking'
      case 'font_weight':
        return 'Font weight'
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
