# Battery widget: the layout rules

Reconstructed from the phone's own Batteries widget. This is the specification the card
implements; the code follows it section by section, and `src/cards/battery/*.test.ts` pins the
worked table at the bottom.

Two views, and the card chooses between them rather than being told:

- **labeled**: a ring with the percentage under it, for devices that fit on one row
- **compact**: the ring alone, for more devices than one row holds

Read [`calendar-widget-rules.md`](calendar-widget-rules.md) first if you want the library's
sizing story; the short version is that Home Assistant owns the footprint and the card
measures the box it ended up in. What this card does with that measurement is different
enough from the calendar to be worth stating early:

> The calendar's content is a **stream**: a fortnight of days arriving to be cut wherever the
> box runs out, so its box arithmetic is a budget, and the answer to "what fits" is "how much
> of the week". This card's content is **exactly the devices the config names**. Nothing is
> ever cut for lack of something better to draw, so the box does not decide _what_, only _how
> large_ and _in how many rows_.

---

## 1. What a device is

```ts
{
  id: string,             // the battery entity
  name: string,           // never drawn (see §6)
  icon: string,           // an `mdi:` name
  level: number | null,   // 0–100, or null when it cannot be read
  charging: boolean
}
```

Every field is normalised out of `hass.states` by `model.ts`, which is the whole of the card's
contact with Home Assistant; there is no subscription, no window and no wire mapper. A
battery level is a number sitting in the state machine, pushed to every card on every change.

**The level** is `Number(state.state)`, clamped to 0–100. `unavailable` and `unknown` come out
as `NaN` and so as `null`; so does a config pointing at an entity that no longer exists. The
clamp is for the sensor that reports 105 after a firmware update; an arc longer than the
circle wraps back over itself and reads as nearly empty.

**A device that cannot be read is not dropped.** It gets a ring with a bare track, a dimmed
icon, and a dash where the percentage would be. A card that quietly showed three rings where
four were configured would answer the opposite of the question somebody puts a battery widget
on a dashboard to ask.

**The icon** is the config's, then the entity's `attributes.icon`, then `mdi:battery`, or
`mdi:battery-unknown` when there is no reading behind it. The card contains no logic about
kinds of device: what the icon has to say is _which_ device, and the only honest source for
that is whoever wrote the config. Home Assistant's own icon for a `device_class: battery`
sensor is computed from the level, so falling back to it would draw the ring's reading a
second time in the middle of it.

**Charging** is read in this order, and it stops at the first answer:

1. `charging_entity`, if the config named one: `on` means charging. This is the
   `battery_charging` binary sensor an integration that knows publishes.
2. `is_charging === true` on the battery sensor's own attributes.
3. `battery_state` equal to `charging`, compared lower-cased: integrations write `Charging`,
   `charging` and `CHARGING` between them.

Everything else is "not charging", including a `charging_entity` that does not exist. An
absent bolt is a widget that has not been told; a bolt on a device sitting on a desk is a
widget that is wrong.

**None of the four is YAML-only, and they are one control rather than four.** A device is a
panel in a sortable list, titled and iconed with what the card is drawing for it, dragged by a
handle, deleted by the bin in its header, and inside it are the battery sensor, the icon, the
charging sensor and the name. An **Add a device** button under the list opens a picker that adds
the next one (one press, not one to reveal the picker and another to open it), and that picker
leaves out every sensor the list already holds: a device cannot be added twice, so offering one
that would be refused is offering a dead end.

Each of the two fields that override something greys the inherited value in as its placeholder,
and that is the rule rather than a flourish: the placeholder is the answer to "what happens if I
leave this empty", so it is read off the same expression the card keeps it with. Which is why
the icon field offers `mdi:battery` and not the `mdi:battery-70` Home Assistant computes for the
same sensor (see `inheritedIcon`).

The one thing the editor cannot reach is a battery percentage published without the `battery`
device class, which is what the pickers' filter costs and is stated where the filter is.

## 2. The ring

The ring is drawn by the library's shared gauge, and the rules it shares with every other dial
are in [`gauge-rules.md`](gauge-rules.md): the coordinate space, the 10% stroke and why it is
not 13, the round caps, and the one-unit shortest arc that makes a 1% battery visible without
overstating it. What this card decides about it:

- **A full turn**, `FULL_TURN`, from **twelve o'clock, clockwise**, where the shared gauge's
  own default, `OPEN_DIAL`, has a notch at the bottom. The battery is a quantity that can
  genuinely be all of itself, and a ring that stops short of its own start would say 100% is
  not quite full.
- An **arc**, not a dot: a length is how much is left, which is the question, and a dot on a
  bare track would answer a different one.
- Level is already 0 to 100, so the gauge's own scale is the one it assumes and the card passes
  no `min` or `max`.
- **Always green**, at every level. Not amber at 20 and not red at 5 (see §7). The gauge itself
  has no opinion on colour; this card sets `--cw-gauge-mark`.
- `level === 0` and `level === null` are both a bare track. The two are told apart by the
  caption, `0%` against an em dash, and where there is no caption, by the dimmed icon.

**The icon** is passed as the gauge's whole middle, so it is drawn at the size that implies
(`gauge-rules.md` §6). What this card adds is the dimming: 40% opacity when there is no reading,
so a device with nothing to say reads as "nothing to say" rather than as "empty".

**The charging badge** is a bolt at twelve o'clock, straddling the stroke's centreline, on a
disc of the card's own surface colour. The disc is what makes it work: the badge sits exactly
where the arc _starts_, so a green bolt laid straight on it is invisible at the one moment it
matters most: a device left on the charger overnight, at 100%, whose arc runs all the way
round. Punching the surface through first costs a notch out of the arc and buys a badge that
reads at every level. The arc underneath is not shortened for it, so its length still means
what it means. It is drawn through the gauge's `overlay`, and it is this card's CSS that puts it
where it goes, off `--cw-gauge-centerline`: the gauge publishes where the middle of its stroke
is so that a badge does not have to restate a stroke width it no longer owns.

The glyph is Material's own `Bolt` rather than one of MDI's, which makes it the only icon in
the library not drawn from the set Home Assistant draws itself with. MDI's `mdiFlash` and
`mdiLightningBolt` are both harder-edged, with a flat top and a straight leading edge;
Material's tapers and kinks, which is what makes it read as a charging mark beside a round
gauge rather than as a hazard sign. It is inlined as a path string, Apache-2.0, from
`@mui/icons-material`, which is a React package of some ten megabytes and not a dependency
worth taking for one glyph.

## 3. Which view, and how many rows

```
columns  = small ? 2 : 4          # from cwLayout, i.e. from the measured width
maxRows  = small ? 2 : 1          # the design cap: four rings, and never a stub row
rows     = min(ceil(count / columns), the rows the height holds at RING_MIN, maxRows)
visible  = min(count, columns * rows)
labeled  = visible <= columns && every column is wide enough for `100%`
```

**Four rings is what either of these footprints draws.** The square holds its 2 × 2 and the
wide card holds one row of four, and the wide card pointedly does **not** stack a second row
under it. A 4 + 2 grid fits perfectly well in the box and reads as a card that ran out of
something, where one row of four reads as the widget it is.

So a config naming six devices sees four, in config order, and says nothing about the two it
did not draw. That is deliberate, and it is groundwork rather than a limit: six exist for a
`large` footprint, which is the size with two rows of four to give them, and which arrives
here as a third entry in `MAX_ROWS`. Until then, `entities` is allowed to be longer than the
current sizes can show so that adding the size is the only change needed.

There is no `+N` indicator, and this is the one place the card's taste differs from the
calendar's `2 more events`. That row exists because the calendar is cutting an open-ended week
and the reader has no way to know how much was cut. Here the list is short, named, and the
user's own: a device that is not drawn is a config written for a size that is not on screen,
which is a thing to fix in the editor rather than a fact to report on the card.

Both halves of the `labeled` test are required, and they fail differently.

**More rings than one row holds** is the reference's own rule: the percentages come off and the
grid closes up. That is the trade the widget makes. A caption is worth a row of its own, and
past one row there is no room to keep buying it. Note it reads `visible`, not `count`: the wide
card draws four rings whether it was given four devices or nine, and four rings are one row, so
it is **always** captioned. Counting the configured list instead would take the percentages off
a card that is otherwise pixel-for-pixel identical, on the strength of devices nobody can see.

**Too little width** is this card's addition, and it exists because Home Assistant permits
footprints a phone has no equivalent of. `100%` is 64 design units at the caption's type, so
two rings across the narrowest 4-column card leave 51 units each and the reading would be
clipped in half. The percentages come off altogether rather than being set in a size of their
own: a widget with two type sizes for one number is a worse answer than a widget that admits
the column is too narrow to caption. A _single_ device is priced against the whole width
rather than against a column it does not share, so it keeps its caption in the same box.

The height is the third bound and the only one that is measured. It can take a row away (a
square squashed below two legible rows of rings draws one, with two of its four devices
undrawn), but it can never add one. That is the corner where the widget cannot say everything
it was asked to, and the answer is the editor's own advice: drag the card taller.

## 4. The grid

- Cells are the ring's width, or the caption's if that is wider, and they sit `GAP` apart in
  both directions. The whole block is centred in the card, vertically and horizontally.
- Filling is **row-major**, in config order. Nothing is sorted, ever: the order of `entities`
  is the order of the rings, which is what makes dragging in the editor worth having.
- An incomplete row is **left-aligned in two columns and centred in four.** The asymmetry is
  deliberate. Centring a lone ring between two columns parks it exactly over the gap in the row
  above, which reads as a pyramid rather than as a grid with a corner missing; in four columns
  there is no row above to line up with, so a short row centred is simply a short row centred.
  With `maxRows` as it is, the two-column case is the only one where an incomplete row sits
  under a full one, but the rule belongs to the grid, and `large` will want it.

## 5. How big a ring is

```
ring = clamp(RING_MIN, min(RING_MAX, cell width, cell height − the caption), …)
```

**`RING_MAX` is 96 design units, and it is a proportion rather than a taste.** The widget
being copied draws a 62pt ring in a 158pt square with 16pt of inset, which comes to 39% of the
widget's width, two of them nearly filling the space between the insets. Home Assistant's small
footprint is a ~246px square rather than 158pt, and 39% of that is 96, so a card at the design
footprint reproduces the reference's proportion. Past that the cap holds: a card dragged wider
than the shape the rings were laid out for gets air rather than dinner-plate rings.

**`RING_MIN` is 40**, which is where an icon at 45% stops being a silhouette you can name. It
is a floor in two senses: no row is kept whose cell could not hold a ring this big, and a box
too small for even one row of them gets the ring anyway and is clipped by `ha-card`. Clipping
is the right failure there: `min_columns` and `min_rows` keep the Layout tab well clear of it,
and a card that answered a squashed box by drawing nothing would look broken rather than
cramped.

**`scale` is spent out of the ring**, which is where this card and the calendar part company.
The calendar answers larger type with fewer rows of it; there is no equivalent here, because
the rows are the devices and §3 caps them anyway. So the same footprint holds the same devices
at every scale and draws them smaller. Which direction runs out first depends on the shape: the
wide card is column-limited, so four captioned rings across 500px come down from 96 to 77 at
130%, while the square runs out of both at once, 70.8 units of column against 71.6 of row,
which is what a square footprint means. A card dragged **taller** gets bigger rings rather than
more of them: the rows are the devices, so there is nothing to fill extra height with.

## 6. The caption, and the name

- `NN%`, `Math.round`ed, no decimal and no space before the `%`.
- **`100%` is set in the same size as `9%`.** The type does not shrink to fit, which is why §3
  prices a captioned column against the width `100%` needs rather than against the reading
  currently on screen; a cell measured against `72%` would clip only on the day the device
  was full.
- `level === null` prints an em dash in the secondary label colour.
- Tabular figures, so the numeral does not shift between 9% and 90%.

**The device's name is never drawn.** It is the cell's `title` and its accessible name, and
that is all. Six names at a size that fits under a ring are six lines of truncated text, and
the icon in the middle of the ring is already the answer to "which one is this". A `show_name`
option is a reasonable thing to want and is not in this version.

## 7. Why the ring is never red

The level is read off the **length** of the arc, which is a quantity. A colour that changed
underneath it would be a second, coarser reading of the same number, one that says "low" at
19% and "fine" at 21% when the arc has already said 19 and 21. And a widget of six devices in
three colours stops being a glance and becomes a thing to interpret.

The traffic light belongs on the automation that fires at 20%, where the colour is about what
to do rather than about what is.

## 8. Worked table

Each row is a test in `layout.test.ts`. The two footprints are the ones the widget is designed
for: **6 × 4** is a ~246px square and **12 × 4** is the ~500 × 248 2:1.

| Devices | 6 × 4 (square)           | 12 × 4 (wide)              |
| ------- | ------------------------ | -------------------------- |
| 0       | `No Devices`             | `No Devices`               |
| 1       | labeled, one ring        | labeled, one ring          |
| 2       | labeled, 2 across        | labeled, 2 across, centred |
| 3       | compact `2+1`, tail left | labeled, 3 across, centred |
| 4       | compact `2+2`            | labeled, 4 across          |
| 5       | compact `2+2`, 4 of 5    | labeled, 4 across, 4 of 5  |
| 6       | compact `2+2`, 4 of 6    | labeled, 4 across, 4 of 6  |
| 9       | compact `2+2`, 4 of 9    | labeled, 4 across, 4 of 9  |

The square's 1 and 2 are the left half of the wide card, percentages and all; that pairing is
the point of the two views, and the reason the caption rule is about a row rather than about a
size.

The bottom three rows are the same two cards. Past four devices nothing about the drawing
changes, at either footprint, and there is a test that says so in exactly those terms: a wide
card given six devices is compared field for field against one given four. §3 has the argument:
four rings is the design of these two sizes, and a longer `entities` is a config waiting for
`large` rather than a card that has to grow.

The square is the one footprint whose row count the box can still change, and only downwards:
at the 3-row floor it keeps its `2+2` even at 130%, with rings at 47, and it takes a genuinely
squashed box to lose the second row.

## 9. Still open

Decided rather than known, each one edit away from being decided differently.

- **`show_name`.** §6 says why it is not the default. As an option it would need a rule for
  what happens when a name does not fit, and the honest one (truncate) is the thing §6 is
  avoiding.
- **A `+N` indicator** for devices that were not drawn. §3 argues it is the wrong shape of
  answer here; the counter-argument is that silence is exactly what the calendar refuses. It
  gets less pressing once `large` exists, since the common reason for a short list is that the
  card has not been dragged to the size the list was written for.
- **`large`.** Two rows of four, which is where the six a config may already name will be
  drawn. It is one entry in `COLUMNS` and one in `MAX_ROWS` plus a second width threshold in
  `core/size.ts`, and the second of those is the part that needs a decision rather than a
  patch: `WIDGET_LAYOUTS` currently has two members and one line to choose between them.
- **Zero-config discovery.** Every other card in the library draws something useful before it
  is configured, and this one cannot: an installation's battery sensors are every remote,
  every valve and every door contact, and no order over them is the order anybody meant. So
  `No Devices` is the honest first frame rather than a shortcoming.
- **A tap opens `more-info` for the device.** Per cell rather than per card, because the card
  has no single subject; six devices behind one dialog would have to pick one, and picking
  the first is a card that opens the wrong thing five times out of six.
