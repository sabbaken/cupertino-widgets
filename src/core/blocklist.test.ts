/**
 * The copyable title filter's rules, including the blank entry that would otherwise match
 * every title. The card-specific tests cover the counts and empty states it feeds.
 */

import { describe, expect, it } from 'vitest'

import { blocklistTerms, filterBlocked } from './blocklist'

const titled = (...titles: string[]): { title: string }[] => titles.map(title => ({ title }))

describe('the block list', () => {
  it('trims entries and ignores empty entries between commas', () => {
    expect(blocklistTerms(' Lunch, , School run, ')).toEqual(['lunch', 'school run'])
  })

  it('matches any phrase anywhere in a title without case sensitivity', () => {
    const items = titled('Team LUNCH tomorrow', 'Morning school run', 'Lunchbox', 'Walk')
    expect(filterBlocked(items, ' lunch, SCHOOL RUN, ')).toEqual(titled('Walk'))
  })

  it('matches non-Latin titles and accented letters', () => {
    const items = titled('Купить МОЛОКО', 'Trip to POZNAŃ', 'Walk')
    expect(filterBlocked(items, 'молоко, poznań')).toEqual(titled('Walk'))
  })

  it('reads punctuation as literal text', () => {
    const items = titled('Call [work]', 'Budget .*', 'Call work', 'Budget review')
    expect(filterBlocked(items, '[work], .*')).toEqual(titled('Call work', 'Budget review'))
  })

  it('keeps every row for an absent, empty or malformed filter', () => {
    const items = titled('Lunch', 'Walk')
    for (const value of [undefined, null, '', ' , , ', 42, ['Lunch'], {}]) {
      expect(filterBlocked(items, value)).toEqual(items)
    }
  })

  it('keeps the source and other cards independent of a filtered card', () => {
    const items = Object.freeze(titled('Lunch', 'Walk', 'Call'))
    expect(filterBlocked(items, 'lunch')).toEqual(titled('Walk', 'Call'))
    expect(filterBlocked(items, 'walk')).toEqual(titled('Lunch', 'Call'))
    expect(filterBlocked(items, undefined)).toEqual(titled('Lunch', 'Walk', 'Call'))
  })
})
