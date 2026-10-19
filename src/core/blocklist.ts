/**
 * A card's own title filter, shared by the calendar and reminders cards.
 *
 * One comma-separated string keeps the editor copyable without a second representation
 * in YAML. Each entry is literal text found anywhere in a title, ignoring case; regular
 * expressions would turn ordinary punctuation into rules a user did not ask for. Filtering
 * before the flow or count means a hidden row costs neither space nor an empty-day claim.
 */

import type { HaFormSchema } from './types/ha'

export const BLOCKLIST_FIELD = 'blocklist'
export const BLOCKLIST_LABEL = 'Block list'
export const BLOCKLIST_HELPER =
  'Enter words or phrases separated by commas, e.g. lunch, school run. ' +
  'Titles containing any entry are hidden in this card only, ignoring case. ' +
  'Leave empty to show everything.'

export const BLOCKLIST_ROW: HaFormSchema = {
  name: BLOCKLIST_FIELD,
  selector: { text: { placeholder: 'lunch, school run' } },
}

/** Empty entries are ignored so a trailing comma cannot hide every title. */
export const blocklistTerms = (value: unknown): string[] =>
  typeof value === 'string'
    ? value
        .split(',')
        .map(term => term.trim().toLowerCase())
        .filter(Boolean)
    : []

export const filterBlocked = <T extends { title: string }>(
  items: readonly T[],
  value: unknown,
): readonly T[] => {
  const terms = blocklistTerms(value)
  if (terms.length === 0) return items

  return items.filter(item => {
    const title = item.title.toLowerCase()
    return !terms.some(term => title.includes(term))
  })
}
