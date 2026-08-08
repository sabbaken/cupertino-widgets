/**
 * What the showcase knows about the widgets it shows.
 *
 * One entry per card in the library, and the sidebar is that list. A card that is not
 * in here does not exist as far as the site is concerned, so adding a widget means
 * adding an entry: the shell, the routing, the controls table and the YAML pane all
 * read from this and need no further help.
 *
 * The split that matters is between `toConfig` and `toFixture`. `toConfig` is the
 * config a real dashboard would hold, which is why the Config tab can print it
 * verbatim and tell the visitor to paste it. `toFixture` is the preview-only keys that
 * make the page show something on a machine with no Home Assistant behind it, and it is
 * applied last precisely because it must never end up in that YAML.
 */

import { mdiBatteryHigh, mdiCalendarMonth, mdiFormatListChecks } from '@mdi/js'

import { DEMO_SCENARIOS, DEFAULT_DEMO_SCENARIO } from '../../src/cards/calendar/demo-data'
import { BATTERY_CARD_TAG, CALENDAR_CARD_TAG, REMINDERS_CARD_TAG } from '../../src/index'
import { DEFAULT_DEVICE_SET, DEVICE_SETS, deviceSet } from '../battery-devices'
import { DEFAULT_REMINDER_LIST, REMINDER_LISTS, reminderList } from '../reminders-lists'
import {
  DEFAULT_SCALE,
  MAX_SCALE,
  MIN_SCALE,
  SCALE_FIELD,
  SCALE_LABEL,
  SCALE_STEP,
} from '../../src/core/scale'
import type { LovelaceCardConfig } from '../../src/core/types/ha'

// ---- Control values ----------------------------------------------------------

export type ArgValue = string | readonly string[] | number
export type Args = Readonly<Record<string, ArgValue>>

/**
 * Which half of the controls panel a knob belongs in: the card's own options, or the
 * Home Assistant the page is standing in for. That is the only question a visitor has:
 * which of these survive installation.
 */
export type ControlGroup = 'card' | 'preview'

interface ControlBase {
  name: string
  /** First column of the controls table. */
  label: string
  /**
   * Second column: one line, in the interface's voice, about what the control does.
   *
   * Optional, for the control whose label already says it, because a line that only repeats
   * the label is noise in a table read top to bottom.
   */
  description?: string
  group: ControlGroup
  /**
   * Why this control is currently inert, if it is.
   *
   * A control that visibly does nothing is worse than one that says why; picking
   * calendars while the preview is drawing a fixture changes nothing, and a visitor
   * who does not know that concludes the picker is broken.
   */
  inert?(args: Args): string | undefined
}

export interface SelectControl extends ControlBase {
  kind: 'select'
  options: readonly { value: string; label: string }[]
  initial: string
}

export interface RangeControl extends ControlBase {
  kind: 'range'
  min: number
  max: number
  step: number
  unit: string
  initial: number
}

export type Control = SelectControl | RangeControl

export const readString = (args: Args, name: string, fallback: string): string => {
  const value = args[name]
  return typeof value === 'string' ? value : fallback
}

export const readNumber = (args: Args, name: string, fallback: number): number => {
  const value = args[name]
  return typeof value === 'number' ? value : fallback
}

export const readList = (args: Args, name: string): readonly string[] => {
  const value = args[name]
  return Array.isArray(value) ? (value as readonly string[]) : []
}

// ---- Widgets -----------------------------------------------------------------

export interface Widget {
  /** Route segment, and the key everything else is filed under. */
  id: string
  name: string
  /** One line under the name, at the top of the canvas. */
  tagline: string
  /** An MDI path, for the sidebar. The same icon set Home Assistant draws itself with. */
  icon: string
  /** The custom element the cards are made of. */
  tag: string
  /** The card's own options, as rows of the Controls table. `CARD_OPTIONS` joins them. */
  props: readonly Control[]
  /**
   * This widget's half of the config a real dashboard would hold; `widgetConfig` adds the
   * half every card shares. Goes into the Config tab as it comes.
   */
  toConfig(args: Args): Partial<LovelaceCardConfig>
  /**
   * Preview-only keys, spread last so a panel that pins its own config down still
   * draws whatever data the inspector is pointing at. Empty when the preview is live.
   */
  toFixture(args: Args): Partial<LovelaceCardConfig>
}

/**
 * The one Data option that is not a fixture.
 *
 * Every other option sets `demo_scenario`, which hands the card a ready-made
 * `CalendarItem[]` and exercises the layout rules. This one leaves the key off, which is
 * what a real dashboard looks like, so the card resolves `entities` and `todo_entities`,
 * opens both subscriptions over `mock-hass`'s websocket, and runs both wire mappers on the
 * way in. The only option that would have caught the card drawing fixtures in Home
 * Assistant, and the only one where an undated to-do can be seen not being drawn.
 */
export const LIVE_DATA = 'live'

/**
 * Readable names for the fixtures.
 *
 * `demo-data.ts` names its scenarios for the branch each one exercises, which is right
 * for a test fixture and reads like a bug tracker in a dropdown. A scenario with no
 * entry here still appears (its key is title-cased), so this can never be the reason a
 * new fixture is invisible.
 */
const SCENARIO_LABELS: Record<string, string> = {
  default: 'A normal day',
  'today-empty': 'Nothing on today',
  'today-done': 'Today is over',
  'one-event': 'A single event',
  'two-events': 'Two events',
  'three-events': 'Three events',
  'more-events': 'More than fits',
  reminders: 'Reminders and events',
  'all-day': 'An all-day event',
  'all-day-busy': 'All-day, on a busy day',
  'skip-empty-day': 'Tomorrow is empty',
  empty: 'Nothing at all',
}

const titleCase = (key: string): string =>
  key.replace(/-/g, ' ').replace(/^./, first => first.toUpperCase())

const DATA_OPTIONS = [
  { value: LIVE_DATA, label: 'Live: from Home Assistant' },
  ...DEMO_SCENARIOS.map(key => ({ value: key, label: SCENARIO_LABELS[key] ?? titleCase(key) })),
]

const calendar: Widget = {
  id: 'calendar',
  name: 'Calendar',
  tagline: 'Today at a glance, and what is coming after it.',
  icon: mdiCalendarMonth,
  tag: CALENDAR_CARD_TAG,

  props: [
    {
      kind: 'select',
      name: 'data',
      label: 'Calendars',
      description: 'Chose mock calendars',
      group: 'preview',
      options: DATA_OPTIONS,
      initial: DEFAULT_DEMO_SCENARIO,
    },
  ],

  /**
   * Which calendars the card follows is not a control on this page: the card's own editor
   * asks for it, and the Advanced section runs that editor. Two pickers for one key is a
   * question a visitor should not have to answer twice.
   */
  toConfig(args) {
    const entities = readList(args, 'entities')
    return entities.length > 0 ? { entities: [...entities] } : {}
  },

  toFixture(args) {
    const data = readString(args, 'data', LIVE_DATA)
    // The key is omitted entirely rather than set to `undefined`: the card distinguishes
    // "no key" from "a key naming nothing", and so does Home Assistant.
    return data === LIVE_DATA ? {} : { demo_scenario: data }
  },
}

/**
 * Readable names for the device sets, and each one names the layout it lands on rather than
 * the devices in it, which is what a visitor is choosing between.
 */
const DEVICE_LABELS: Record<string, string> = {
  none: 'Nothing configured',
  one: 'One device',
  two: 'Two (with percentages)',
  three: 'Three',
  four: 'Four: one on a charger',
  awkward: 'Four (one not reporting)',
  overflow: 'Six: more than these sizes draw',
}

const battery: Widget = {
  id: 'battery',
  name: 'Batteries',
  tagline: 'What is left in everything you have to charge.',
  icon: mdiBatteryHigh,
  tag: BATTERY_CARD_TAG,

  props: [
    {
      kind: 'select',
      name: 'devices',
      label: 'Devices',
      description: 'Mock devices, in the order the rings follow them.',
      group: 'card',
      options: Object.keys(DEVICE_SETS).map(value => ({
        value,
        label: DEVICE_LABELS[value] ?? titleCase(value),
      })),
      initial: DEFAULT_DEVICE_SET,
    },
  ],

  /**
   * In the **Card** group and printed in the Config pane, unlike the calendar's Data knob,
   * because there is nothing preview-only about it. This card has no fixtures: it reads
   * `hass.states` like it would on a dashboard, and the only thing the harness supplies is
   * which entities to point it at. So the YAML above the control is the config that produced
   * what is on screen, per-device overrides and all. The entity ids are the mock
   * installation's, which is the one thing a visitor has to substitute.
   */
  toConfig(args) {
    const rows = deviceSet(readString(args, 'devices', DEFAULT_DEVICE_SET))
    return rows.length > 0 ? { entities: [...rows] } : {}
  },

  toFixture() {
    return {}
  },
}

/**
 * Readable names for the lists, and each one names what the card does with it rather than
 * what is on it: which of them a visitor wants is a question about the card.
 */
const LIST_LABELS: Record<string, string> = {
  home: 'A full list',
  errands: 'Three items',
  packing: 'Nothing left to do',
  shared: 'Read-only: no ticks',
  none: 'Nothing configured',
}

const reminders: Widget = {
  id: 'reminders',
  name: 'Reminders',
  tagline: 'One to-do list, and how much of it is still ahead of you.',
  icon: mdiFormatListChecks,
  tag: REMINDERS_CARD_TAG,

  props: [
    {
      kind: 'select',
      name: 'list',
      label: 'List',
      description: 'Mock to-do lists, one per thing the card does with one.',
      group: 'card',
      options: Object.keys(REMINDER_LISTS).map(value => ({
        value,
        label: LIST_LABELS[value] ?? titleCase(value),
      })),
      initial: DEFAULT_REMINDER_LIST,
    },
  ],

  /**
   * In the **Card** group and printed verbatim, like the battery card's devices and for the
   * same reason: this card has no fixtures either. It reads `hass.states` and one
   * `todo/item/subscribe` subscription exactly as it would on a dashboard, and all the
   * harness supplies is which list to point it at, so the YAML above the control is the
   * config that produced what is on screen. The entity id is the mock installation's, which
   * is the one thing a visitor has to substitute.
   *
   * Ticking a row off in the preview really does call `todo.update_item` against that mock
   * list, and `mock-hass.ts` pushes the list back the way Home Assistant does. It is the one
   * control on this page whose effect outlives the render it caused.
   */
  toConfig(args) {
    const entityId = reminderList(readString(args, 'list', DEFAULT_REMINDER_LIST))
    // Omitted rather than written empty: a card with no list is a card that has not been
    // told, and `entity: ''` is not a config anybody would paste.
    return entityId ? { entity: entityId } : {}
  },

  toFixture() {
    return {}
  },
}

export const WIDGETS: readonly Widget[] = [calendar, battery, reminders]

export const widgetById = (id: string): Widget | undefined => WIDGETS.find(w => w.id === id)

/**
 * The rest of the library, as the README's table has it.
 *
 * Listed but not linked; a route to a page saying "not built yet" is a worse answer
 * than a greyed row that already says it. They are here because the first question a
 * visitor asks a small library is whether there will be more.
 *
 * Empty now that the reminders card is the To-do lists row that used to be in it. Kept
 * rather than deleted along with the entry: the sidebar renders an empty list as nothing at
 * all, so this costs a visitor no pixels, and the next planned widget is one line here
 * instead of a template to write again.
 */
export const PLANNED: readonly { name: string; icon: string }[] = []

// ---- Options every card has --------------------------------------------------

/**
 * The knobs that belong to `CupertinoCardConfig` rather than to one widget's config.
 *
 * In the **Card** group with a widget's own props, and rightly: unlike the Demo knobs
 * these do survive installation, and the Config pane above prints them. Kept as a separate
 * list only because the card that has none of its own still has these.
 */
export const CARD_OPTIONS: readonly Control[] = [
  {
    kind: 'range',
    name: SCALE_FIELD,
    label: SCALE_LABEL,
    description: 'Type, rows and spacing together. 100% is the design size.',
    group: 'card',
    min: MIN_SCALE,
    max: MAX_SCALE,
    step: SCALE_STEP,
    unit: '%',
    initial: DEFAULT_SCALE,
  },
]

/**
 * What `CARD_OPTIONS` came to, as config (every key, always, including one sitting at its
 * default).
 *
 * It dropped the defaults at first, on the grounds that a `scale: 100` says exactly what
 * its absence says and the pane is a thing to paste. What that overlooked is where the pane
 * is: directly above the controls. A key appearing and disappearing changes the height of
 * the YAML, which moves every control below it, so dragging the Scale slider off 100
 * pushed the slider itself down a line, out from under the cursor, and back up again on the
 * way home. Tidy output is not worth a control that flinches when you use it.
 *
 * So the rule for this panel is that the set of keys it writes never changes: whatever it
 * prints, it prints at every setting. Which is honest about the config anyway; Home
 * Assistant's own editor writes `scale` into the YAML the moment anything in the form is
 * touched, default or not.
 */
export const cardOptions = (args: Args): Partial<LovelaceCardConfig> => ({
  [SCALE_FIELD]: readNumber(args, SCALE_FIELD, DEFAULT_SCALE),
})

/** One widget's whole config: its own options, then the ones every card has. */
export const widgetConfig = (widget: Widget, args: Args): Partial<LovelaceCardConfig> => ({
  ...widget.toConfig(args),
  ...cardOptions(args),
})

// ---- The dashboard the widgets are shown in ----------------------------------

export const CONTROL_GROUPS: readonly { id: ControlGroup; name: string }[] = [
  { id: 'card', name: 'Card' },
  { id: 'preview', name: 'Demo' },
]

/**
 * Knobs that belong to the fake dashboard rather than to any one card, so they are the
 * same list whichever widget is on screen.
 *
 * The theme is deliberately not among them. It is the one setting that changes the whole
 * page, so it lives in the header where it can be seen from anywhere rather than a
 * scroll-length down in a panel about the card.
 */
export const CLOCK = 'clock'
export const SECTION_WIDTH = 'sectionWidth'

export const ENVIRONMENT: readonly Control[] = [
  {
    kind: 'select',
    name: CLOCK,
    label: 'Clock',
    group: 'preview',
    /**
     * The three Home Assistant's own profile offers that anybody reasons about. Its fourth,
     * `language`, follows the Home Assistant language rather than the browser and differs
     * from `system` only for a user whose two settings disagree, a distinction with no
     * place on a page about widgets.
     */
    options: [
      { value: 'system', label: 'System' },
      { value: '12', label: '12-hour' },
      { value: '24', label: '24-hour' },
    ],
    /**
     * The browser's own convention, which is very likely the one the visitor reads times
     * in, so the cards arrive already speaking their clock. The other three are here to
     * be switched to; this one is here to be right without being touched.
     */
    initial: 'system',
  },
  {
    kind: 'range',
    name: SECTION_WIDTH,
    label: 'Section width',
    group: 'preview',
    min: 260,
    max: 760,
    step: 10,
    unit: 'px',
    initial: 500,
  },
]

// ---- YAML --------------------------------------------------------------------

const yamlScalar = (value: unknown): string => {
  const text = String(value)
  // Quote only what would otherwise change meaning. A dashboard config is read by
  // people as often as by machines, and `type: custom:…` unquoted is what every
  // Home Assistant doc shows.
  return /^[\w.:/-]+$/.test(text) ? text : JSON.stringify(text)
}

/**
 * One item of a list: a scalar, or a mapping whose first key rides on the dash.
 *
 * The mapping form is here for the battery card's `entities`, whose rows carry a
 * `charging_entity` when the device's own state cannot say, so a config the visitor is
 * invited to paste has to be able to print one. Two spaces of indent and the dash, exactly
 * as every Home Assistant document writes it.
 */
const yamlItem = (item: unknown): string => {
  if (typeof item !== 'object' || item === null || Array.isArray(item)) {
    return `  - ${yamlScalar(item)}`
  }
  return Object.entries(item)
    .map(([key, value], index) => `  ${index === 0 ? '-' : ' '} ${key}: ${yamlScalar(value)}`)
    .join('\n')
}

/** Just enough YAML for a card config: scalars, and lists of scalars or flat mappings. */
export const configToYaml = (config: LovelaceCardConfig): string =>
  Object.entries(config)
    .map(([key, value]) =>
      Array.isArray(value)
        ? [`${key}:`, ...value.map(item => yamlItem(item))].join('\n')
        : `${key}: ${yamlScalar(value)}`,
    )
    .join('\n')

/**
 * The config a visitor can paste, which is `toConfig` and nothing else.
 *
 * `custom:` is load-bearing: it is how Lovelace resolves a card that is not one of its
 * own, and a config without it fails to render with a message about an unknown card.
 */
export const widgetYaml = (widget: Widget, args: Args): string =>
  configToYaml({ type: `custom:${widget.tag}`, ...widgetConfig(widget, args) })
