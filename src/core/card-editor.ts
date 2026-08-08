import { LitElement, css, html, nothing, type CSSResultGroup, type TemplateResult } from 'lit'
import { property, state } from 'lit/decorators.js'

import { DEFAULT_SCALE, SCALE_FIELD, SCALE_HELPER, SCALE_LABEL, SCALE_ROW } from './scale'
import type {
  HaFormSchema,
  HomeAssistant,
  LovelaceCardConfig,
  LovelaceCardEditor,
  Selector,
} from './types/ha'

/**
 * A value the config is better off not carrying.
 *
 * `ha-form` reports every field it knows about on every change, including the ones the
 * user has just emptied, and a multiple entity picker says "nothing selected" with `[]`
 * rather than by dropping the key. Home Assistant strips `undefined` out of a config it
 * is handed and nothing else, so an `entities: []` would survive into the user's YAML,
 * where it means exactly what its absence means, only louder.
 */
const isBlank = (value: unknown): boolean =>
  value === undefined ||
  value === null ||
  value === '' ||
  (Array.isArray(value) && value.length === 0)

/**
 * Whether a row reports a list rather than a scalar.
 *
 * Written as a lookup with a false tail rather than as an either/or, because the union of
 * selectors is open: a `number` row has no `multiple` to read, and the version of this
 * that assumed there were only two kinds threw on the first one that was added.
 */
const isMultiple = (selector: Selector): boolean => {
  if ('entity' in selector) return selector.entity.multiple === true
  if ('select' in selector) return selector.select.multiple === true
  return false
}

/**
 * Every field a schema owns, groups walked into.
 *
 * One list rather than one per level, because a group in this library is `flatten: true`
 * (see `HaFormExpandable`): its rows read and write the same flat config the rows beside
 * it do, so the only thing the nesting changes is where they are drawn. A version of this
 * that stopped at the group reported the group's own name as the field, and
 * `applyFormData` then wrote none of the rows inside it: an Advanced section that looked
 * right and saved nothing.
 */
export const fieldNames = (schema: readonly HaFormSchema[]): string[] =>
  schema.flatMap(node => ('selector' in node ? [node.name] : fieldNames(node.schema)))

/**
 * What `ha-form` is handed: the config, with the defaults showing through where it is
 * silent, and a scalar widened to a list wherever the schema says `multiple`.
 *
 * That last part is not decoration. A hand-written `entities: calendar.work` (a scalar
 * where the schema says `multiple`) reaches `ha-entities-picker`, which maps over the
 * value and throws on a string. The selector does know how to coerce, but only inside
 * `willUpdate` and only when the *selector* has changed:
 *
 *     willUpdate(changed) { changed.get('selector') && this.value !== undefined && … }
 *
 * `changed.get` answers the previous value, which on a first update is `undefined`, so
 * the one render where it matters is the one render it sits out.
 */
export const formData = (
  config: Record<string, unknown>,
  defaults: Record<string, unknown>,
  schema: readonly HaFormSchema[],
): Record<string, unknown> => {
  const data: Record<string, unknown> = { ...defaults, ...config }

  const widen = (nodes: readonly HaFormSchema[]): void => {
    for (const node of nodes) {
      // A group holds rows, not a value of its own, and its rows are the ones that might
      // need widening. Walked rather than skipped: a `multiple` picker inside an Advanced
      // section is one hand-written scalar away from the same throw.
      if (!('selector' in node)) {
        widen(node.schema)
        continue
      }
      const multiple = isMultiple(node.selector)
      const value = data[node.name]
      // `isBlank`, not `!== undefined`: a bare `entities:` in the YAML parses to `null`,
      // and wrapping that would show the picker one empty row it cannot fill and then
      // write `[null]` back out.
      if (multiple && !isBlank(value) && !Array.isArray(value)) data[node.name] = [value]
    }
  }

  widen(schema)
  return data
}

/**
 * Fold what the form reported back into the card config.
 *
 * Only the `fields` the form owns are touched. The data object also carries every other
 * key of the config (because that is what we put in it), and a `grid_options` or a
 * `visibility` that came along for the ride has to come back out untouched, including
 * when it happens to be empty.
 */
export const applyFormData = <C extends LovelaceCardConfig>(
  config: C,
  data: Record<string, unknown>,
  fields: readonly string[],
): C => {
  const next: Record<string, unknown> = { ...config }

  for (const field of fields) {
    const value = data[field]
    if (isBlank(value)) delete next[field]
    else next[field] = value
  }

  return next as C
}

/**
 * Shared behaviour for the visual editor of every card in the library.
 *
 * Home Assistant's contract for the element a card's `static getConfigElement()`
 * returns is short and written down nowhere, so here it is, read out of
 * `hui-element-editor` in the 2026.7.4 frontend:
 *
 *  - the host sets `hass` first, then calls `setConfig(config)`, and calls `setConfig`
 *    again on every later change, including the ones this editor itself emitted, and
 *    including edits made in the YAML tab;
 *  - the element is built once and kept; only a change of `config.type` replaces it;
 *  - a change is reported with a `config-changed` event carrying the WHOLE config in
 *    `detail.config`, dispatched on the editor element itself: that is where the host
 *    added its listener;
 *  - keys whose value is `undefined` are stripped out of that config. Nothing else is;
 *  - throwing out of `setConfig` is how an editor says "I cannot edit this": the host
 *    catches it, shows the message, and drops the user into the YAML editor.
 *
 * Worth knowing what else this buys, beyond the fields themselves: the tab strip in the
 * edit dialog is rendered only inside the GUI branch, so a card with no config element
 * gets no **Visibility** and no **Layout** tab either: just the YAML box.
 *
 * Subclasses supply a schema and the words around it; the plumbing lives here.
 */
export abstract class CupertinoCardEditor<C extends LovelaceCardConfig = LovelaceCardConfig>
  extends LitElement
  implements LovelaceCardEditor
{
  /**
   * Deliberately none of the `--cw-*` tokens the cards use. This element is Home
   * Assistant's furniture, not ours: a widget that looks like a phone's should still have
   * a config panel that looks like the dialog it is sitting in.
   */
  static override styles: CSSResultGroup = css`
    :host {
      display: block;
    }
  `

  @property({ attribute: false }) public hass?: HomeAssistant

  @state() protected _config?: C

  public setConfig(config: C): void {
    this._config = config
  }

  /** The rows this card asks for, in order. */
  protected abstract fields(): readonly HaFormSchema[]

  /**
   * The rows a card wants *below* the shared ones, which in practice means a folded
   * section.
   *
   * `fields()` is where a row goes; this exists for the one thing that has to stay at the
   * bottom however the dialog grows. An **Advanced** disclosure triangle is the floor of a
   * settings panel: anything drawn under it reads as an option that escaped the fold
   * rather than as a sibling of the rows above, and **Scale** is an ordinary row in that
   * reading, so it belongs over the triangle rather than under it.
   */
  protected trailingFields(): readonly HaFormSchema[] {
    return []
  }

  /**
   * Every row of the form: the card's own, then the ones every card in the library shares,
   * then whatever the card keeps folded away at the bottom.
   *
   * Composed here rather than left to each editor to remember, for the same reason `scale`
   * lives on `CupertinoCardConfig` rather than on one card's config: it is not a question
   * one widget gets to answer differently from another, and an option that has to be
   * re-added by hand to each new editor is an option the third card will ship without.
   *
   * The shared rows go after the card's own. A card's subject (which calendars, which
   * clock) is why somebody opened the dialog; how big to draw it is a decision taken after
   * that, and anything in `trailingFields` is a decision most people never take at all.
   */
  private schema(): readonly HaFormSchema[] {
    return [...this.fields(), SCALE_ROW, ...this.trailingFields()]
  }

  /**
   * The label for one row.
   *
   * A subclass answers for its own rows and hands the rest back here, which is what puts
   * one wording on the shared fields across the library.
   */
  protected label(schema: HaFormSchema): string {
    return schema.name === SCALE_FIELD ? SCALE_LABEL : schema.name
  }

  /** The grey line under one row, if it has anything to add. Same arrangement as `label`. */
  protected helper(schema: HaFormSchema): string | undefined {
    return schema.name === SCALE_FIELD ? SCALE_HELPER : undefined
  }

  /**
   * What the form should show for a field the config does not carry.
   *
   * A card that treats a missing `size` as medium should show medium in the editor
   * rather than an empty control: an unset radio group reads as broken, not as a
   * default. The first edit then writes the value through into the config, which is
   * what Home Assistant's own card editors do with theirs.
   *
   * The shared fields' defaults are added by `render` rather than here, so that a subclass
   * overriding this cannot drop them by forgetting to spread `super.defaults()`.
   */
  protected defaults(): Partial<C> {
    return {}
  }

  /**
   * The config as `ha-form` should see it, and its answer folded back into the config.
   *
   * Both are the identity for a card whose config is exactly what its rows say, which is
   * most of them: `toForm` hands the config straight over, `fromForm` writes the named
   * fields back with `applyFormData`. The pair exists for the one shape that cannot round
   * trip: a list whose rows carry more than the selector can express.
   *
   * No card in the library needs either at the moment: the one shape that could not round
   * trip was the battery card's `entities`, whose rows carry `{ entity, charging_entity,
   * name, icon }` objects that `ha-entities-picker` can only report as a list of ids, and
   * that list is no longer a form row at all. It is a control of its own, drawn by
   * `beforeForm` below, which is the same answer Home Assistant reaches for its entities
   * card. The pair stays because it is the cheaper answer whenever a list's rows are only
   * *slightly* more than a selector can say, and because deleting it would leave the next
   * card that finds out to rediscover why.
   */
  protected toForm(config: C): Record<string, unknown> {
    return config
  }

  protected fromForm(config: C, data: Record<string, unknown>, fields: readonly string[]): C {
    return applyFormData(config, data, fields)
  }

  /**
   * Bound once, the way Home Assistant's own card editors bind theirs.
   *
   * Not an optimisation, and it would be wrong to describe it as one: `ha-form` compares
   * every property by identity, and the `.data` beside these is a fresh object on every
   * render, so `ha-form` updates each time this editor does either way. The reason is
   * plainer: a stable callback is one less thing changing under a component that is
   * diffing its inputs, and it is what the reference implementations do.
   */
  private readonly _computeLabel = (schema: HaFormSchema): string => this.label(schema)

  private readonly _computeHelper = (schema: HaFormSchema): string | undefined =>
    this.helper(schema)

  /**
   * Tell Home Assistant the config changed.
   *
   * Protected rather than private because the form is not the only thing that can change a
   * config: a card whose subject is a list draws a control of its own above the form (see
   * `beforeForm`) and reports through here, so that both routes carry the same event with
   * the same flags.
   */
  protected emitConfig(config: C): void {
    this.dispatchEvent(
      new CustomEvent('config-changed', {
        detail: { config },
        // Not strictly needed: the host listens on this very element, so its handler
        // runs at the target whatever these say. They match what Home Assistant's own
        // `fireEvent` puts on this event, which is the point: an editor nested inside
        // another one, or a host that ever listens further up, keeps working.
        bubbles: true,
        composed: true,
      }),
    )
  }

  private readonly _valueChanged = (
    event: CustomEvent<{ value: Record<string, unknown> }>,
  ): void => {
    // It has been folded into the `config-changed` below; nothing above us wants to see
    // the raw form value as well.
    event.stopPropagation()
    if (!this._config) return

    this.emitConfig(this.fromForm(this._config, event.detail.value, fieldNames(this.schema())))
  }

  /**
   * A control of the card's own, drawn above the form.
   *
   * For the one question an `ha-form` row cannot answer: a list whose rows are each a small
   * config of their own, which wants adding, reordering and deleting as well as editing.
   * Home Assistant's own entities card hand-rolls exactly this and so does the battery card,
   * and both put it *above* the shared rows for the reason `schema()` gives: the card's
   * subject is why somebody opened the dialog, and how big to draw it comes after.
   *
   * Anything drawn here reports with `emitConfig`; nothing about it goes through
   * `formData`/`applyFormData`, which are the form's business alone.
   */
  protected beforeForm(): TemplateResult | typeof nothing {
    return nothing
  }

  protected override render(): TemplateResult | typeof nothing {
    if (!this.hass || !this._config) return nothing

    // 100% shown rather than a slider parked at its left-hand end, which is what a card
    // with no `scale` would otherwise look like: the one reading a slider cannot express
    // is "unset".
    const defaults = { [SCALE_FIELD]: DEFAULT_SCALE, ...this.defaults() }

    return html`
      ${this.beforeForm()}
      <ha-form
        .hass=${this.hass}
        .data=${formData(this.toForm(this._config), defaults, this.schema())}
        .schema=${this.schema()}
        .computeLabel=${this._computeLabel}
        .computeHelper=${this._computeHelper}
        @value-changed=${this._valueChanged}
      ></ha-form>
    `
  }
}
