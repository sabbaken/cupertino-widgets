# Cupertino Widgets: working notes

Home Assistant dashboard cards styled like a phone's home-screen widgets. TypeScript + Lit,
built by Vite into one self-contained ES module (`dist/cupertino-widgets.js`) that a
dashboard loads as a resource. Three widgets exist: the calendar card, the battery card and
the reminders card.

The architectural premise, because everything else follows from it: **there is no size
option.** Home Assistant owns the footprint through the sections **Layout** tab, the card
measures the box it actually ended up in and picks its layout and row budgets from that.
`config.scale` (80–130%) is the one thing the card decides about its own size, and it is a
factor over the whole widget rather than a preset.

## Commands

```bash
pnpm dev          # the showcase at localhost:5173 (no Home Assistant needed)
pnpm test         # vitest, the pure layers only
pnpm typecheck    # tsc --noEmit over src/ AND dev/
pnpm format       # prettier --write .
pnpm build        # typecheck + dist/cupertino-widgets.js
pnpm build:site   # typecheck + dist-site/ (the GitHub Pages showcase)
pnpm shots        # regenerate docs/images/ from the cards themselves
pnpm ha:up        # the throwaway Home Assistant at localhost:8123
pnpm verify       # build + bump the resource ?v= + force-recreate the container
```

Before committing, run what CI runs: `pnpm format:check && pnpm typecheck && pnpm test`,
and `pnpm build && pnpm build:site` if anything they cover moved. CI also greps the bundle
for unresolved bare imports: Home Assistant loads the file directly, so it must be
self-contained.

## Layout

```
src/
  index.ts              imports every card for its self-registering side effect
  core/
    base-card.ts        the hass/config contract, ResizeObserver → cwLayout, scale, floor
    card-editor.ts      the visual-editor half of that contract, over ha-form
    register.ts         collision-safe define + card-picker entry
    size.ts             sections-grid arithmetic; gridOptions(); layoutFromBox()
    scale.ts            the 80–130 clamp, its justification, and the editor's Scale row
    navigate.ts         HA's own navigate(), less the parts a card cannot use
    action.ts           tap/hold/double-tap: HA's config shape and its two timings, hand-rolled
    time.ts             which clock and which zone; was the calendar's, moved on the 2nd card
    entity-color.ts     the colour stored against an entity: HA's key, then ours
    types/ha.ts         the slice of the HA API we depend on, hand-rolled
  theme/tokens.ts       the ONLY place a Home Assistant variable is read
  theme/base-styles.ts  structural CSS every card shares
  ui/gauge/             the shared dial, and the library's first thing that is not a card:
                        geometry.ts (the arc as arithmetic, in a 100-unit box) → gauge.ts
                        (`gaugeStyles` a card composes + `renderGauge`); see rule 14
  cards/calendar/       flow.ts (what is shown) → layout.ts (how much fits) → the element
                        source.ts: calendars; todo-source.ts: the same for to-do lists
                        model.ts: what a row is, and the page a tap on it opens
  cards/battery/        model.ts (a state as a device) → layout.ts (the grid) → the element
                        device-list-editor.ts: the editor's sortable list of device panels
  cards/reminders/      completion.ts (what is drawn, and what a tap can take back) →
                        layout.ts (which of three shapes, and the row budget) → the element
                        model.ts: one to-do list, its items, and where a tap on the name goes
                        source.ts: the single `todo/item/subscribe` the rows arrive on
  cards/mini/           four small cards, one entity each, in a fixed 56-unit slot; see rule 15
                        mini-card.ts (the slot, the tap target) + mini-editor.ts (the frame)
                        model.ts (a state) → format.ts (how large it prints) → layout.ts (room)
                        text.ts: the text card's five formats; template-source.ts: render_template
                        mini-{gauge,icon,text,range}.ts and an editor beside each
dev/
  site/                 the showcase; one entry per widget in catalog.ts
  shots.ts              the README gallery as a page a camera can point at
  battery-devices.ts    the battery card's mock devices AND the sets pointing at them
  reminders-lists.ts    the reminders card's mock to-do lists AND the ones the harness offers
  mini-entities.ts      the mini widgets' mock sensors AND one config set per branch
  mock-hass.ts, ha-stubs.ts, ha-config/
docs/                   the specs, the verified-API notebook, the generated images
```

`tmp/` and this file are gitignored; scratch work and probes belong in `tmp/`.

## Rules that break things quietly

Each of these has a comment at the site explaining it; this is the index, not the argument.

1. **Tokens.** Cards read `--cw-*` and never a Home Assistant variable. `theme/tokens.ts`
   is the whole bridge, and a colour needs both the `:host` and the `:host([dark])` entry.
   Icons come from `@mdi/js`, the set Home Assistant draws itself with; the battery card's
   charging bolt is the one exception: Material's `Bolt`, inlined with its provenance on it.
2. **Scale is two languages.** CSS multiplies every widget-owned length by
   `var(--cw-scale)`; `layout.ts` divides the measured box by the same factor. A px length
   added to a stylesheet without the `calc(… * var(--cw-scale))` stops scaling, and a
   constant `layout.ts` prices unscaled must keep matching its CSS twin. The calendar's are
   `INSET` 16 ↔ `--cw-inset`, `GAP` 6 ↔ `--cw-flow-gap`, `COMPACT_PX` 56 ↔ `.row`,
   `DATE_BLOCK` 84 ↔ the date block; every card has an `INSET` 16 of its own against the
   same `--cw-inset`, and rule 3 has the other two cards' lists. `--cw-scale` is
   inline-only, never a theme hook. `--cw-radius` and `ha-card`'s 1px border are Home
   Assistant's and must not scale.
3. **The row budget.** `geometryFor` takes the border off in real pixels first and the
   inset in design units after; `ROW = 31` is priced at the dearest kind of row so no mix
   can overflow. A new row kind means re-checking that ceiling and `ONE_ROW` in
   `layout.test.ts`. The battery card's `gridFor` divides the box the same way and for the
   same reason, but budgets nothing: its content is the config's device list, so the box
   only settles how large and in how many rows. Its twins are `GAP` 14 ↔ `--cw-ring-gap`,
   `LABEL_GAP` 8 ↔ `--cw-ring-label-gap`, `LABEL` 28 ↔ `.level`'s line-height, and
   `LABEL_WIDTH` 64, which is `100%` measured in a browser and has to be re-measured if
   that type moves. The diameter is not a twin at all: it travels as `--cw-gauge-size`,
   which `gridFor` computes and the template writes inline, and the gauge prices its own
   insides off that one length (rule 14). The reminders card budgets like the calendar and has one kind of row,
   so its ceiling is exact rather than dear: `ROW` 24 ↔ `.item`'s `min-height` AND
   `--cw-tick-size` (one number, because the circle is the tallest thing on a row),
   `GAP` 16 ↔ `--cw-item-gap`, `COUNT` 34 and `COUNT_SMALL` 22 and `NAME` 22 ↔ the line
   boxes of `--cw-text-title-1` and `--cw-text-headline` (the count is set in the smaller of
   the two in the square, which is why there are three numbers for two sizes), and `RULE` 1
   with `RULE_ABOVE` 8 and `RULE_BELOW` 12 ↔ `.rule`'s height and its margin. Only the
   large view pays for the rule, and only it and the square pay for a heading: the wide
   one puts it in a column beside the rows, so `HEAD.medium` is 0. `ROW + GAP` is the whole
   density: in the square the gap cancels and the count is `floor(192 / pitch)`, so the 40
   is what makes that footprint draw four rather than the five a 34 gave. `RULE_BELOW` did
   NOT follow `GAP` up to 16, and must not: it is what keeps the large view from costing a
   row at the footprint it arrives on (12 × 5 draws seven wide, 12 × 6 draws seven large).
4. **`min_rows: 3` is a promise.** Whatever cell the Layout tab hands out, the card has to
   draw itself inside it, including its own floor, which `base-card.ts` clamps to the
   measured box because `min-height` beats `max-height` in CSS. That clamp is only as good
   as the measurement, and `:host { min-height: 0 }` is what keeps the measurement honest:
   a grid or flex parent (a `button-card` custom field, `layout-card`) gives its items
   `min-height: auto`, so without it the floor lifted the host, the ResizeObserver read the
   lifted height back, and the card budgeted rows for a box twice its cell.
5. **`cwLayout`, never `layout`.** HA owns `layout` on a card element and wrapper cards
   forward it down verbatim. `preview` means *the user is editing*, not *this is a
   thumbnail*: the calendar's fixtures are reachable only through an explicit
   `demo_scenario`, and the battery card ships no fixture door at all (its demo data is
   mock entities in `dev/`, which is the better arrangement wherever a card can manage it).
6. **The re-render filter.** Anything `render()` reads must appear in `watchedEntities()`,
   or a plain `hass` swap is filtered out and the card goes stale. A subclass overriding
   `setConfig`/`connectedCallback`/`willUpdate` must call `super`.
7. **Editors.** `fields()` must not contain a `scale` row (`schema()` appends the shared
   one, and `trailingFields()` is what goes under it: an Advanced section is the floor of
   the dialog, so **Scale** sits above the triangle rather than below it);
   `label()`/`helper()` overrides need the `default: return super.…` branch;
   `applyFormData` touches only the named fields, so keys Home Assistant owns survive. A
   list row carrying more than a selector can report needs both `toForm` and `fromForm`:
   one direction alone is either a picker that throws or an editor that deletes the extras.
   A control that is not an `ha-form` row at all goes in `beforeForm()` and reports with
   `emitConfig`, which is the battery card's device list: `ha-form` cannot hang a drag
   handle or a bin off a panel, so the panels have to be ours. Anything it renders must be
   an element Home Assistant has already defined (an undefined custom element draws
   nothing at all), and `docs/ha-api-notes.md` has the table of which are. A **group** of
   rows is the one node with a `type` rather than a `selector`, and `flatten: true` is not
   optional on it: without it `ha-form` reads and writes `data[name]`, so the calendar's
   Advanced section would nest `day_offset` under an `advanced:` key in the user's YAML.
   `fieldNames` and `formData` walk into a group for the same reason, and a version that
   stopped at it drew a section that accepted edits and saved none of them. `toForm`/
   `fromForm` are also how a row edits something that is NOT in the config: the reminders
   card's **Colour** reads out of the entity registry and writes back to it, and `fromForm`
   filtering that name out of the fields it hands `applyFormData` is the whole of what keeps
   it from landing in the user's YAML as well.
7a. **A colour belongs to the entity, not to the card.** `core/entity-color.ts`:
   `options.<domain>.color` first (Home Assistant's own, so a calendar is unchanged and a
   native `options.todo.color` would take over by itself), then
   `options.cupertino_widgets.color`, then the card's palette. The namespace is ours and the
   field takes one because core validates neither; `docs/ha-api-notes.md` has the citations,
   including why labels were the wrong answer. Writing is admin-gated, which costs nothing
   because saving a dashboard is too. A write REPLACES the namespace, so it is
   read-modify-write, and `options: null` is how a key is removed rather than emptied.
8. **Registration.** `registerCard`'s `type` is the bare tag, `getStubConfig()` returns
   `custom:<tag>`, `getConfigElement()` must stay defined or the dialog loses its
   Visibility and Layout tabs, and a new card must be imported in `src/index.ts`.
9. **Build.** `emptyOutDir: false` on the library build (a new inode detaches the dev HA's
   bind mount), and the bundle filename is load-bearing in `hacs.json` and `release.yml`.
   `vitest.config.ts` stays separate from `vite.config.ts`; tests run in `node` so a
   machine in another timezone cannot get different answers.
10. `max_columns`/`max_rows` are deliberately absent from `gridOptions()`.
11. **SVG in a nested template needs lit's `svg` tag, not `html`.** A nested template is
    parsed on its own, so an `html` one puts the element in the HTML namespace: it appears
    in the DOM with every attribute set and every presentation attribute ignored. The
    battery ring drew a bare track at every level until the conditional arc was moved over,
    and that lesson now lives in `renderGauge`, which is where the conditional pieces are.
    A root `<svg>` inside an `html` template is fine, which is the refinement the reminders
    card records; the same rule bites from the other side on the gauge's `overlay`, where an
    `svg` template with no `<svg>` root lands in the DOM and draws nothing.
12. **Leaving a card is a history push, not a link.** `core/navigate.ts`: HA's router
    listens for `location-changed` on a **window**, so an `<a href>` reloads the whole
    frontend and an event fired at the card's element can miss the window that matters. A
    tap target also asks `hass.panels` before it goes anywhere, because a panel exists only
    while its integration is loaded; that guard is what keeps the showcase's mock `hass`
    (`panels: {}`) to its press effect. The row is the tap target, never `ha-card`. The
    reminders card is the first with two kinds of target on one widget, and they are not
    interchangeable: the count, the name and the badge push history (so they are
    `role="button"`), while a row calls `todo.update_item` and goes nowhere (so it is
    `role="checkbox"`, with `aria-checked`, and Space is the key that toggles it). A list
    that does not advertise `UPDATE_TODO_ITEM` gets rows with no role, no `tabindex` and no
    handler at all, which is what Home Assistant's own to-do card does with its checkbox.
13. **A third shape is the card's own, not core's.** The reminders card has three views and
    `core/size.ts` has two, because its third is a taller card rather than a wider one and
    the shared threshold is on the width alone. `layout.ts`'s `viewFor` refines
    `layoutFromBox` locally instead of adding a member to `WIDGET_LAYOUTS`: that union is a
    `Record<WidgetLayout, number>` key, so a third member is two tables the battery card
    would owe an answer for, and a `large` reminders card would have meant designing a
    `large` battery card on the way past. What stays in core is the one number both halves
    have to agree on, `LAYOUT_THRESHOLD`, which `layout.ts` reads for the width and reuses
    on the height as `LARGE_HEIGHT`. The calendar's `LayoutMode` is the same move, smaller.
14. **The shared gauge is a template and a stylesheet, not an element.** `src/ui/gauge/` is
    the first thing here that is neither core nor a card, and it is composed rather than
    nested for reasons the module essay carries: `tokens` hangs on a card's `:host`, with
    `--cw-scale` inline on it and `[dark]` reflected onto it, so a second shadow root either
    fights that layer or cannot use it; `defineElement` keeps the FIRST definition of a tag,
    which is right for two copies of a card and wrong for a dependency, since a v2 card would
    silently draw with a v1 gauge; and no boundary is what lets `.cell.unknown
    .cw-gauge-glyph` be one line of the battery card's own CSS. The costs are real: a card
    must name `gaugeStyles` as a third sheet (nothing did before), the `cw-gauge-*` class
    names are public API, and there is no id space, so a gradient or a mask would collide
    between two gauges in one card. `--cw-gauge-size` is the diameter, required, already
    scaled, and every length inside is a fraction of it; the knobs are unitless fractions on
    purpose, because a length knob invites a second `* var(--cw-scale)`. Nothing may budget
    a row against the middle of a gauge: the battery card's percentage stays OUTSIDE it,
    which is what keeps `LABEL` and `LABEL_WIDTH` describing something. `docs/gauge-rules.md`
    has the fitted numbers and the reasons. Three of the spec's fields are NOT CSS and must not
    become knobs: `stroke`, `cap` and `ticks` are priced by `geometry.ts` (the cap sets `arcFor`'s
    floor, the stroke moves the whole track), so a stylesheet able to change one would change the
    picture out from under the arithmetic describing it. `--cw-gauge-stroke` and `--cw-gauge-cap`
    are published inline the way `--cw-gauge-centerline` is: read, never set.
15. **The mini cards invert the premise, in one direction only.** `src/cards/mini/` is four cards
    whose content is a fixed 56-unit token rather than something that fills its box: that size is
    what lines one up with the one beside it, and a dial stretched to a large cell is magnified
    rather than larger. So `slotFor` shrinks and never grows, and `getGridOptions` asks for 2×1
    (4×1 for a pill) with both floors at 1. They are also the one family whose `ha-card` draws
    nothing at all, which is why `BORDER` in their `layout.ts` is 0 and is still named: the order
    (real pixels off first, then design units) has to survive the day a border comes back.
    `getCardSize` must stay overridden at 1, or masonry drops a 56px widget into a column as
    though it were four rows tall. Their type is fitted to the string by `format.ts`, whose
    advance table is measured at **11px and not at a display size**: `-apple-system` is
    optical-sized, so a table measured large under-states a small label and clips it, and `fitFor`
    rounds DOWN for the same reason while `captionScale` rounds UP (a floor, not a fit). A tap
    defaults to the dialog and never to a toggle. `core/action.ts` is the shared machinery, and it
    is hand-rolled because the frontend publishes no `handleAction` a card can import; its two
    timings (500ms, 250ms) are HA's own and the 250 is only ever waited when a double tap is
    configured.
16. **Rows leave with their entity, and with nothing else.** The calendar card's `CalendarFeed`
    and `TodoFeed` close a subscription for four reasons (the window moved, the card left the
    DOM, the entity went `unavailable`, the entity was deselected or is gone from `hass.states`)
    and only the last forgets the rows: `_unsubscribe` and `_forget` are two methods so that
    stays a decision, and a `stop()` that cleared rows again would blink every card on a move.
    Core does not end a subscription when a reload removes its entity, so `unavailable` and back
    is the resubscribe cue, and discovery keeps unavailable entities (unlike HA's `getCalendars`)
    for the same reason; `docs/ha-api-notes.md` has the core lines. A push identical to the last
    is dropped by a serialised compare before it is mapped, because core re-pushes on every state
    write. `ReminderFeed` in the reminders card has not had this treatment yet.

## Where the truth lives

- **`docs/calendar-widget-rules.md`** is the calendar's specification, section by section,
  and §8's worked examples are transcribed into `layout.test.ts`. Change a packing rule and
  both move, plus §10 if it answers an open question. §9 is the tap behaviour: the one
  section about what happens after the layout settles. §2's "Which days" is the other
  section that is not about pixels: the card is anchored on today only by default, and
  `day_offset` moves the date block, the day that goes unheaded and the empty line
  together. The clock retires a row on **today alone**, which is what lets a window in the
  past be read at all.
- **`docs/battery-widget-rules.md`** is the same for the battery card, and §8's table is
  transcribed into its own `layout.test.ts` the same way. Its §3 is the section to read first:
  `MAX_ROWS` caps both current sizes at four rings and the wide one at a single row, so
  `entities` may legitimately be longer than the card draws: that is groundwork for `large`,
  not a bug, and §9 lists what adding that size takes. Its §2 is now a short list of what this
  card decides about a ring the shared gauge draws; the arithmetic moved.
- **`docs/gauge-rules.md`** is that gauge, and it is a **component** spec rather than a widget
  one: no footprint, no row budget, no `cwLayout`. What it holds instead is every number fitted
  off the reference by measuring a screenshot (the 270 degree notch, the stroke, the dot and the
  hole under it, the two type sizes in the middle and the anchoring of the end readings), each
  with the arrangement it beat. Change a number there and the fit it came from has to be
  re-measured, not re-argued.
- **`docs/reminders-widget-rules.md`** is the same for the reminders card, and its worked
  examples are transcribed into its own `layout.test.ts`. Three of its sections carry more
  than layout: which of the three shapes a box gets (the width question is core's, the
  height question is that card's own; see rule 13); what a tap on a row does, which is the
  only place a card holds a row against what the server has already said; and §6a, the
  colour, which is the library's second write path and the only thing it stores outside a
  card's own config (see rule 7a).
- **`docs/mini-widget-rules.md`** is the four small cards, and it is the specification to read
  before touching `format.ts`: its §3 carries the one thing about type in this library that
  cannot be reasoned out, which is that an advance is not a constant fraction of the em. §2 is
  the size premise inverted and why; §5 is the two tap defaults and the argument for each; §6a's
  note on thresholded colour is the only place a card in this library disagrees with
  `docs/gauge-rules.md` §7, and it says why the two cases differ.
- **`docs/ha-api-notes.md`** is a notebook of Home Assistant facts verified by grepping the
  frontend bundle and core source inside the docker image; the header carries the one-liner.
  Verify there, not against tutorials, and write down what you find. Its to-do section is in
  three parts now: the subscription the rows arrive on; the `todo.update_item` write path
  under it, whose timing (the push lands before `callService` resolves) is what the
  five-second hold on a ticked row is built around; and the entity-options namespace the
  colour lives in, which carries the line numbers proving core validates neither the
  namespace nor its contents, and the argument against labels.
- **`docs/images/`** is generated by `pnpm shots` against a frozen clock. Never hand-edit or
  hand-crop. A fixture edit obliges a re-run, and the README's `alt` text names the events
  in each shot. The shots are clipped at 540 and 286 CSS px (a 500px section plus 2 × 20px of
  margin); the README pins its `<img>` widths to the same ratio but smaller, so a half-width
  table cell caps neither and the square stays to scale. The rule is in
  [`docs/development.md`](docs/development.md).

## Style

**Prose** (docs, comments, commit subjects): British spelling in prose and American in code
(`colour` in a sentence, `color:` in CSS). Hard-wrap by hand at ~90 columns; Prettier does
not do it for you. **No em dashes.** The house punctuation used to be the spaced em dash,
and every one of them was rewritten out because a reader scanning for machine-written prose
stops at that character first. Reach for the punctuation the sentence actually wants: a
colon before a reason, a semicolon between two balanced halves, brackets around an aside,
or two sentences. Vary it, because a colon everywhere is the same tell wearing a hat. Two
em dashes survive on purpose and must not be swept up by a later pass: `LEVEL_DASH` in
`battery-card.ts` and the `blank.textContent` pair in `ha-stubs.ts`, which are the glyph
Home Assistant itself draws for an unavailable entity rather than punctuation. The en dash
stays where it belongs, in numeric ranges like `80–130`. No marketing adjectives, no
exclamation marks. Every decision is stated with the alternative it beat and what that
alternative cost; a comment that only restates the mechanism is not written. The obvious
name for the phone platform appears nowhere in this repo and a grep must keep returning
nothing: say "phone" or "Cupertino". Existing "Apple" mentions are grandfathered; ask
before adding one.

**Code**: Prettier with no semicolons, single quotes, `printWidth: 100`, trailing commas,
`arrowParens: "avoid"`. Named exports only. Pure helpers are `export const f = (…): T =>`;
stateful things are classes or `export function`. Files open with a module-level essay
comment before the imports; sections inside a file are `// ---- Name ----` banners. Public
names carry `cw`/`--cw-`/`CW`. Explicit `override` everywhere.

**Tests**: vitest with explicit imports, colocated as `*.test.ts`, pure layers only.
`describe` names the rule area as a lower-case noun phrase; `it` is a third-person sentence
about behaviour, never "should". Define local prose-named builders so assertions read like
the spec. Invariant sweeps accumulate into `const broken: string[] = []`, assert
`expect(broken).toEqual([])`, and separately assert the sample was not vacuous.

**Commits**: conventional commits, one line, no body: `feat:`, `fix:`, `refactor:`,
`docs:`, `chore:`. Identifiers in backticks.

**Demo data** (`demo-data.ts`): a neutral invented week that reads like somebody's real
one. Street addresses are `Street N, Warsawa`, the trip goes to Poznań, times anchor to the
clock so the harness always has something to show.

## Habits that pay off here

- The showcase is the loop you live in; the dockerised Home Assistant is the loop you
  finish in. `pnpm verify` is the only reliable way to see a change there, and it rewrites
  the `?v=` in the tracked `dev/ha-config/configuration.yaml`, so keep that out of
  unrelated commits. Never `docker compose restart`.
- Settle CSS and measurement questions in a browser rather than by reasoning about the
  cascade: a throwaway Playwright probe against `dev/shots.html` (borrow the running card's
  `hass`, build a box of your own, measure `ha-card` inside the shadow root) answers in a
  minute and leaves nothing behind.
- Settle Home Assistant behaviour by grepping the shipped bundle. Its own cards are the
  best documentation of the contract.

## Agent orchestration

At most five agents in flight at once, in ultracode mode or anywhere else.
`CLAUDE_CODE_MAX_CONCURRENT_SUBAGENTS: "5"` in `.Codex/settings.json` enforces that for
the Agent tool. A workflow script is not covered by it: the runner has its own limiter at
`min(16, cores - 2)` and no setting reaches that number, so the script holds the line
itself, fanning out in batches of five rather than handing `parallel()` or `pipeline()` a
longer list. `workflowSizeGuideline: "small"` was the alternative, and it caps how many
agents a workflow may spawn in total rather than how many run together: a blunter limit
than the one wanted here.
