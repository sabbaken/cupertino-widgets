import { describe, expect, it } from 'vitest'

import {
  FULL_TURN,
  GAUGE_BOX,
  GAUGE_CENTER,
  GAUGE_CIRCUMFERENCE,
  GAUGE_RADIUS,
  GAUGE_STROKE,
  OPEN_DIAL,
  arcFor,
  endPointsFor,
  fractionFor,
  pointAt,
  rotationFor,
  trackDash,
  trackLength,
  type GaugePoint,
  type GaugeSweep,
} from './geometry'

/** A battery level, read the way the battery card reads one. */
const level = (percent: number | null): number | null => fractionFor(percent, 0, 100)

/** The arc as a percentage of the track it is drawn over, which is what a reader sees. */
const drawn = (fraction: number | null, sweep: GaugeSweep = FULL_TURN): number =>
  Math.round((arcFor(fraction, sweep) / trackLength(sweep)) * 1000) / 10

/** A point read back as a clock angle: degrees clockwise from twelve. */
const clockAngleOf = (point: GaugePoint): number => {
  const degrees = (Math.atan2(point.x - GAUGE_CENTER, GAUGE_CENTER - point.y) * 180) / Math.PI
  return (degrees + 360) % 360
}

const distanceFromCenter = (point: GaugePoint): number =>
  Math.hypot(point.x - GAUGE_CENTER, point.y - GAUGE_CENTER)

describe('a value against its scale', () => {
  it('is the share of the way from one end to the other', () => {
    expect(fractionFor(0, 0, 100)).toBe(0)
    expect(fractionFor(50, 0, 100)).toBe(0.5)
    expect(fractionFor(100, 0, 100)).toBe(1)
    expect(fractionFor(14, 8, 24)).toBeCloseTo(0.375, 6)
  })

  it('reads a scale that does not start at zero, and one that runs below it', () => {
    expect(fractionFor(0, -10, 30)).toBe(0.25)
    expect(fractionFor(-10, -10, 30)).toBe(0)
  })

  /** The sensor that reports 105 after a firmware update, and the one that reports -3. */
  it('is clamped at both ends, whatever the sensor claims', () => {
    expect(fractionFor(140, 0, 100)).toBe(1)
    expect(fractionFor(-40, 0, 100)).toBe(0)
  })

  it('is nothing at all for a reading there is not one of', () => {
    expect(fractionFor(null, 0, 100)).toBeNull()
    expect(fractionFor(undefined, 0, 100)).toBeNull()
    expect(fractionFor(Number.NaN, 0, 100)).toBeNull()
    expect(fractionFor(Number.POSITIVE_INFINITY, 0, 100)).toBeNull()
    expect(fractionFor(50, Number.NaN, 100)).toBeNull()
  })

  /**
   * A still day, where today's low and today's high are the same number: a real case rather
   * than a misconfiguration, and one with no position to report. The alternative was the middle
   * of the track, which draws exactly like a reading halfway up a scale that has a width.
   */
  it('has no position to report on a scale with no width to it', () => {
    expect(fractionFor(23, 23, 23)).toBeNull()
    expect(fractionFor(23, 30, 10)).toBeNull()
  })
})

describe('the track', () => {
  it('is the whole circle at a full turn and three quarters of it on the dial', () => {
    expect(trackLength(FULL_TURN)).toBeCloseTo(GAUGE_CIRCUMFERENCE, 6)
    expect(trackLength(OPEN_DIAL)).toBeCloseTo(GAUGE_CIRCUMFERENCE * 0.75, 6)
  })

  /**
   * A closed circle is not dashed at all: a dash of exactly the circumference joins its own
   * tail, and whether that join is seamless depends on the browser agreeing with
   * `2 * Math.PI * r` to the last double. The battery ring is drawn from the attribute being
   * absent, which is also what it was before this module existed.
   */
  it('is not dashed at all where it has no ends', () => {
    expect(trackDash(FULL_TURN)).toBeNull()
    expect(trackDash(OPEN_DIAL)).toBe(trackLength(OPEN_DIAL))
  })

  it('starts where the sweep says, and an SVG circle owes it a quarter turn', () => {
    expect(rotationFor(FULL_TURN)).toBe(-90)
    expect(rotationFor(OPEN_DIAL)).toBe(135)
  })
})

describe('the arc', () => {
  it('is the fraction of the track, on either sweep', () => {
    expect(drawn(level(0))).toBe(0)
    expect(drawn(level(25))).toBe(25)
    expect(drawn(level(50))).toBe(50)
    expect(drawn(level(100))).toBe(100)
    expect(drawn(0.25, OPEN_DIAL)).toBe(25)
    expect(drawn(1, OPEN_DIAL)).toBe(100)
  })

  it('never runs past the track it is drawn over', () => {
    expect(arcFor(1, FULL_TURN)).toBeCloseTo(GAUGE_CIRCUMFERENCE, 6)
    expect(arcFor(1, OPEN_DIAL)).toBeCloseTo(GAUGE_CIRCUMFERENCE * 0.75, 6)
    expect(arcFor(4, OPEN_DIAL)).toBeCloseTo(GAUGE_CIRCUMFERENCE * 0.75, 6)
  })

  /**
   * Two ways of having no arc, and they are not the same statement: an empty battery against a
   * device that is not reporting. The gauge cannot tell them apart and does not try: the card
   * says `0%` for one and a dash for the other, and where there is no reading, the dimmed
   * glyph does it.
   */
  it('is nothing at all for an empty reading and for one that cannot be read', () => {
    expect(arcFor(0, FULL_TURN)).toBe(0)
    expect(arcFor(null, FULL_TURN)).toBe(0)
    expect(arcFor(level(null), OPEN_DIAL)).toBe(0)
  })

  /**
   * The rounded cap is what makes a 1% battery visible, so the floor only has to be positive.
   *
   * Worth pinning at the value rather than at "greater than zero", because the obvious floor is
   * the stroke width and it is wrong by twice over: a cap adds half a stroke beyond each end of
   * the dash, so a dash of one stroke draws two long and a 1% battery would read as 7%.
   */
  it('leaves a visible mark at the bottom of the range without overstating it', () => {
    expect(arcFor(level(1), FULL_TURN)).toBeGreaterThan(0)
    expect(arcFor(level(1), FULL_TURN)).toBeLessThan(GAUGE_STROKE)
    expect(arcFor(level(0.2), FULL_TURN)).toBe(1)
    expect(arcFor(0.0001, OPEN_DIAL)).toBe(1)
  })

  it('grows with the reading and never shrinks, on either sweep', () => {
    const broken: string[] = []
    let compared = 0
    for (const sweep of [FULL_TURN, OPEN_DIAL]) {
      for (let step = 1; step <= 100; step += 1) {
        const here = arcFor(step / 100, sweep)
        const before = arcFor((step - 1) / 100, sweep)
        compared += 1
        if (here < before) broken.push(`${sweep.extent}deg: ${step} draws less than ${step - 1}`)
      }
    }
    expect(broken).toEqual([])
    expect(compared).toBe(200)
  })
})

describe('a point on the dial', () => {
  it('runs clockwise from twelve on the ring', () => {
    expect(clockAngleOf(pointAt(0, FULL_TURN))).toBeCloseTo(0, 6)
    expect(clockAngleOf(pointAt(0.25, FULL_TURN))).toBeCloseTo(90, 6)
    expect(clockAngleOf(pointAt(0.5, FULL_TURN))).toBeCloseTo(180, 6)
    expect(clockAngleOf(pointAt(0.75, FULL_TURN))).toBeCloseTo(270, 6)
  })

  /** Half past seven to half past four, which is the notch measured off the reference. */
  it('runs from the bottom left to the bottom right on the dial, over the top', () => {
    expect(clockAngleOf(pointAt(0, OPEN_DIAL))).toBeCloseTo(225, 6)
    expect(clockAngleOf(pointAt(0.5, OPEN_DIAL))).toBeCloseTo(0, 6)
    expect(clockAngleOf(pointAt(1, OPEN_DIAL))).toBeCloseTo(135, 6)
  })

  it('is on the stroke centreline and inside the box, at every reading', () => {
    const broken: string[] = []
    let checked = 0
    for (const sweep of [FULL_TURN, OPEN_DIAL]) {
      for (let step = 0; step <= 100; step += 1) {
        const point = pointAt(step / 100, sweep)
        checked += 1
        if (Math.abs(distanceFromCenter(point) - GAUGE_RADIUS) > 1e-9) {
          broken.push(`${sweep.extent}deg at ${step}: off the centreline`)
        }
        const inside = [point.x, point.y].every(
          axis => axis >= GAUGE_STROKE / 2 && axis <= GAUGE_BOX - GAUGE_STROKE / 2,
        )
        if (!inside) broken.push(`${sweep.extent}deg at ${step}: ink outside the box`)
      }
    }
    expect(broken).toEqual([])
    expect(checked).toBe(202)
  })

  it('is clamped to the sweep, so a reading off the scale cannot leave the track', () => {
    expect(pointAt(4, OPEN_DIAL)).toEqual(pointAt(1, OPEN_DIAL))
    expect(pointAt(-1, OPEN_DIAL)).toEqual(pointAt(0, OPEN_DIAL))
  })
})

describe('the two end readings', () => {
  it('has nowhere to go on a closed circle, or on a sweep that was never drawn', () => {
    expect(endPointsFor(FULL_TURN)).toBeNull()
    expect(endPointsFor({ start: 0, extent: 0 })).toBeNull()
    expect(endPointsFor({ start: 0, extent: -90 })).toBeNull()
  })

  it('anchors in the notch, past each end of the track, on one shared baseline', () => {
    const ends = endPointsFor(OPEN_DIAL)
    if (!ends) throw new Error('the dial has a notch and therefore two anchors')

    expect(ends.min.y).toBeCloseTo(ends.max.y, 6)
    expect(GAUGE_BOX - ends.max.x).toBeCloseTo(ends.min.x, 6)
    expect(clockAngleOf(ends.min)).toBeCloseTo(217, 6)
    expect(clockAngleOf(ends.max)).toBeCloseTo(143, 6)
    // On the stroke's centreline, which is where the reference hangs them, and below the middle.
    expect(distanceFromCenter(ends.min)).toBeCloseTo(GAUGE_RADIUS, 6)
    expect(ends.min.y).toBeGreaterThan(GAUGE_CENTER)
  })

  /**
   * The low reading is hung by its left edge and the high one by its right, so the two grow
   * towards each other. They must therefore start in that order, and on a narrow notch a fixed
   * inset would have swapped them: at a sweep of 350 degrees the pair would each be 8 degrees
   * into a 10 degree notch and the low reading would be drawn to the right of the high one.
   */
  it('keeps the low reading to the left of the high one, however narrow the notch', () => {
    const broken: string[] = []
    let checked = 0
    for (let extent = 10; extent < 360; extent += 5) {
      const ends = endPointsFor({ start: 180 + (360 - extent) / 2, extent })
      checked += 1
      if (!ends) {
        broken.push(`${extent}deg: no anchors for a sweep with a notch`)
        continue
      }
      if (ends.min.x >= ends.max.x) broken.push(`${extent}deg: the readings cross over`)
    }
    expect(broken).toEqual([])
    expect(checked).toBe(70)
  })
})
