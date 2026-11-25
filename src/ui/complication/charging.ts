/** The charging badge sits over the gauge stroke so it stays legible at every level. */
import { css, html } from 'lit'

/**
 * The bolt, and the one glyph in this library that does not come from `@mdi/js`.
 *
 * It is Material's own `Bolt`: the path Material Symbols ships and `@mui/icons-material`
 * re-exports, on the same 24-unit grid as MDI, taken verbatim from that package's
 * `Bolt.js`. Apache-2.0, which is compatible with this repository's licence, and one path
 * string rather than a dependency: `@mui/icons-material` is a React package of some ten
 * megabytes and this is the whole of what we want from it.
 *
 * MDI's own bolts were the obvious first answer and are not this shape. `mdiFlash` and
 * `mdiLightningBolt` are both harder-edged, with a flat top and a straight leading edge;
 * Material's tapers and kinks, which is what makes it read as a charging mark next to a
 * round gauge rather than as a hazard sign. Everything else about how it is drawn (inlined
 * rather than handed to `<ha-icon>`, so nothing waits on the icon registry) is the same
 * arrangement as the calendar's all-day badge.
 */
const BOLT_PATH =
  'M11 21h-1l1-7H7.5c-.58 0-.57-.32-.38-.66s.05-.08.07-.12C8.48 10.94 10.42 7.54 13 3h1l-1 ' +
  '7h3.5c.49 0 .56.33.47.51l-.07.15C12.96 17.55 11 21 11 21'

/**
 * How that bolt is centred in its badge.
 *
 * It inks x 7.1–17.5 and y 3–21, so its centre is (12.3, 12) rather than the grid's (12, 12):
 * the glyph leans right, and centring it on the nominal middle leaves the badge visibly
 * lopsided. Its furthest corner is 10.4 units from that centre, and 0.95 brings it to 9.9
 * inside a disc of radius 12: a bolt that fills the badge without its tips touching the rim.
 */
const BOLT = 'translate(12 12) scale(0.95) translate(-12.3 -12)'

/**
 * The charging badge: a bolt on a disc of the card's own surface.
 *
 * The disc is what makes it work at all. The badge sits at twelve o'clock, which is where
 * the arc starts, so a green bolt laid straight on it is invisible at exactly the moment it
 * matters most: a device left on the charger overnight, at 100%, whose arc runs all the way
 * round. Punching the surface through first costs a notch out of the arc and buys a badge
 * that reads at every level. It is drawn over the arc rather than replacing part of it, so
 * the length of the arc still means what it means.
 */
export const CHARGING_BADGE = html`
  <svg class="bolt" viewBox="0 0 24 24" aria-hidden="true">
    <circle cx="12" cy="12" r="12" fill="var(--cw-surface)" />
    <path d=${BOLT_PATH} transform=${BOLT} fill="var(--cw-gauge-bolt-ink, var(--cw-green))" />
  </svg>
`

export const chargingStyles = css`
  .bolt {
    --cw-bolt-size: calc(var(--cw-gauge-size) * 0.34);
    position: absolute;
    left: 50%;
    /* Centred on the stroke's centreline, which the gauge publishes rather than this
           card working it out from a stroke it no longer owns. Straddling it that way leaves
           about an eighth of the ring's width standing above the box, which the card's inset
           absorbs. */
    top: var(--cw-gauge-centerline);
    width: var(--cw-bolt-size);
    height: var(--cw-bolt-size);
    transform: translate(-50%, -50%);
  }
`
