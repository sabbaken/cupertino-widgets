# Development

How to work on the cards: the fast loop, the loop that proves it, and where everything
lives. The [README](../README.md) is the shop window; this is the workshop behind it.

```bash
pnpm install
pnpm dev          # the showcase at http://localhost:5173, no Home Assistant needed
pnpm test         # the layout rules, as unit tests
```

## The showcase

`pnpm dev` serves the same page that is published at
[sabbaken.github.io/cupertino-widgets](https://sabbaken.github.io/cupertino-widgets/), with
full HMR: every card against a mock `hass` object, in a box the sections grid would have
given it. This is the fast loop.

The top of it is what a visitor sees: **Small** and **Medium**, each labelled with the
footprint the Layout tab would give it, plus a box whose corner drags. They stand on a
plane painted with Home Assistant's own background, and the site gives each card a width
and a height and not one other property, so a card there is a card on a dashboard.

The settings column down the right-hand side leads with the config to paste and a Copy
button, then every knob that changes it, grouped by whether it belongs to the card. The Card
group is what ends up in the YAML above it; the Demo group stands in for Home Assistant.

**Scale** is in the Card group whichever widget is on screen: every card in the library has
it. So is the battery card's **Devices**, and that is the honest grouping rather than an
oversight: that card has no fixtures at all. It reads `hass.states` exactly as it would on a
dashboard, so the only thing the harness supplies is which of the mock installation's sensors
to point it at, and the YAML above the control is genuinely the config that produced what is on
screen. `dev/battery-devices.ts` holds both halves (the mock entities and the named sets), and
its sets are chosen for the layout branch each one lands on: the captioned row, the grid that
gives the percentages up, two rows of rings, a device that has stopped reporting.

The calendar's **Calendars** is in the Demo group for the opposite reason: it picks either
`Live`, which makes the card resolve `entities` and subscribe to the mock's calendars as it
would in Home Assistant, or one of the fixtures built to hit every layout branch (an empty
today, a skipped empty tomorrow, locations that fit and locations that do not, reminders,
all-day, a tail that turns into `2 more events`). Only the first exercises the wire mapping;
only the rest can reach every layout rule, and none of them is a config anybody could paste.

**Clock** flips between the system format and an explicit 12 or 24 hours, and **Section width**
emulates a wider or narrower dashboard section, which re-boxes every footprint on the page.

**Advanced** is the part that is there for working on a card rather than for choosing one:
the in-between footprints, and the card's real editor (reached the way Home Assistant
reaches it, through `getConfigElement()`), driving a live card beside the config it writes.
That editor's `ha-form` is a stand-in (`dev/ha-stubs.ts`): the behaviour is real, the widget
is not, so check how it _reads_ in the dev Home Assistant below.

```bash
pnpm build:site   # the same page as static files in dist-site/
pnpm preview:site # serve that build
```

The site is published to GitHub Pages by `.github/workflows/pages.yml` on every push to
`main`. It is served from a subdirectory, so the build hard-codes that prefix; a fork
serving it from a domain root wants `SITE_BASE=/ pnpm build:site`.

`pnpm test` covers the parts with no pixels in them: selection, ordering, column
packing, time formatting, row budgets, including the worked examples at the bottom of each
rules document.

## Against a real Home Assistant

A throwaway Home Assistant lives in `docker-compose.yml`. It is wired so that build
output is served without any copy step: `./dist` is mounted into the container's
`www/`, and the dashboard resource is pre-registered in
`dev/ha-config/configuration.yaml`.

```bash
pnpm ha:up        # http://localhost:8123, create an account on first run
pnpm verify       # build, bust the cache, restart (the one command to trust)
```

**`pnpm verify` is the answer to "am I looking at my change?"** It builds, bumps the `?v=`
on the resource URL, and force-recreates the container. Nothing else is reliable, and it is
worth knowing why, because the failure mode is not "stale": it is _one build behind_,
which reads as flaky rather than as cached.

Two caches sit in front of that file and cover for each other:

- Home Assistant serves `/local/` with `Cache-Control: public, max-age=2678400`. 31 days.
- The frontend's service worker ends its route table with a catch-all that `/local/` falls
  into: `registerRoute(/\/.*/, new StaleWhileRevalidate({ cacheName: 'file-cache',
plugins: [new ExpirationPlugin({ maxAgeSeconds: 86400 })] }))`. Stale-while-revalidate
  answers from cache and refreshes behind you, so a reload shows the **previous** build and
  the current one appears on the reload after that.

A hard reload (⌘⇧R) does not rescue you, and the reason is specific: Home Assistant loads
a dashboard resource by appending a `<script type="module">` at runtime: `loadModule` in
the bundle is `url => appendScript('script', url, 'module')`. A force-reload takes the
service worker off the navigation and the subresources the parser found in the HTML; it has
no bearing on a fetch a script issues afterwards. So the worker answers the bundle from its
own copy, and the revalidation it fires behind you is served by the month-old HTTP entry.

Changing the URL misses both caches; they key on the full URL including the query, since
that catch-all route sets no `ignoreSearch`. A reload of some kind is unavoidable
regardless: a custom element cannot be redefined in a page that already registered it.
Which is the real argument for the showcase above being the loop you live in, and this one
being the loop you finish in.

If you would rather stay in the browser: DevTools → Application → Service Workers →
**Bypass for network**, plus **Disable cache** on the Network tab. Both only hold while
DevTools is open.

```bash
pnpm watch        # rebuild dist/ on change, if you want the file fresh without restarting
```

```bash
pnpm ha:logs      # follow the container log
pnpm ha:reset     # wipe the instance completely (onboarding, state, dashboards)
```

`ha:reset` is `docker compose down -v` **and** a `git clean` of `dev/ha-config`, and it needs
both halves: the instance lives in a bind mount rather than in a volume, so `down -v` has
nothing of it to remove. The clean is the wipe. It is safe because `.gitignore` ignores
everything under `dev/ha-config/` except the one tracked `configuration.yaml`, which
`git clean` therefore leaves alone, so the next `pnpm ha:up` comes back to first-run
onboarding with the dashboard resource already registered.

One sharp edge worth knowing: the bind mount of `dist` is fragile, and when it breaks
the container serves 404 for a bundle that is visibly there on the host. Two ways to
break it: deleting the _directory_ (Vite is configured never to, via
`emptyOutDir: false`), and `docker compose restart`, which keeps the existing container
and brings its mount back stale. `pnpm ha:up` force-recreates the container and
re-resolves the mount, so it is the fix for both, and it is what to use instead of
`restart` after editing `configuration.yaml`.

The dev instance loads the `demo` integration, so `calendar.calendar_1` and
`calendar.calendar_2` exist to develop against. For calendars you can write to, add
the **Local Calendar** integration in the UI.

`demo` ships no `todo` platform at all, so there is not a single to-do entity here until you
add **Local To-do** in the UI, which is config-flow only and cannot be put in
`configuration.yaml`. That is the integration to add for the reminders card and for the
calendar card's reminder rows, and it is worth adding for the reminders card in particular:
it advertises every `TodoListEntityFeature`, so ticking an item off actually works. Note
that `pnpm ha:reset` takes the list with it, since the integration lives in the instance's
`.storage` and the reset is a `git clean` of `dev/ha-config`.

## Screenshots

The README is the first shop window, before the site, before installing anything, which
means the pictures in it have to be as cheap to regenerate as the code is to rebuild, or
they will quietly go out of date. One command, run by hand whenever the cards change:

```bash
pnpm shots
```

It starts the same Vite dev server the showcase runs on, opens `dev/shots.html` in
headless Chromium, and clips one PNG into `docs/images/` per entry in `dev/shots.ts`'s
`SHOTS` list. That list is the whole edit surface: a shot is a fixture, a footprint in
Layout-tab columns and rows, and a theme. Nothing is cropped by hand: a hand-cropped
screenshot is a screenshot nobody can reproduce.

Two things the script does that a manual screenshot cannot:

- **Freezes the clock**, at Friday 24 July 2026, 09:41, in `Europe/Warsaw`. Half the
  calendar's rules are about `now`, so unfrozen, every run would produce different pixels
  in every file and each one would land in `git diff`, which is how a generated gallery
  stops being regenerated. The date is a Friday so that both heading forms appear across
  the set, and 09:41 because the fixtures anchor today to the next half hour, so
  everything today starts at a round 10:00.
- **Waits to be told.** The page sets `__SHOTS_READY__` only once every card has settled
  into the layout its box implies. A card guesses `medium` for its first frame and learns
  better when its ResizeObserver reports, so a camera firing on `load` would photograph
  the two-column layout inside a small box, reliably, and only in the one place nobody
  looks before committing.

Chromium is a one-off download:

```bash
pnpm exec playwright install chromium
```

Run it on macOS if you have the choice. The cards ask for `-apple-system` first, so that
is where the type comes out as SF rather than as whatever the machine has instead.

One rule for how the README then shows them: each `<img>` is pinned to a width in the same
proportion as its footprint (currently 420px for the 12-column shots against 222px for the
6-column one, the same ratio as the 540 and 286 they were clipped at), and both are small
enough to fit a half-width table cell on GitHub. Pin them at their full clipped widths
instead and the wide shot alone is capped by the cell while the square is not, so the pair
stops being to scale: the square reads about a fifth larger against the medium than the two
cards really are.

## Layout

```
src/
  index.ts              bundle entry: imports every card, which self-register
  core/
    base-card.ts        hass/config contract, sizing, dark mode, re-render filter
    card-editor.ts      the visual-editor half of that contract, over ha-form
    register.ts         collision-safe element definition + card-picker entry
    size.ts             the sections-grid geometry, and which layout a measured box gets
    scale.ts            the 80-130% bounds, why they are those numbers, and the editor row
    types/ha.ts         the slice of the Home Assistant API we depend on
  theme/
    tokens.ts           --cw-* tokens, bridged onto Home Assistant theme variables
    base-styles.ts      structural CSS shared by every card
  ui/gauge/             the shared dial: a track, a mark on it, a reading in the middle
    geometry.ts         sweeps, fractions, dashes and points, all in a 100-unit box
    gauge.ts            the stylesheet a card composes and the template it calls
  cards/<widget>/       one directory per widget
dev/
  site/                 the showcase, one entry per widget in catalog.ts
  ha-stubs.ts           stand-ins for the Home Assistant elements cards use
  mock-hass.ts          a `hass` object good enough to develop against
  battery-devices.ts    the battery card's mock devices, and the sets that point at them
  reminders-lists.ts    the reminders card's mock to-do lists, and the ones the harness offers
  shots.ts              the README's screenshots, as a page a camera can point at
  ha-config/            the throwaway Home Assistant instance
docs/images/            the README's screenshots, generated, never hand-edited
```

All three cards are split so that the rules can be read and tested without a browser:

```
cards/calendar/
  calendar-card.ts         the element: measure the box, draw it, derive the event palette
  calendar-card-editor.ts  its own two rows; Scale is added by the base editor
  flow.ts                  what to show and in what order: one stream of rows
  layout.ts                how much of that stream fits, in columns of a row budget
  format.ts                times, section headings, the date block
  datetime.ts              day arithmetic in the display timezone
  model.ts                 the item shape every data source has to produce
  source.ts                the Home Assistant end: subscriptions, colours, wire mapping
  demo-data.ts             fixtures for the showcase, never for a dashboard

cards/battery/
  battery-card.ts          the element: measure the box, draw what the two below decide
  battery-card-editor.ts   one row, plus the fold that keeps a hand-written override
  layout.ts                how many rings, in how many rows, captioned or not, how big
  model.ts                 a Home Assistant state as a device: level, icon, charging

cards/reminders/
  reminders-card.ts        the element: measure the box, own the clock, draw the answer
  reminders-card-editor.ts one row, the list to draw; Scale is added by the base editor
  layout.ts                which of the three shapes the box is, and how many rows it holds
  completion.ts            what a tap does, and what is drawn while it can be taken back
  model.ts                 a to-do list and its items, and the page a tap on the name opens
  source.ts                the one `todo/item/subscribe` subscription the rows arrive on
```

Neither the battery card nor the reminders card has a `demo-data.ts`, and neither needs one:
what they draw comes out of the installation they are pointed at, so a fixture is a mock
entity plus the config that points at it, and both live in `dev/` rather than in the shipped
bundle. For the battery card that is `dev/battery-devices.ts`; for the reminders card it is
`dev/reminders-lists.ts`, whose four lists `dev/mock-hass.ts` then serves the
`todo/item/subscribe` subscription from. The two dated lists defined in `mock-hass.ts` itself
are the calendar card's, and editing those changes nothing on the reminders card.

Cards read `--cw-*` tokens, never Home Assistant variables directly. `theme/tokens.ts`
is the single place that bridge lives, so a user's theme restyles every card for free.

## Cards inside somebody else's container

A card that measures its own box has to survive being put somewhere Home Assistant never
puts it. People nest these widgets in `button-card` custom fields, in `layout-card`, in
stacks, and the container a card ends up in there is routinely laid out with grid or
flex rather than as a block.

That distinction has teeth. A grid or flex item gets `min-height: auto`, an automatic
minimum size taken from its own content, where a block child's minimum is zero. Our
content is an `ha-card` carrying the `--cw-min-height` floor, so under such a parent the
floor lifted the element itself, the ResizeObserver measured the lifted height, and the
floor was set from that measurement: a card sitting in a 184px area, measuring 248px,
budgeting nine rows where six fit, and clipping the difference. `:host { min-height: 0 }`
in `base-styles.ts` is the whole fix and carries the argument.

The reproduction is worth keeping in mind for the next one of these, because it takes a
minute and does not need Home Assistant at all: on the showcase, build the foreign
container by hand around a card of your own and read what it measured.

```js
// In the console on the showcase, with a card already on the page as a source of `hass`.
const host = document.createElement('div')
host.style.cssText = 'display:grid;height:184px;width:600px;overflow:hidden'
document.body.append(host)

const card = document.createElement('cupertino-widgets-calendar')
card.setConfig({ type: 'cupertino-widgets-calendar', scale: 80, demo_scenario: 'default' })
host.append(card)
card.hass = existingCard.hass

// After a frame: the measurement, and what the floor was set from it.
;[card._measuredWidth, card._measuredHeight, card.getAttribute('style')]
```

One trap: a background tab does not paint, and a tab that does not paint delivers no
`ResizeObserver` callbacks, so every measurement reads 0 and the card looks broken in a
different way than it is. Keep the tab in front, or take a screenshot to bring it there.

## The rest of the documentation

- [`calendar-widget-rules.md`](calendar-widget-rules.md): what the calendar card decides
  to show and in what order, written down as rules with worked examples. The tests are
  transcribed from it.
- [`battery-widget-rules.md`](battery-widget-rules.md). The same for the battery card: how
  many rings, when they get a percentage, and why the ring is never red. Its §8 table is
  `layout.test.ts`'s first two cases.
- [`reminders-widget-rules.md`](reminders-widget-rules.md). The same for the reminders card:
  which of its three shapes a box gets, how many rows fit, and what a tap on a row does for
  the five seconds it can be taken back.
- [`gauge-rules.md`](gauge-rules.md): the shared dial in `src/ui/gauge/`, which is a component
  rather than a widget, so it has no footprint and no row budget. What it does have is a set of
  numbers fitted off the reference's own gauges: the notch, the stroke, the dot and the hole
  under it, and every type size in the middle.
- [`ha-api-notes.md`](ha-api-notes.md): the Home Assistant APIs this library depends on,
  each verified against the frontend bundle shipped in the HA image rather than against
  documentation, including several points where the widely-repeated advice is now wrong.
