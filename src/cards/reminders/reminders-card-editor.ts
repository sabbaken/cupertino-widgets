import type { PropertyValues } from 'lit'
import { state } from 'lit/decorators.js'

import { CupertinoCardEditor, applyFormData } from '../../core/card-editor'
import { colorUpdateMessage, fetchColorOptions, type ColorOptions } from '../../core/entity-color'
import { defineElement } from '../../core/register'
import type { HaFormSchema } from '../../core/types/ha'
import type { RemindersCardConfig } from './reminders-card'

export const REMINDERS_EDITOR_TAG = 'cupertino-widgets-reminders-editor'

/**
 * The one question this card has, and it is a single picker rather than a list.
 *
 * `filter` is the current spelling of the domain restriction. A bare `domain` still works,
 * but only because `ha-selector` migrates it on the way in, and it drops a
 * `supported_features` sitting beside it while it does, silently.
 *
 * Deliberately NOT filtered on `supported_features`. The flag the card cares about is
 * `UPDATE_TODO_ITEM`, and a list without it is still a list worth drawing: it just draws
 * without ticks. Filtering here would hide a read-only list from the picker altogether,
 * which is a bigger answer than the question deserves.
 *
 * `required` is presentational: `ha-form` marks the field and does not enforce it, which is
 * the right amount of pressure. A card with no list draws its placeholder rather than
 * throwing, so an unfinished config is a state the user can be in on the way to a finished
 * one.
 */
const LIST_ROW: HaFormSchema = {
  name: 'entity',
  selector: { entity: { filter: { domain: 'todo' } } },
  required: true,
}

const COLOR_FIELD = 'color'

/**
 * The colour, drawn with Home Assistant's own picker.
 *
 * `include_none` is what makes the choice reversible: without it the picker offers 25
 * swatches and no way back to an uncoloured list. `default_color` puts **(default)** on the
 * purple swatch, so the empty field says what it will draw instead of leaving the user to
 * find out.
 */
const COLOR_ROW: HaFormSchema = {
  name: COLOR_FIELD,
  selector: { ui_color: { include_none: true, default_color: 'purple' } },
}

/** What `ha-color-picker` reports for its **No color** row. Not a colour, and not stored. */
const NONE = 'none'

const storedColor = (options: ColorOptions | undefined): string | undefined =>
  typeof options?.color === 'string' && options.color !== '' ? options.color : undefined

const chosenColor = (value: unknown): string | undefined =>
  typeof value === 'string' && value !== '' && value !== NONE ? value : undefined

/**
 * The reminders card's visual editor: which list, what colour, then the shared **Scale**.
 *
 * Everything else about how the card is drawn it works out from the box the Layout tab put
 * it in and that one factor; see `docs/reminders-widget-rules.md`. There is in particular no
 * size row and no row limit: the three shapes are consequences of the footprint, and how
 * many items fit is the height's answer rather than a number to be typed.
 *
 * The colour row is the one thing in this library that edits something outside the card's
 * own config. It has to: a colour belongs to the LIST, so that two cards over one list
 * agree and so that the calendar card's reminder rows agree with both, and the card config
 * is the wrong place to keep something two cards share. `core/entity-color.ts` carries
 * where it goes instead and why that is a supported place to put it; what this class owes
 * the arrangement is the round trip, which is `toForm` reading the stored value into the
 * row and `fromForm` keeping it out of the config on the way back.
 */
class CupertinoRemindersCardEditor extends CupertinoCardEditor<RemindersCardConfig> {
  /**
   * Our namespace on the chosen list, as the registry currently holds it.
   *
   * The whole namespace rather than the colour alone, because a write replaces it: see
   * `colorUpdateMessage`. A `@state()` because the row is drawn from it.
   */
  @state() private _options: ColorOptions | undefined = undefined

  /** The list `_options` is about, so an unchanged edit does not fetch. */
  private _loadedFor: string | undefined = undefined

  /** Identity for the fetch in flight, so an answer about the previous list is dropped. */
  private _token: object | undefined = undefined

  public override setConfig(config: RemindersCardConfig): void {
    super.setConfig(config)
    void this._loadColor()
  }

  /**
   * The other half of the load.
   *
   * The host sets `hass` before the first `setConfig` and replaces it on every state change
   * afterwards, so this is here for the one ordering that is not promised anywhere:
   * `setConfig` arriving first, with nothing to fetch with. `_loadColor` answers
   * immediately once the list it holds is the one in the config, which is what keeps this
   * from costing anything on the other several hundred calls.
   */
  protected override willUpdate(changed: PropertyValues): void {
    super.willUpdate(changed)
    if (changed.has('hass')) void this._loadColor()
  }

  /**
   * The colour row appears once there is a list to put a colour on.
   *
   * A picker that silently writes nowhere is worse than one that is not there yet, and the
   * card is in the same state beside it: no list means the placeholder rather than a widget
   * with a blank name.
   */
  protected override fields(): readonly HaFormSchema[] {
    return this._config?.entity ? [LIST_ROW, COLOR_ROW] : [LIST_ROW]
  }

  /** The stored colour, shown in a row the config knows nothing about. */
  protected override toForm(config: RemindersCardConfig): Record<string, unknown> {
    return { ...config, [COLOR_FIELD]: storedColor(this._options) ?? '' }
  }

  /**
   * Fold the form's answer back, sending the colour to the registry rather than the config.
   *
   * `fromForm` is synchronous and the write is not, which is why `_store` moves `_options`
   * before the socket does: the row is drawn from that field, so a picker left waiting for
   * a round trip would flick back to the old swatch under the user's finger.
   *
   * The diff is against the stored value rather than against the config, because that is
   * what the row was showing. Without it every edit to any other row would re-send the
   * colour.
   */
  protected override fromForm(
    config: RemindersCardConfig,
    data: Record<string, unknown>,
    fields: readonly string[],
  ): RemindersCardConfig {
    const chosen = chosenColor(data[COLOR_FIELD])
    if (chosen !== storedColor(this._options)) void this._store(chosen)

    return applyFormData(
      config,
      data,
      fields.filter(name => name !== COLOR_FIELD),
    )
  }

  /** The default branch hands the shared rows back to the base: see `CupertinoCardEditor`. */
  protected override label(schema: HaFormSchema): string {
    switch (schema.name) {
      case 'entity':
        return 'List'
      case COLOR_FIELD:
        return 'Colour'
      default:
        return super.label(schema)
    }
  }

  protected override helper(schema: HaFormSchema): string | undefined {
    switch (schema.name) {
      case 'entity':
        // Says the thing the picker cannot: that the card is a portrait of one list, and
        // that wanting two is not a limitation to work around but a second card.
        return 'The to-do list this widget draws. Add another card for another list.'
      case COLOR_FIELD:
        // The surprising half, and the half worth spending a line on: this row does not
        // edit the card. Somebody who moves the widget, or adds a second one, should not be
        // surprised that the colour came along.
        return 'Kept on the list itself, so every widget showing it agrees.'
      default:
        return super.helper(schema)
    }
  }

  private async _loadColor(): Promise<void> {
    const entityId = this._config?.entity
    if (!this.hass || !entityId) {
      this._loadedFor = undefined
      this._options = undefined
      return
    }
    if (entityId === this._loadedFor) return

    const token = {}
    this._token = token
    this._loadedFor = entityId
    this._options = undefined

    try {
      const options = await fetchColorOptions(this.hass, entityId)
      if (this._token !== token) return
      this._options = options
    } catch (error) {
      if (this._token !== token) return
      // The row draws empty, and a colour picked into it overwrites whatever could not be
      // read. That is the one place this is lossy, and it takes a registry that answers a
      // read with an error while accepting a write.
      console.debug('[cupertino-widgets] cannot read the stored colour', error)
    }
  }

  private async _store(color: string | undefined): Promise<void> {
    const entityId = this._config?.entity
    if (!this.hass || !entityId) return

    const previous = this._options
    this._options = { ...previous, color }

    try {
      await this.hass.callWS(colorUpdateMessage(entityId, previous, color))
    } catch (error) {
      // Put the row back to what the registry still holds. The likeliest cause by far is a
      // list that has been deleted since the dialog opened: writing needs admin, and so
      // does saving a dashboard, so a user who got this far has the rights for it.
      this._options = previous
      console.warn(`[cupertino-widgets] cannot store the colour of ${entityId}`, error)
    }
  }
}

defineElement(REMINDERS_EDITOR_TAG, CupertinoRemindersCardEditor)

export { CupertinoRemindersCardEditor }
