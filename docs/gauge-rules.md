# Gauge: the rules of the shared dial

The first thing in this library that is not a card. The battery card's ring became this when it
turned out to be the shape three widgets want: a track, a mark on it, and a reading in the
middle. Everything below was either taken off the reference's own lock-screen gauges by
measuring a screenshot, or is a decision made here with the alternative it beat written beside
it.

The code is `src/ui/gauge/`: `geometry.ts` for the arithmetic, `gauge.ts` for the stylesheet and
the template, and a `*.test.ts` beside each. It is **not a custom element**, and `gauge.ts`'s
own comment carries that argument at length; the short version is that the `--cw-*` tokens are
declared on a card's `:host`, `--cw-scale` is set inline on that same element and `[dark]` is
reflected onto it, so a nested shadow root would be a component that either fights the token
layer or cannot use it.

> This is a component specification, not a widget one. There is no footprint here, no row
> budget and no `cwLayout`: a card measures its box, decides how large a gauge is, and hands
> the diameter over as one CSS length. What this file describes is everything that happens
> inside that circle.

---

## 1. What a gauge is made of

```
track      the whole sweep, in --cw-gauge-track, round-capped
mark       the value: an arc from the start of the sweep, or a dot on the track
knockout   a hole punched in the track under a dot, in the card's surface colour
middle     a reading, a caption under it, a glyph under that: each drawn when given
ends       two readings hung in the notch, one at each end of the scale
overlay    anything the card wants drawn over the top, positioned by the card
```

The dial and its marks are SVG in a `viewBox` of 100 by 100; the readings are HTML positioned
over it. That split is deliberate. Everything belonging to the circle scales with the diameter
for free, and text gets `--cw-font`, tabular figures and the theme's ink, none of which an SVG
`<text>` has. The box being **100 units square** is what lets the two meet: a box unit is also a
percent of the box, so the point that places a circle places a label.

## 2. The two sweeps

A sweep is where the track starts and how far it runs, in clock degrees, clockwise from twelve.

| name        | start | extent | drawn by                      |
| ----------- | ----- | ------ | ----------------------------- |
| `FULL_TURN` | 0     | 360    | the battery card's ring       |
| `OPEN_DIAL` | 225   | 270    | everything with a notch in it |

**The dial's 270 degrees are measured, not chosen.** Thresholding the reference's screenshot and
sweeping the annulus a degree at a time puts the ink between 219 and 141 degrees. A round cap
adds half a stroke past each end of the dash, 7.3 degrees at the reference's proportions, so the
geometric track is 225 to 135: a 90 degree notch centred on six o'clock. Our own cap is
`GAUGE_STROKE / 2 / GAUGE_RADIUS`, 6.4 degrees, so what this library draws is 282.7 degrees of
ink and a **visible** notch of 77.3. That is the number to compare against a screenshot.

The notch is not decoration. It is what gives the two end readings somewhere to sit and keeps
the bottom of the dial from competing with the caption inside it.

Two numbers rather than a named list of shapes, which is the opposite of what `core/size.ts`
does for card layouts, and for a reason that does not carry here: a third card width would be a
shape nobody designed, while a half dial is a perfectly designed gauge that nothing has needed
yet.

## 3. The stroke, and the coordinate space

Stroke is **10% of the diameter**, with round caps, and both the track and the arc are drawn
with it. Ten and not the 13 that the reference's 8-of-62 comes to: that proportion is right on a
62pt ring and reads as a band at the 96 units a card draws at the design footprint. The
reference's own dials run at 11%, which is the same number once rounding is allowed for.

Everything is in box units, so a card never sees a pixel of this and `--cw-scale` never enters
into it: the diameter arrives already scaled, as `--cw-gauge-size`, and every length inside is a
fraction of that.

## 4. A value against its scale

`fractionFor(value, min, max)` is 0 at `min` and 1 at `max`, and:

- **clamped at both ends.** The sensor that reports 105 after a firmware update gets a full arc
  rather than one that wraps back over itself. A dial pinned to its end is a reading, not a bug:
  a temperature below this morning's low at five in the morning is exactly that, and the number
  in the middle of the gauge is the one that has not been clamped.
- **`null` for a reading there is not one of**, and that includes a value that is not a finite
  number and a `min` or `max` that is not either. Nothing is drawn but the track.
- **`null` for a scale with no width to it** (`max <= min`), which is a still day where today's
  low and today's high are the same number. The alternative was to put the mark in the middle,
  on the argument that the middle of a track whose two ends read alike is the least wrong place
  to stand. It was refused because it draws exactly like a reading halfway up a real scale, and
  a mark that cannot be told from a measurement is worse than no mark at all beside a reading
  the card is already printing.

## 5. The mark

**`arc`** fills from the start of the sweep to the value: a **quantity**, how much of the scale
has been used up. A battery level, an index against a ceiling.

**`dot`** marks the position and fills nothing: a **place**, where in today's range this
temperature is. Filling that from the left would say the morning's low is somehow contained in
the afternoon's reading.

Not a pair of independent switches, because the reference has no gauge wearing both: its
temperature dial was measured for it and the track is one tone the whole way round, 176 to 186
of 255 against a moving background, with only the dot at 252. They are computed from the same
fraction, so the day something does want both, it is a union to widen.

**The shortest arc is one box unit.** With a round cap that paints exactly one dot of the
stroke's width, which is the reading a 1% battery deserves. Deliberately not a floor of the
stroke width, which is the obvious answer and is wrong by twice over: a cap adds half a stroke
beyond each end, so a dash of one stroke draws two long and a 1% battery would read as 7%. It is
a length rather than a share, so it is the same smallest mark on any sweep; the cost is that the
mark it paints is 3.9% of the full turn and 5.2% of the shorter 270 degree dial, and `arcFor`
holds it below the length of the track it is drawn on.

**Zero is not the same as no reading**, and the gauge does not try to tell them apart: both are
a bare track. The card says `0%` for one and a dash for the other.

**The dot is the stroke's own width, on the centreline, with a hole punched under it.** All
three are measured. Sweeping the reference a degree at a time, the dot's ink ends 7.3 degrees
from its centre and the track's resumes at about 9, so the hole is 1.4 times the dot's radius. A
ratio and not an addition: `+ 2` is the same 7 units at a stroke of 10 and quietly stops being
1.4 at any other stroke. On the phone that hole is a hole and the wallpaper shows through; on a
card it is filled with `--cw-surface`, which is the same trade the battery card's charging badge
already makes and fails the same way, on a gauge drawn over something that is not the card's
surface. `--cw-gauge-knockout` is the way out.

One visible consequence, and it is the intended trade: at the very top or bottom of the scale
the dot sits on the track's end, the hole eats the round cap, and the dial reads about nine
degrees shorter than at any other value. The alternative was to inset the dot's travel so it
never reaches the ends, which buys a track of constant length by making a reading at the top of
the scale stop short of the top of the dial: a quieter picture telling a small lie, against a
truthful one with a chipped end.

## 6. The middle

A stack, drawn in this order and each piece when it is given: the **reading** large, a
**caption** under it, a **glyph** under that. There is no rule to remember about which is which:
the reading and the glyph are each sized by whether they stand alone, so a middle that is one of
them is drawn as the middle. That is what makes the battery card's icon-only ring the same code
path as a humidity dial's number and droplet. The caption has one size only, because a word is a
label for something and a gauge whose whole middle is a label is not a gauge anybody draws.

Every size is a fraction of the diameter, fitted off the reference by fitting a circle to each
dial's ink and measuring the cap heights against it:

| piece                         | fraction | fitted from                  |
| ----------------------------- | -------- | ---------------------------- |
| reading, alone                | 0.42     | 30.4 units of cap height     |
| reading, with a line under it | 0.30     | 22.1 units                   |
| caption                       | 0.10     | 6.8 units                    |
| glyph, alone                  | 0.45     | the reference's 28 of 62     |
| glyph, under a reading        | 0.16     | the reference's sun, rounded |

The two reading sizes are picked by `:only-child` rather than by a flag, which works because
lit's markers are comments rather than elements. A reading of more than three glyphs at 0.42
starts to crowd the ring; `--cw-gauge-value-scale` is the way down.

## 6a. The two end readings

Hung by the edge nearest their end of the track, on the centreline, 8 degrees into the notch,
and grown **inwards**. Fitted off the reference's temperature dial: its low reading's left edge
and its high reading's right edge both land on the centreline, 3.5 and 2.5 degrees past their
ends of the track.

Anchored and not centred, and that is the whole rule. Centred on the same points, a two-glyph
reading reaches back under the end cap and a three-glyph one sits on it, which is a collision no
test can see and no card can price, because neither the readings nor the middle are in flow.
Anchored, the width a card adds grows towards six o'clock, where the worst that can happen is
that the two readings meet each other in the open.

Eight degrees rather than the reference's three: its own low reading starts inside its cap and
gets away with it because a digit's side bearing and a round cap are both mostly empty where
they meet, and because that widget is drawn in translucent ink over a wallpaper. Ours is solid.
The inset is capped at a quarter of the notch as well, so a sweep with less room than the dial
cannot cross its two readings over.

Type is **0.12** of the diameter, and it is the one size here that is not the reference's. Its
own end readings are 13.5 units of cap height, which is 0.19, and that is a size chosen for what
it prints: bare numerals, 8 and 23. A card prints what a sensor means, so the pair is 8° and
24°, or -12° and 104°, and the anchors are 54.2 box units apart, which is what the pair has to
fit inside. Measured in a browser at this library's font stack, a -12° and 104° pair comes to
56.6 units at 0.13, which overlaps by two; at 0.12 it is 52.4 with about two units to spare, so
0.12 holds four glyphs a side and that is the ceiling. A pair wider than that wants `--cw-gauge-end-scale` turned down, or the unit dropped,
which is what the reference does.

Two arrangements this beat. Outside the ring, level with the ends: that is a legend rather than
a scale, and it costs the card the width of two readings on either side of a box it has already
measured. A row at the foot of the box with the pair pushed into its two corners: the same
numbers, no polar arithmetic, and they stop pointing at anything the moment the sweep is not 270
degrees.

**End readings have a floor.** They are out of flow, so no `layout.ts` can price them, and the
type is a fraction of the diameter, so a dial below about 90 design units prints them under
11px, which is smaller than any type in the library (the scale is 0.12, and 11 over that is 92).
A card that small should be leaving them off, the way the battery card drops its captions.

## 7. Colour

One colour at every value. Nothing here thresholds a reading into amber or red: the length of
the arc, or the place of the dot, is already the reading, and a colour changing underneath it is
a second, coarser one that disagrees with the first. The battery card's §7 is the same argument
at length, and it is stated there rather than here because it is a card's decision.

The mark defaults to `--cw-label`, the card's own ink, which is what the reference draws its
dials in. Deliberately not `--cw-accent`: that would make every gauge in the library the
installation's primary colour, which is the trade the reminders card refused for its headings. A
card that wants a colour says so: the battery card sets `--cw-gauge-mark: var(--cw-green)`.

Every token read here (`--cw-track`, `--cw-label`, `--cw-label-secondary`, `--cw-surface`,
`--cw-font`) resolves because the sheet lands in a card's root where `theme/tokens.ts` has
declared them. There are no literal colours behind them, because rule 1 says the bridge lives in
one file. The consequence is a limit worth knowing: a root with no tokens, which is what
`core/card-editor.ts` ships on purpose, draws this with no track at all, a black knockout and
unweighted type.

## 8. Size, and what must never be priced against it

`--cw-gauge-size` is the diameter, it is required, and it arrives **already multiplied by
`--cw-scale`**. Nothing inside multiplies by the factor a second time.

A card that forgets it draws nothing, and that is arranged rather than hoped for: the fallback
is 0, because an undefined custom property makes the declaration invalid at computed-value time,
`width` falls back to `auto`, and an SVG at `100%` of an auto-width box is the specification's
own 300 by 150. A 300px gauge inside a 250px card is a plausible-looking accident; nothing at
all is a bug report.

Type sized as a fraction of a measured box is not what the rest of the library does, and it is
safe here because **nothing budgets against it**. No `layout.ts` prices a row off the middle of a
gauge. The one piece of type that is priced, the battery card's percentage, stays outside the
gauge, where `LABEL` 28 and `LABEL_WIDTH` 64 go on describing it. If a reading ever moves inside
one, those two numbers stop describing anything.

The knobs are **unitless fractions** rather than lengths, and that had to be designed rather than
chosen: a length knob invites `calc(11px * var(--cw-scale))` from a card that remembered rule 2
and `11px` from one that did not, and the first of those scales twice on a diameter that is
already scaled.

| knob                       | default                                               |
| -------------------------- | ----------------------------------------------------- |
| `--cw-gauge-size`          | required                                              |
| `--cw-gauge-track`         | `--cw-track`                                          |
| `--cw-gauge-mark`          | `--cw-label`                                          |
| `--cw-gauge-knockout`      | `--cw-surface`                                        |
| `--cw-gauge-ink`           | `--cw-label`                                          |
| `--cw-gauge-end-ink`       | `--cw-label-secondary`                                |
| `--cw-gauge-value-scale`   | 0.42 alone, 0.30 stacked                              |
| `--cw-gauge-caption-scale` | 0.10                                                  |
| `--cw-gauge-glyph-scale`   | 0.45 alone, 0.16 stacked                              |
| `--cw-gauge-end-scale`     | 0.12                                                  |
| `--cw-gauge-centerline`    | published, not set: where the middle of the stroke is |

## 9. What a card is responsible for

- **Composing `gaugeStyles`** into its own `static styles`, after `CupertinoCard.styles`. The
  gauge has no shadow root of its own, so a card that calls `renderGauge` without that sheet
  draws unstyled markup. `src/cards/battery/battery-card.ts` is the worked example.
- **The accessible name.** The dial is `aria-hidden`: it is a picture of a number. The battery
  card names its cell, and any card with a tap target does the same. The middle's text is left
  readable, because for a card whose subject is that one reading it is the headline.
- **Formatting.** `reading`, `caption` and `ends` are strings, units and rounding included.
- **The size**, from its own measurement of its own box.
- **Whether an end reading fits**, per §6a.

## 10. The three call sites

The battery card's ring, which is the one that exists:

```ts
renderGauge({
  value: device.level, // 0-100 already, so min and max are the defaults
  sweep: FULL_TURN,
  mark: 'arc',
  glyph: device.icon,
  overlay: device.charging ? CHARGING_BADGE : nothing,
})
```

A temperature dial, which is the shape this component was generalised for:

```ts
renderGauge({
  value: current,
  min: low,
  max: high,
  mark: 'dot',
  reading: `${Math.round(current)}°`,
  ends: { min: `${Math.round(low)}°`, max: `${Math.round(high)}°` },
})
```

A humidity dial, which is the same dial with nothing at the ends:

```ts
renderGauge({
  value: humidity,
  mark: 'dot',
  reading: `${Math.round(humidity)}%`,
  glyph: 'mdi:water-percent',
})
```

## 11. What it deliberately does not do

- **No colour thresholds** (§7), **no animation**, and no reading of Home Assistant: a gauge is
  handed numbers.
- **No band**, an arc between two values rather than from the start of the sweep to one. It is
  the general case that the arc is the special case of, and it would cost an offset returned
  alongside the dash. It is not here because nothing draws one, and because the reference's
  temperature dial was measured for it and does not (§5).
- **No tick marks.** Nothing in the reference's widgets has them; they belong to its watch faces.
- **No gradient along the arc.** It would need an SVG `id`, and with no shadow root of its own
  there is no id space: two gauges in one card would collide. It needs a scheme before it can
  exist.
- **No decision about its own size** (§8).

## 12. Where the tests are

`geometry.test.ts` covers the arithmetic, including the battery ring's own cases carried over
from the module this grew out of. `gauge.test.ts` covers the template, by flattening lit's
`TemplateResult` back into markup in the same `node` environment the rest of the suite runs in.
That second file exists because everything the drawing can get wrong is invisible to `tsc`, to
the geometry tests and to `pnpm shots` alike: the guard that keeps a zero-length dash from
painting a full-stroke dot at twelve o'clock is one `arc > 0` in a template, and nothing else
can see it.
