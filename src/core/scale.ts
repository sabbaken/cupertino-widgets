/**
 * `scale`: how big the widget is drawn, as a percentage of the size it was designed at.
 *
 * The first option in this library that is about the room the card is in rather than
 * about its data, and the reason it exists: a widget on a phone is held at arm's length,
 * the same widget on a tablet screwed to a hallway wall is read from across the room, and
 * a dashboard nobody works in wants larger type than one somebody does. Home Assistant's
 * Layout tab settles how much space a card gets and nothing else: a card dragged twice
 * as wide still draws 17px type, only more of it, so how large to draw that type is a
 * question the card has to answer for itself. 100% is the answer it used to give
 * everybody.
 *
 * ## What moves
 *
 * One factor, everything at once: type, spacing, insets, the radius of a row's chip. The
 * card at 120% is the card at 100% seen from closer up, and that is the point: a widget
 * whose type grew while its padding stood still is a different, worse layout rather than
 * the same one bigger. Two things deliberately do not move, and both belong to Home
 * Assistant rather than to us: `ha-card`'s corner radius, which has to agree with the
 * cards sitting next to it on the dashboard, and its 1px border.
 *
 * ## The two halves have to agree
 *
 * Scaling is drawn in CSS (`--cw-scale`, which `tokens.ts` multiplies its lengths by)
 * and *budgeted* in arithmetic: `layout.ts` prices a row of content in pixels, so it has
 * to be told the same number, and it works in design units by dividing the measured box
 * by the factor rather than by multiplying every constant it holds. Those two are one
 * mechanism in two languages. Move one without the other and the card either budgets rows
 * it cannot draw or leaves a strip of the box blank.
 *
 * Which is also why `--cw-scale` is not a theme hook. A stylesheet that set it would
 * change what is drawn without changing what was budgeted, and the card would clip its
 * last row with no way of knowing.
 */
import { t } from './i18n'
import type { HaFormSchema } from './types/ha'

/** The config key, and the name of the row in every card's editor. */
export const SCALE_FIELD = 'scale'

/** Percent, not a factor: `scale: 110` cannot be misread, where `scale: 1.1` invites it. */
export const DEFAULT_SCALE = 100

/**
 * The floor, and it is a real one rather than a round number.
 *
 * Smaller type means more content fits the same box, which includes fitting *two columns*
 * of it: `layoutFromBox` compares the design width of the card against
 * `LAYOUT_THRESHOLD`, so shrinking the type walks a card towards the wide layout. The 6×4
 * square (the footprint the small layout was designed for and the one the README shows)
 * is ~246px in a typical section, and 246 / 0.73 crosses that threshold. So below roughly
 * 73% the square quietly becomes two narrow columns, which is a different widget. 80%
 * keeps clear of it.
 */
export const MIN_SCALE = 80

/**
 * The ceiling, from the same rule read the other way.
 *
 * A full-width card is ~500px, and 500 / 1.47 is where *it* would fold to a single
 * column, so the arithmetic permits rather more than this. The limit here is the design
 * instead: past about 130% the date numeral dominates a default-height card and the row
 * budget it leaves is two or three, which is a poster rather than a widget. Anyone who
 * wants that can have it by dragging the card taller as well.
 */
export const MAX_SCALE = 130

/** The editor slider's granularity. Nothing enforces it on a config; see `scaleFactor`. */
export const SCALE_STEP = 5

const clamp = (value: number): number => Math.min(MAX_SCALE, Math.max(MIN_SCALE, value))

/**
 * What the config says, as a multiplier, having survived being hand-written.
 *
 * Anything in `config` reaches this having been typed into a YAML box, so `"110"` (what
 * a quoted value parses to) is read as the number it plainly is, and a value outside the
 * range is clamped rather than refused. Clamped and not rejected because the arithmetic
 * itself is happy at any factor: the bounds above are about which of them the widget
 * still looks like itself at, and a config asking for 400% is better answered with a
 * card that is legibly too big than with an error where a dashboard used to be.
 */
export const scaleFactor = (value: unknown): number => {
  const percent =
    typeof value === 'number'
      ? value
      : typeof value === 'string' && value.trim() !== ''
        ? Number(value)
        : Number.NaN

  return (Number.isFinite(percent) ? clamp(percent) : DEFAULT_SCALE) / 100
}

// ---- The editor row ----------------------------------------------------------
//
// Here rather than in `card-editor.ts` so that everything about this one option is in
// one file: the bounds, what they mean, and the control that offers them.

/**
 * A slider, because the bounds are what carry the meaning.
 *
 * `ha-selector-number` draws one whenever `min` and `max` are both given, with the value
 * and its unit beside it, and falls back to a bare box without them, so the two ends of
 * the range being visible is a consequence of stating them rather than of `mode`, which
 * is set anyway to say which of the two this is meant to be.
 */
export const SCALE_ROW: HaFormSchema = {
  name: SCALE_FIELD,
  selector: {
    number: {
      min: MIN_SCALE,
      max: MAX_SCALE,
      step: SCALE_STEP,
      mode: 'slider',
      unit_of_measurement: '%',
    },
  },
}

export const SCALE_LABEL = t('common.scale')

export const SCALE_HELPER = t('common.scaleHelp')
