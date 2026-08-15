/**
 * The gauge: a track, a mark on it, and something in the middle.
 *
 * The library's first shared piece of widget, and it is deliberately **not a custom element**.
 * Three reasons, in the order they would bite:
 *
 *   **The token layer belongs to the card's `:host`.** `theme/tokens.ts` declares every `--cw-*`
 *   on `:host` and its dark twin on `:host([dark])`, `base-card.ts` reflects `dark` onto the
 *   card element and writes `--cw-scale` inline on it. An element with a shadow root of its own
 *   would have to either import those tokens, and then its own `:host { --cw-scale: 1 }` beats
 *   the factor the card set an element up the tree, and its `:host([dark])` never matches
 *   because the attribute is not on it, or import nothing and live on what it inherits. The
 *   second works. It also means a component that cannot use the library's own colour
 *   arrangement for anything of its own, which is a strange thing to build on purpose.
 *
 *   **The registry keeps the first definition.** `core/register.ts` skips a duplicate
 *   `customElements.define` with a warning, which is the right answer for a card or an editor:
 *   the two copies are two versions of the same thing and either of them draws a card. A gauge
 *   is not a version of anything, it is a dependency, so the same rule would hand a v2 card the
 *   v1 gauge, which reads the spec it knows and silently ignores the rest.
 *
 *   **No boundary is worth more here than encapsulation.** The classes below land in the
 *   calling card's shadow root, so a card styles a gauge internal for its own state in plain
 *   CSS: the battery card's `.cell.unknown .cw-gauge-glyph { opacity: 0.4 }` is one line, where
 *   through an element it would have been a `::part` and an exported name for every piece.
 *
 * The cost is real and is stated rather than hidden: a consuming card has to name a third sheet
 * in its `static styles`, which no card in this library did before this one, and the class
 * names below are public API rather than private detail. Renaming one is a breaking change for
 * every card that reaches into it. Two smaller consequences of the same choice: the styles are
 * duplicated into each consuming card's root (a few hundred bytes, once per card), and there is
 * no per-instance id space, so anything wanting an SVG `id` (a gradient, a mask, a filter)
 * would collide between two gauges in one card and needs a scheme before it can exist.
 *
 * **The card owns the size.** `--cw-gauge-size` is required, it is the diameter, and it arrives
 * already multiplied by `--cw-scale` (the battery card's grid hands it over as
 * `calc(56px * var(--cw-scale))`). Every length in here is a fraction of it, so nothing in this
 * file multiplies by the scale a second time. A card that forgets it draws **nothing**, and
 * that is arranged rather than assumed: the fallback is 0, because an undefined custom property
 * makes the declaration invalid at computed-value time and `width` then falls to `auto`, which
 * for an SVG at `100%` of an auto-width box is the specification's own 300 by 150 default. A
 * 300px gauge in a 250px card is a plausible-looking accident; nothing at all is a bug report.
 *
 * **The card owns the tokens.** These rules read `--cw-track`, `--cw-label`, `--cw-surface` and
 * `--cw-font`, and they resolve because the sheet lands in a card's root, where
 * `theme/tokens.ts` has already declared them on `:host`. There are deliberately no literal
 * colours behind them: rule 1 says the bridge from Home Assistant's variables lives in exactly
 * one file, and a second copy here would be a palette that drifts. The consequence is a real
 * limit rather than a detail. A root with no tokens in it, which is what `core/card-editor.ts`
 * ships on purpose, draws this with no track at all (an invalid `stroke` inherits, and the
 * initial is `none`), a black knockout and unweighted type. A gauge in an editor needs the
 * token layer brought with it.
 *
 * Type sized as a fraction of a measured box is not something the rest of the library does
 * (rule 2's two languages are scaled px in CSS and design units in `layout.ts`), and it is safe
 * here for one reason worth stating: **nothing budgets against it.** No `layout.ts` prices a
 * row off the middle of a gauge. The one piece of type that is priced, the battery card's
 * percentage, stays outside the gauge where `LABEL` 28 and `LABEL_WIDTH` 64 can go on
 * describing it. The knobs are **unitless fractions** and not lengths, which is the one part of
 * this arrangement that had to be designed rather than chosen: a length knob invites
 * `calc(11px * var(--cw-scale))` from a card that remembered rule 2 and `11px` from one that
 * did not, and the first of those scales twice on a diameter that is already scaled. A fraction
 * cannot be either.
 *
 * **The card owns the accessible name.** The dial is `aria-hidden`, as it was in the battery
 * card: it is a picture of a number. The middle's text is left readable, because for a card
 * whose whole subject is that one reading it is the headline rather than decoration.
 *
 * Two halves, and the class names are the contract between them: `gaugeStyles` below and
 * `renderGauge` under it. `geometry.ts` holds the arithmetic both of them quote.
 */

import {
  css,
  html,
  nothing,
  svg,
  type CSSResult,
  type HTMLTemplateResult,
  type TemplateResult,
} from 'lit'

import {
  GAUGE_BOX,
  GAUGE_CENTER,
  GAUGE_RADIUS,
  GAUGE_STROKE,
  MARK_DOT,
  MARK_KNOCKOUT,
  OPEN_DIAL,
  arcFor,
  dashArray,
  endPointsFor,
  fractionFor,
  pointAt,
  rotationFor,
  trackDash,
  type GaugeSweep,
} from './geometry'

// ---- What a caller asks for ----

/**
 * How the value is drawn on the track.
 *
 * `arc` fills from the start of the sweep to the value, which is a **quantity**: how much of
 * the scale has been used up, and the shape a battery level or an index against a ceiling
 * wants. `dot` marks the position and fills nothing, which is a **place**: where in today's
 * range this temperature is, where between dry and damp this humidity is. Filling those from
 * the left would say the morning's low is somehow contained in the afternoon's reading.
 *
 * Two modes and not a pair of independent switches, because the reference has no gauge that
 * wears both: its dials were measured for it, and the one carrying a dot has a track of one
 * tone the whole way round. `geometry.ts` computes them from the same fraction, so the day
 * something does want both, this is a union to widen rather than a shape to rebuild.
 */
export type GaugeMark = 'arc' | 'dot'

export interface GaugeSpec {
  /** The reading, or `null` when there is not one: an unavailable entity, a scale of no width. */
  value: number | null | undefined
  /** The scale it is read against. The defaults are a percentage, which most gauges are. */
  min?: number
  max?: number
  /** Defaults to the notched dial; the battery card passes `FULL_TURN`. */
  sweep?: GaugeSweep
  /** Defaults to the filled arc. */
  mark?: GaugeMark
  /**
   * What goes in the middle, drawn in this order and each one when it is there: the reading
   * large, a word under it, a glyph under that. The battery card passes the glyph alone, which
   * is the whole of its middle and is drawn at the size that implies; a humidity dial passes a
   * reading and a droplet, and the droplet is a caption drawn rather than written. There is no
   * rule to remember for that: a piece of the stack standing alone is sized as though it were
   * the middle, because it is.
   */
  reading?: string
  caption?: string
  /** An `mdi:` name, drawn through `ha-icon`. */
  glyph?: string
  /**
   * The two ends of the scale, already formatted, drawn in the notch. A sweep with no notch to
   * put them in ignores them: see `endPointsFor`. They are out of flow and the type is a
   * fraction of the diameter, so a dial below `11 / --cw-gauge-end-scale` design units prints
   * them under 11px, which is smaller than any type in the library: about 90 at the 0.12 that
   * ships. A card that small should be leaving `ends` off, the way the battery card drops its
   * captions.
   */
  ends?: { min: string; max: string }
  /**
   * Drawn last, as an HTML child of the gauge, positioned by the caller against
   * `--cw-gauge-centerline`: the battery card's charging badge. An `html` template, not an
   * `svg` one: an `svg`-tagged template here would produce SVG-namespaced nodes with no `<svg>`
   * root, which land in the DOM and draw nothing, which is rule 11 arriving from the other
   * direction.
   *
   * The alternative was no slot at all, with the card wrapping the gauge in a positioned box of
   * its own, and it costs the card a second element carrying a restated copy of
   * `--cw-gauge-size`: a twin, in a library that already counts them.
   */
  overlay?: HTMLTemplateResult | typeof nothing
}

// ---- The stylesheet ----

/**
 * Add to a card's `static styles`, after `CupertinoCard.styles`.
 *
 * Every knob is read in the `var(name, default)` form rather than being declared on the root,
 * and that is what keeps a card able to set one: a property declared on `.cw-gauge` itself
 * beats the same property inherited from the card's own wrapper, so the obvious arrangement
 * would have made every default final. The one property that IS declared is
 * `--cw-gauge-centerline`, because it is not a knob: it is where the middle of the stroke sits,
 * published for an overlay to hang off, and derived from the constants rather than written out
 * as the 0.05 it comes to.
 */
export const gaugeStyles: CSSResult = css`
  .cw-gauge {
    position: relative;
    flex: none;
    /* Required. The 0 is what makes a card that forgot it draw nothing rather than 300px of
       SVG default; the module comment has the argument. */
    width: var(--cw-gauge-size, 0);
    height: var(--cw-gauge-size, 0);
    --cw-gauge-centerline: calc(var(--cw-gauge-size, 0) * ${GAUGE_STROKE / 2 / GAUGE_BOX});
  }

  .cw-gauge-dial {
    display: block;
    width: 100%;
    height: 100%;
  }

  /* Round caps, so a dial's two ends are finished rather than sawn off. A closed circle is a
     closed subpath and has no ends to cap, so a full turn is untouched by this. */
  .cw-gauge-track {
    fill: none;
    stroke: var(--cw-gauge-track, var(--cw-track));
    stroke-linecap: round;
  }

  /* One colour at every value. Nothing here thresholds a reading into amber or red: the length
     of the arc, or the place of the dot, is already the reading, and a card that wants a colour
     to say something else says so in --cw-gauge-mark. The default is the card's own ink, which
     is what the reference draws its dials in, and deliberately not --cw-accent: that would make
     every gauge in the library the installation's primary colour, which is the trade the
     reminders card refused for its own headings. */
  .cw-gauge-arc {
    fill: none;
    stroke: var(--cw-gauge-mark, var(--cw-label));
    stroke-linecap: round;
  }

  .cw-gauge-dot {
    fill: var(--cw-gauge-mark, var(--cw-label));
  }

  /* The hole under the dot. The card's surface by default, because that is what is behind a
     gauge; a card drawing one on a tinted panel sets it to the tint. */
  .cw-gauge-knockout {
    fill: var(--cw-gauge-knockout, var(--cw-surface));
  }

  /* Centred by the transform rather than by stretching to the box and centring inside it, and
     the two are not the same picture: they agree on the rect to the last fraction of a pixel,
     and a glyph laid out at a fractional offset rasterises about half a device pixel away from
     the same glyph translated onto it. Measured, on the battery card's own screenshots, which
     are byte for byte what they were before the ring became a gauge because of this rule. */
  .cw-gauge-center {
    position: absolute;
    top: 50%;
    left: 50%;
    transform: translate(-50%, -50%);
    display: flex;
    flex-direction: column;
    align-items: center;
    justify-content: center;
    gap: calc(var(--cw-gauge-size, 0) * 0.04);
    /* The middle of a circle is not a box. A reading long enough to need wrapping has outgrown
       the gauge, and the card should be lowering --cw-gauge-value-scale or printing fewer
       glyphs; nowrap keeps that visible instead of reflowing into a shape that reads as
       intended. */
    white-space: nowrap;
  }

  /* Two sizes for one piece of type, and :only-child is what picks between them: a reading that
     stands alone is set at 0.42 of the diameter and one with a line under it at 0.30. Both are
     fitted off the reference rather than picked: a circle fitted to each dial's ink puts the
     temperature's numerals at 30.4 units of cap height in a box of 100, and the index's at
     22.1, which at a cap of about 0.72 of the em is those two fractions. lit's markers are
     comments rather than elements, so a caption that is absent really does leave the reading an
     only child. Fractions and not lengths: the module comment has that argument. */
  .cw-gauge-value {
    font: 600 calc(var(--cw-gauge-size, 0) * var(--cw-gauge-value-scale, 0.3)) / 1 var(--cw-font);
    font-variant-numeric: tabular-nums;
    letter-spacing: -0.01em;
    color: var(--cw-gauge-ink, var(--cw-label));
  }

  .cw-gauge-value:only-child {
    font-size: calc(var(--cw-gauge-size, 0) * var(--cw-gauge-value-scale, 0.42));
  }

  /* 0.10, which is the reference's own AQI: 6.8 units of cap height against the reading's 22.1.
     A third of the number it sits under, and not the half it looks like on a screen. */
  .cw-gauge-caption {
    font: 400 calc(var(--cw-gauge-size, 0) * var(--cw-gauge-caption-scale, 0.1)) / 1 var(--cw-font);
    color: var(--cw-gauge-ink, var(--cw-label));
  }

  /* Sized through --mdc-icon-size because that is the only handle ha-icon offers; it defaults
     to 24px, so a card that forgot this would draw every glyph the same size whatever the gauge
     did. 45% of the diameter alone in the middle, which is the reference's 28 of 62 and the
     size the battery card's device icons have always been; 0.16 under a reading, which is more
     than the caption's 0.10 because a glyph carries no cap height to read by and needs the room
     the reference's own sun takes. */
  .cw-gauge-glyph {
    --mdc-icon-size: calc(var(--cw-gauge-size, 0) * var(--cw-gauge-glyph-scale, 0.16));
    color: var(--cw-gauge-ink, var(--cw-label));
  }

  .cw-gauge-glyph:only-child {
    --mdc-icon-size: calc(var(--cw-gauge-size, 0) * var(--cw-gauge-glyph-scale, 0.45));
  }

  /* Hung by the edge nearest its end of the track and grown into the notch, which is why the
     inline style sets left on one and right on the other: geometry.ts has the measurement and
     the argument. Only the vertical is centred on the anchor, and the ink is secondary because
     the pair is the scale rather than the reading.

     0.12 is the one type size here that is not the reference's. Fitted, its end readings are
     13.5 units of cap height, which is 0.19 of the diameter, and that is a size chosen for what
     it prints: bare numerals, 8 and 23. A card here prints what a sensor means, so the pair is
     8° and 24°, or -12° and 104°, and the anchors are 54.2 units apart, which is what the pair
     has to fit inside. Measured in a browser at this library's own font stack, a -12° and 104°
     pair comes to 56.6 units at 0.13 and overlaps by two; 0.12 is the size that holds four
     glyphs a side, and the knob is there for the card that prints five. */
  .cw-gauge-end {
    position: absolute;
    transform: translateY(-50%);
    font: 400 calc(var(--cw-gauge-size, 0) * var(--cw-gauge-end-scale, 0.12)) / 1 var(--cw-font);
    font-variant-numeric: tabular-nums;
    white-space: nowrap;
    color: var(--cw-gauge-end-ink, var(--cw-label-secondary));
  }
`

// ---- The template ----

/**
 * One gauge.
 *
 * The dial is SVG and the readings are HTML, which is a division rather than an accident:
 * everything that belongs to the `viewBox` (the track, the arc, the dot and the hole under it)
 * is drawn in it and scales with the diameter for nothing, while text wants `--cw-font`,
 * tabular figures and the theme's ink, none of which an SVG `<text>` gets for free. What lets
 * the two meet is the box being 100 units square, so the point that places a circle also places
 * a label as a percentage.
 *
 * The conditional pieces are built with lit's **`svg`** tag rather than `html`, and that is not
 * a nicety. A nested lit template is parsed on its own, so an `html` one creates its circle in
 * the HTML namespace: it lands in the DOM with every attribute set and every *presentation*
 * attribute ignored, `stroke-width` reads back as 1px and `stroke-dasharray` as `none`, and the
 * card draws a bare track at every value with nothing anywhere to say why.
 *
 * The track and the arc are turned together, because a dash starts where the path does and an
 * SVG circle's path starts at three o'clock. The dot is not: `pointAt` gives it an absolute
 * point in the box, and turning it a second time would send it round the dial twice.
 *
 * One consequence of the hole is visible and is the intended trade: a reading at the very top
 * or bottom of its scale puts the dot on the track's end, where the hole eats the round cap and
 * the dial reads about nine degrees shorter than it does at any other value. The alternative
 * was to inset the dot's travel so it never reaches the ends, which buys a track of constant
 * length by making a reading at the top of the scale stop short of the top of the dial: a
 * quieter picture telling a small lie, against a truthful one with a chipped end.
 */
export const renderGauge = (spec: GaugeSpec): TemplateResult => {
  // A sweep is the one input that does not go through `fractionFor`, and a card that computes
  // one from a config value can hand over a NaN. It has to be caught here rather than five
  // lines down, because every way it reaches the DOM is silent: `stroke-dasharray="NaN …"`
  // computes to `none`, which is a SOLID ring, so a dial with a broken sweep would read as a
  // full one; `rotate(NaN 50 50)` invalidates the whole transform and starts the track at three
  // o'clock; `cx="NaN"` computes to 0 and parks the dot in the corner of the box.
  const asked = spec.sweep ?? OPEN_DIAL
  const sweep = Number.isFinite(asked.start) && Number.isFinite(asked.extent) ? asked : OPEN_DIAL
  const mark = spec.mark ?? 'arc'
  const fraction = fractionFor(spec.value, spec.min ?? 0, spec.max ?? 100)

  const arc = mark === 'arc' ? arcFor(fraction, sweep) : 0
  const dot = mark === 'dot' && fraction !== null ? pointAt(fraction, sweep) : null
  const dash = trackDash(sweep)
  const ends = spec.ends ? endPointsFor(sweep) : null

  return html`
    <div class="cw-gauge">
      <svg class="cw-gauge-dial" viewBox="0 0 ${GAUGE_BOX} ${GAUGE_BOX}" aria-hidden="true">
        <g transform="rotate(${rotationFor(sweep)} ${GAUGE_CENTER} ${GAUGE_CENTER})">
          <circle
            class="cw-gauge-track"
            cx=${GAUGE_CENTER}
            cy=${GAUGE_CENTER}
            r=${GAUGE_RADIUS}
            stroke-width=${GAUGE_STROKE}
            stroke-dasharray=${dash === null ? nothing : dashArray(dash)}
          />
          ${
            // The guard is load-bearing rather than tidy: a dash of zero with a round cap is not
            // nothing, it is a dot of the full stroke at the start of the sweep, so an empty
            // battery would draw a green pip at twelve o'clock. `gauge.test.ts` pins it.
            arc > 0
              ? svg`<circle
                  class="cw-gauge-arc"
                  cx=${GAUGE_CENTER}
                  cy=${GAUGE_CENTER}
                  r=${GAUGE_RADIUS}
                  stroke-width=${GAUGE_STROKE}
                  stroke-dasharray=${dashArray(arc)}
                />`
              : nothing
          }
        </g>
        ${
          dot
            ? svg`<circle class="cw-gauge-knockout" cx=${dot.x} cy=${dot.y} r=${MARK_KNOCKOUT} />
                  <circle class="cw-gauge-dot" cx=${dot.x} cy=${dot.y} r=${MARK_DOT} />`
            : nothing
        }
      </svg>
      <div class="cw-gauge-center">
        ${spec.reading ? html`<div class="cw-gauge-value">${spec.reading}</div>` : nothing}
        ${spec.caption ? html`<div class="cw-gauge-caption">${spec.caption}</div>` : nothing}
        ${
          spec.glyph
            ? html`<ha-icon class="cw-gauge-glyph" .icon=${spec.glyph}></ha-icon>`
            : nothing
        }
      </div>
      ${
        ends && spec.ends
          ? html`
              <div class="cw-gauge-end" style=${`left: ${ends.min.x}%; top: ${ends.min.y}%`}>
                ${spec.ends.min}
              </div>
              <div
                class="cw-gauge-end"
                style=${`right: ${GAUGE_BOX - ends.max.x}%; top: ${ends.max.y}%`}
              >
                ${spec.ends.max}
              </div>
            `
          : nothing
      }
      ${spec.overlay ?? nothing}
    </div>
  `
}
