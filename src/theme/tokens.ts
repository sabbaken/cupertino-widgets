import { css } from 'lit'

/**
 * The `--cw-*` layer.
 *
 * Every token falls back through a Home Assistant theme variable first, so a user's
 * theme restyles these cards for free, and only then to an Apple-ish default. Cards
 * must never read `--primary-text-color` and friends directly: they read `--cw-*`,
 * and this file is the single place where the bridge lives.
 *
 * Dark values hang off `:host([dark])`, which the base card reflects from
 * `hass.themes.darkMode`. A `prefers-color-scheme` media query would be wrong here:
 * Home Assistant's theme is chosen in HA, not by the OS.
 */
export const tokens = css`
  :host {
    /* ---- Scale ------------------------------------------------------------- */
    /* Set inline on the element by the base card, from config.scale. Every length below
       that belongs to the widget's own design is multiplied by it; the ones bridged
       straight from Home Assistant (the card radius, the font family) are not.
       core/scale.ts has the whole story, including why a stylesheet must not set this
       itself. The 1 here is what a card renders at before it is configured. */
    --cw-scale: 1;

    /* ---- Typography -------------------------------------------------------- */
    /* San Francisco on Apple hardware, then whatever the HA theme asked for. */
    --cw-font:
      -apple-system, BlinkMacSystemFont, 'SF Pro Display', 'SF Pro Text', system-ui,
      var(--ha-font-family-body, Roboto), 'Helvetica Neue', Arial, sans-serif;

    /* Apple's text styles, trimmed to what widgets use. size / line-height, both
       scaled: a size that grew while its line-height stood still would re-space the
       paragraph rather than resize it, and layout.ts prices rows off the line box. */
    --cw-text-large-title: 700 calc(34px * var(--cw-scale)) / calc(41px * var(--cw-scale))
      var(--cw-font);
    --cw-text-title-1: 700 calc(28px * var(--cw-scale)) / calc(34px * var(--cw-scale))
      var(--cw-font);
    --cw-text-title-2: 700 calc(22px * var(--cw-scale)) / calc(28px * var(--cw-scale))
      var(--cw-font);
    --cw-text-title-3: 600 calc(20px * var(--cw-scale)) / calc(25px * var(--cw-scale))
      var(--cw-font);
    --cw-text-headline: 600 calc(17px * var(--cw-scale)) / calc(22px * var(--cw-scale))
      var(--cw-font);
    --cw-text-body: 400 calc(17px * var(--cw-scale)) / calc(22px * var(--cw-scale)) var(--cw-font);
    --cw-text-callout: 400 calc(16px * var(--cw-scale)) / calc(21px * var(--cw-scale))
      var(--cw-font);
    --cw-text-subheadline: 400 calc(15px * var(--cw-scale)) / calc(20px * var(--cw-scale))
      var(--cw-font);
    --cw-text-footnote: 400 calc(13px * var(--cw-scale)) / calc(18px * var(--cw-scale))
      var(--cw-font);
    --cw-text-caption-1: 400 calc(12px * var(--cw-scale)) / calc(16px * var(--cw-scale))
      var(--cw-font);
    --cw-text-caption-2: 500 calc(11px * var(--cw-scale)) / calc(13px * var(--cw-scale))
      var(--cw-font);

    /* ---- Colour ------------------------------------------------------------ */
    --cw-controls-light-fallback: #d49b00;
    --cw-controls-fan-fallback: #008ba3;
    --cw-controls-inactive-icon: var(--state-inactive-color, #757575);
    /* Controls keeps the active tile white in both themes. These labels sit on that surface. */
    --cw-controls-active-surface: #fff;
    --cw-controls-active-label: #202124;
    --cw-controls-active-secondary: #53565b;
    --cw-label: var(--primary-text-color, #000);
    --cw-label-secondary: var(--secondary-text-color, rgba(60, 60, 67, 0.6));
    --cw-label-tertiary: color-mix(in srgb, var(--cw-label-secondary) 55%, transparent);
    --cw-separator: var(--divider-color, rgba(60, 60, 67, 0.29));
    /* The system "fill" greys: the tint behind chips, dividers and empty slots. */
    --cw-fill: rgba(120, 120, 128, 0.12);
    --cw-fill-strong: rgba(120, 120, 128, 0.2);
    /* The unfilled part of a gauge: the battery card's rings run on this. Deliberately
       not the fill above, and not a shade of it either: a fill sits behind content and
       reads as a surface, while a track is the part of a measurement that has not been
       reached. It has to stay quieter than the arc drawn over it, or the ring reads as
       two colours rather than as a length. Half the fill's weight, in each theme. */
    --cw-track: rgba(0, 0, 0, 0.1);

    --cw-accent: var(--primary-color, #007aff);
    /* Ink on one of the colours below, rather than on a surface: the glyph in the reminders
       card's badge, and the tick inside a completed row. It has no dark twin and does not
       want one, for the same reason the accent above has none: the thing behind it is a
       colour this library chose, so it is the same colour in either theme and the theme has
       nothing to say about what reads on it. */
    --cw-on-accent: #fff;
    --cw-red: #ff3b30;
    --cw-orange: #ff9500;
    --cw-yellow: #ffcc00;
    --cw-green: #34c759;
    --cw-blue: #007aff;
    --cw-indigo: #5856d6;
    --cw-purple: #af52de;
    --cw-pink: #ff2d55;

    /* ---- Surface ----------------------------------------------------------- */
    --cw-surface: var(--ha-card-background, var(--card-background-color, #fff));
    /* Phone widgets are noticeably rounder than HA's default card. Not scaled: this is
       the outline the dashboard sees, and a card whose corners disagreed with the ones
       beside it would read as a mistake rather than as a setting. */
    --cw-radius: var(--ha-card-border-radius, 22px);
    --cw-card-border-width: var(--ha-card-border-width, 1px);
    /* Scaled, unlike the one above: this radius is inside the card, and the all-day
       badge is drawn concentric with it; see the .row.allday rule. */
    --cw-radius-inner: calc(12px * var(--cw-scale));
    --cw-radius-pill: 999px;

    /* ---- Spacing ----------------------------------------------------------- */
    /* Home Assistant's own scale is 4px-stepped (--ha-space-1 is 4px), the same
       grid Apple uses, so we ride on it and inherit any theme that rescales it;
       and then scale that, so a theme's grid and the card's own stay in step. */
    --cw-space-1: calc(var(--ha-space-1, 4px) * var(--cw-scale));
    --cw-space-2: calc(var(--ha-space-2, 8px) * var(--cw-scale));
    --cw-space-3: calc(var(--ha-space-3, 12px) * var(--cw-scale));
    --cw-space-4: calc(var(--ha-space-4, 16px) * var(--cw-scale));
    --cw-space-5: calc(var(--ha-space-5, 20px) * var(--cw-scale));
    --cw-space-6: calc(var(--ha-space-6, 24px) * var(--cw-scale));
    /* Apple keeps widget content off the rounded edge by roughly this much.
       layout.ts holds the unscaled 16 as its INSET. */
    --cw-inset: calc(16px * var(--cw-scale));

    /* ---- Motion ------------------------------------------------------------ */
    /* The curve the phone uses for sheets and springs; feels "settled", not linear. */
    --cw-ease: cubic-bezier(0.32, 0.72, 0, 1);
    --cw-ease-out: cubic-bezier(0.25, 0.1, 0.25, 1);
    --cw-duration-fast: 150ms;
    --cw-duration: 250ms;
  }

  :host([dark]) {
    --cw-label: var(--primary-text-color, #fff);
    --cw-label-secondary: var(--secondary-text-color, rgba(235, 235, 245, 0.6));
    --cw-separator: var(--divider-color, rgba(84, 84, 88, 0.65));
    --cw-fill: rgba(120, 120, 128, 0.24);
    --cw-fill-strong: rgba(120, 120, 128, 0.36);
    --cw-track: rgba(255, 255, 255, 0.12);

    --cw-red: #ff453a;
    --cw-orange: #ff9f0a;
    --cw-yellow: #ffd60a;
    --cw-green: #30d158;
    --cw-blue: #0a84ff;
    --cw-indigo: #5e5ce6;
    --cw-purple: #bf5af2;
    --cw-pink: #ff375f;

    --cw-surface: var(--ha-card-background, var(--card-background-color, #1c1c1e));
  }
`

/**
 * Native tiles keep the hue of an RGB lamp and adjust its saturation or peak
 * channel for contrast. The RGB channel distances give the HSV adjustment
 * directly, so the card only needs to convert the result to CSS.
 */
const lightTileColor = (rgb: unknown): string | undefined => {
  if (
    !Array.isArray(rgb) ||
    rgb.length !== 3 ||
    !rgb.every(
      channel =>
        typeof channel === 'number' && Number.isFinite(channel) && channel >= 0 && channel <= 255,
    )
  ) {
    return undefined
  }
  const peak = Math.max(...rgb)
  const spread = peak - Math.min(...rgb)
  const saturation = peak ? spread / peak : 0
  const channels = rgb.map(channel => {
    if (saturation < 0.1) return peak ? (channel * 225) / peak : 225
    if (saturation < 0.4) return peak - ((peak - channel) * peak * 0.4) / spread
    return channel
  })
  return `rgb(${channels.map(Math.round).join(', ')})`
}

/**
 * Home Assistant themes can colour an individual state before falling back to its
 * domain and then to the global active or inactive colour.
 */
export const controlsStateColor = (
  domain: string,
  state: string,
  active: boolean,
  deviceClass?: string,
  rgb?: unknown,
): string => {
  if (state === 'unavailable' || state === 'unknown') {
    return 'var(--state-unavailable-color, var(--cw-label-secondary))'
  }
  if (domain === 'light' && active) {
    const lightColor = lightTileColor(rgb)
    if (lightColor) return lightColor
  }
  const key = (value: string) => value.toLowerCase().replace(/[^a-z0-9_-]+/g, '_')
  const activity = active ? 'active' : 'inactive'
  const stateKey = key(state)
  const domainKey = key(domain)
  const properties = [
    ...(deviceClass ? [`--state-${domainKey}-${key(deviceClass)}-${stateKey}-color`] : []),
    `--state-${domainKey}-${stateKey}-color`,
    `--state-${domainKey}-${activity}-color`,
    `--state-${activity}-color`,
  ]
  const fallback = active
    ? `var(--cw-controls-${domainKey}-fallback, var(--cw-accent))`
    : 'var(--cw-label-secondary)'
  return properties.reduceRight((value, property) => `var(${property}, ${value})`, fallback)
}
