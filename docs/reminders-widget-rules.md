# Reminders widget: the layout rules

Reconstructed from the phone's own Reminders widget. This is the specification the card
implements; the code follows it section by section, and `src/cards/reminders/*.test.ts` pins
the worked table at the bottom.

Three shapes, and the card chooses between them rather than being told:

- **small**: a square. The name and the count share one line, then the rows.
- **medium**: the 2:1 band. The badge, the count and the name are a column to the left of the
  rows.
- **large**: a panel. The count and the name at the top left, the badge at the top right, a
  hairline, then the rows across the whole width.

Read [`calendar-widget-rules.md`](calendar-widget-rules.md) first if you want the library's
sizing story; the short version is that Home Assistant owns the footprint and the card
measures the box it ended up in. Where this card sits between the other two is worth stating
early:

> The calendar's content is a **stream** and its box arithmetic is a budget. The battery
> card's content is **exactly the devices the config names**, so its box settles only how
> large and in how many rows. This card is the calendar's kind: a to-do list is as long as it
> is, rows really are cut for want of room, and the box decides how much of the list is on
> screen. What it is not is a _flow_: every row is the same kind of row, so there is a budget
> and no packing pass to spend it.

---

## 1. What a row is, and what a list is

```ts
{
  id: string,                              // the uid, or the summary when there is no uid
  title: string,                           // the item's summary
  status: 'needs_action' | 'completed'
}
```

Items arrive over a `todo/item/subscribe` websocket subscription, one per list, and that is
the only way to have them: a to-do entity carries no item data in its attributes at all.
`TodoListEntity` defines no `state_attributes`, no `capability_attributes` and no
`extra_state_attributes`, and none of core's twelve to-do platforms adds any. Each push is a
full snapshot rather than a delta, and every mutation produces one.

**`id` does three jobs and is therefore one field.** It is the keyed-render identity, it is
what the five-second linger pins on, and it is what `todo.update_item` is addressed with. That
last one decides its value: the service resolves its `item` field through
`_find_by_uid_or_summary`, which matches `value in (item.uid, item.summary)`, so a uid where
the store keeps one and the summary where it does not are both things the service accepts. Two
items with the same summary on a list that keeps no uids are one identity here and the service
ticks off the first of them; every core platform keeps uids, so that is the shape of a
hand-rolled integration rather than of anything shipped.

**An item with no summary is not a row.** `TodoItem.summary` is `str | None`, and there is
nothing to draw. **An item with no `status` is a row, and it counts as still to do**: the field
is `Optional` on the dataclass, Home Assistant's own card gives those items a section of their
own, and being on a to-do list is the only claim this widget makes about one.

**The order is the list's own.** It is the order the subscription pushes, which is the order
the list is kept in and the order `todo.move_item` rearranges. Nothing here sorts, not by due
date and not by title: a to-do list is already somebody's arrangement of itself, and a widget
that reordered it would be showing a different list from the panel a tap on it opens.

**The list's name** is `attributes.friendly_name`, falling back to the entity id.
**The badge's glyph** is `attributes.icon`, falling back to `mdi:clipboard-list`. Almost no
list has one of its own: the glyph the frontend draws a to-do list with everywhere else comes
out of the domain's `icons.json` and is resolved frontend-side, so it never reaches
`attributes` and the fallback is not an edge case, it is the normal path.

**One list per card.** The whole heading is a name over a count of that name's items, so a card
over two lists would have to be told what to call itself, what its number meant, and which of
the two a tap opened. Two lists are two cards, which is also how the reference does it. This is
the opposite choice from the calendar card's `todo_entities`, and the two are consistent: that
card pours several lists into one flow of days, and this one is a portrait of a single list.

## 2. What each size shows

The three are the reference's three, and the differences between them are differences of
arrangement rather than of content.

**small** has no room for a badge, so it has none. The name and the count share the heading's
one line, name left and count hard right, both at `--cw-text-headline`. There is no rule under
it: the gap between rows is what separates the heading from the first of them.

**medium** is the only one whose heading is a column rather than a band. The badge sits at the
top of it and the count and the name at the foot, which is the reference's arrangement and the
one that leaves the rows the full height of the card. The column is a fixed 80 design units
with 20 between it and the rows: what it holds is two lines of type, so the room they need is a
property of the type rather than of the card, and a fraction of the width would re-wrap the
name at every footprint. A name that does not fit on one line gets a second and then stops; a
third would push the count off the bottom of a column it shares.

**large** is the only one whose rows get the whole width, and that is what it is for. The count
goes on its own line at `--cw-text-title-1`, the name under it, the badge opposite, and a
hairline separates the heading from the list.

## 3. The height budget

```
content = (box height − 2 × border) / scale − 2 × inset
rows    = floor((content − heading + GAP) / (ROW + GAP))
```

The border comes off in real pixels and the inset in design units, in that order, for the
reason the other two cards spell out: the border is Home Assistant's and is drawn at 1px
whatever the widget inside is scaled to, so it is not one of the lengths `scale` moves.

`ROW` is 24 and `GAP` is 16, so rows sit on a 40-unit pitch. The `+ GAP` in the numerator is
because the last row has no gap under it. `ROW` is also the tick's diameter, and it is taller
than the 22 line box the title sets in: the circle is the tallest thing on a row, so letting
one number be both is what stops a row being taller than anything in it.

**Where the 40 comes from, because it is the number that decides everything else.** Home
Assistant's square is 214 design units of content where the reference widget's is 126, so a
card that simply filled the box drew five items in the square where the phone draws three, at a
density that reads as a list rather than as a widget. In the square the gap cancels out of the
budget (the heading spends one and the last row saves one), so the count there is exactly
`floor(192 / (ROW + GAP))`: 34 gives five, and anything from 39 to 48 gives four. 40 is the
shallow end of that range and the compromise worth taking. The reference's three would want 48,
which is a widget mostly made of air at every other footprint, and it is reachable anyway by
turning `scale` up: at 130% the square draws three.

The heading costs, in design units:

| Shape  | Costs | Made of                                                                         |
| ------ | ----- | ------------------------------------------------------------------------------- |
| small  | 38    | one 22 line box, then the row gap                                               |
| medium | 0     | it is beside the rows, not above them                                           |
| large  | 77    | 34 for the count, 22 for the name, then 8 + 1 + 12 for the rule and its margins |

The 12 under the rule did **not** follow `GAP` up to 16, and that is load-bearing twice over. A
gap between two rows is doing the separating alone, where here there is a line doing it, so the
air around it can be less. And it is what keeps the large view from costing a row at the
footprint it arrives on: see §7.

**Nothing is ever cut for width.** A title that does not fit is truncated with an ellipsis on
its own line, which is what the reference does and what the row's single line makes possible.

**There is no `+N` indicator**, and unlike the battery card this is not a matter of taste: the
count over the list already says how many things are still to do, so a card drawing three rows
under an `8` has already reported that five are not on screen. A `5 more` under them would be
the same fact a second time, in a row that could have held one of the five.

**`scale` is spent out of the rows.** Larger type means fewer of them in the same box, which is
the calendar's behaviour rather than the battery card's: there is nothing here to draw larger
instead, because a row is a line of text and a circle.

## 4. The count, and where it comes from

The number over the name is counted from **the same snapshot the rows come from**, adjusted by
the pins of §5. It is deliberately not read off the entity's state, even though the state is
exactly this number: `TodoListEntity.state` is `sum(item.status == NEEDS_ACTION)`, stringified.

Two reasons, and the second is the one that decides it.

The state counts `needs_action` alone, so an item whose `status` is `null` is drawn by this
card and counted by nothing. A widget whose number disagrees with the rows under it is worse
than one that is a moment out of date.

And a pin has to be able to move it. Ticking something off decrements the count under the
finger while the row is still on screen, which is what the reference does, and the entity's
state cannot say that: it will have already dropped, or not yet, depending on a round trip.

What that costs is one frame. Before the first push there is no snapshot and so no number, and
the heading holds its line box empty rather than showing a `0` that is about to be wrong.

## 5. Ticking something off

A tap on a row calls `todo.update_item` **immediately**, and the row is then held on screen for
five seconds by a **pin**: a note against that item saying what the tap asked for. A second tap
inside those five seconds pins the opposite and calls the service again with it. After five
seconds the pin lapses, and a row the snapshot says is completed is gone.

**The five seconds cannot be a delay before the call, and that is a fact about Home Assistant
rather than a preference.** `local_todo` ends `async_update_todo_item` with
`async_update_ha_state(force_refresh=True)`, which reaches `async_update_listeners()`, so the
subscription pushes a snapshot already saying `completed` before `callService` resolves. There
is no window in which a card could sit on the change and still be describing the list. Holding
the call would also lose the tick if the dashboard were left inside the five seconds, and would
tell no other Home Assistant client anything for as long.

So the pin does three jobs at once, which is the argument for it being one mechanism:

- the row stays put instead of vanishing under the finger;
- the tick appears on the tap rather than a round trip later, because while a pin is live it is
  what the row is drawn from;
- a failed call rolls back by dropping the pin, and there is nothing else to undo.

The payload is `item` and `status` and nothing else. `todo.update_item` is a partial update
server-side: it starts from `asdict` of the item it found and overwrites only what was sent, so
a due date and a description this card never reads are left alone. Home Assistant's own to-do
card re-sends the summary and both date fields alongside the status, and that is the one thing
here that deliberately does not copy it. Re-sending a field the card did not read is how a card
corrupts one.

**A list that will not accept an update answers no tap.** The service is registered with
`required_features=[TodoListEntityFeature.UPDATE_TODO_ITEM]`, so calling anyway raises
`ServiceNotSupported`, and because `hass.callService` notifies before it re-throws the user
gets a ten-second red toast for their trouble. So the rows lose their `role`, their `tabindex`,
their handlers and the press effect. What they keep is the circle, which Home Assistant's own
card also does: it disables its checkboxes on this flag rather than removing them, and a row
without one would read as a different kind of row rather than as the same row that will not
move. The difference is real and it is invisible in a screenshot; the DOM is where it shows.

**The row is the tap target, not the circle.** A 24-unit circle is a miss waiting to happen on
a phone, and the reference takes the whole row too.

## 6. What the widget does not draw

**No repeat glyph.** The reference draws one on recurring reminders, and Home Assistant has
nothing to draw it from: `TodoItem` is exactly `summary`, `uid`, `status`, `due`, `description`
and `completed`, and there is no recurrence field of any kind, in core or in the frontend's own
to-do card, panel and item dialog. This is not a thing to add later; it is a thing that does
not exist.

**No due date.** It is on the wire and it is not read, which is the whole difference between
this card and the calendar's reminder rows. There, an item without a due date has no day to be
filed under and is dropped; here the list is the list, and a date under every title would be a
second line the reference does not draw and a row twice as expensive. `src/cards/calendar/` is
where a to-do item's date earns a row.

**No description, no colour.** The description is a second line by another name. A colour would
have to be invented: a to-do list has none anywhere in Home Assistant, so the purple is the
reference's own rather than anything inherited, and `--cw-accent` would make the heading the
user's primary colour, which is a different card in every installation.

## 7. Why the third size is decided in the card

`core/size.ts` knows two layouts and one threshold, and the threshold is on the width alone.
That is deliberate for the two cards that came before: for them, height feeds the row budget
and never the shape. This card's third size is not a wider card, it is a taller one, so the
view is decided in `layout.ts` and `viewFor` is a refinement of `layoutFromBox` rather than a
second opinion about it. The width half is that function's answer unchanged; the height only
ever splits its `medium` in two.

Kept local rather than added to `WIDGET_LAYOUTS`, because a third member of that union is a
`Record<WidgetLayout, number>` entry the battery card would have to be given, which means
designing a `large` battery card in order to get a `large` reminders card: a change to a widget
nobody asked to change, taken on the way past.

**The threshold is 340 design units of height, which is `LAYOUT_THRESHOLD` used in the other
direction.** The library already has a number for how much room a widget needs before it stops
being cramped; asking it about the height as well as the width says that a large card is one
that is roomy both ways, which is what the reference's large widget is.

It lands well. The large view's heading band costs two rows against what the same box would
hold in the wide arrangement, and at the footprints the Layout tab actually stops on, that cost
falls between two stops and is never paid: a 12 × 5 card draws seven rows in the wide
arrangement and a 12 × 6 card draws seven in the large one, having gained 100 design units of
title width on each of them. That is not luck, and it did not survive the row pitch growing on
its own: it is `RULE_BELOW` staying at 12 while `GAP` went to 16 that holds the second of those
numbers where it is. A heading band that cost a row to gain the width would be a card that got
smaller as it got bigger.

## 8. Worked table

Each row is a test in `layout.test.ts`. The boxes are what Home Assistant's sections grid gives
those footprints in a section of the usual 500px: 12 columns, 56px rows, 8px gaps.

| Footprint | Box       | Draws          |
| --------- | --------- | -------------- |
| 4 × 3     | 161 × 184 | small, 3 rows  |
| 4 × 4     | 161 × 248 | small, 4 rows  |
| 6 × 3     | 246 × 184 | small, 3 rows  |
| 6 × 4     | 246 × 248 | small, 4 rows  |
| 6 × 8     | 246 × 504 | small, 11 rows |
| 9 × 4     | 373 × 248 | medium, 5 rows |
| 12 × 3    | 500 × 184 | medium, 4 rows |
| 12 × 4    | 500 × 248 | medium, 5 rows |
| 12 × 5    | 500 × 312 | medium, 7 rows |
| 12 × 6    | 500 × 376 | large, 7 rows  |
| 12 × 8    | 500 × 504 | large, 10 rows |

The square is 6 × 4, which is the footprint the reference's small widget maps onto, and it draws
four rows against the reference's three. Home Assistant's square is a good deal taller than the
phone's, so the two cannot both be had: the pitch is what §3 sets, and four is where it lands.
Three is still reachable, by turning `scale` up rather than by a rule about that footprint.

A narrow card is never large, however tall it is dragged. 6 × 8 is a column of eleven rows under
a one-line heading, which is a perfectly good widget and is not a shape the reference has.

At 130% the wide card comes down from five rows to four, and at 80% it goes up to seven. That is
the whole of what `scale` does here.

## 9. What a tap opens

The count, the name and the badge all open `/todo?entity_id=<this list>`, which is the panel's
own address for a list: `ha-panel-todo` reads `entity_id` off the query string on its first
update and writes it back when the user picks another. Without the parameter the panel opens
whichever list was looked at last, out of local storage, so it is not a courtesy but the
difference between opening this list and opening a list.

The count and the name are one tap target and the badge is a second, both reaching the same
page, which is the ordinary shape of an icon and a title both linking to the thing they name.

Two guards, and they fail differently. `hass.panels.todo` has to exist, because a panel is only
there while its integration is loaded, and that check is also what keeps a tap in the showcase
(whose mock `hass` has `panels: {}`) to its press effect. And the entity has to be in
`hass.states`, because `ha-panel-todo` assigns a URL-supplied `entity_id` without checking it
exists: a config that outlived its list would open the panel on nothing at all, and catching
that is the card's job rather than the panel's.

Navigation is a history push and a `location-changed` event on the router's window, never an
`<a href>`; `core/navigate.ts` has the argument.

**A card whose list is not in `hass.states` draws `No List`**, the same as one with nothing
configured. There is nothing to name and nothing to count, and naming a deleted list over an
empty widget would be worse than admitting there is none. A list that is there and has nothing
outstanding draws its heading and `No Reminders`, which is the reference's own wording.

## 10. Still open

Decided rather than known, each one edit away from being decided differently.

- **The five seconds are not configurable.** It is the one number in this card that is a
  promise to the user rather than a consequence of the box: long enough to notice the row you
  did not mean to tick and reach it, short enough that a widget does not become a list of
  things you have already done. An option would be a second question about a behaviour most
  people will never think about.
- **Nothing can be added from the widget.** `todo.add_item` exists and `CREATE_TODO_ITEM` is a
  flag that could be tested, but a text field is not a thing this shape of widget has, and the
  panel a tap opens is one press away.
- **No due dates, ever?** §6 says why not, and the counter-argument is that an overdue reminder
  is exactly what somebody puts this on a dashboard for. If it arrives it should arrive as the
  reference draws it, a small red second line, and it doubles the price of a row, which is a
  change to §3 and not only to the template.
- **The purple is fixed.** Two reminders cards side by side are two purple cards, and a
  `color` option is the obvious answer. It is not here because a to-do list has no colour in
  Home Assistant to inherit, so the option would be a preference with nothing behind it, and
  because the calendar card's positional palette is the wrong shape for a card that shows one
  list.
- **`preview` is not a fixture door.** This card ships none at all, like the battery card: its
  demo data is mock entities in `dev/`, which is the better arrangement wherever a card can
  manage it, and everything this one draws comes out of `hass`.
