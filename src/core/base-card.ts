import { LitElement, type CSSResultGroup, type PropertyValues } from 'lit'
import { property, state } from 'lit/decorators.js'

import { baseStyles } from '../theme/base-styles'
import { tokens } from '../theme/tokens'
import { scaleFactor } from './scale'
import {
  DEFAULT_HEIGHT,
  DEFAULT_LAYOUT,
  DEFAULT_WIDTH,
  cardSize,
  gridOptions,
  layoutFromBox,
  type WidgetLayout,
} from './size'
import type {
  HomeAssistant,
  LovelaceCard,
  LovelaceCardConfig,
  LovelaceGridOptions,
} from './types/ha'

/**
 * What every card in the library can be configured with, whatever it draws.
 *
 * It held a `size` preset until the Layout tab was found to do the same job properly, and
 * then nothing at all for a while; it was kept as the shared base so a card's own config
 * still named one type, and so the next genuinely cross-card option had somewhere to go.
 * `scale` is that option: it is about the room the dashboard is in, which is a question no
 * card gets to answer differently from its neighbour.
 */
export interface CupertinoCardConfig extends LovelaceCardConfig {
  /**
   * How large to draw the widget, as a percentage of the size it was designed at. Absent
   * means 100%. See `core/scale.ts`, including why an out-of-range value is clamped
   * rather than refused.
   */
  scale?: number
}

/**
 * Shared behaviour for every card in the library:
 *
 *  - the `hass` / `setConfig` contract Home Assistant expects
 *  - sizing: grid defaults for Home Assistant, plus a measured `cw-layout` attribute
 *  - `dark` reflected from the active Home Assistant theme
 *  - a re-render filter, so a card does not repaint on every unrelated state change
 *
 * Subclasses implement `render()` and, when they read entities, `watchedEntities()`.
 */
export abstract class CupertinoCard<C extends CupertinoCardConfig = CupertinoCardConfig>
  extends LitElement
  implements LovelaceCard
{
  static override styles: CSSResultGroup = [tokens, baseStyles]

  @property({ attribute: false }) public hass?: HomeAssistant

  /**
   * Set by Home Assistant while the user is EDITING, not while the card is a thumbnail.
   *
   * The name invites the wrong reading. `hui-section` does
   * `card.preview = this.lovelace.editMode`, so this goes true for every card on the
   * dashboard the moment the pencil is pressed, and wrapper cards forward it down. Home
   * Assistant's own cards use it to keep themselves visible when their condition is false
   * and to size differently in the editor, but never to draw something other than the real
   * thing. A card that showed sample data on this would replace the whole dashboard's
   * contents with samples as soon as the user went to edit it.
   */
  @property({ type: Boolean }) public preview = false

  /** The picker reuses its stub config when adding a card. Its preview wrapper keeps
   * sample data out of that config and out of the dashboard's edit mode. */
  protected get inCardPicker(): boolean {
    const root = this.getRootNode()
    return (
      root instanceof ShadowRoot &&
      root.host.localName === 'hui-card-picker' &&
      this.parentElement?.classList.contains('preview') === true
    )
  }

  @state() protected _config?: C

  /**
   * The layout actually being rendered, derived from the card's measured box rather
   * than from `config.size`: Home Assistant lets the user's `grid_options` override
   * whatever we asked for, so the configured size is only a starting point.
   * Reflected so CSS can select on it.
   *
   * Deliberately NOT called `layout`: Home Assistant already owns that name on a card
   * element. Wrapper cards forward it down verbatim
   * (`this._element.layout = this.layout` in `hui-entity-filter-card.shouldUpdate`), so
   * a card nested in `conditional` or `entity-filter` would silently have this
   * overwritten with the view's layout type (`"grid"`, `"panel"`) and every
   * `:host([cw-layout=…])` rule would stop matching.
   */
  @property({ reflect: true, attribute: 'cw-layout' })
  protected cwLayout: WidgetLayout = DEFAULT_LAYOUT

  /**
   * Set by Home Assistant to the view's layout type. We do not use it yet, but it is
   * declared so nothing here accidentally reuses the name.
   */
  @property({ attribute: false }) public layout?: string

  /** Reflected from `hass.themes.darkMode`; drives the dark token set. */
  @property({ type: Boolean, reflect: true }) protected dark = false

  /**
   * Measured box of the card, or 0 before the first measurement.
   *
   * Both are `@state()`, and the width has to be: it used to be a plain field on the
   * grounds that the only thing reading it was `layoutFromBox`, whose answer is reflected
   * through `cwLayout` and reactive on its own. That holds only for a card whose rendering
   * depends on the width in no finer a way than which of the two layouts it is: the
   * calendar. A card that sizes cells from the width, as the battery grid does, would
   * otherwise keep last frame's ring diameter through every resize that did not happen to
   * cross the layout threshold.
   */
  @state() private _measuredHeight = 0
  @state() private _measuredWidth = 0

  private _resizeObserver?: ResizeObserver

  /**
   * How tall the card actually is, in px.
   *
   * Cards that fit content to their box (the calendar's row budgets) read this rather
   * than assuming a height, because the footprint is the user's to choose. Until the
   * first measurement lands it answers with the default footprint's height, so the very
   * first paint is already right for a card nobody has resized.
   */
  protected get boxHeight(): number {
    return this._measuredHeight || DEFAULT_HEIGHT
  }

  /**
   * How wide the card actually is, in px.
   *
   * `cwLayout` answers the question most cards have about their width (one column of
   * content or two), and this answers the one it cannot: how much room a single column
   * actually got. The battery card's ring is drawn to fit its cell, and a cell is the
   * measured width shared out, so it reads this directly.
   */
  protected get boxWidth(): number {
    return this._measuredWidth || DEFAULT_WIDTH
  }

  /**
   * `config.scale` as a multiplier, ready to divide a measured box by.
   *
   * The CSS side of it is set on the element by `_applyScale`; this is the same number for
   * the arithmetic side, which every card that prices its content in pixels needs. Read
   * from the config on each call rather than cached; it is a clamp and a division, and a
   * second copy of a number that has to agree with a stylesheet is a way to get it wrong.
   */
  protected get scaleFactor(): number {
    return scaleFactor(this._config?.scale)
  }

  public setConfig(config: C): void {
    if (!config) {
      throw new Error('Invalid configuration')
    }
    this._config = config
    this._applyScale()
    this._applyLayout()
  }

  /**
   * Hand the factor to CSS.
   *
   * Inline on the element, so it beats the `:host` default in `tokens.ts` and anything a
   * theme has to say (see `core/scale.ts` on why this must not be a theme hook). Set from
   * `setConfig` rather than from an update, because the config is the only thing it
   * depends on and a scaled card must be scaled on its first paint: this runs before Lit
   * has rendered anything, and it works on an element that is not in the document yet.
   */
  private _applyScale(): void {
    this.style.setProperty('--cw-scale', String(this.scaleFactor))
  }

  /**
   * The floor `ha-card` keeps: the default footprint's height, never taller than the box
   * the card was measured in.
   *
   * The floor is there for the masonry layout, whose cell imposes no height at all. Take it
   * away and the row budget chases the content down: fewer rows drawn, a shorter card,
   * fewer rows again, so in that layout this number IS the height of the card.
   *
   * In the sections layout the cell has a height of its own and the floor is only ever in
   * the way, because `min-height` beats the `max-height: 100%` that holds a card inside its
   * cell (min is applied last; see `base-styles.ts`). A card dragged to the 3 rows
   * `gridOptions` offers was drawing 248px of `ha-card` into a 184px cell and hanging the
   * difference over the card below, which is what made 4 rows the shortest a card looked
   * able to be however low the floor in the Layout tab went.
   *
   * Clamped to the measurement rather than switched on which layout we are in, because
   * "is anything imposing a height on me" is the question the measurement already answers:
   * a dragged cell reports its own height, while a masonry cell reports whatever this floor
   * made the card, so there the clamp is a no-op and the floor stands at the full 248.
   *
   * Which leaves the clamp only as honest as the measurement, and the measurement is one
   * `min-height: 0` away from being this floor read back to itself: `:host` in
   * `base-styles.ts` has the loop and why it only closes under a grid or flex parent.
   */
  private _applyMinHeight(): void {
    this.style.setProperty('--cw-min-height', `${Math.min(DEFAULT_HEIGHT, this.boxHeight)}px`)
  }

  /**
   * Measurement beats configuration, and the measurement outlives a config change.
   *
   * `setConfig` runs again whenever the card is edited, and a config edit does not
   * resize anything, so the ResizeObserver will not fire to put things right. Reading
   * back the last measured width instead of resetting to the default is what stops an
   * edit from leaving a narrow card rendering the two-column layout for a frame.
   *
   * It is also why this is called from `setConfig` at all now that `scale` exists: a
   * change of scale does not move the box either, and yet it can flip the layout, because
   * the threshold is about design units rather than pixels.
   */
  private _applyLayout(): void {
    this.cwLayout = this._measuredWidth
      ? layoutFromBox(this._measuredWidth, this.scaleFactor)
      : DEFAULT_LAYOUT
  }

  // ---- Sizing -------------------------------------------------------------

  public getGridOptions(): LovelaceGridOptions {
    return gridOptions()
  }

  public getCardSize(): number {
    return cardSize()
  }

  // ---- Lifecycle ----------------------------------------------------------

  public override connectedCallback(): void {
    super.connectedCallback()
    this.requestUpdate()
    // The default footprint until the first measurement corrects it; see `_applyMinHeight`
    // for what it is for and what the measurement does to it.
    this._applyMinHeight()
    this._resizeObserver ??= new ResizeObserver(entries => {
      const box = entries[0]?.contentRect
      // Width 0 means we are not laid out yet; measuring then would flip the card to
      // the smallest layout for a frame.
      if (!box || box.width === 0) return
      // Rounded so that a sub-pixel box does not repaint the card on every frame of a
      // dashboard resize.
      this._measuredWidth = Math.round(box.width)
      this._measuredHeight = Math.round(box.height)
      this._applyMinHeight()
      this._applyLayout()
    })
    this._resizeObserver.observe(this)
  }

  public override disconnectedCallback(): void {
    this._resizeObserver?.disconnect()
    super.disconnectedCallback()
  }

  protected override willUpdate(changed: PropertyValues): void {
    if (changed.has('hass')) {
      this.dark = this.hass?.themes?.darkMode ?? false
    }
  }

  /**
   * Entity ids whose state changes should repaint this card. Everything else in
   * `hass` is ignored, which matters: `hass` is replaced on every state change
   * anywhere in the installation.
   */
  protected watchedEntities(): string[] {
    return []
  }

  protected override shouldUpdate(changed: PropertyValues): boolean {
    if (!this._config) return false
    // Anything other than a plain `hass` swap is a real change.
    if (changed.size > 1 || !changed.has('hass')) return true

    const previous = changed.get('hass') as HomeAssistant | undefined
    if (!previous || !this.hass) return true
    if (previous.themes?.darkMode !== this.hass.themes?.darkMode) return true
    if (previous.locale !== this.hass.locale) return true

    return this.watchedEntities().some(id => previous.states[id] !== this.hass?.states[id])
  }
}
