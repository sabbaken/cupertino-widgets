/**
 * Stand-ins for the Home Assistant frontend elements our cards use.
 *
 * `ha-card`'s CSS is copied from the one that ships inside home-assistant 2026.7.4, so
 * the harness shows the same surface the real dashboard does, including the 1px border
 * that is easy to forget about, which `layout.ts` prices its row budget against. The one
 * departure is marked below. `ha-form` and `ha-icon` are the opposite: a working shape,
 * not a copy. See the notes on them.
 */

import {
  mdiAccountMultiple,
  mdiBagSuitcase,
  mdiBattery,
  mdiBatteryUnknown,
  mdiCellphone,
  mdiClipboardList,
  mdiDoorbellVideo,
  mdiHeadphones,
  mdiHelpCircleOutline,
  mdiHome,
  mdiLaptop,
  mdiTablet,
  mdiWatch,
} from '@mdi/js'

import type {
  EntityFilter,
  EntitySelector,
  HaFormSchema,
  HomeAssistant,
  NumberSelector,
  SelectOption,
} from '../src/core/types/ha'

const asArray = <T>(value: T | readonly T[] | undefined): readonly T[] =>
  value === undefined ? [] : Array.isArray(value) ? value : [value as T]

const entityName = (hass: HomeAssistant | undefined, entityId: string): string =>
  hass?.states[entityId]?.attributes.friendly_name ?? entityId

/**
 * The entities a filter allows, as ids.
 *
 * The real selector ORs the filter's clauses and ANDs the keys inside one, then takes the
 * exclusions off the result. All three are read here, because all three change what the
 * battery card's editor offers: `device_class` is what turns a list of every sensor in the
 * installation into a list of batteries, and the exclusions are what stop it offering a device
 * that is already in the list.
 *
 * Shared by the two stubs that need it (the form's entity rows and the picker below) because
 * the real ones share it too, and a harness where one of them filtered differently would be
 * answering a question Home Assistant does not ask.
 */
const matchingEntities = (
  hass: HomeAssistant | undefined,
  clauses: readonly EntityFilter[],
  excluded: readonly string[] | undefined,
): string[] => {
  const skip = new Set(excluded ?? [])
  const states = hass?.states ?? {}

  return Object.keys(states).filter(id => {
    if (skip.has(id)) return false
    if (!clauses.length) return true
    return clauses.some(clause => {
      const domains = asArray(clause.domain)
      const classes = asArray(clause.device_class)
      if (domains.length && !domains.includes(id.split('.')[0] ?? '')) return false
      return !classes.length || classes.includes(String(states[id]?.attributes.device_class))
    })
  })
}

const HA_CARD_CSS = `
  :host {
    background: var(--ha-card-background, var(--card-background-color, white));
    backdrop-filter: var(--ha-card-backdrop-filter, none);
    box-shadow: var(--ha-card-box-shadow, none);
    box-sizing: border-box;
    /* The real rule has no 12px here: it leans on --ha-border-radius-lg, which is set
       by a theme the harness does not load. The card overrides this anyway. */
    border-radius: var(--ha-card-border-radius, var(--ha-border-radius-lg, 12px));
    border-width: var(--ha-card-border-width, 1px);
    border-style: solid;
    border-color: var(--ha-card-border-color, var(--divider-color, #e0e0e0));
    color: var(--primary-text-color);
    display: block;
    position: relative;
    transition: all 0.3s ease-out 0s;
  }
`

/**
 * Not copied from anywhere: the real `ha-form` is a stack of `ha-selector`s and looks
 * nothing like this. Enough to tell the rows apart and read the helper lines.
 */
const HA_FORM_CSS = `
  :host {
    display: block;
    font: 400 14px/1.4 -apple-system, BlinkMacSystemFont, system-ui, sans-serif;
    color: var(--primary-text-color);
  }

  fieldset {
    margin: 0 0 16px;
    padding: 0;
    border: 0;
  }

  legend {
    padding: 0 0 10px;
    font-size: 13px;
    font-weight: 500;
  }

  .options {
    display: flex;
    flex-direction: column;
    gap: 8px;
  }

  /* A plain row. The real selector draws a searchable picker with friendly names, area
     breadcrumbs and drag handles, and no amount of border-radius here would get any
     closer to it, so this stays out of the way instead of imitating a card. */
  .option {
    display: flex;
    align-items: center;
    gap: 8px;
    cursor: pointer;
  }

  .option span {
    display: flex;
    flex-direction: column;
  }

  .option small {
    font-size: 11px;
    color: var(--secondary-text-color);
  }

  .helper {
    margin-top: 6px;
    font-size: 11px;
    color: var(--secondary-text-color);
  }

  .number {
    display: flex;
    align-items: center;
    gap: 10px;
  }

  .number input {
    flex: 1;
    min-width: 0;
  }

  .number output {
    min-width: 44px;
    font-variant-numeric: tabular-nums;
    text-align: right;
  }

  .text {
    width: 100%;
    box-sizing: border-box;
  }
`

/**
 * A stand-in for the Home Assistant icon registry, which is a much bigger thing than this.
 *
 * The real `ha-icon` resolves any of the ~7500 `mdi:` names (and a custom icon set, and an
 * entity's computed icon) out of an IndexedDB cache it fills over the network. Here it is a
 * lookup table, deliberately: importing all of `@mdi/js` would put a megabyte of path strings
 * into the showcase that GitHub Pages then serves to every visitor, for the sake of icons only
 * this file's own mock devices ever ask for.
 *
 * So: add an entry when a fixture file grows one, which is `battery-devices.ts` for a device's
 * icon and `reminders-lists.ts` for a to-do list's. A name with no entry draws the question
 * mark rather than nothing, on the same grounds as the `ha-form` stub's unsupported row: a
 * silently blank icon reads as a broken card, and the cards are what this page is for.
 *
 * `mdi:clipboard-list` is not any fixture's: it is the reminders card's own fallback, and the
 * one a visitor sees most, because Home Assistant resolves a to-do list's default glyph
 * frontend-side and it therefore never reaches `attributes` for a fixture to carry.
 */
const ICONS: Record<string, string> = {
  'mdi:account-multiple': mdiAccountMultiple,
  'mdi:bag-suitcase': mdiBagSuitcase,
  'mdi:battery': mdiBattery,
  'mdi:battery-unknown': mdiBatteryUnknown,
  'mdi:cellphone': mdiCellphone,
  'mdi:clipboard-list': mdiClipboardList,
  'mdi:doorbell-video': mdiDoorbellVideo,
  'mdi:headphones': mdiHeadphones,
  'mdi:home': mdiHome,
  'mdi:laptop': mdiLaptop,
  'mdi:tablet': mdiTablet,
  'mdi:watch': mdiWatch,
}

/**
 * The `:host` rule is the real one's, and it is the part worth copying exactly: a card sizes
 * an icon by setting `--mdc-icon-size` and by nothing else, so a stub that took its size from
 * the glyph would draw every icon at the same size however the card scaled.
 */
const HA_ICON_CSS = `
  :host {
    display: inline-flex;
    align-items: center;
    justify-content: center;
    position: relative;
    vertical-align: middle;
    fill: currentcolor;
    width: var(--mdc-icon-size, 24px);
    height: var(--mdc-icon-size, 24px);
  }

  svg {
    width: 100%;
    height: 100%;
    display: block;
  }
`

const SVG_NS = 'http://www.w3.org/2000/svg'

class HaIconStub extends HTMLElement {
  private readonly _root: ShadowRoot
  private _icon = ''

  public constructor() {
    super()
    this._root = this.attachShadow({ mode: 'open' })
    const style = document.createElement('style')
    style.textContent = HA_ICON_CSS
    this._root.append(style)
  }

  /** Both a property and an attribute, because the real one is too, and cards use either. */
  public static get observedAttributes(): string[] {
    return ['icon']
  }

  public attributeChangedCallback(_name: string, _old: string | null, value: string | null): void {
    this.icon = value ?? ''
  }

  public set icon(value: string) {
    if (this._icon === value) return
    this._icon = value
    this._render()
  }

  public get icon(): string {
    return this._icon
  }

  private _render(): void {
    const style = this._root.firstElementChild as HTMLStyleElement
    const path = ICONS[this._icon] ?? mdiHelpCircleOutline

    const svg = document.createElementNS(SVG_NS, 'svg')
    svg.setAttribute('viewBox', '0 0 24 24')
    svg.setAttribute('aria-hidden', 'true')
    const shape = document.createElementNS(SVG_NS, 'path')
    shape.setAttribute('d', path)
    svg.append(shape)

    this._root.replaceChildren(style, svg)
  }
}

class HaCardStub extends HTMLElement {
  constructor() {
    super()
    const root = this.attachShadow({ mode: 'open' })
    const style = document.createElement('style')
    style.textContent = HA_CARD_CSS
    root.append(style, document.createElement('slot'))
  }
}

/**
 * `ha-svg-icon`: the same glyph as `ha-icon`, given as a path rather than by name.
 *
 * A property and not an attribute, because that is how it is used, as in `.path=${mdiDrag}`.
 */
class HaSvgIconStub extends HTMLElement {
  private readonly _root: ShadowRoot
  private _path = ''

  public constructor() {
    super()
    this._root = this.attachShadow({ mode: 'open' })
    const style = document.createElement('style')
    style.textContent = HA_ICON_CSS
    this._root.append(style)
  }

  public set path(value: string) {
    if (this._path === value) return
    this._path = value
    const style = this._root.firstElementChild as HTMLStyleElement
    const svg = document.createElementNS(SVG_NS, 'svg')
    svg.setAttribute('viewBox', '0 0 24 24')
    svg.setAttribute('aria-hidden', 'true')
    const shape = document.createElementNS(SVG_NS, 'path')
    shape.setAttribute('d', value)
    svg.append(shape)
    this._root.replaceChildren(style, svg)
  }

  public get path(): string {
    return this._path
  }
}

const HA_ICON_BUTTON_CSS = `
  :host {
    display: inline-block;
    --mdc-icon-size: 24px;
  }

  button {
    display: flex;
    align-items: center;
    justify-content: center;
    width: var(--ha-icon-button-size, 48px);
    height: var(--ha-icon-button-size, 48px);
    padding: 0;
    border: 0;
    border-radius: 50%;
    background: none;
    color: inherit;
    cursor: pointer;
  }

  button:hover {
    background: rgba(127, 127, 127, 0.12);
  }
`

/**
 * `ha-icon-button`: a real `<button>` around a glyph, and the `--ha-icon-button-size` handle
 * the real one takes its size from.
 *
 * The `label` becomes the accessible name, as it does in Home Assistant. Worth having as a
 * button rather than a clickable div: the editor's delete affordance has to be reachable by
 * keyboard, and only a button is that for free.
 */
class HaIconButtonStub extends HTMLElement {
  private readonly _button: HTMLButtonElement
  private readonly _icon: HaSvgIconStub

  public constructor() {
    super()
    const root = this.attachShadow({ mode: 'open' })
    const style = document.createElement('style')
    style.textContent = HA_ICON_BUTTON_CSS
    this._button = document.createElement('button')
    this._icon = document.createElement('ha-svg-icon') as HaSvgIconStub
    this._button.append(this._icon)
    root.append(style, this._button)
  }

  public set path(value: string) {
    this._icon.path = value
  }

  public set label(value: string) {
    this._button.setAttribute('aria-label', value)
    this._button.title = value
  }
}

const HA_EXPANSION_PANEL_CSS = `
  :host {
    display: block;
  }

  :host([outlined]) {
    border: 1px solid var(--divider-color, #e0e0e0);
    border-radius: 6px;
  }

  .top {
    display: flex;
    align-items: center;
  }

  #summary {
    flex: 1;
    display: flex;
    align-items: center;
    gap: 8px;
    min-height: 48px;
    padding: 0 8px;
    font-weight: 500;
    cursor: pointer;
    overflow: hidden;
  }

  .header {
    flex: 1;
    min-width: 0;
  }

  .secondary {
    display: block;
    font-weight: 400;
    font-size: 11px;
    color: var(--secondary-text-color);
  }

  .chevron {
    transition: transform 0.15s ease;
  }

  .chevron.expanded {
    transform: rotate(180deg);
  }

  .container {
    padding: 0 8px;
  }

  .container[hidden] {
    display: none;
  }
`

const CHEVRON = 'M7.41,8.58L12,13.17L16.59,8.58L18,10L12,16L6,10L7.41,8.58Z'

/**
 * `ha-expansion-panel`: the accordion the battery card's device rows are.
 *
 * Its slots are the real one's, because the editor addresses them by name and getting one
 * wrong is a silently empty summary: `leading-icon` before the header, `header` (which the
 * `header`/`secondary` properties fill when nothing is slotted into it), and `icons` after
 * the chevron, which is where the delete button goes.
 *
 * The one behaviour worth copying rather than approximating is the toggle guard. The real
 * `_toggleContainer` opens with `if (e.defaultPrevented) return`, which is the whole reason a
 * button can live inside a clickable summary at all; the editor's delete handler calls
 * `preventDefault`, and a stub without this check would delete a device and open the panel
 * below it in the same click.
 */
class HaExpansionPanelStub extends HTMLElement {
  private readonly _root: ShadowRoot
  private readonly _summary: HTMLDivElement
  private readonly _headerText: HTMLSpanElement
  private readonly _secondaryText: HTMLSpanElement
  private readonly _chevron: HaSvgIconStub
  private readonly _container: HTMLDivElement
  private _expanded = false

  public constructor() {
    super()
    this._root = this.attachShadow({ mode: 'open' })
    const style = document.createElement('style')
    style.textContent = HA_EXPANSION_PANEL_CSS

    const top = document.createElement('div')
    top.className = 'top'
    this._summary = document.createElement('div')
    this._summary.id = 'summary'
    this._summary.setAttribute('role', 'button')
    this._summary.tabIndex = 0

    const leading = document.createElement('slot')
    leading.name = 'leading-icon'

    const headerSlot = document.createElement('slot')
    headerSlot.name = 'header'
    const header = document.createElement('div')
    header.className = 'header'
    this._headerText = document.createElement('span')
    this._secondaryText = document.createElement('span')
    this._secondaryText.className = 'secondary'
    header.append(this._headerText, this._secondaryText)
    headerSlot.append(header)

    this._chevron = document.createElement('ha-svg-icon') as HaSvgIconStub
    this._chevron.className = 'chevron'
    this._chevron.path = CHEVRON

    const icons = document.createElement('slot')
    icons.name = 'icons'

    this._summary.append(leading, headerSlot, this._chevron, icons)
    top.append(this._summary)

    this._container = document.createElement('div')
    this._container.className = 'container'
    this._container.hidden = true
    this._container.append(document.createElement('slot'))

    this._root.append(style, top, this._container)

    const toggle = (event: Event): void => {
      if (event.defaultPrevented) return
      if (event instanceof KeyboardEvent && event.key !== 'Enter' && event.key !== ' ') return
      event.preventDefault()
      this.expanded = !this._expanded
      this.dispatchEvent(
        new CustomEvent('expanded-changed', {
          detail: { expanded: this._expanded },
          bubbles: true,
          composed: true,
        }),
      )
    }
    this._summary.addEventListener('click', toggle)
    this._summary.addEventListener('keydown', toggle)
  }

  public set expanded(value: boolean) {
    this._expanded = value
    this._container.hidden = !value
    this._chevron.classList.toggle('expanded', value)
    this._summary.setAttribute('aria-expanded', String(value))
  }

  public get expanded(): boolean {
    return this._expanded
  }

  public set header(value: string) {
    this._headerText.textContent = value
  }

  public set secondary(value: string) {
    this._secondaryText.textContent = value
  }
}

const HA_ENTITY_PICKER_CSS = `
  :host {
    display: block;
  }

  button {
    display: inline-flex;
    align-items: center;
    gap: 8px;
    height: 36px;
    padding: 0 16px;
    border: none;
    border-radius: 9999px;
    background: var(--primary-color, #03a9f4);
    color: var(--text-primary-color, #fff);
    font: 500 14px/1 inherit;
    font-family: inherit;
    cursor: pointer;
  }

  select {
    width: 100%;
    box-sizing: border-box;
  }

  select[hidden] {
    display: none;
  }
`

/**
 * `ha-entity-picker`, and only the two things about it this library leans on.
 *
 * The real one is a searchable combo box over every entity in the installation, with state
 * badges, area breadcrumbs and a create-helper row; this is a `select`. What it copies exactly
 * is the contract the battery card's add control depends on:
 *
 *  - **`add-button`**: with it the real picker renders `ha-button` with the label from
 *    `addButtonLabel` and `@click=${this.open}`, and passes `undefined` down as its value
 *    whatever it holds, so it is a button before the press, opens the list on the press, and
 *    is a button again afterwards, with nothing to reset. Both halves matter and one of them
 *    is what two earlier attempts at this control got wrong.
 *  - **`value-changed` carrying a bare id string**, not the `{ [name]: value }` object an
 *    `ha-form` reports. An editor written against the wrong one of those silently adds nothing.
 *
 * The filter properties are the picker's own spelling of a selector's `filter`, which is why
 * they are read here rather than ignored: `includeDomains`, `includeDeviceClasses` and
 * `excludeEntities`.
 */
class HaEntityPickerStub extends HTMLElement {
  private readonly _root: ShadowRoot
  private _hass: HomeAssistant | undefined
  private _addButtonLabel = 'Add'
  private _includeDomains: string[] = []
  private _includeDeviceClasses: string[] = []
  private _excludeEntities: string[] = []
  private _value = ''
  private _pending = false

  public constructor() {
    super()
    this._root = this.attachShadow({ mode: 'open', delegatesFocus: true })
    const style = document.createElement('style')
    style.textContent = HA_ENTITY_PICKER_CSS
    this._root.append(style)
  }

  public set hass(value: HomeAssistant | undefined) {
    this._hass = value
    this._invalidate()
  }

  public set addButtonLabel(value: string) {
    this._addButtonLabel = value
    this._invalidate()
  }

  public set includeDomains(value: string[] | undefined) {
    this._includeDomains = value ?? []
    this._invalidate()
  }

  public set includeDeviceClasses(value: string[] | undefined) {
    this._includeDeviceClasses = value ?? []
    this._invalidate()
  }

  public set excludeEntities(value: readonly string[] | undefined) {
    this._excludeEntities = [...(value ?? [])]
    this._invalidate()
  }

  public set value(value: string | undefined) {
    this._value = value ?? ''
    this._invalidate()
  }

  public get value(): string {
    return this._value
  }

  /** The one method an editor calls on it. */
  public open(): void {
    const select = this._root.querySelector('select')
    if (!select) return
    select.hidden = false
    select.focus()
    try {
      select.showPicker()
    } catch {
      // Needs a user gesture, and the harness is not always in one.
    }
  }

  private _invalidate(): void {
    if (this._pending) return
    this._pending = true
    queueMicrotask(() => {
      this._pending = false
      this._render()
    })
  }

  private _render(): void {
    const style = this._root.firstElementChild as HTMLStyleElement
    const addButton = this.hasAttribute('add-button')

    const select = document.createElement('select')
    const blank = document.createElement('option')
    blank.value = ''
    blank.textContent = '—'
    select.append(blank)

    for (const entityId of matchingEntities(
      this._hass,
      [{ domain: this._includeDomains, device_class: this._includeDeviceClasses }],
      this._excludeEntities,
    )) {
      const option = document.createElement('option')
      option.value = entityId
      option.textContent = entityName(this._hass, entityId)
      select.append(option)
    }

    // Never shows a value in add-button mode, exactly as the real one does not.
    select.value = addButton ? '' : this._value
    select.hidden = addButton
    select.addEventListener('change', () => {
      const value = select.value
      this._value = addButton ? '' : value
      if (addButton) select.hidden = true
      this.dispatchEvent(
        new CustomEvent('value-changed', {
          detail: { value: value || undefined },
          bubbles: true,
          composed: true,
        }),
      )
    })

    const children: Element[] = [select]
    if (addButton) {
      const button = document.createElement('button')
      button.type = 'button'
      button.textContent = this._addButtonLabel
      button.addEventListener('click', () => this.open())
      children.unshift(button)
    }

    this._root.replaceChildren(style, ...children)
  }
}

/**
 * `ha-sortable`: here, only the shape of it.
 *
 * The real one loads sortablejs and makes its first child's children draggable by a handle,
 * then rolls its own DOM change back and reports `item-moved` with two indices so the
 * framework can re-render the new order. Reproducing that is not what this harness is for,
 * so this renders its children and drags nothing: the reorder *rule* is `moveRow` in
 * `model.ts`, which a test covers, and the drag itself is one of the things `pnpm ha:up` is
 * for. Light DOM rather than a shadow root, like the real one, so the editor's own CSS still
 * reaches the rows inside it.
 */
class HaSortableStub extends HTMLElement {}

/**
 * A stand-in for `ha-form`, so a card editor can be developed here too.
 *
 * It implements the API surface our editors actually touch: the `.hass` / `.data` /
 * `.schema` / `.computeLabel` / `.computeHelper` properties, and a `value-changed`
 * event whose detail carries the WHOLE data object rather than the field that moved,
 * which is the part that is easy to get wrong. Behind that it is plain form controls.
 *
 * It is emphatically **not** a replica of the widget. The real `ha-form` hands each row
 * to an `ha-selector`, which draws a searchable entity picker with friendly names, area
 * breadcrumbs and drag handles; this draws a list of checkboxes. Develop the editor's
 * behaviour here, then look at it in the dev Home Assistant (`pnpm ha:up`) before
 * believing anything about how it reads.
 *
 * Its own shadow root, like the real one. An editor puts this inside *its* shadow
 * root, where the harness stylesheet cannot reach it anyway.
 */
class HaFormStub extends HTMLElement {
  private readonly _root: ShadowRoot
  private _hass: HomeAssistant | undefined
  private _data: Record<string, unknown> = {}
  private _schema: readonly HaFormSchema[] = []
  /** Both take the same arguments the real `ha-form` passes. */
  private _computeLabel:
    ((schema: HaFormSchema, data: Record<string, unknown>) => string) | undefined
  private _computeHelper: ((schema: HaFormSchema) => string | undefined) | undefined
  private _pending = false

  constructor() {
    super()
    // `delegatesFocus` is the real one's (`shadowRootOptions = {mode:'open', delegatesFocus:true}`)
    // and it is not decoration: it is how an editor gets the keyboard into a control it has
    // just revealed; `form.focus()` lands on the field inside, and a keydown there bubbles
    // back out to the editor's own handler. A stub without it swallows both.
    this._root = this.attachShadow({ mode: 'open', delegatesFocus: true })
    const style = document.createElement('style')
    style.textContent = HA_FORM_CSS
    this._root.append(style)
  }

  public set hass(value: HomeAssistant | undefined) {
    this._hass = value
    this._invalidate()
  }

  public set data(value: Record<string, unknown> | undefined) {
    this._data = value ?? {}
    this._invalidate()
  }

  public set schema(value: readonly HaFormSchema[] | undefined) {
    this._schema = value ?? []
    this._invalidate()
  }

  public set computeLabel(
    value: ((schema: HaFormSchema, data: Record<string, unknown>) => string) | undefined,
  ) {
    this._computeLabel = value
    this._invalidate()
  }

  public set computeHelper(value: ((schema: HaFormSchema) => string | undefined) | undefined) {
    this._computeHelper = value
    this._invalidate()
  }

  /** Coalesces the five property writes one Lit render makes into a single repaint. */
  private _invalidate(): void {
    if (this._pending) return
    this._pending = true
    queueMicrotask(() => {
      this._pending = false
      this._render()
    })
  }

  /**
   * The real one merges the changed field into its data and re-fires the lot. Editors
   * are written against that, so the stub has to do it too.
   */
  private _emit(name: string, value: unknown): void {
    this.dispatchEvent(
      new CustomEvent('value-changed', {
        detail: { value: { ...this._data, [name]: value } },
        bubbles: true,
        composed: true,
      }),
    )
  }

  private _render(): void {
    // Rebuilding the DOM drops the focus ring mid-keyboard-navigation; put it back.
    const active = this._root.activeElement
    const focused = active instanceof HTMLElement ? active.id : ''

    const style = this._root.firstElementChild as HTMLStyleElement
    this._root.replaceChildren(style, ...this._schema.map(node => this._renderRow(node)))

    if (focused) this._root.getElementById(focused)?.focus()
  }

  private _renderRow(node: HaFormSchema): HTMLElement {
    const row = document.createElement('fieldset')
    const value = this._data[node.name]

    const legend = document.createElement('legend')
    legend.textContent = this._computeLabel?.(node, this._data) ?? node.name
    row.append(legend)

    if ('select' in node.selector) {
      row.append(this._renderSelect(node, node.selector.select.options))
    } else if ('number' in node.selector) {
      row.append(this._renderNumber(node.name, value, node.selector.number))
    } else if ('icon' in node.selector) {
      row.append(this._renderText(node.name, value, node.selector.icon.placeholder))
    } else if ('text' in node.selector) {
      row.append(this._renderText(node.name, value, node.selector.text.placeholder))
    } else if ('boolean' in node.selector) {
      row.append(this._renderBoolean(node.name, value))
    } else if (node.selector.entity.multiple) {
      row.append(this._renderEntities(node, node.selector.entity))
    } else {
      row.append(this._renderEntity(node.name, value, node.selector.entity))
    }

    const helper = this._computeHelper?.(node)
    if (helper) {
      const hint = document.createElement('div')
      hint.className = 'helper'
      hint.textContent = helper
      row.append(hint)
    }

    return row
  }

  private _renderSelect(node: HaFormSchema, options: readonly SelectOption[]): HTMLElement {
    const list = document.createElement('div')
    list.className = 'options'

    for (const option of options) {
      const id = `${node.name}-${option.value}`
      const label = document.createElement('label')
      label.className = 'option'

      const radio = document.createElement('input')
      radio.type = 'radio'
      radio.id = id
      radio.name = node.name
      radio.value = option.value
      radio.checked = this._data[node.name] === option.value
      radio.addEventListener('change', () => this._emit(node.name, option.value))

      const text = document.createElement('span')
      text.append(option.label)
      if (option.description) {
        const description = document.createElement('small')
        description.textContent = option.description
        text.append(description)
      }

      label.append(radio, text)
      list.append(label)
    }

    return list
  }

  /**
   * A slider and its reading, which is the shape the real selector settles on too once it
   * has been given a `min` and a `max`.
   *
   * The one thing worth copying exactly is the type of the value it reports: `ha-form`
   * hands back a **number**, and an editor that folded a string into the config would put
   * `scale: "110"` in somebody's YAML and look fine doing it here.
   */
  private _renderNumber(
    name: string,
    value: unknown,
    number: NumberSelector['number'],
  ): HTMLElement {
    const min = number.min ?? 0
    const max = number.max ?? 100
    const current = typeof value === 'number' ? value : min

    const wrap = document.createElement('div')
    wrap.className = 'number'

    const input = document.createElement('input')
    input.type = 'range'
    input.id = `${name}-range`
    input.min = String(min)
    input.max = String(max)
    input.step = String(number.step ?? 1)
    input.value = String(current)

    const readout = document.createElement('output')
    readout.textContent = `${current}${number.unit_of_measurement ?? ''}`

    input.addEventListener('input', () => this._emit(name, Number(input.value)))

    wrap.append(input, readout)
    return wrap
  }

  /**
   * A text box, standing in for both the icon picker and the text selector.
   *
   * The real icon picker is a searchable combo box over the whole MDI set and this is a
   * field you type `mdi:watch` into, which is the one thing worth having here: the value
   * the editor writes. Both report `undefined` rather than `''` for an emptied field:
   * that is what makes an override disappear from the config instead of shadowing the
   * entity's own value with nothing, so the stub reports it the same way.
   */
  private _renderText(name: string, value: unknown, placeholder: string | undefined): HTMLElement {
    const input = document.createElement('input')
    input.type = 'text'
    input.className = 'text'
    input.id = name
    input.value = typeof value === 'string' ? value : ''
    input.placeholder = placeholder ?? ''
    input.addEventListener('input', () => this._emit(name, input.value || undefined))
    return input
  }

  /**
   * A checkbox where Home Assistant draws a switch, and the one thing worth copying is what
   * it reports: `target.checked`, so a **boolean** and never `undefined`. An editor that
   * only ever saw a truthy value here would have no way to write an option off.
   */
  private _renderBoolean(name: string, value: unknown): HTMLElement {
    const input = document.createElement('input')
    input.type = 'checkbox'
    input.id = name
    input.checked = value === true
    input.addEventListener('change', () => this._emit(name, input.checked))
    return input
  }

  private _candidates(selector: EntitySelector['entity']): string[] {
    return matchingEntities(this._hass, asArray(selector.filter), selector.exclude_entities)
  }

  private _name(entityId: string): string {
    return entityName(this._hass, entityId)
  }

  private _renderEntities(node: HaFormSchema, selector: EntitySelector['entity']): HTMLElement {
    const list = document.createElement('div')
    list.className = 'options'

    const selected = Array.isArray(this._data[node.name]) ? (this._data[node.name] as string[]) : []
    const candidates = this._candidates(selector)

    for (const entityId of candidates) {
      const id = `${node.name}-${entityId}`
      const label = document.createElement('label')
      label.className = 'option'

      const box = document.createElement('input')
      box.type = 'checkbox'
      box.id = id
      box.checked = selected.includes(entityId)
      box.addEventListener('change', () => {
        const next = box.checked
          ? [...selected, entityId]
          : selected.filter(current => current !== entityId)
        this._emit(node.name, next)
      })

      const text = document.createElement('span')
      text.append(this._name(entityId))
      const raw = document.createElement('small')
      raw.textContent = entityId
      text.append(raw)

      label.append(box, text)
      list.append(label)
    }

    if (!candidates.length) {
      const empty = document.createElement('div')
      empty.className = 'helper'
      empty.textContent = 'No matching entities in the mock hass.'
      list.append(empty)
    }

    return list
  }

  /**
   * One entity, or none. A blank option rather than a required choice, because that is what
   * clearing the real picker does, and an editor is judged as much on what it removes from
   * a config as on what it puts there.
   *
   * It also answers to **`open()`**, which is the one thing about the real picker an editor
   * can call. `ha-entity-picker` has such a method (its own add button is
   * `@click=${this.open}`) and the battery card's device list finds it by walking the shadow
   * trees under its `ha-form` so that its Add button opens the list in one press. A stub
   * without an `open` would send that search down its fallback path, and the harness would
   * quietly stop exercising the thing being developed.
   */
  private _renderEntity(
    name: string,
    value: unknown,
    selector: EntitySelector['entity'],
  ): HTMLElement {
    const select = document.createElement('select')
    select.id = name

    const blank = document.createElement('option')
    blank.value = ''
    blank.textContent = '—'
    select.append(blank)

    for (const entityId of this._candidates(selector)) {
      const option = document.createElement('option')
      option.value = entityId
      option.textContent = this._name(entityId)
      select.append(option)
    }

    select.value = typeof value === 'string' ? value : ''
    select.addEventListener('change', () => this._emit(name, select.value || undefined))

    // `showPicker` is the browser's own version of what the real picker's `open` does. It
    // wants a user gesture and throws without one, which is why the caller of `open` catches.
    Object.assign(select, { open: () => select.showPicker() })
    return select
  }
}

export function defineHaStubs(): void {
  const stubs: Record<string, CustomElementConstructor> = {
    'ha-card': HaCardStub,
    'ha-form': HaFormStub,
    'ha-icon': HaIconStub,
    'ha-svg-icon': HaSvgIconStub,
    'ha-icon-button': HaIconButtonStub,
    'ha-expansion-panel': HaExpansionPanelStub,
    'ha-entity-picker': HaEntityPickerStub,
    'ha-sortable': HaSortableStub,
  }

  for (const [tag, ctor] of Object.entries(stubs)) {
    if (!customElements.get(tag)) customElements.define(tag, ctor)
  }
}
