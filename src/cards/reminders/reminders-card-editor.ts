import { CupertinoCardEditor } from '../../core/card-editor'
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

/**
 * The reminders card's visual editor: which list, then the **Scale** every card shares.
 *
 * Everything else about how the card is drawn it works out from the box the Layout tab put
 * it in and that one factor; see `docs/reminders-widget-rules.md`. There is in particular no
 * size row and no row limit: the three shapes are consequences of the footprint, and how
 * many items fit is the height's answer rather than a number to be typed.
 */
class CupertinoRemindersCardEditor extends CupertinoCardEditor<RemindersCardConfig> {
  protected override fields(): readonly HaFormSchema[] {
    return [LIST_ROW]
  }

  /** The default branch hands the shared rows back to the base: see `CupertinoCardEditor`. */
  protected override label(schema: HaFormSchema): string {
    switch (schema.name) {
      case 'entity':
        return 'List'
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
      default:
        return super.helper(schema)
    }
  }
}

defineElement(REMINDERS_EDITOR_TAG, CupertinoRemindersCardEditor)

export { CupertinoRemindersCardEditor }
