import { describe, expect, it } from 'vitest'

import { applyFormData, fieldNames, formData } from './card-editor'
import type { HaFormSchema, LovelaceCardConfig } from './types/ha'

const SCHEMA: readonly HaFormSchema[] = [
  { name: 'size', selector: { select: { mode: 'box', options: [] } } },
  { name: 'entities', selector: { entity: { multiple: true, filter: { domain: 'calendar' } } } },
  { name: 'scale', selector: { number: { min: 80, max: 130, step: 5, mode: 'slider' } } },
]

/** The same, with two of its rows folded into an Advanced section. */
const GROUPED: readonly HaFormSchema[] = [
  SCHEMA[0],
  {
    name: 'advanced',
    type: 'expandable',
    flatten: true,
    title: 'Advanced',
    schema: [SCHEMA[1], SCHEMA[2]],
  },
]

/** Typed as a card config, so `formData` infers the open shape rather than the literal. */
const config = (extra: Record<string, unknown> = {}): LovelaceCardConfig => ({
  type: 'custom:x',
  ...extra,
})

/** What the editor shows, before the user has touched anything. */
describe('formData', () => {
  it('shows a default where the config is silent, and the config where it is not', () => {
    expect(formData(config(), { size: 'medium' }, SCHEMA)).toEqual({
      type: 'custom:x',
      size: 'medium',
    })
    expect(formData(config({ size: 'small' }), { size: 'medium' }, SCHEMA)).toEqual({
      type: 'custom:x',
      size: 'small',
    })
  })

  /**
   * Hand-written YAML is not typechecked, and `ha-entities-picker` maps over whatever it
   * is given: a bare string would throw on the editor's very first render, which is the
   * one render the selector's own coercion sits out.
   */
  it('widens a scalar into a list for a multiple field', () => {
    expect(formData(config({ entities: 'calendar.work' }), {}, SCHEMA).entities).toEqual([
      'calendar.work',
    ])
  })

  it('leaves a list, an absent field and a single-value field alone', () => {
    expect(formData(config({ entities: ['a'] }), {}, SCHEMA).entities).toEqual(['a'])
    expect('entities' in formData(config(), {}, SCHEMA)).toBe(false)
    expect(formData(config({ size: 'small' }), {}, SCHEMA).size).toBe('small')
  })

  /**
   * A row whose selector is neither of the two kinds this started out knowing about.
   *
   * `scale` is a `number` selector and has no `multiple` to read, which the first version
   * of the widening loop discovered by throwing on it, so every editor in the library went
   * blank the moment a number row was added to the shared schema. Cheap to pin, and the
   * failure was total.
   */
  it('leaves a row it cannot widen alone instead of tripping over its selector', () => {
    expect(formData(config({ scale: 110 }), { scale: 100 }, SCHEMA).scale).toBe(110)
    expect(formData(config(), { scale: 100 }, SCHEMA).scale).toBe(100)
  })

  /** A bare `entities:` in the YAML. Widening that would write `[null]` straight back. */
  it('does not widen a blank into a list of one blank', () => {
    expect(formData(config({ entities: null }), {}, SCHEMA).entities).toBeNull()
    expect(formData(config({ entities: '' }), {}, SCHEMA).entities).toBe('')
  })

  /**
   * A group is a place to draw rows, not a value: it has no selector of its own, and the
   * first version of the widening loop found that out by reading `'entity' in undefined`
   * and taking every editor in the library down with it.
   */
  it('walks into a group instead of tripping over it', () => {
    expect(formData(config({ entities: 'calendar.work' }), {}, GROUPED).entities).toEqual([
      'calendar.work',
    ])
    expect('advanced' in formData(config(), {}, GROUPED)).toBe(false)
  })
})

/**
 * Which fields an editor owns, which is the list `applyFormData` writes back.
 *
 * The rows inside a `flatten` group are the editor's own, exactly as the ones beside it
 * are: a version of this that stopped at the group reported `advanced` as the field, so an
 * Advanced section drew, accepted an edit, and saved none of it.
 */
describe('fieldNames', () => {
  it('is the rows in order, groups walked into', () => {
    expect(fieldNames(SCHEMA)).toEqual(['size', 'entities', 'scale'])
    expect(fieldNames(GROUPED)).toEqual(['size', 'entities', 'scale'])
  })
})

/**
 * The one part of an editor with no pixels in it: what the form reports becomes what
 * the user's YAML says. Everything the rule exists for is a shape `ha-form` really
 * produces: an emptied entity picker sends `[]`, a cleared dropdown sends `undefined`,
 * and every untouched field comes back on every change.
 */
describe('applyFormData', () => {
  const FIELDS = ['size', 'entities', 'scale'] as const

  /**
   * A number the form reports goes in as a number.
   *
   * Worth its own case because the config is read by `scaleFactor` and by anybody looking
   * at their YAML, and a `scale: "110"` would satisfy neither: the editor is the one place
   * that can guarantee the type, since it is the only one that is not hand-written.
   */
  it('writes a number through as a number, and forgets one the user cleared', () => {
    expect(applyFormData(config(), { scale: 110 }, FIELDS)).toEqual({
      type: 'custom:x',
      scale: 110,
    })
    const scaled = config({ scale: 110 })
    expect(applyFormData(scaled, { scale: undefined }, FIELDS)).not.toHaveProperty('scale')
  })

  it('writes through the fields the form owns', () => {
    const config = { type: 'custom:x', size: 'medium' }
    const next = applyFormData(config, { size: 'small', entities: ['calendar.work'] }, FIELDS)

    expect(next).toEqual({ type: 'custom:x', size: 'small', entities: ['calendar.work'] })
  })

  it('leaves the original config alone', () => {
    const config = { type: 'custom:x', size: 'medium' }
    applyFormData(config, { size: 'small' }, FIELDS)

    expect(config).toEqual({ type: 'custom:x', size: 'medium' })
  })

  /**
   * The reason this function exists. `entities: []` and no `entities` key mean the same
   * thing to the card (every calendar), so only one of them belongs in a config the
   * user has to read.
   */
  it('drops a field the user has emptied rather than writing an empty one', () => {
    const config = { type: 'custom:x', entities: ['calendar.work'] }
    const next = applyFormData(config, { entities: [] }, FIELDS)

    expect(next).toEqual({ type: 'custom:x' })
    expect('entities' in next).toBe(false)
  })

  it('treats undefined, null and the empty string the same way', () => {
    const config = { type: 'custom:x', size: 'small', entities: ['calendar.work'] }

    expect(applyFormData(config, { size: undefined }, FIELDS)).not.toHaveProperty('size')
    expect(applyFormData(config, { size: null }, FIELDS)).not.toHaveProperty('size')
    expect(applyFormData(config, { size: '' }, FIELDS)).not.toHaveProperty('size')
  })

  /**
   * `ha-form` is handed the whole config as its data, so everything else in there comes
   * back out of it, including the keys Home Assistant owns. `visibility: []` is the one
   * that pins the rule: an empty array IS blank, so widening the loop from `fields` to
   * every key of `data` would quietly delete it.
   */
  it('carries keys the form does not own through untouched', () => {
    const config = {
      type: 'custom:x',
      size: 'medium',
      grid_options: { columns: 6 },
      visibility: [],
      demo_scenario: 'all-day',
    }
    const next = applyFormData(config, { ...config, size: 'small' }, FIELDS)

    expect(next).toEqual({ ...config, size: 'small' })
  })

  it('adds a field the config did not have', () => {
    const next = applyFormData({ type: 'custom:x' }, { entities: ['calendar.work'] }, FIELDS)

    expect(next).toEqual({ type: 'custom:x', entities: ['calendar.work'] })
  })

  it('ignores a field the form reported that the schema does not own', () => {
    const next = applyFormData({ type: 'custom:x' }, { size: 'small', rogue: 1 }, FIELDS)

    expect(next).toEqual({ type: 'custom:x', size: 'small' })
  })
})
