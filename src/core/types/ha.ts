/**
 * The slice of the Home Assistant frontend API these cards actually touch.
 *
 * Hand-rolled on purpose: `custom-card-helpers` exists but always trails the real
 * frontend, and we want zero runtime dependencies beyond Lit. Everything here was
 * checked against the bundle that ships inside home-assistant 2026.7.4.
 */

export interface HassEntityAttributes {
  friendly_name?: string
  icon?: string
  device_class?: string
  supported_features?: number
  [key: string]: unknown
}

export interface HassEntity {
  entity_id: string
  state: string
  attributes: HassEntityAttributes
  last_changed: string
  last_updated: string
}

/** Entity-registry display entry, exposed to cards as `hass.entities`. */
export interface HassEntityRegistryDisplayEntry {
  entity_id: string
  name?: string
  hidden?: boolean
  entity_category?: string
  translation_key?: string
}

/**
 * Note the wire values. The frontend's enum reads
 * `am_pm="12", twenty_four="24"`: the member names never travel, and a card
 * comparing against `"am_pm"` silently never matches.
 */
export type TimeFormat = 'language' | 'system' | '12' | '24'
export type FirstWeekday =
  'language' | 'monday' | 'tuesday' | 'wednesday' | 'thursday' | 'friday' | 'saturday' | 'sunday'
/**
 * Whether the frontend shows times in the browser's zone or the server's. Verified in
 * the 2026.7.4 bundle: `local="local", server="server"`, and `local` is the default.
 */
export type TimeZoneSetting = 'local' | 'server'

export interface FrontendLocaleData {
  language: string
  time_format: TimeFormat
  first_weekday: FirstWeekday
  /** Absent on older cores, which had no such setting; treat that as `local`. */
  time_zone?: TimeZoneSetting
}

export interface HassConfig {
  time_zone: string
  country?: string | null
  currency?: string
  version?: string
}

export interface HassThemes {
  /** Whether the active theme is dark. The only reliable dark-mode signal for a card. */
  darkMode: boolean
  theme: string
}

export interface HassConnection {
  subscribeMessage<T>(
    callback: (message: T) => void,
    subscribeMessage: Record<string, unknown>,
  ): Promise<() => Promise<void>>
}

/**
 * One entry of `hass.panels`, keyed by its own `url_path`: `hass.panels.todo` is the
 * To-do lists panel at `/todo`, and its absence means the integration behind it is not
 * loaded.
 *
 * Presence is the whole of what this library reads it for, and asking that question this
 * way is Home Assistant's own idiom rather than our invention:
 * `hui-energy-distribution-card` draws its dashboard link as
 * `this._config.link_dashboard && this.hass.panels.energy ? … : nothing`. Modelled past the
 * key anyway, because a type whose only content is a comment invites the next reader to
 * guess what else is in there. `config` is left out: it is `Record<string, any> | null`
 * upstream, so declaring it would buy nothing but an `any`.
 */
export interface PanelInfo {
  component_name: string
  url_path: string
  title: string | null
  icon: string | null
}

export interface HomeAssistant {
  states: Record<string, HassEntity>
  entities: Record<string, HassEntityRegistryDisplayEntry>
  /** Every page in the sidebar, keyed by `url_path`. See `PanelInfo`. */
  panels: Record<string, PanelInfo>
  config: HassConfig
  themes: HassThemes
  locale: FrontendLocaleData
  language: string
  connection: HassConnection
  localize(key: string, ...args: unknown[]): string
  callWS<T>(msg: Record<string, unknown>): Promise<T>
  callService(
    domain: string,
    service: string,
    serviceData?: Record<string, unknown>,
    target?: Record<string, unknown>,
  ): Promise<unknown>
  callApi<T>(
    method: 'GET' | 'POST' | 'PUT' | 'DELETE',
    path: string,
    parameters?: unknown,
  ): Promise<T>
}

export interface LovelaceCardConfig {
  type: string
  [key: string]: unknown
}

/**
 * Sizing hints for the sections layout. Read out of the shipped frontend:
 * the grid is 12 columns, `columns` accepts the literal `"full"`, and `rows`
 * accepts the literal `"auto"`.
 */
export interface LovelaceGridOptions {
  columns?: number | 'full'
  rows?: number | 'auto'
  min_columns?: number
  max_columns?: number
  min_rows?: number
  max_rows?: number
}

// ---- The visual editor -----------------------------------------------------

/**
 * One clause of an entity selector's filter.
 *
 * Keys within a clause are ANDed; a filter given as an array is ORed across its
 * clauses. `domain`, `device_class` and `unit_of_measurement` each also accept an
 * array, which is an OR of its own. Only the keys we use are modelled.
 */
export interface EntityFilter {
  domain?: string | string[]
  device_class?: string | string[]
}

export interface EntitySelector {
  entity: {
    filter?: EntityFilter | EntityFilter[]
    /**
     * Ids to leave out of the list, on top of whatever `filter` allows.
     *
     * A list rather than a predicate, which is the whole of its usefulness: what a card
     * editor wants to hide is the entities its own config has already taken, and that is
     * a set of ids rather than a property of any entity. `ha-selector-entity` forwards it
     * to the picker's `excludeEntities`. Note it hides them from the *list*: a value
     * already selected still shows, which is what lets a row exclude its siblings without
     * blanking itself.
     */
    exclude_entities?: string[]
    /**
     * Turns the picker into a list of pickers. The value it reports is then a
     * `string[]`, and once the user removes the last entity, it is an empty array rather
     * than `undefined`. See `applyFormData` in `core/card-editor.ts`.
     */
    multiple?: boolean
    /** Drag handles on a multiple picker. Off unless asked for. */
    reorder?: boolean
  }
}

export interface SelectOption {
  value: string
  label: string
  /** A second line under the label. Only `box` mode draws it. */
  description?: string
}

export interface SelectSelector {
  select: {
    options: SelectOption[]
    /**
     * Omit it and the option count decides: under six renders `list` (radio buttons),
     * six or more `dropdown`. `box` (labelled tiles) is never chosen for you.
     */
    mode?: 'dropdown' | 'list' | 'box'
    /** `box` mode only. */
    box_max_columns?: number
    multiple?: boolean
  }
}

export interface NumberSelector {
  number: {
    min?: number
    max?: number
    step?: number
    /**
     * Omit it and `min`/`max` decide: `ha-selector-number` draws a box unless both are
     * given, and a slider (with the value and its unit beside it) when they are.
     */
    mode?: 'box' | 'slider'
    /** Shown after the value, and only ever cosmetic: the config carries the bare number. */
    unit_of_measurement?: string
  }
}

/** An `mdi:` name, chosen from a searchable list of the whole set. */
export interface IconSelector {
  icon: {
    /**
     * Greyed into the empty field, and never written to the config.
     *
     * `ha-selector-icon` prefers this over the icon it would otherwise work out for
     * itself, which is the reason to pass one: its own guess comes from Home Assistant's
     * state icon, and for a `device_class: battery` sensor that is computed from the level,
     * so it would offer `mdi:battery-70` where this card actually draws `mdi:battery`.
     * A placeholder is a promise about what happens when the field is left empty, so it
     * has to be made by whoever keeps it.
     */
    placeholder?: string
  }
}

/** A line of text. `ha-selector-text` reports `undefined` (not `''`) when it is emptied. */
export interface TextSelector {
  text: {
    /** Same arrangement as the icon selector's: a suggestion, not a value. */
    placeholder?: string
  }
}

/**
 * A switch. Nothing to configure, and the empty object is what selects it.
 *
 * `ha-selector-boolean` renders `.checked=${this.value ?? this.placeholder === true}` and
 * reports `target.checked`, so it always sends a real boolean: `false` included, which is
 * what lets an off switch survive `applyFormData` rather than being read as a blank.
 */
export interface BooleanSelector {
  boolean: Record<string, never>
}

/**
 * Home Assistant's own colour picker: the 25 named tokens, as a grid of swatches.
 *
 * `ha-selector-ui_color` forwards all four keys to `ha-color-picker` and reports the bare
 * token (`"red"`), which is exactly what the entity registry stores for a calendar and what
 * `core/entity-color.ts` reads. Two of the keys earn their place in this library:
 *
 *  - `include_none` adds a **No color** row, and it is the only way a set colour can be
 *    unset again: without it the picker offers 25 swatches and no way back. It reports the
 *    string `"none"`, which is not a colour any more than an empty field is, so a caller
 *    has to read it as "cleared" rather than store it.
 *  - `default_color` marks one swatch **(default)**, which is how the picker says out loud
 *    what an empty field will draw.
 */
export interface UiColorSelector {
  ui_color: {
    default_color?: string
    include_none?: boolean
    include_state?: boolean
  }
}

/**
 * A selector, as `ha-selector` reads it.
 *
 * It dispatches on `Object.keys(selector)[0]`, so exactly one key is meaningful;
 * hence a union rather than a bag of optional keys. The shipped build knows 57 of
 * these; these are the seven our editors ask for.
 */
export type Selector =
  | EntitySelector
  | SelectSelector
  | NumberSelector
  | IconSelector
  | TextSelector
  | BooleanSelector
  | UiColorSelector

/** One row of an `ha-form`: a label, and a control chosen by the selector. */
export interface HaFormRow {
  name: string
  selector: Selector
  /** Purely presentational here: `ha-form` marks the field, it does not enforce it. */
  required?: boolean
}

/**
 * A group of rows behind a disclosure triangle: `ha-form-expandable`.
 *
 * The one node with a `type` rather than a `selector` that this library uses. (`ha-form`
 * knows eleven, dispatched to `ha-form-${type}` and lazily imported when it first sees
 * one.) The battery card's accordions are `ha-expansion-panel`s of its own instead,
 * because a panel it owns is one it can hang a drag handle and a delete button off; this
 * node cannot, and a group of plain rows does not need to.
 *
 * **`flatten` is `true` and not optional**, which is a decision rather than a formality.
 * `ha-form` reads a named node's value as `data[name]` and merges its answer back under
 * that key, so a group without it would nest its rows in a config object of their own:
 * `advanced: { day_offset: 1 }` in the user's YAML, for a panel that exists to fold two
 * rows out of sight. `flatten` opts out of both halves, which is what Home Assistant's own
 * badge and heading editors do with their **Content** panel, and it is what lets
 * `formData` and `applyFormData` go on seeing one flat config.
 *
 * `title` wins over `computeLabel`; passing neither leaves the summary the bare `name`.
 */
export interface HaFormExpandable {
  name: string
  type: 'expandable'
  flatten: true
  title?: string
  /** An `@mdi/js` path, drawn left of the title. `icon` takes an `mdi:` name instead. */
  iconPath?: string
  /** Open on the first render. Off means the panel arrives folded. */
  expanded?: boolean
  schema: readonly HaFormSchema[]
}

/**
 * One node of an `ha-form` schema: a row, or a group of them.
 *
 * A union rather than one shape with optional keys, because the two are read by different
 * code paths in `ha-form` itself and nothing sensible has both. `'selector' in node` is
 * the narrowing every reader uses.
 */
export type HaFormSchema = HaFormRow | HaFormExpandable

/**
 * The element a card's `static getConfigElement()` hands back.
 *
 * The contract, read out of `hui-element-editor` in the 2026.7.4 frontend rather than
 * from documentation, is written up on `CupertinoCardEditor`.
 */
export interface LovelaceCardEditor extends HTMLElement {
  hass?: HomeAssistant
  setConfig(config: LovelaceCardConfig): void
}

/**
 * The static side of a card class: what Home Assistant reaches for on the constructor
 * rather than on the element. `hui-card-element-editor` looks up exactly this, so the
 * dev harness can drive the same path the dashboard does.
 */
export interface LovelaceCardConstructor {
  getConfigElement?(): LovelaceCardEditor | Promise<LovelaceCardEditor>
  getStubConfig?(): LovelaceCardConfig
}

export interface LovelaceCard extends HTMLElement {
  hass?: HomeAssistant
  /**
   * Set by Home Assistant while the dashboard is in EDIT mode: `hui-section` assigns
   * `lovelace.editMode` to it, so it is true for every card at once. Not the same thing
   * as `CustomCardEntry.preview` below, despite the name.
   */
  preview?: boolean
  /**
   * The view's layout type (`"grid"`, `"panel"`, …), set by Home Assistant. Wrapper
   * cards forward it to their child card, so this name is NOT available for a card's
   * own use; see the note on `CupertinoCard.cwLayout`.
   */
  layout?: string
  setConfig(config: LovelaceCardConfig): void
  /** Legacy masonry layout sizing, in ~50px units. */
  getCardSize?(): number | Promise<number>
  /** Sections layout sizing. The current API; `getLayoutOptions` is its predecessor. */
  getGridOptions?(): LovelaceGridOptions
}

/** One entry in `window.customCards`, which feeds the dashboard card picker. */
export interface CustomCardEntry {
  type: string
  name: string
  description?: string
  /** Render a live instance of the card in the picker instead of a generic tile. */
  preview?: boolean
  documentationURL?: string
}
