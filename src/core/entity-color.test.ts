import { describe, expect, it } from 'vitest'

import {
  CW_OPTIONS_DOMAIN,
  colorUpdateMessage,
  entityColor,
  registryColor,
  type RegistryEntry,
} from './entity-color'

/** A `get_entries` reply for one entity, written the way the wire carries it. */
const entry = (options: NonNullable<RegistryEntry['options']>): RegistryEntry => ({ options })

describe('registryColor', () => {
  /** A token, not a literal, so a user's theme keeps its say over the shade. */
  it('maps a Home Assistant colour token to its theme variable', () => {
    expect(registryColor('red')).toBe('var(--red-color)')
    expect(registryColor('deep-purple')).toBe('var(--deep-purple-color)')
  })

  /** What `google` seeds through `cv.color_hex`. */
  it('takes a hex as written', () => {
    expect(registryColor('#4269d0')).toBe('#4269d0')
    expect(registryColor('#ABC')).toBe('#ABC')
  })

  /**
   * The frontend maps these three but its own validator rejects them, so a calendar
   * carrying one falls through to the palette in Home Assistant too.
   */
  it('rejects the text tokens the colour picker cannot produce', () => {
    expect(registryColor('disabled')).toBeUndefined()
    expect(registryColor('primary-text')).toBeUndefined()
  })

  /** The picker's own "No color" row. Storing it is what the editor avoids. */
  it('rejects the none the colour picker reports for an empty field', () => {
    expect(registryColor('none')).toBeUndefined()
  })

  it('rejects anything it cannot be sure is a colour', () => {
    expect(registryColor(undefined)).toBeUndefined()
    expect(registryColor('')).toBeUndefined()
    expect(registryColor(0x4269d0)).toBeUndefined()
    expect(registryColor('nonsense')).toBeUndefined()
    expect(registryColor('#12345')).toBeUndefined()
  })
})

describe('the colour of one entity', () => {
  it('takes the colour Home Assistant stores for the domain ahead of ours', () => {
    const both = entry({ calendar: { color: 'red' }, [CW_OPTIONS_DOMAIN]: { color: 'blue' } })
    expect(entityColor('calendar.work', both)).toBe('var(--red-color)')
  })

  it('takes ours where the domain has no colour of its own', () => {
    const ours = entry({ [CW_OPTIONS_DOMAIN]: { color: 'purple' } })
    expect(entityColor('todo.groceries', ours)).toBe('var(--purple-color)')
  })

  /**
   * The whole of the migration plan, and the reason the order is what it is: the day core
   * grows an `options.todo.color`, a list carrying both is drawn in Home Assistant's
   * answer, and nothing here has to know it happened.
   */
  it('hands over to a native to-do colour the day one exists', () => {
    const both = entry({ todo: { color: 'green' }, [CW_OPTIONS_DOMAIN]: { color: 'blue' } })
    expect(entityColor('todo.groceries', both)).toBe('var(--green-color)')
  })

  it('falls through a domain colour it cannot draw to ours', () => {
    const odd = entry({ todo: { color: 'nonsense' }, [CW_OPTIONS_DOMAIN]: { color: 'pink' } })
    expect(entityColor('todo.groceries', odd)).toBe('var(--pink-color)')
  })

  /** `null` is what the command answers for a YAML entity: no registry entry at all. */
  it('answers nothing for an entity the registry does not know', () => {
    expect(entityColor('todo.groceries', null)).toBeUndefined()
    expect(entityColor('todo.groceries', undefined)).toBeUndefined()
    expect(entityColor('todo.groceries', entry({}))).toBeUndefined()
  })

  it('survives an entity id with no domain in it', () => {
    expect(entityColor('groceries', entry({ [CW_OPTIONS_DOMAIN]: { color: 'red' } }))).toBe(
      'var(--red-color)',
    )
  })
})

describe('the command that stores a colour', () => {
  it('names our namespace and the entity it is about', () => {
    const message = colorUpdateMessage('todo.groceries', undefined, 'purple')
    expect(message.type).toBe('config/entity_registry/update')
    expect(message.entity_id).toBe('todo.groceries')
    expect(message.options_domain).toBe(CW_OPTIONS_DOMAIN)
    expect(message.options).toEqual({ color: 'purple' })
  })

  /**
   * `async_update_entity_options` replaces the namespace outright, so anything in it that
   * this write is not about has to be carried back over.
   */
  it('carries the rest of the namespace over a colour change', () => {
    const message = colorUpdateMessage('todo.groceries', { color: 'red', kept: 1 }, 'blue')
    expect(message.options).toEqual({ kept: 1, color: 'blue' })
  })

  /** `null` is core's "remove this namespace", and an empty husk is what it avoids. */
  it('removes the namespace when the colour is the only thing in it', () => {
    const message = colorUpdateMessage('todo.groceries', { color: 'red' }, undefined)
    expect(message.options).toBeNull()
  })

  it('keeps the namespace when clearing the colour leaves something behind', () => {
    const message = colorUpdateMessage('todo.groceries', { color: 'red', kept: 1 }, undefined)
    expect(message.options).toEqual({ kept: 1 })
  })
})
