# Calendar widget: the layout rules

Reconstructed from Apple's own Calendar widget and checked against eight screenshots of
it. This is the specification the card implements; the code follows it section by
section, and `src/cards/calendar/*.test.ts` pins the worked examples at the bottom.

Two sizes, matching the two Apple offers on a home screen:

- **small**: the anchor day, and nothing else, ever
- **medium**: two columns of one continuous flow: the anchor day plus what comes after it

The **anchor day** is today, and is today on every card that has not been told otherwise.
§2 has the option that moves it and what moves with it; everywhere else in this document,
read "today" as "the anchor day" unless the sentence is about the clock.

---

## 1. What a row is

```ts
{
  kind: 'event' | 'reminder',
  title: string,
  location?: string,
  start: Date,
  end?: Date,          // reminders have none
  allDay?: boolean,    // belongs to a day, not to a moment
  color: string        // the calendar's or the to-do list's colour
}
```

**Event**: a thin bar down the left, a chip behind the whole row, the title, and the
time. Four things in the calendar's colour and no two of them the same shade of it; the
palette below is how the four come out of the one colour Home Assistant holds.

**Reminder**: a neutral grey background, an empty circle in the list's colour, muted
text. Reminders never show a location.

**A reminder with a date and no time**: the same row with the time line gone, so one line
and 24px, priced exactly like an all-day event (§4). It keeps its circle rather than taking
the badge below: the badge is a calendar, and a to-do is not on one. `allDay` is the flag
for both, because both mean the same thing (this belongs to a day rather than to a moment)
and it is what puts them at the top of their day and prints no time under them. There is
no time to print: `12:00AM` would be an invention, and an invention about the one thing the
reader would act on.

**All-day event**: the chip of an event, but the bar gives way to a filled circle with
a calendar knocked out of it, in the bar's colour, and then the title on one line
with an ellipsis. Nothing else: no time, no location, no expanded form. The badge has to
carry the meaning on its own, because there is no second line left to say "all day" on.
The circle is set concentric with the rounded end of the chip and 2px smaller in radius,
so it clears the chip by the same 2px right around that arc, not on the 10px rail inset
the other rows use, and not flush either: flush, the two rims merge into one edge and
the badge stops reading as a badge. The chip is 24px with a 12px radius, so the badge is
20px with a 10px one, and the row still measures the 24px §4 prices it at.

The calendar is `mdiCalendarMonth`, taken from `@mdi/js` as a path string and inlined.
That is Home Assistant's own icon set, so the badge matches the icons around it on the
dashboard, but it is deliberately not an `<ha-icon>`: rows are priced in pixels here
(§4), and an icon that resolves a frame late out of HA's registry would be measured at
the wrong height. The dev harness has no registry at all, and the screenshots below are
taken in it.

**`2 more events`**: the tail indicator, and the one row the flow can end on that is
not an item: a thin bar in the calendar colour, grey text at a normal weight, and
**no tinted background**, unlike an event. A tint would read as one more event, when the
point of the line is that those did not fit.

### The palette

Home Assistant holds one colour per calendar: the hex the `google` integration seeds, the
token its colour picker writes, or the palette entry `source.ts` deals a calendar that has
neither. The widget needs four out of that one: the bar, the title, the time, and the chip
behind them. Twice over, because a dark theme is not a light one with the numbers nudged.

A **to-do list** has no colour of Home Assistant's own (no registry option, nothing in the
to-do panel), so what it has instead is the colour its owner set in a reminders card, which
this library keeps against the entity under a namespace of its own:
`options.cupertino_widgets.color`. `docs/reminders-widget-rules.md` §6a is the design and
`src/core/entity-color.ts` is the mechanism. That is what makes a shopping list the same
colour here as it is in the widget beside this card, which is the whole point of storing it
where both can read it.

A list with no colour set falls to the palette, at its own position in the card's list of
lists. That is dealt independently of the calendars, so a calendar and a to-do list can come
out the same hue. The alternative, dealing the lists from where the calendars left off, would
make a list's colour depend on how many calendars happen to exist, and the two rows do not
look alike anyway: one has a bar and a tint, the other a circle and grey.

Unlike a calendar's, a list's colour here is **live**: `TodoFeed` maps its rows at publish, so
a colour edited elsewhere repaints the flow rather than waiting for the next reconcile. The
calendars cannot have that as cheaply, since `CalendarFeed` maps a row as it arrives.

The derivation is in OKLCH, and the hue is the channel that never moves. Only `L` and `C`
do, per role, so the four read as one colour at four strengths rather than as four
colours. Written against `L₀` and `C₀`, the calendar's own lightness and chroma:

| Role  | Light                                        | Dark                          |
| ----- | -------------------------------------------- | ----------------------------- |
| bar   | `L₀`, `C₀`, the base exactly                 | `L = max(L₀, 0.68)`, `C₀`     |
| title | `L₀ − 0.29` held in [0.26, 0.48], `0.52 C₀`  | the bar's colour, exactly     |
| time  | `L₀ − 0.135` held in [0.38, 0.62], `0.66 C₀` | `L = L_bar − 0.11`, `0.85 C₀` |
| chip  | `L = 0.97`, `0.08 C₀`                        | `L = 0.28`, `0.25 C₀`         |

The stylesheet calls the bar's colour `--item-accent`, three other things having a use for
it: the reminder circle, the all-day badge, and the bar on `2 more events`.

The asymmetry between the two columns is the substance of the table rather than an artefact
of writing it down. In light every role has a lightness of its own, the bar is the base
untouched, and the title sits 0.29 below it, most of the way to the dark end, and far more
than a text colour usually travels from the thing it belongs to. In dark two roles share
one: the bar and the title are the same lifted colour, and it is the time that steps 0.11
below them.

Two guards sit over the table, and neither is arithmetic the card does at runtime: the
browser owns one, and the constants above have the other pre-solved.

**The gamut.** Moving `L` at a fixed `C` walks colours out of sRGB, so `C` has to come back
down until the result can be drawn, at the same lightness and the same hue, which is the
whole reason for working in this space. The browser does it, `oklch()` being gamut-mapped
when it is painted, and it is not a formality: lifting `--cw-blue` to the dark bar's floor
of 0.68 costs it 0.034 of the 0.218 of chroma it had, and indigo 0.032 of 0.191. At the
light chip's 0.97 there is so little room left that even 8% of blue's chroma is 0.003 over
the edge.

**The contrast.** `|L_title − L_chip| ≥ 0.38`, or the title moves further from the chip.
The constants above are chosen so that it never has to, and the sum is worth keeping
because it is what pins two of them. Light: the title tops out at 0.48 against a chip at
0.97, so the narrowest it comes is 0.49. Dark: 0.68 − 0.28 = 0.40, and that floor of 0.68
_is_ this guard solved, since 0.28 + 0.38 = 0.66 and the floor clears it by 0.02 and by
nothing else. Move the dark chip up or the bar's floor down and this is the line that has
to be redone.

### The values, and where they come from

Two calendars of a real installation: `#EC8834` at L 0.721 C 0.154 H 56, and `#C830DC` at
L 0.615 C 0.259 H 323. What the stylesheet paints for them, read back out of a screenshot
rather than computed: the CSS is the implementation, so a number worked out beside it
would be checking the arithmetic twice and the rendering not at all:

| Base      | Theme | Bar       | Title     | Time      | Chip      |
| --------- | ----- | --------- | --------- | --------- | --------- |
| `#EC8834` | light | `#EC8834` | `#714320` | `#AA6B3C` | `#FCF3ED` |
| `#EC8834` | dark  | `#EC8834` | as bar    | `#BD6C27` | `#372416` |
| `#C830DC` | light | `#C830DC` | `#520F5B` | `#883194` | `#FCF1FE` |
| `#C830DC` | dark  | `#DE4BF2` | as bar    | `#B037C1` | `#381D3B` |

And the same eight roles sampled off screenshots of the widget this copies:

| Base      | Theme | Bar       | Title     | Time      | Chip      |
| --------- | ----- | --------- | --------- | --------- | --------- |
| `#EC8834` | light | `#EC8C34` | `#704418` | `#AC7034` | `#FDF6EC` |
| `#EC8834` | dark  | `#F09034` | `#F09034` | `#C47430` | `#362714` |
| `#C830DC` | light | `#C830DC` | `#54185C` | `#84308C` | `#F9EFFA` |
| `#C830DC` | dark  | `#E43CF4` | `#E43CF4` | `#B034C0` | `#371E3C` |

The recipe is a reading of the second table, so the first agreeing with it is the check and
not the news. The two are within 0.013 of lightness everywhere except the orange calendar's
dark rows, where the sample runs 0.019 to 0.024 lighter; and that same screenshot reads
its light bar 0.007 above a base the rule says it is _exactly_, so most of the gap is in
the sampling rather than in the recipe. That the dark title is the dark bar is the second
table's own finding as much as anything here: in both calendars those two cells are the
same value twice.

**The dark chip is why this is done in OKLCH at all.** The rest of the table could be had
with `color-mix` towards white and towards the surface, which is what the card did before
and what one reading of the screenshots suggests: a chip is the base at low alpha over the
widget's background. It cannot be. The orange calendar's dark chip is `#362714` on a widget
sitting on `#1C1C1E`, so its blue channel has to come out _below_ the surface's, and no
amount of any colour laid over a surface takes a channel below it. A lightness of its own
is the only way to say it.

### What the calendar does not colour

Not everything on the card is tinted, and the two rows that barely are take the bar's
colour and nothing else from the table:

- **Grey text** (section headings, `2 more events`, both empty lines) is
  `--cw-label-secondary`: Home Assistant's `--secondary-text-color` wherever the theme has
  one, and the system's secondary label where it does not. The fallback is what the
  screenshots were sampled at, `#8A8A8E` over a white card and `#98989F` over a `#1C1C1E`
  one against a sample of `#9C9CA0`; Home Assistant's own default light theme draws these
  at `#727272` instead, and is welcome to. What matters is the one thing neither of them
  is: a heading tinted by whichever calendar the day happened to belong to would read as
  an event of that calendar, and the furniture being grey is what leaves a chip something
  to mean.
- **A reminder** keeps `--cw-fill` behind it and spends the list's colour on its circle
  alone, in the bar's shade of it, so it lifts on a dark theme with everything else. A
  reminder is a thing you tick off rather than a span of the day, and the circle is the
  whole of that.
- **`2 more events`** is grey text on no background at all, with its bar in the colour of
  the calendar whose event was the first one not to fit (§5).
- **The all-day badge** is that same bar colour, filled, with the calendar knocked out of
  it in white, not the title's, because the badge stands in for the bar and it is the bar
  it has to agree with.

## 2. Selection and order

### Which rows exist at all

Events come from the `calendar` entities the config names, and every calendar in the
installation when it names none. Reminders work the same way over `todo` entities, with one
question in front of them that the calendars do not have: **whether reminders are drawn**,
which defaults to yes. An empty picker cannot say "none": Home Assistant reports an emptied
entity list as `[]`, which is what "I chose nothing" and "I chose everything" both look
like, so the switch is what says no. Off means not subscribed rather than subscribed and
filtered.

**A to-do item is a row only if it has a due date, and is not ticked off.** The date is what
files it under a day, and a calendar widget has nowhere to put an item without one, which
is most of a real list, so this is the rule that keeps a shopping list from arriving as a
wall of undated rows. A due date with no time on it is a day (§1); a due time is a moment
and prints like one.

### Which days

The card is about **today and the fortnight after it**, and two options move that window.
Both live in the editor's **Advanced** section, folded away, because almost nobody needs
either:

| Option         | Default | Means                                                     |
| -------------- | ------- | --------------------------------------------------------- |
| `day_offset`   | `0`     | Days from today to the first day drawn. `-1` is yesterday |
| `days_to_show` | `14`    | How many days are drawn, counting the first               |

The first day drawn is the **anchor day**, and three things follow it rather than the
clock: the date block prints it (§3), it is the day that gets no heading (§3), and the
empty line names it (§4). `day_offset: 1, days_to_show: 1` is therefore a card that is
about tomorrow in every one of those places, which is the arrangement the option exists
for: three of these side by side, reading yesterday, today and tomorrow.

Both are clamped to ±31 days and 1–31 days, which is the range the editor's two boxes
offer, so hand-written YAML has nothing to reach for that the dialog cannot show. The
small size ignores `days_to_show` and draws one day, exactly as it has always ignored what
tomorrow holds (§4).

**A day in the past is drawn whole.** Rule 2 below retires a row the clock has overtaken,
and applying it to a day already gone would empty the card: everything on yesterday is
over. So it is asked of **today alone**, which is the one day where "what is left" is a
different question from "what happened". A window of `-1` for two days therefore shows the
whole of yesterday and only the rest of today, and those are the two readings each of
those days wants.

### Order

1. The window above, and nothing outside it. Something with a duration that began before
   the window is filed under the first day of it, so a trip that started on Monday is what
   Wednesday is about too.
2. Anything the clock has overtaken is dropped, and a meeting is overtaken **halfway
   through it**: at ten past two you are already sitting in the two-to-three, so the row
   worth having is the one after it. Holding it to 3PM is more literal, and it is what this
   card did first; what it cost was the second half of every appointment, spent describing
   where the reader already is. Two shapes keep their full end, half of them being no sort
   of deadline: an **all-day entry**, whose half is midday and which is about the day rather
   than a moment in it, and a **span across midnight** (an overnight shift, a multi-day trip
   with times on it), which the flow is still filing under today for being under way, and
   which the reader is on rather than done with. Only a real end time retires a row at all,
   so an overdue reminder stays up for the rest of its day.
3. Inside a day: all-day first, then by start time. Reminders and events share one
   stream: `Pick up dry cleaning 10:30` comes before `Language class 12:00`, and it is
   not shunted into a section of its own. A reminder due on a date with no time is one of
   the all-day rows, so it sits with them at the top rather than at midnight.
4. Sections are calendar days. **A day with nothing in it disappears entirely**,
   heading and all: if today is Friday and Saturday is empty, the next heading is
   `SUNDAY, 26 JUL`, not an empty Saturday.

Everything above is answered in the _display_ timezone: Home Assistant lets a profile
follow the server's zone rather than the browser's, and "is that tomorrow" has a
different answer in each.

## 3. Headings

**The widget's own date**, top left, always: the weekday in capitals in the accent
red, and the day number, large. The **anchor day**, whether or not it has anything in it,
which is today on a card that has not been sent anywhere else (§2). It stays red wherever
it is pointed: red is the card's, not today's.

**Section headings**, in the flow, medium only:

| Section                     | Heading                           |
| --------------------------- | --------------------------------- |
| the anchor day              | none, the date block already said |
| exactly one day after today | `TOMORROW`                        |
| today                       | `TODAY`                           |
| exactly one day before      | `YESTERDAY`                       |
| anything else               | `SUNDAY, 26 JUL`                  |

The three words are relative to **today**, not to the anchor day, and the top row wins:
a card anchored on tomorrow heads no section `TOMORROW`, because that section is the one
the date block is already speaking for. `TODAY` and `YESTERDAY` can only arise on a card
whose window starts before today, which is what `day_offset: -1` does. Two days out in
either direction is a date: `in 2 days` is a duration where a heading wants a day, and the
word only exists in some languages anyway.

Headings are small and grey, never a calendar colour, and follow the locale's own
day/month order (`JUL 26` in en-US); the three words are the locale's too.

## 4. What each size shows

**Small**: the anchor day. If it is empty: the empty line, below. Other days never appear,
not even when it is empty and the next one is full, and not even when `days_to_show` asks
for more.

**Medium**: two columns holding one vertical flow that spills from the left column
into the right:

- left: the date block, and the start of the flow beneath it;
- right: the same flow continuing, the rest of the anchor day first, **with no heading**,
  then the next day's heading and its rows;
- if the anchor day is empty, the left column reads the empty line under the date and the
  flow starts at the top of the right column.

**The empty line** says which day is empty, and on today it says which kind of empty:

| The anchor day                               | Line                   |
| -------------------------------------------- | ---------------------- |
| today, nothing on it, and nothing was        | `No Events Today`      |
| today, had something, all of it already over | `No More Events Today` |
| tomorrow                                     | `No Events Tomorrow`   |
| yesterday                                    | `No Events Yesterday`  |
| any other day                                | `No Events`            |

The distinction between the first two rows is only ever worth drawing on today: yesterday
is finished by definition, so `No More Events Yesterday` would be saying nothing, and
tomorrow cannot be. Past the day either side, the date block above the line has already
named the day better than a relative word could, so the line stops trying.

"Already over" is §2's own rule read backwards: the same events that drop out of the flow
during the day are what turn the line into `No More Events Today`, so it arrives when the
last of them is half over rather than when it ends. `No More Events Today` while that
meeting still has twenty minutes to run is the rule saying what it means: there is nothing
after this one. An entry with no end time never retires and so never produces the line, and
the end that dates a retired row is the exclusive one: an all-day entry for yesterday ends at
today's midnight and is still yesterday's.

## 5. The height budget

The unit is one line of text inside the card.

| Element                                      | Cost |
| -------------------------------------------- | ---- |
| compact row (title + time)                   | 2    |
| expanded row (title + location + time)       | 3    |
| all-day row (title alone), reminder or event | 1    |
| section heading                              | 1    |
| `2 more events`                              | 1    |

| Column               | Budget |
| -------------------- | ------ |
| small                | 4      |
| medium, left column  | 4      |
| medium, right column | 7      |

A node goes in the current column if it fits there whole; otherwise the next column takes
it. **A heading and the first row of its section are one unit.** The heading asks for its
own row and that row together, and where the two will not fit, the whole section starts the
next column while the rows the heading passed over are left blank. The widget glues the
pair, and this is the reading that makes it worth the wasted rows: a day whose name is at
the foot of one column and whose first event is at the head of the next is a day nobody
reads as one day.

The row a heading arrives with is usually its first event, and at the end of the flow it can
be the count instead. `WEDNESDAY, 29 JUL` over `1 more event`, with not one of that day's
events on screen, is a section saying how much of itself did not fit, and that is a row of
the section as much as an event is. So the pair holds and both screenshots are satisfied by
it: what is held back is a row of the day rather than the day's first event. That pair costs
two rows and buys them the way the tail buys its one, below: a location line may pay for the
second, an event never does. And the count belongs to the end of the flow, so no column the
flow carries on past ever ends on a heading.

The pair is priced at what its first row costs _plainly_: an all-day entry's one row or a
timed event's two, never the three a location would like. A day that started in one column
or the other depending on whether its first event happened to name a street would be the
packing showing through, and the location is dropped under §6's own rule instead.

### The tail

One row, at the end of the flow (meaning the last column the flow actually reached, not
whichever column happens to have space left in it), and it speaks for **one day**: the
section it is drawn inside.

`N` is the rest of that section. The items counted are the ones of that day that did not
fit, read up to the next heading and no further, and the days past the cut are not
summarised at all. A calendar carrying a month of recurring events used to read
`90 more events` under `TOMORROW`, which is a true statement about the loaded fortnight
and a nonsense one about tomorrow; two of tomorrow's five events drawn under that heading
is `3 more events`. Headings do not count either, for the same reason they end the count:
a section that got cut takes its heading with it, and `2 more events` that meant "one
event and one Thursday" would be a lie. The row's own section is the exception it has to
be: where the count stands in for the first row of a section (above), that section's
heading is drawn over the count rather than counted in it. Singular is `1 more event`.

The indicator costs a row like everything else, and on a column that came out exactly full
it buys one, cheapest first:

1. the last location line drawn in that column gives way (§6's third line, handed back);
2. failing that, the last event drawn steps aside and joins the count.

A count arriving with its own heading (above) costs two rows and shops from the same list,
with the second line struck out: one location may go on it and an event may not, so a
column with nothing spare at all cannot reach it and the day goes unmentioned.

What it will not buy is its own section's last visible row. If what sits above the event it
would evict is a heading, or there is nothing above it at all, the event stays and the
widget says nothing. The second of those would leave a column holding a count and no
calendar, which is worse than a quiet one. The first is not about the shape that comes out
but about the price: `TOMORROW` over nothing but a count is a legitimate shape when spare
rows paid for it, and tomorrow's one readable event (its title, its time) is too much to
pay for the same row when it is not going spare.

The count-and-no-calendar half is a rule about the column and not only about the trade, so
it holds where the count would have come free as well: a column too short to have fitted an
event (one row, which the 3-row footprint reaches at 110% and up) says nothing rather
than standing the count on its own. Otherwise the size would contradict itself as it
shrank, three rows drawing the event and the count, two keeping the event quietly, and one
dropping the event to announce it.

**This is the one place the card knowingly departs from the widget it copies.** Apple adds
the indicator out of whatever is left over and never takes a row back, which is why
`Training` simply vanished in the third and fifth screenshots: the right column was
occupied to exactly seven rows. An event that is neither on the card nor in a count is one
the reader has no way to know about, and a widget that cannot be trusted to be complete is
one you open the calendar app behind anyway.

In the small size that trade is at its most expensive, and the answer is the same. The
indicator beats §6's locations to a leftover row: "count wins" is about how much of the
day you know about, not how much of it is drawn, and where there is no leftover row it
beats the second of two events as well: four rows and three timed events come out as one
event and `2 more events`. A row an eviction frees and the count does not need is slack
like any other, so a location on the event still standing takes it (`3 + 1`) rather than
leaving white space at the foot of the column.

### Where those numbers come from here

Apple can hardcode 4 and 7 because an iPhone widget is always the same number of
points tall. A Home Assistant card is whatever the user dragged it to, so `layout.ts`
measures instead. A row is priced at 31px: half of a compact row's 56px plus the 6px
gap beneath it, which is the dearest any kind of row gets per row, so no mix of them can
overflow. The right column fits `floor((content + 6) / 31)` of those; the left one is
short by the 84px date block above it. At the default card height of 248px that works out
to exactly 4 and 7, and a card dragged taller shows more rows rather than leaving a blank
strip at the bottom.

Two pixels of that arithmetic are easy to lose, and losing either one clips a descender
off the last row of a column packed exactly full:

- `content` is the card's measured height less the 16px inset **and less the 1px border
  `ha-card` draws top and bottom**, because it is `box-sizing: border-box`, so the border
  comes out of the height, not on top of it.
- a compact row is 56px only while the AM/PM keeps out of the line box. A smaller font in
  the same line gets a larger half-leading and hangs below the strut, which made the time
  line 22px instead of 20 and the row 58px on any 12-hour clock; the `.meridiem` rule
  zeroes its line-height to take the box back out of the sum.

### And at another scale

`scale` (the one option in this library that is about the room rather than the data)
multiplies everything the card draws: 56px, 31px, 84px, 16px and every type size are
**design units**, and at 120% they are drawn at 120% of themselves. `ha-card`'s border is
not, because it is Home Assistant's and it stays 1px.

So `geometryFor` takes the pixels off for the border, divides what is left by the factor,
and hands the numbers above a box in the units they are priced in. Nothing else in this
section changes, and that is the point of dividing the box rather than scaling six
constants: there is one conversion to get wrong instead of six, and the numbers here go on
matching the CSS that draws them.

Two consequences worth stating, because both are the widget behaving and both look like
bugs from a distance:

- **Size costs rows.** The same footprint holds 4 and 7 rows at 100%, 2 and 5 at 130%, 6
  and 9 at 80%. A card scaled up wants dragging taller in the Layout tab; scaled down, it
  fills the height it already has with more of the day.
- **Size can change the layout.** §4's threshold is a statement about type: two columns
  of event rows need so much room before every title truncates, so it too is compared in
  design units. Scaled up far enough, a card that had two columns folds to one; scaled
  down, a narrow one unfolds. The range `scale.ts` permits is chosen to keep the two
  designed footprints, 6 × 4 and 12 × 4, in the layouts they were designed for at every
  value it offers, and `scale.test.ts` holds it to that.

## 6. When a location shows

The location is a third line, drawn only when the item has one and there is room. The
two sizes disagree on purpose:

- **Medium: greedy, location wins.** Going top to bottom: if an event has a location
  and three rows fit in what is left of the column, draw it expanded, even though the
  next event will be pushed into the other column or off the card entirely.
- **Small: count wins.** Pack everything compactly first, then spend whatever budget
  is left over on locations, top down. One event → 3 rows, location shown. Two timed
  events → `2 + 2`, no slack, so neither shows a location even though the first one
  would have fitted. The rule is about the slack and not about the count, though: an
  all-day entry and a timed event come to `1 + 2`, and the row that leaves over does buy
  the location. The tail indicator draws from the same slack and is served first (§5).

Neither size ever expands an all-day entry: it has no expanded form, so both the greedy
medium pass and the small slack pass step over it.

Location and title are each one line, truncated with an ellipsis.

## 7. Time

- 12-hour or 24-hour per the locale, AM/PM a size down. The card's `time_format` pins it
  when set to `12` or `24`; `system` and an absent key both defer to the Home Assistant
  profile, whose own detection can only read the browser's locale (see
  `TIME_FORMAT_OPTIONS` in `datetime.ts` for the case that motivates the override).
- `:00` is not printed on a 12-hour clock: `5 – 6PM`, `3 – 4:30PM`. A 24-hour clock
  keeps its minutes: `17 – 18` would read as a range of numbers.
- The meridiem prints **only on the end of a range** while both ends are in the same
  half of the day: `12 – 1PM`, `6:15 – 7:15PM`. Different halves, and both get one:
  `11AM – 1PM`.
- The separator is a spaced en dash.
- No duration (a reminder, a zero-length event) prints one time: `10:30AM`.
- All-day prints no time at all, and no location either, one line of content, costing
  the one row (§5).

## 8. Worked examples

Each of these is a test in `layout.test.ts`. A column is written as the cost of each
row in it, in order. Tomorrow is three more rows in every case.

| Today                             | Left  | Right     | The tail                           |
| --------------------------------- | ----- | --------- | ---------------------------------- |
| 3 events, no locations            | `2+2` | `2+1+2+1` | full column: an event buys the row |
| 2 events                          | `2+2` | `1+2+2+2` | everything fitted                  |
| 1 event with a location           | `3`   | `1+2+2+2` | everything fitted                  |
| 2 events, a location on the first | `3`   | `2+1+2+1` | full column: an event buys the row |
| 2 events, a location on both      | `3`   | `3+1+2+1` | that last `1` is `2 more events`   |
| all-day + 1 event with a location | `1+3` | `1+2+2+2` | everything fitted                  |

The first and fourth rows are the two the screenshots disagree with, and §5 says why: Apple
came out at `2+1+2+2` there and let tomorrow's third event vanish, where this card ends the
column on `2 more events`: the event that had been drawn last is the one that paid for it.
Both are still cut mid-tomorrow, so both counts are tomorrow's own.

The third row is where the pair costs a row and the screenshot agrees that it should: the
location takes three of the four in the left column, and the one left over is not enough for
`TOMORROW` and the event under it, so tomorrow starts the right column and that row is spent
on nothing at all.

The fifth row is the seventh screenshot, and it is worth reading twice: the location
`Focha 4, Warsawa` on the second event is what cost tomorrow two of its three rows.
Greedy locations are paid for in events (§6), and the indicator is how the widget admits
it, here out of a row that was going spare, with nothing to buy.

The sixth is the eighth screenshot, and it is the same trade read the other way: the
all-day entry costs one row instead of two, and that saved row is exactly what pays for
`Warsawa Główna` underneath the event below it. The same day in **small** comes to
`1 + 3`: two items _and_ a location inside four rows.

## 9. What a tap opens

**The row is the tap target, not the card.** A widget-sized card holds up to eight rows, and
one press effect over all of them says the card is one thing to press when it is a list of
them: the surface dipped under a finger aimed at a single event and then opened nothing. So
`cw-pressable` is on the chips, one at a time, and `ha-card` carries none.

A heading is not tappable, and neither is the date block. Nor is the tail indicator, and that
one is a decision rather than an omission: the line exists to say those events did **not** fit,
and giving it a row's feedback would make it read as one more of them.

**An event opens the calendar.** `/calendar`, which is the whole of what Home Assistant's
calendar panel can be sent to: it reads nothing out of the URL, so there is no addressing a
date or an event, and which calendars are shown lives in its own local storage. It opens on
today, which is the day the widget is usually about, so the gap between this and a deep link
is narrower than it sounds. A card sent elsewhere by `day_offset` is the one case where the
panel lands on a different day from the row that was tapped, and there is nothing to be done
about it: the parameter does not exist.

**A reminder opens its own list.** `/todo?entity_id=todo.…`, and the parameter is the point:
`ha-panel-todo` remembers the last list the user looked at, so `/todo` on its own would open
whichever that was rather than the one the row came from. That is what `CalendarItem.entityId`
is for: the row has to carry the list it belongs to all the way from the subscription.

Both are a history push and a `location-changed` event rather than a link or a document load,
which is the difference between a page the app already has and the whole frontend again.
`core/navigate.ts` has the mechanism and `docs/ha-api-notes.md` has what it was verified
against, including why an `<a href>` could not do it.

**A page that is not there does nothing.** The panel is only registered while its integration
is loaded, so the card asks `hass.panels` first and a row whose page is missing declines
rather than landing the user on a not-found screen. Thin in a real installation: a card
drawing `todo.…` rows is one whose `todo` integration is loaded. It is also what keeps a
tap in the showcase to its press effect, since a page with cards on it is not a Home Assistant
and has no panels at all.

Keyboard: a row is `role="button"` with `tabindex="0"`, and Enter or Space opens it. Both are
swallowed, because Space would otherwise scroll the dashboard and Enter would submit whatever
form the card is sitting inside.

## 10. Still open

No screenshot settles either of these, so they are decided rather than known. Each is one
edit, the trade in `addMoreRow` and the wording in `moreLabel`, and the current answer is
whichever keeps the rule simplest to state.

- **What to call them.** Always `events`, even when everything hidden is a reminder.
  `2 more items` would be truthful and is uglier.
- **What the indicator is worth in the small size.** It is worth an event there, same as
  in the medium size (§5), which is the most expensive answer available: four rows hold
  two events, so the third one costs the second one. The alternative is to buy the row
  only where it is free (a location line, or slack) and go quiet on a full column, which
  is what Apple does and what this card did until the count stopped over-reporting.

Two questions used to be open here, and both are settled.

**How far `N` reaches**: the section the row is drawn inside, and nothing beyond the next
heading.

**What a heading has to arrive with**: a row of its own section, which is its first event or
the count standing in for it (§5). The two screenshots only looked opposed while the
question was being asked about the first _event_, and neither of them answers that one.
`WEDNESDAY, 29 JUL` over `1 more event` keeps its heading, the spare row at the foot of §8's
third left column goes to nobody, as that screenshot has it, and the rule is still one line.
What it gives up is the rows a split heading used to save, and those were rows the reader
paid for in a day that arrived in two pieces.
