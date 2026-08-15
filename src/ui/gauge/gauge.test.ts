import { html } from 'lit'
import { describe, expect, it } from 'vitest'

import {
  FULL_TURN,
  GAUGE_CENTER,
  GAUGE_CIRCUMFERENCE,
  OPEN_DIAL,
  endPointsFor,
  pointAt,
  trackLength,
} from './geometry'
import { renderGauge, type GaugeSpec } from './gauge'

/**
 * What a gauge would put in the DOM, as a string, without a DOM.
 *
 * A lit `TemplateResult` is plain data: `strings` is the literal it was written as and `values`
 * are the expressions in the holes, nested templates included. Flattening the two back together
 * gives markup close enough to assert against, and it keeps this test in the `node` environment
 * the whole suite runs in. It is worth the twenty lines: everything the rendering half can get
 * wrong is invisible to `tsc` (a template is opaque to it), invisible to `geometry.test.ts`
 * (which only sees the arithmetic) and invisible until a card is looked at.
 */
const markup = (value: unknown): string => {
  if (value === null || value === undefined) return ''
  if (Array.isArray(value)) return value.map(markup).join('')
  if (typeof value === 'object' && 'strings' in value && 'values' in value) {
    const template = value as { strings: readonly string[]; values: readonly unknown[] }
    return template.strings.reduce(
      (out, part, index) => out + part + markup(template.values[index]),
      '',
    )
  }
  return String(value)
}

const drawn = (spec: GaugeSpec): string => markup(renderGauge(spec))

/** Every number the template interpolates, in order. */
const numbersIn = (value: unknown): number[] => {
  if (typeof value === 'number') return [value]
  if (Array.isArray(value)) return value.flatMap(numbersIn)
  if (value && typeof value === 'object' && 'values' in value) {
    return (value as { values: readonly unknown[] }).values.flatMap(numbersIn)
  }
  return []
}

const battery = (level: number | null): GaugeSpec => ({
  value: level,
  sweep: FULL_TURN,
  mark: 'arc',
  glyph: 'mdi:battery',
})

const dial = (value: number | null, extra: Partial<GaugeSpec> = {}): GaugeSpec => ({
  value,
  min: 8,
  max: 24,
  sweep: OPEN_DIAL,
  mark: 'dot',
  reading: '14°',
  ...extra,
})

describe('what a gauge draws', () => {
  it('is a track at every value, and an arc over it only when there is one to draw', () => {
    expect(drawn(battery(72))).toContain('cw-gauge-track')
    expect(drawn(battery(72))).toContain('cw-gauge-arc')
  })

  /**
   * The one that would go unnoticed. A dash of zero with a round cap is not nothing: it paints
   * a disc of the full stroke at the start of the sweep, so an empty battery and an unreadable
   * one would each show a green pip at twelve o'clock, which is the reading §2 of the battery
   * card's rules forbids. `arcFor` returning 0 is not the guard; the template's `arc > 0` is.
   */
  it('draws no arc at all for an empty reading and for one that cannot be read', () => {
    expect(drawn(battery(0))).not.toContain('cw-gauge-arc')
    expect(drawn(battery(null))).not.toContain('cw-gauge-arc')
    expect(drawn(battery(0))).toContain('cw-gauge-track')
  })

  it('marks a dial with a dot and a hole, and neither without a reading', () => {
    expect(drawn(dial(14))).toContain('cw-gauge-dot')
    expect(drawn(dial(14))).toContain('cw-gauge-knockout')
    expect(drawn(dial(null))).not.toContain('cw-gauge-dot')
    expect(drawn(dial(null))).not.toContain('cw-gauge-knockout')
  })

  it('puts the dot where the arithmetic says, and outside the turned group', () => {
    const point = pointAt(0.375, OPEN_DIAL)
    const drawing = drawn(dial(14))
    expect(drawing).toContain(`cx=${point.x}`)
    expect(drawing).toContain(`cy=${point.y}`)
    // Inside the group it would be turned a second time and go round the dial twice, and the
    // coordinates above would still be the ones in the markup.
    expect(drawing.indexOf('cw-gauge-dot')).toBeGreaterThan(drawing.indexOf('</g>'))
  })

  it('draws one kind of mark or the other, never both', () => {
    expect(drawn(dial(14))).not.toContain('cw-gauge-arc')
    expect(drawn({ value: 50, mark: 'arc' })).not.toContain('cw-gauge-dot')
  })

  it('turns the track to the start of its sweep, and leaves a closed circle undashed', () => {
    expect(drawn(battery(50))).toContain(`rotate(-90 ${GAUGE_CENTER} ${GAUGE_CENTER})`)
    expect(drawn(battery(50))).not.toContain('stroke-dasharray=282')
    expect(drawn(dial(14))).toContain(`rotate(135 ${GAUGE_CENTER} ${GAUGE_CENTER})`)
    expect(drawn(dial(14))).toContain(
      `stroke-dasharray=${trackLength(OPEN_DIAL)} ${GAUGE_CIRCUMFERENCE}`,
    )
  })
})

describe('what a gauge puts in the middle', () => {
  it('draws each piece of the stack only when it is given one', () => {
    const full = drawn(dial(14, { caption: 'AQI', glyph: 'mdi:water-percent' }))
    expect(full).toContain('cw-gauge-value')
    expect(full).toContain('cw-gauge-caption')
    expect(full).toContain('cw-gauge-glyph')

    const bare = drawn(battery(50))
    expect(bare).toContain('cw-gauge-glyph')
    expect(bare).not.toContain('cw-gauge-value')
    expect(bare).not.toContain('cw-gauge-caption')
  })

  it('hangs the two end readings on opposite edges, and only where there is a notch', () => {
    const withEnds = drawn(dial(14, { ends: { min: '8°', max: '24°' } }))
    const ends = endPointsFor(OPEN_DIAL)
    if (!ends) throw new Error('the dial has a notch and therefore two anchors')
    // Each reading against its OWN anchor: the two are symmetric on this sweep, so asserting
    // the numbers apart from the readings would pass with the pair swapped, which is exactly
    // what `endPointsFor` pins (min is the left edge of the low reading).
    expect(withEnds).toMatch(new RegExp(`left: ${ends.min.x}%[^<]*>\\s*8°`))
    expect(withEnds).toMatch(new RegExp(`right: ${100 - ends.max.x}%[^<]*>\\s*24°`))

    const ring = drawn({ ...battery(50), ends: { min: '0%', max: '100%' } })
    expect(ring).not.toContain('cw-gauge-end')
  })

  it('draws no overlay when it was handed none, and the one it was handed when it was', () => {
    expect(drawn(battery(50))).not.toContain('cw-bolt')
    expect(drawn({ ...battery(50), overlay: html`<svg class="cw-bolt"></svg>` })).toContain(
      'cw-bolt',
    )
  })
})

describe('what a gauge refuses to put in an attribute', () => {
  /**
   * Nothing here is theoretical: `stroke-dasharray="NaN 282.7"` computes to `none`, which is a
   * SOLID stroke, so a sensor with nothing to say would read as full. `cx="NaN"` computes to 0
   * and parks the dot in the corner of the box. The guards are in `fractionFor` and in
   * `renderGauge`; this is the assertion that they are both still there.
   */
  it('never interpolates a number that is not one, whatever it is handed', () => {
    const nonsense: GaugeSpec[] = [
      { value: Number.NaN, mark: 'dot' },
      { value: 5, min: Number.NaN, max: 10, mark: 'dot' },
      { value: 5, min: Number.NEGATIVE_INFINITY, max: 100, mark: 'dot' },
      { value: 5, min: 10, max: 10, mark: 'arc' },
      { value: Number.POSITIVE_INFINITY, mark: 'arc' },
      { value: 5, mark: 'dot', sweep: { start: Number.NaN, extent: 270 } },
      // The worse half of the same guard: a NaN extent makes the track's own dash NaN, which
      // computes to `none`, which is a solid ring.
      { value: 5, mark: 'arc', sweep: { start: 225, extent: Number.NaN } },
    ]

    const broken: string[] = []
    for (const spec of nonsense) {
      const drawing = drawn(spec)
      if (/NaN|Infinity/.test(drawing)) broken.push(`${JSON.stringify(spec)} drew ${drawing}`)
      for (const number of numbersIn(renderGauge(spec))) {
        if (!Number.isFinite(number)) broken.push(`${JSON.stringify(spec)} interpolated ${number}`)
      }
    }

    expect(broken).toEqual([])
    expect(nonsense).toHaveLength(7)
  })
})
