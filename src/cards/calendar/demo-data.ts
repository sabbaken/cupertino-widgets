/**
 * TEMPORARY: goes away with the websocket subscription.
 *
 * Hand-built days that exercise every branch of the layout: an empty today and a
 * finished one, a skipped empty tomorrow, locations that fit and locations that do not,
 * reminders mixed into the same stream as events (due at a time and due on a date, which
 * are two different rows), an all-day entry, and a tail that runs out of column.
 *
 * Times for *today* are anchored to the current clock rather than written out, so the
 * card still has something to show at four in the afternoon, and, since the spacing
 * shrinks with what is left of the day, at eleven at night as well. Later days use plain
 * clock times, so nothing filters them out.
 */

import type { CalendarItem } from './model'

const WORK = 'var(--cw-orange)'
const HOME = 'var(--cw-blue)'
const SPORT = 'var(--cw-green)'
const LIST = 'var(--cw-purple)'

const HOUR = 3_600_000

/** Local midnight `offset` days from now. */
const midnight = (now: Date, offset: number): Date => {
  const date = new Date(now)
  date.setHours(0, 0, 0, 0)
  date.setDate(date.getDate() + offset)
  return date
}

/** A clock time on a later day. */
const on = (now: Date, offset: number, hours: number, minutes = 0): Date => {
  const date = midnight(now, offset)
  date.setHours(hours, minutes, 0, 0)
  return date
}

/** `now` rounded up to the next half hour: the anchor for everything happening today. */
const soon = (now: Date): Date => {
  const date = new Date(now)
  date.setSeconds(0, 0)
  date.setMinutes(date.getMinutes() > 30 ? 60 : 30)
  return date
}

/**
 * How many steps of today the widest scenario below lays out.
 *
 * `after(base, 5)` is the furthest any of them reaches, plus one step of headroom so that
 * last event ends before midnight rather than exactly on it.
 */
const TODAY_STEPS = 6

/**
 * One step of today's clock: an hour, or an even share of what is left of the day when
 * there is not an hour to give.
 *
 * A fixed hour is right until about six in the evening and then quietly takes the fixture
 * apart. `after(base, 4)` at ten at night is a dentist's appointment at half past two in the
 * MORNING, which the day filter moves to tomorrow, so `a normal day` serves up one event
 * and `three events` serves up one, in exactly the hours somebody is most likely to be
 * sitting in front of the harness. Compressed instead: the same shape of day, an evening's
 * worth of it, and every event still on the day the scenario meant.
 *
 * The last half hour before midnight is not rescued and is not worth rescuing; `soon`
 * rounds up into tomorrow there, and a day with fifteen minutes left in it has an honest
 * claim to being over.
 */
const step = (base: Date): number =>
  Math.min(HOUR, (midnight(base, 1).getTime() - base.getTime()) / TODAY_STEPS)

const after = (base: Date, hours: number): Date => new Date(base.getTime() + hours * step(base))

/**
 * `hours` before now, floored at this morning's midnight.
 *
 * A scenario about what has already happened today has nothing to say if the harness is
 * opened at half past midnight and its events land on yesterday, where the day filter
 * eats them and the card claims today was free.
 */
const earlier = (now: Date, hours: number): Date => {
  const wanted = new Date(now.getTime() - hours * HOUR)
  const start = midnight(now, 0)
  return wanted < start ? start : wanted
}

type Draft = Omit<CalendarItem, 'id' | 'entityId'>

/**
 * The entities the fixtures pretend to have come out of.
 *
 * One of each kind, filled in centrally rather than written on forty drafts, because no
 * scenario below is about *which* calendar or list a row belongs to. The colours already
 * carry that distinction, and a per-draft entity would be a second way to say the same thing
 * and a second way to get it wrong. What they buy is a row that can answer `itemTarget`, so
 * the tap behaviour is the same shape in the harness as in a dashboard.
 */
const DEMO_CALENDAR = 'calendar.personal'
const DEMO_LIST = 'todo.reminders'

const withIds = (scenario: string, drafts: Draft[]): CalendarItem[] =>
  drafts.map((draft, index) => ({
    id: `${scenario}-${index}`,
    entityId: draft.kind === 'reminder' ? DEMO_LIST : DEMO_CALENDAR,
    ...draft,
  }))

/**
 * The days after today, shared by most scenarios. `offset` is which day they land on:
 * 1 gives the `TOMORROW` heading, 2 leaves tomorrow empty so it gets skipped and the
 * heading falls back to a date.
 */
const laterDays = (now: Date, offset = 1): Draft[] => [
  {
    kind: 'event',
    title: 'Market run',
    location: 'Podwale 5, Warsawa',
    start: on(now, offset, 10),
    end: on(now, offset, 12),
    color: HOME,
  },
  {
    kind: 'event',
    title: 'Coffee with Marta',
    start: on(now, offset, 13),
    end: on(now, offset, 14),
    color: HOME,
  },
  {
    kind: 'event',
    title: 'Training',
    start: on(now, offset, 18, 15),
    end: on(now, offset, 19, 15),
    color: SPORT,
  },
  { kind: 'reminder', title: 'Renew library card', start: on(now, offset + 2, 9), color: LIST },
]

const scenarios: Record<string, (now: Date) => Draft[]> = {
  /** Three today, the third of them pushed into the right column. */
  default: now => {
    const base = soon(now)
    return [
      { kind: 'event', title: 'Design review', start: base, end: after(base, 1), color: WORK },
      {
        kind: 'event',
        title: 'Lunch with Anna',
        location: 'Gdańska 12, Warsawa',
        start: after(base, 2),
        end: after(base, 3),
        color: HOME,
      },
      { kind: 'event', title: 'Dentist', start: after(base, 4), end: after(base, 5), color: HOME },
      ...laterDays(now),
    ]
  },

  /** `No Events Today` on the left, the flow starting on the right. */
  'today-empty': now => laterDays(now),

  /**
   * The other empty today: it had events, but they are all behind us, so this is `No More
   * Events Today`.
   */
  'today-done': now => [
    { kind: 'event', title: 'Standup', start: earlier(now, 4), end: earlier(now, 3), color: WORK },
    {
      kind: 'event',
      title: 'Design review',
      location: 'Długa 36, Warsawa',
      start: earlier(now, 2),
      end: earlier(now, 1),
      color: WORK,
    },
    ...laterDays(now),
  ],

  /** One event, so its location fits even in the small size. */
  'one-event': now => {
    const base = soon(now)
    return [
      {
        kind: 'event',
        title: 'Design review',
        location: 'Długa 36, Warsawa',
        start: base,
        end: after(base, 1),
        color: WORK,
      },
      ...laterDays(now),
    ]
  },

  /** Two events: the small size shows neither location, the medium shows the first. */
  'two-events': now => {
    const base = soon(now)
    return [
      {
        kind: 'event',
        title: 'Design review',
        location: 'Długa 36, Warsawa',
        start: base,
        end: after(base, 1),
        color: WORK,
      },
      { kind: 'event', title: 'Standup', start: after(base, 2), end: after(base, 3), color: WORK },
      ...laterDays(now),
    ]
  },

  /** Three plain events: the left column takes two, the third flows right. */
  'three-events': now => {
    const base = soon(now)
    return [
      { kind: 'event', title: 'Design review', start: base, end: after(base, 1), color: WORK },
      { kind: 'event', title: 'Standup', start: after(base, 2), end: after(base, 3), color: WORK },
      { kind: 'event', title: 'Retro', start: after(base, 4), end: after(base, 5), color: WORK },
      ...laterDays(now),
    ]
  },

  /**
   * `2 more events`, laid out exactly as the reference screenshot has it: two greedy
   * locations today spend the left column and most of the right one, so tomorrow gets a
   * heading, its reminder, and one row left over to admit what is missing.
   */
  'more-events': now => {
    const base = soon(now)
    return [
      {
        kind: 'event',
        title: 'Design review',
        location: 'Długa 36, Warsawa',
        start: base,
        end: after(base, 1),
        color: WORK,
      },
      {
        kind: 'event',
        title: 'Sprint planning',
        location: 'Focha 4, Warsawa',
        start: after(base, 2),
        end: after(base, 3),
        color: WORK,
      },
      { kind: 'reminder', title: 'Pick up dry cleaning', start: on(now, 1, 10, 30), color: LIST },
      {
        kind: 'event',
        title: 'Language class',
        start: on(now, 1, 12),
        end: on(now, 1, 13),
        color: WORK,
      },
      {
        kind: 'event',
        title: 'Training',
        start: on(now, 1, 18, 15),
        end: on(now, 1, 19, 15),
        color: SPORT,
      },
    ]
  },

  /**
   * Reminders and events in one stream, ordered by time rather than by kind, and both
   * shapes a to-do arrives in: one due at a time, which reads like an event, and one due on
   * a date, which is a single line at the top of the day with no midnight invented for it.
   */
  reminders: now => {
    const base = soon(now)
    return [
      {
        kind: 'reminder',
        title: 'Book the car service',
        start: midnight(now, 0),
        allDay: true,
        color: LIST,
      },
      { kind: 'reminder', title: 'Pick up dry cleaning', start: base, color: LIST },
      {
        kind: 'event',
        title: 'Language class',
        start: after(base, 2),
        end: after(base, 3),
        color: WORK,
      },
      { kind: 'reminder', title: 'Water the plants', start: after(base, 5), color: LIST },
      ...laterDays(now),
    ]
  },

  /**
   * All-day entries: first in the day, one row, no time, and the reference screenshot
   * for what that one row buys. Medium fits the whole flow, `1 + 3` beside `1 + 2+2+2`.
   * Small gets `1 + 2` with a row left over, which goes on the location: two items and a
   * location, which two timed events could never have managed.
   */
  'all-day': now => {
    const base = soon(now)
    return [
      { kind: 'event', title: 'Poznań trip', allDay: true, start: midnight(now, 0), color: HOME },
      {
        kind: 'event',
        title: 'Train to Poznań',
        location: 'Warsawa Główna',
        start: base,
        end: after(base, 1),
        color: HOME,
      },
      { kind: 'reminder', title: 'Pick up dry cleaning', start: on(now, 1, 10, 30), color: LIST },
      {
        kind: 'event',
        title: 'Language class',
        start: on(now, 1, 12),
        end: on(now, 1, 13),
        color: WORK,
      },
      {
        kind: 'event',
        title: 'Training',
        start: on(now, 1, 18, 15),
        end: on(now, 1, 19, 15),
        color: SPORT,
      },
    ]
  },

  /** An all-day entry sharing a busy day, so the tail indicator has to work around it. */
  'all-day-busy': now => {
    const base = soon(now)
    return [
      { kind: 'event', title: 'Poznań trip', allDay: true, start: midnight(now, 0), color: HOME },
      { kind: 'event', title: 'Standup', start: base, end: after(base, 1), color: WORK },
      { kind: 'event', title: 'Retro', start: after(base, 3), end: after(base, 4), color: WORK },
      ...laterDays(now),
    ]
  },

  /**
   * A day that is already behind us, which is what `day_offset: -1` is for.
   *
   * Everything on yesterday is over, and that is the whole point of the fixture: the clock
   * retires a finished row on TODAY and leaves a past day alone, so this is where those two
   * halves of §2 can be watched disagreeing. Today is here as well, one meeting spent and
   * one still ahead, so the same card can be dragged from -1 to 0 and back and show
   * something different each time.
   */
  'past-day': now => {
    const base = soon(now)
    return [
      {
        kind: 'event',
        title: 'Sprint planning',
        start: on(now, -1, 9),
        end: on(now, -1, 10, 30),
        color: WORK,
      },
      {
        kind: 'event',
        title: 'Physio',
        location: 'Gdańska 45, Warsawa',
        start: on(now, -1, 17, 30),
        end: on(now, -1, 18, 30),
        color: SPORT,
      },
      {
        kind: 'event',
        title: 'Standup',
        start: earlier(now, 3),
        end: earlier(now, 2),
        color: WORK,
      },
      { kind: 'event', title: 'Design review', start: base, end: after(base, 1), color: WORK },
      ...laterDays(now),
    ]
  },

  /** Tomorrow is empty, so it is skipped and the next heading is a date, not `TOMORROW`. */
  'skip-empty-day': now => {
    const base = soon(now)
    return [
      { kind: 'event', title: 'Design review', start: base, end: after(base, 1), color: WORK },
      ...laterDays(now, 2),
    ]
  },

  /** Nothing at all, anywhere. */
  empty: () => [],
}

export const DEMO_SCENARIOS = Object.keys(scenarios)
export const DEFAULT_DEMO_SCENARIO = 'default'

export const demoItems = (scenario: string, now: Date): CalendarItem[] => {
  const build = scenarios[scenario] ?? scenarios[DEFAULT_DEMO_SCENARIO]
  return withIds(scenario, build ? build(now) : [])
}
