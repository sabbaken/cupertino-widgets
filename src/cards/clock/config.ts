/** Clock configuration uses the same entity rows as the standalone complications card. */
import { t } from '../../core/i18n'
import type { ComplicationsCardConfig } from '../complications/complication-card-base'
import { finiteNumber } from '../complications/model'

export const CLOCK_COMPLICATION_LIMIT = 4
export const CLOCK_COMPLICATION_APPEARANCE = 'monochrome'

export const CLOCK_TRACKING = { min: -100, max: 100, step: 5, default: -55 }
export const CLOCK_FONT_WEIGHT = { min: 100, max: 900, step: 50, default: 650 }

export const clockTypography = (config?: ClockCardConfig) => ({
  tracking:
    Math.max(
      CLOCK_TRACKING.min,
      Math.min(CLOCK_TRACKING.max, finiteNumber(config?.tracking) ?? CLOCK_TRACKING.default),
    ) / 1000,
  weight: Math.max(
    CLOCK_FONT_WEIGHT.min,
    Math.min(CLOCK_FONT_WEIGHT.max, finiteNumber(config?.font_weight) ?? CLOCK_FONT_WEIGHT.default),
  ),
})

export const CLOCK_FONTS = [
  { value: 'system', label: t('clock.systemFont'), family: 'var(--cw-font)' },
  { value: 'rounded', label: t('clock.rounded'), family: 'ui-rounded, system-ui, sans-serif' },
  { value: 'Avenir Next', label: 'Avenir Next', family: '"Avenir Next", var(--cw-font)' },
  { value: 'DIN Alternate', label: 'DIN Alternate', family: '"DIN Alternate", var(--cw-font)' },
  { value: 'Futura', label: 'Futura', family: 'Futura, var(--cw-font)' },
  { value: 'monospace', label: t('clock.monospace'), family: 'ui-monospace, monospace' },
] as const

export const clockFontFamily = (font: unknown): string => {
  if (typeof font !== 'string' || !font.trim()) return CLOCK_FONTS[0].family
  if (font === 'serif') return 'Georgia, ui-serif, serif'
  const preset = CLOCK_FONTS.find(option => option.value === font)
  return preset?.family ?? `"${CSS.escape(font)}", var(--cw-font)`
}

export interface ClockCardConfig extends ComplicationsCardConfig {
  font?: string
  tracking?: number
  font_weight?: number
  weather_entity?: string
  show_date?: boolean
  show_background?: boolean
}
