/**
 * The colour an entity is drawn in, and the one place the library keeps it.
 *
 * Home Assistant answers this question for calendars and for nothing else. Its entity
 * settings dialog draws a colour picker under `domain === "calendar"` and writes
 * `options.calendar.color`; a to-do list has no counterpart in core, in the frontend or in
 * the to-do panel, and nothing about one is planned (all three grepped in 2026.7.4 and in
 * the current `main`; `docs/ha-api-notes.md` carries the notes and the citations). So the
 * library keeps its own answer, in the same place and in the same format:
 *
 *     todo.groceries → options.cupertino_widgets.color = "purple"
 *
 * That is not a hack against a closed door. `options` on a registry entry is a map keyed by
 * an arbitrary namespace string: `config/entity_registry/update` passes `options_domain`
 * through without comparing it to anything (`components/config/entity_registry.py:277`) and
 * `async_update_entity_options` stores it with no whitelist
 * (`helpers/entity_registry.py:1995`). A real installation already carries `conversation`,
 * `sensor` and `sensor.private` keys side by side.
 *
 * Three decisions, each stated with what it beat:
 *
 *  - **Home Assistant's own key wins.** `entityColor` reads `options.<domain>.color` first
 *    and ours second, so a calendar keeps the colour its owner picked in the settings
 *    dialog and nothing about that card changes. The alternative, our key first, would let
 *    a widget quietly override the colour Home Assistant draws the same calendar in
 *    everywhere else. It also means that if `options.todo.color` ever ships, it takes over
 *    on its own: no migration, no code, no version check.
 *  - **A colour is not a card option.** It belongs to the list rather than to one widget
 *    drawing it, which is the whole point of storing it here: two reminders cards over the
 *    same list agree, and the calendar card's reminder rows agree with both. The audience
 *    is the same either way, so nothing is lost by having no fallback: writing the registry
 *    needs admin (`@require_admin` on the command) and so does saving a dashboard
 *    (`@require_admin` on `lovelace/config/save`), so anybody who can reach a card editor
 *    can reach the registry.
 *  - **The palette stays underneath.** A card asks this module for a colour and falls back
 *    to its own deck when the answer is `undefined`, rather than being handed a default it
 *    cannot tell from a choice.
 */

import type { HomeAssistant } from './types/ha'

// ---- Where it is kept ----------------------------------------------------------

/**
 * The namespace this library owns inside an entry's `options`.
 *
 * Spelled out rather than abbreviated to `cw`: unlike a CSS custom property this lands in
 * the user's `.storage/core.entity_registry`, next to `conversation` and `sensor`, where
 * two letters would be a puzzle for whoever opens that file in five years.
 */
export const CW_OPTIONS_DOMAIN = 'cupertino_widgets'

/**
 * What we keep in it.
 *
 * An object with one key rather than a bare colour string, for the reason
 * `colorUpdateMessage` has to deal with anyway: `async_update_entity_options` replaces the
 * whole namespace on every write, so the shape has to be one a later key can join without
 * a migration, and every write has to carry what it is not changing.
 */
export interface ColorOptions {
  color?: unknown
  /**
   * Open on purpose. A write replaces the namespace, so the type has to admit that what is
   * in there may be more than this version of the card knows about: a key added by a newer
   * one, sitting in the registry of somebody who has not updated yet.
   */
  [key: string]: unknown
}

/**
 * The slice of a `config/entity_registry/get_entries` reply the library reads.
 *
 * Only `options`, and only two levels into it. The command answers a map keyed by the
 * entity ids that were asked for, with `null` for an entity that has no registry entry at
 * all, which every YAML and `demo` entity is, since they carry no unique id.
 *
 * `hass.entities` cannot answer any of this. That is the DISPLAY registry, decoded from
 * `config/entity_registry/list_for_display`, and `options` is not one of the twelve fields
 * in it (`_as_display_dict` forwards a sensor's display precision and nothing else). The
 * full registry is where the colour lives, and Home Assistant's own calendar card fetches
 * all of it to read two levels into one key; `get_entries` asks only about the entities we
 * care about instead. It is not admin-gated, unlike the write.
 */
export interface RegistryEntry {
  options?: Record<string, ColorOptions | undefined>
}

// ---- Reading a stored value ----------------------------------------------------

/**
 * Home Assistant's named colour tokens: the 25 its colour picker can produce.
 *
 * The picker writes one of these; the `google` integration seeds a `#RRGGBB` instead,
 * through `cv.color_hex`. Between them that is every value `options.calendar.color` holds
 * in practice, and the `ui_color` selector the reminders editor draws writes from the same
 * set, so our own key never holds anything stranger either.
 */
const HA_COLOR_TOKENS = new Set([
  'primary',
  'accent',
  'red',
  'pink',
  'purple',
  'deep-purple',
  'indigo',
  'blue',
  'light-blue',
  'cyan',
  'teal',
  'green',
  'light-green',
  'lime',
  'yellow',
  'amber',
  'orange',
  'deep-orange',
  'brown',
  'light-grey',
  'grey',
  'dark-grey',
  'blue-grey',
  'black',
  'white',
])

const HEX = /^#(?:[0-9a-f]{3,4}|[0-9a-f]{6}|[0-9a-f]{8})$/i

/**
 * The colour stored against an entity, if it is one we can draw.
 *
 * Narrower than the frontend's `isValidColor` on purpose, and the difference is worth
 * stating. That one ends in `new Option().style.color = value`, asking the browser whether
 * the string is a colour at all, which needs a DOM this layer does not have and the tests
 * do not run in. So the rule here is a token or a hex, which covers everything Home
 * Assistant itself writes, and anything stranger falls through to the caller's palette. A
 * colour that came back looking wrong is a nuisance; an invalid `--item-color` would take
 * the row's tint and its title with it.
 *
 * A token becomes `var(--red-color)` rather than a literal, exactly as `computeCssColor`
 * does it, so a user's theme keeps its say over the shade. Note the three text tokens
 * (`primary-text`, `secondary-text`, `disabled`) are not in the set; the frontend maps
 * them but its validator rejects them too. `none`, which the picker reports for its own
 * "No color" row, is not in there either, and that is what makes clearing the field read
 * as "unset" rather than as a colour nobody can see.
 */
export const registryColor = (value: unknown): string | undefined => {
  if (typeof value !== 'string' || value === '') return undefined
  if (HA_COLOR_TOKENS.has(value)) return `var(--${value}-color)`
  return HEX.test(value) ? value : undefined
}

/**
 * The colour for one entity: Home Assistant's own answer, then ours.
 *
 * The domain comes off the entity id rather than being passed in, so one call answers for
 * a mixed list of calendars and to-do lists, which is exactly what the calendar card holds.
 */
export const entityColor = (
  entityId: string,
  entry: RegistryEntry | null | undefined,
): string | undefined => {
  const options = entry?.options
  if (!options) return undefined

  const dot = entityId.indexOf('.')
  const domain = dot > 0 ? entityId.slice(0, dot) : ''

  return registryColor(options[domain]?.color) ?? registryColor(options[CW_OPTIONS_DOMAIN]?.color)
}

/**
 * The colours for a set of entities, in one round trip.
 *
 * Only the entities that have one are in the answer: a caller's fallback is its own
 * business, and a map that carried a default would be one a caller could not tell a real
 * choice from.
 *
 * Failure is not fatal and is swallowed here rather than at each of the three call sites. A
 * card that refused to draw because it could not learn a shade would be worse than one
 * drawing its palette.
 */
export const fetchEntityColors = async (
  hass: HomeAssistant,
  entityIds: readonly string[],
): Promise<Map<string, string>> => {
  const colors = new Map<string, string>()
  if (!entityIds.length) return colors

  try {
    const entries = await hass.callWS<Record<string, RegistryEntry | null>>({
      type: 'config/entity_registry/get_entries',
      entity_ids: [...entityIds],
    })
    for (const entityId of entityIds) {
      const color = entityColor(entityId, entries?.[entityId])
      if (color) colors.set(entityId, color)
    }
  } catch (error) {
    console.debug('[cupertino-widgets] no colours from the entity registry', error)
  }

  return colors
}

// ---- Writing one ---------------------------------------------------------------

/**
 * Our namespace as it currently stands, for an editor about to write it.
 *
 * Deliberately unlike `fetchEntityColors` in two ways, because its caller is unlike theirs.
 * It answers the RAW stored value rather than a resolved CSS colour, because a picker's
 * value is the token the user chose rather than the variable it becomes. And it lets a
 * failure through rather than swallowing it: this is the read half of a read-modify-write,
 * and writing on top of a guess would drop whatever else the namespace holds.
 */
export const fetchColorOptions = async (
  hass: HomeAssistant,
  entityId: string,
): Promise<ColorOptions | undefined> => {
  const entries = await hass.callWS<Record<string, RegistryEntry | null>>({
    type: 'config/entity_registry/get_entries',
    entity_ids: [entityId],
  })
  return entries?.[entityId]?.options?.[CW_OPTIONS_DOMAIN]
}

/**
 * The command that stores a colour against an entity, or takes it off again.
 *
 * A builder rather than a call, so the shape can be tested without a socket. Three things
 * about it are load-bearing and none is obvious from the schema:
 *
 *  - it is read-modify-write. `async_update_entity_options` sets `options[domain]` to
 *    exactly what it is handed, so a write that carried only `color` would delete any other
 *    key in our namespace. There is none today, which is the point of fixing it now;
 *  - clearing sends `options: null`, which core reads as "remove this namespace"
 *    (`if options is not None` in the same method). The alternative, `{ color: null }`,
 *    would leave an empty husk in every user's registry for a colour they unset;
 *  - `options_domain` and `options` are `vol.Inclusive`, so they travel together or the
 *    command is rejected. That is why the `null` above goes in `options` rather than the
 *    key being left out.
 *
 * Home Assistant's own settings dialog writes one `options_domain` per save and merges
 * nothing else, so our namespace survives a user editing the entity beside us, and theirs
 * survives us.
 */
export const colorUpdateMessage = (
  entityId: string,
  previous: ColorOptions | undefined,
  color: string | undefined,
): Record<string, unknown> => {
  const rest: Record<string, unknown> = { ...previous }
  delete rest.color

  const options = color ? { ...rest, color } : Object.keys(rest).length ? rest : null

  return {
    type: 'config/entity_registry/update',
    entity_id: entityId,
    options_domain: CW_OPTIONS_DOMAIN,
    options,
  }
}

// ---- Keeping them current ------------------------------------------------------

/**
 * What `subscribe_events` delivers for `entity_registry_updated`.
 *
 * Core fires `{ action, entity_id, changes }` and orjson sends it as the `data` of an
 * ordinary event object. Typed down to the one field that decides whether this holder
 * cares, because everything else about the event is a reason to look rather than an answer:
 * an options write reports `changes: { options: … }`, but so would a write to somebody
 * else's namespace, and comparing what we already have is cheaper and truer than parsing
 * that.
 */
interface RegistryEvent {
  data?: { entity_id?: unknown }
}

const sameColors = (a: ReadonlyMap<string, string>, b: ReadonlyMap<string, string>): boolean =>
  a.size === b.size && [...a].every(([entityId, color]) => b.get(entityId) === color)

/**
 * The colours for a card's entities, kept current while the card is on screen.
 *
 * A holder rather than a function, because the answer changes under the card: the colour
 * lives on the entity, so the card that writes it is usually not one of the cards that has
 * to notice. Without the watch, a colour picked in one card's editor would reach the others
 * on the next dashboard reload, which is the version of this feature that reads as broken.
 *
 * The watch is `subscribe_events` over `entity_registry_updated`, which is exactly what
 * Home Assistant's own registry collection does (`subscribeEntityRegistryUpdates` in
 * `src/data/entity/entity_registry.ts`). It goes through `subscribeMessage` because
 * `subscribeEvents` is a thin wrapper over precisely that message, and our slice of the
 * connection type does not carry the wrapper.
 *
 * The identity discipline is `CalendarFeed`'s, and it is no less needed at one entity: the
 * unsubscribe handle resolves a turn of the event loop after the call, events keep arriving
 * for as long as the socket is open, and a card can be dragged out of the DOM or re-pointed
 * at another list inside that gap. The revision counter does the same job for the fetch.
 */
export class EntityColors {
  private readonly _onChange: (colors: ReadonlyMap<string, string>) => void
  private readonly _colors = new Map<string, string>()

  private _hass: HomeAssistant | undefined
  private _ids: readonly string[] = []

  /** What the current colours were loaded for. `undefined` until the first reconcile. */
  private _key: string | undefined

  /** Bumped per load, so an answer overtaken by a later one is discarded. */
  private _revision = 0

  private _watch: { token: object; unsubscribe?: () => Promise<void> } | undefined

  public constructor(onChange: (colors: ReadonlyMap<string, string>) => void) {
    this._onChange = onChange
  }

  public get(entityId: string): string | undefined {
    return this._colors.get(entityId)
  }

  /**
   * Point the holder at `entityIds`, doing as little as possible.
   *
   * Called from the same place a feed's reconcile is, which means on every `hass` swap:
   * the unchanged case has to cost nothing, and in particular must not fetch. What the
   * event watch is for is the case this cannot see, a colour changing while the entity list
   * stays exactly as it was.
   */
  public async reconcile(hass: HomeAssistant, entityIds: readonly string[]): Promise<void> {
    // Kept whatever else this call decides. The watch outlives the reconcile that opened
    // it, and a `hass` captured in that closure would be the one from that reconcile.
    this._hass = hass

    const key = entityIds.join(' ')
    if (key === this._key) return
    this._key = key
    this._ids = [...entityIds]

    if (!this._ids.length) {
      this._closeWatch()
      this._publish(new Map())
      return
    }

    await Promise.all([this._load(), this._openWatch()])
  }

  /**
   * Called when the card leaves the DOM; safe to call when nothing is running.
   *
   * Publishes nothing: the only caller is a card on its way out, so there is nobody to
   * tell, and `connectedCallback` reconciles again with `_key` cleared, which is what makes
   * a card dragged from one section to another reload rather than sit on stale colours.
   *
   * The colours themselves stay until that reload answers, and it is the reload that
   * replaces them. Cleared here, a card coming back was colourless for a round trip: the
   * answer always differed from the empty map and repainted for nothing, and a row mapped
   * before it landed was drawn in the palette and then in its own colour. The calendar card
   * holds its rows over a move, so that was a flash on a card with nothing else changing.
   */
  public stop(): void {
    this._revision += 1
    this._key = undefined
    this._ids = []
    this._closeWatch()
  }

  private async _load(): Promise<void> {
    const hass = this._hass
    if (!hass) return

    const revision = (this._revision += 1)
    const loaded = await fetchEntityColors(hass, this._ids)
    // Overtaken by a later reconcile, or by the card leaving. This answer is about a set of
    // entities the holder no longer has.
    if (revision !== this._revision) return

    this._publish(loaded)
  }

  /**
   * Take the new colours, and repaint only if they are actually new.
   *
   * The guard is not an optimisation. Every registry edit in the installation wakes this,
   * including the renames and the area assignments that have nothing to do with a colour,
   * and a callback fired on each of those would repaint every card holding one of these.
   */
  private _publish(loaded: ReadonlyMap<string, string>): void {
    if (sameColors(this._colors, loaded)) return

    this._colors.clear()
    for (const [entityId, color] of loaded) this._colors.set(entityId, color)
    this._onChange(this._colors)
  }

  private async _openWatch(): Promise<void> {
    const hass = this._hass
    if (!hass || this._watch) return

    const token = {}
    this._watch = { token }

    try {
      const unsubscribe = await hass.connection.subscribeMessage<RegistryEvent>(
        event => this._registryChanged(event),
        { type: 'subscribe_events', event_type: 'entity_registry_updated' },
      )

      // Superseded while the handle was in flight, so it is ours to close and nobody
      // else's.
      if (this._watch?.token !== token) {
        await unsubscribe()
        return
      }
      this._watch.unsubscribe = unsubscribe
    } catch (error) {
      if (this._watch?.token === token) this._watch = undefined
      // A card that cannot watch the registry still drew its colours at reconcile, so this
      // costs liveness and nothing else.
      console.debug('[cupertino-widgets] not watching the entity registry', error)
    }
  }

  private _registryChanged(event: RegistryEvent): void {
    const entityId = event?.data?.entity_id
    if (typeof entityId !== 'string' || !this._ids.includes(entityId)) return

    void this._load()
  }

  private _closeWatch(): void {
    const watch = this._watch
    this._watch = undefined
    // Nothing to do about a failed unsubscribe: the socket may already be gone, which is
    // the case that closed the subscription for us.
    void watch?.unsubscribe?.().catch(() => {})
  }
}
