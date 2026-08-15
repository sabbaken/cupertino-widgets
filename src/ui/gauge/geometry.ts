/**
 * The gauge, as arithmetic.
 *
 * Everything here is in the gauge's own coordinate space rather than in pixels, and that is
 * what keeps a card's `layout.ts` and this file from having to agree about anything: the SVG
 * carries a `viewBox` of `GAUGE_BOX` square and is drawn at whatever diameter the card worked
 * out, so the stroke, the arc and the dot scale with it for free and `--cw-scale` never enters
 * into it. The one number the two halves share is the diameter, and it travels as a CSS
 * length: `--cw-gauge-size`.
 *
 * The box is 100 on purpose and not merely conveniently: a box unit is therefore also a
 * **percent of the box**, so the same point that places a circle in the SVG places an HTML
 * label over it with `left`/`top`, and the two cannot drift apart.
 *
 * This module was the battery card's `ring.ts` and is now the whole library's, which is why it
 * has grown two ideas the ring did not need:
 *
 *   a **sweep**, so the mark can run the full way round from twelve o'clock (the battery ring)
 *   or over a dial with a notch at the bottom (the shape the phone's lock-screen gauges use);
 *
 *   a **fraction**, so a value is read against a scale the card names rather than against the
 *   0 to 100 a battery level happens to be in. A temperature dial spans today's low to today's
 *   high, and the same arithmetic has to place a mark on it.
 *
 * What is deliberately NOT here: any decision about size (the card measures its box and hands
 * over a diameter), about colour (a card sets `--cw-gauge-mark`, and nothing here thresholds a
 * value into amber or red), and about what the numbers mean (formatting is the card's).
 *
 * And one thing that is not here yet, written down so the next person does not have to
 * re-derive it: a **band**, an arc between two values rather than from the start of the sweep
 * to one. It is the general case that `arcFor` is the special case of, and it would cost an
 * offset returned alongside the dash and a second value on the way in. It is not here because
 * nothing draws one: the reference's dials were measured for it and the temperature dial's
 * track is one tone the whole way round (176 to 186 of 255 against a moving background, with
 * only the dot at 252), so the mark on a dial really is a point rather than a range.
 */

// ---- The coordinate space ----

/**
 * The gauge's coordinate space, and its stroke inside it.
 *
 * A fraction of the box rather than a length, because the gauge is drawn at anything from a
 * battery card's 40 to a dial several times that, and the stroke has to stay the same share of
 * it at either end: a fixed stroke turns a small gauge into a solid disc.
 *
 * 10 rather than the 13 the battery card started at, which is what the reference's 8-of-62
 * comes to. That proportion is right on a 62pt ring and reads heavy at the 96 a card draws at
 * the design footprint: the same share of a ring half again as large is half again as much
 * ink, and the arc stops looking like a line and starts looking like a band. 10% keeps the
 * gauge legible at 40, where it is 4px of stroke, without dominating at the top. The gauges
 * measured off the reference run at 11%, which is the same number once rounding is allowed for.
 */
export const GAUGE_BOX = 100
export const GAUGE_STROKE = 10

/** Centred inside the stroke, so the ink stays within the box rather than half outside it. */
export const GAUGE_RADIUS = (GAUGE_BOX - GAUGE_STROKE) / 2
export const GAUGE_CENTER = GAUGE_BOX / 2
export const GAUGE_CIRCUMFERENCE = 2 * Math.PI * GAUGE_RADIUS

/** A point in the box, which is also a percentage of it. See the module comment. */
export interface GaugePoint {
  x: number
  y: number
}

// ---- Which way round ----

/**
 * Where the track begins and how far it runs, in **clock degrees**: 0 is twelve o'clock and
 * they increase clockwise, which is the direction every gauge in the reference fills in.
 *
 * Two numbers rather than a named list of shapes, which is the choice `core/size.ts` makes the
 * other way round for the card layouts, and for a reason that does not carry here: there, a
 * third width would be a shape nobody designed. A sweep is not a shape, it is a dimension of
 * one, and a half dial or a three-quarter one is a perfectly designed gauge that this library
 * has simply not had a use for yet. The two below are the ones it has.
 */
export interface GaugeSweep {
  /** Clock degrees at which the track starts. */
  readonly start: number
  /** How far it runs clockwise, in degrees. 360 closes the circle. */
  readonly extent: number
}

/**
 * The battery card's ring: the full way round, from twelve o'clock.
 *
 * The start matters as much as the extent, which is why it is stated rather than derived: a
 * full turn has no notch to be centred on, so nothing in the arithmetic below would otherwise
 * know that this one begins at the top.
 */
export const FULL_TURN: GaugeSweep = { start: 0, extent: 360 }

/**
 * The dial with a notch at the bottom, and both numbers are measured rather than chosen.
 *
 * Taken off the reference's own lock-screen gauges by thresholding the screenshot and sweeping
 * the annulus a degree at a time: the ink runs from 219 degrees round to 141, and a round cap
 * adds half a stroke beyond each end of the dash, 7.3 degrees at the reference's proportions.
 * So the geometric track is 225 to 135: a 270 degree sweep with a 90 degree notch centred on
 * six o'clock. Our own cap is `GAUGE_STROKE / 2 / GAUGE_RADIUS`, 6.4 degrees, so what this
 * draws is 282.7 degrees of ink and a notch of 77.3, and that is the number to expect when
 * holding a screenshot of this card against a screenshot of the reference.
 *
 * The notch is not decoration. It is what buys the two end readings a place to sit and keeps
 * the bottom of the dial from competing with the caption inside it.
 */
export const OPEN_DIAL: GaugeSweep = { start: 225, extent: 270 }

// ---- Reading a value against a scale ----

/**
 * Where a value sits on its scale, from 0 at `min` to 1 at `max`, or `null` for a value there
 * is no reading for.
 *
 * Clamped at both ends, which is the battery card's old rule generalised: the sensor that
 * reports 105 after a firmware update gets a full arc rather than one that runs past the
 * circle and starts again. A dial pinned to its end is the reading, not a bug: a temperature
 * below this morning's low at five in the morning is exactly the case, and the reading in the
 * middle of the gauge is the number that has not been clamped.
 *
 * A scale with no width to it (`max <= min`, a still day where today's low and today's high
 * are the same number) has no position to report, so it reports none and the mark is not
 * drawn. The alternative was 0.5, on the argument that the middle of a track whose two ends
 * read alike is the least wrong place to stand: it was refused because it draws exactly like a
 * reading halfway up a real scale, and a mark that cannot be told from a measurement is worse
 * than no mark beside a reading the card is already printing in the middle.
 */
export const fractionFor = (
  value: number | null | undefined,
  min: number,
  max: number,
): number | null => {
  if (value === null || value === undefined || !Number.isFinite(value)) return null
  if (!Number.isFinite(min) || !Number.isFinite(max) || max <= min) return null
  return Math.min(1, Math.max(0, (value - min) / (max - min)))
}

// ---- The track, the arc and the dot ----

/**
 * The shortest arc there is, for a fraction that is not zero.
 *
 * One unit of the box, which with a round cap paints exactly one dot of the stroke's diameter:
 * the smallest mark the gauge can make, and the reading a 1% battery deserves. The cap is not
 * an assumption here, it is `.cw-gauge-arc` in `gauge.ts`, and the two have to move together.
 *
 * Deliberately not the stroke width, which is the obvious answer and is wrong by twice over: a
 * round cap adds half a stroke beyond each end of the dash, so a dash of one stroke is drawn
 * two long and a 1% battery would show an arc the length of a 7% one. The cap is already the
 * thing that guarantees a visible mark, so the floor only has to be positive.
 *
 * A length rather than a share of the track, so it is the same smallest mark on any sweep. The
 * cost is that it is a larger share of a shorter one: the mark it paints, one unit of dash plus
 * a cap at each end, is 3.9% of the full turn and 5.2% of the 270 degree dial. That is the
 * right direction to be wrong in, since the point of the floor is to be seen at all, but it
 * does mean `arcFor` has to hold it below the length of the track it is drawn on rather than
 * trusting it to be small.
 */
const MIN_ARC = 1

/** How long the track is, in the gauge's own units: the whole path at a full turn. */
export const trackLength = (sweep: GaugeSweep): number =>
  (Math.min(360, Math.max(0, sweep.extent)) / 360) * GAUGE_CIRCUMFERENCE

/**
 * The dash the track is drawn with, or `null` for a track that has no ends.
 *
 * A closed circle is drawn with no `stroke-dasharray` at all rather than with one the length
 * of its own path, and there are two reasons, one of them historical. A dash of precisely the
 * circumference joins its own tail, and whether that join is seamless depends on the browser
 * agreeing with `2 * Math.PI * r` to the last double; and the battery card drew its track with
 * no dash at all before this module existed, so the absent attribute is also what makes the
 * move from there to here provably nothing to look at.
 */
export const trackDash = (sweep: GaugeSweep): number | null =>
  sweep.extent >= 360 ? null : trackLength(sweep)

/**
 * How long to draw the value's arc, in the gauge's own units.
 *
 * Zero for a fraction of zero and for one that cannot be read: in both cases the gauge is its
 * track and nothing else, which are two different statements that happen to look alike. It is
 * the card that tells them apart, in the reading it puts in the middle: `0%` in the first case
 * and a dash in the second, and where there is no reading, in the dimmed glyph.
 */
export const arcFor = (fraction: number | null, sweep: GaugeSweep): number => {
  // `!(fraction > 0)` rather than `<= 0`, so a NaN handed straight to this exported helper
  // falls into the same branch as a null instead of through it: `renderGauge` only ever passes
  // what `fractionFor` returned, but nothing stops a card from calling this itself.
  if (fraction === null || !(fraction > 0)) return 0
  const length = trackLength(sweep)
  if (length <= 0) return 0
  return Math.min(length, Math.max(MIN_ARC, Math.min(1, fraction) * length))
}

/**
 * The `stroke-dasharray` for a length of ink: the ink, and then a gap longer than the path.
 *
 * The gap is the whole circumference and not the rest of the track, which is the tidier-looking
 * arithmetic and is wrong: a pattern shorter than the path repeats, and on a 270 degree dial
 * half an arc paired with its own complement paints a second stub inside the notch, where the
 * track has no ink at all. Verified in a browser rather than reasoned about.
 *
 * One more thing to know before touching this: a browser's `<circle>` is four Béziers and
 * measures 282.2866, not the 282.7433 that `2 * Math.PI * r` gives. Everything here is
 * consistent because both circles are dashed in the same units, but a dash end and the
 * trigonometric point of `pointAt` disagree by about 0.4 degrees at the far end of a sweep.
 */
export const dashArray = (ink: number): string => `${ink} ${GAUGE_CIRCUMFERENCE}`

/**
 * How far the dash pattern has to be turned to start where the sweep does.
 *
 * An SVG circle starts at three o'clock, so every sweep owes the arithmetic a quarter turn
 * before its own start is added.
 */
export const rotationFor = (sweep: GaugeSweep): number => sweep.start - 90

/** The point on the stroke's centreline at a fraction of the way along the sweep. */
export const pointAt = (fraction: number, sweep: GaugeSweep): GaugePoint => {
  // Clamped, and a NaN clamps to the start rather than through the arithmetic: see `arcFor`.
  const along = Number.isFinite(fraction) ? Math.min(1, Math.max(0, fraction)) : 0
  const degrees = sweep.start + along * sweep.extent
  const radians = (degrees * Math.PI) / 180
  return {
    x: GAUGE_CENTER + GAUGE_RADIUS * Math.sin(radians),
    y: GAUGE_CENTER - GAUGE_RADIUS * Math.cos(radians),
  }
}

/**
 * The dot that marks a value, and the hole punched under it.
 *
 * The dot is exactly the stroke's width, measured off the reference: it sits on the centreline
 * and takes up the track's own band rather than bulging out of it, which is worth pinning
 * because it looks larger than that on a screen and the reason is the hole rather than the dot.
 *
 * The hole is what makes it read as a separate mark: sweeping the reference a degree at a time,
 * the dot's own ink ends 7.3 degrees from its centre and the track's resumes at about 9, so a
 * disc of 1.4 times the dot's radius is punched through the track beneath it. A ratio and not
 * an addition, so that the whole mark stays a proportion of the stroke the way everything else
 * in this file does: `+ 2` is the same 7 units at a stroke of 10 and quietly stops being 1.4 at
 * any other stroke.
 *
 * On the phone that hole is genuinely a hole and the wallpaper shows through. On a card it is
 * filled with the card's own surface, which is the same trade the battery card's charging
 * badge already makes, and it fails in the same way: a gauge drawn on something other than the
 * card's surface shows a disc of the wrong colour. `--cw-gauge-knockout` is the way out.
 */
export const MARK_DOT = GAUGE_STROKE / 2
export const MARK_KNOCKOUT = MARK_DOT * 1.4

// ---- The two end readings ----

/**
 * Where the end readings sit, and this is an **anchor** rather than a centre.
 *
 * Fitted off the reference's temperature dial: a circle fitted to the arc's ink puts the
 * centreline at 45 units, and the low reading's left edge and the high reading's right edge
 * then land on that same 45, 3.5 and 2.5 degrees past their ends of the track. So the pair is
 * hung by the edge nearest the track and grows **into** the notch, which is the only direction
 * with room in it: the outward direction is occupied by the end cap.
 *
 * That is worth more than it looks. Centred on the same points, a two-glyph reading reaches
 * back under the cap and a three-glyph one sits on it, which is a collision no test can see and
 * no card can price, because neither the readings nor the middle are in flow. Anchored, the
 * width a card adds grows towards six o'clock, where the worst that can happen is that the two
 * readings meet each other in the open.
 *
 * 8 degrees rather than the reference's 3: the reference's own low reading starts inside its
 * cap and gets away with it because a digit's side bearing and a round cap are both mostly
 * empty where they meet, and because that widget is drawn in translucent ink over a wallpaper.
 * Ours is solid. The inset is capped at a quarter of the notch as well, so that a sweep with
 * less room than the dial cannot cross its own readings over.
 *
 * Two arrangements it beat. Outside the ring, level with the ends: that is a legend rather than
 * a scale, and it costs the card the width of two readings on either side of a box it has
 * already measured. A row at the foot of the box with the pair pushed to its two corners: the
 * same numbers, no polar arithmetic, and they stop pointing at anything the moment the sweep is
 * not 270 degrees.
 */
const END_INSET = 8

/**
 * The two anchors, or `null` when the sweep has no notch to put them in.
 *
 * A full turn gets `null` rather than a pair of points on top of each other at twelve o'clock,
 * and the caller draws nothing: end readings are a property of a dial, not of a ring, and there
 * is nowhere on a closed circle for them to go. A sweep of nothing at all gets `null` too: two
 * readings labelling a track that was never drawn.
 *
 * The `min` anchor is the **left** edge of the low reading and the `max` anchor is the **right**
 * edge of the high one; `gauge.ts` is what turns that into `left` and `right`.
 */
export const endPointsFor = (sweep: GaugeSweep): { min: GaugePoint; max: GaugePoint } | null => {
  const notch = 360 - sweep.extent
  if (notch <= 0 || sweep.extent <= 0) return null

  const inset = Math.min(END_INSET, notch / 4)
  const at = (degrees: number): GaugePoint => {
    const radians = (degrees * Math.PI) / 180
    return {
      x: GAUGE_CENTER + GAUGE_RADIUS * Math.sin(radians),
      y: GAUGE_CENTER - GAUGE_RADIUS * Math.cos(radians),
    }
  }

  return {
    min: at(sweep.start - inset),
    max: at(sweep.start + sweep.extent + inset),
  }
}
