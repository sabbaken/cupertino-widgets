/** A daily record can belong to different days in the server and browser zones. */
import { describe, expect, it, vi } from 'vitest'
import type { HassConnection } from '../../core/types/ha'
import { ComplicationForecasts, todaysRange, type DailyForecast } from './forecast'

describe('daily complication forecasts', () => {
  const zone = 'Europe/Warsaw'
  const daily: DailyForecast[] = [
    { datetime: '2026-11-24T23:00:00Z', templow: 8, temperature: 22 },
    { datetime: '2026-11-25T23:00:00Z', templow: 6, temperature: 20 },
  ]

  it('selects today in the Home Assistant zone and rolls to the next entry at midnight', () => {
    expect(todaysRange(daily, Date.parse('2026-11-25T22:59:00Z'), zone)).toEqual({
      min: 8,
      max: 22,
    })
    expect(todaysRange(daily, Date.parse('2026-11-25T23:00:00Z'), zone)).toEqual({
      min: 6,
      max: 20,
    })
  })

  it('ignores missing, invalid, and equal endpoints', () => {
    const now = Date.parse('2026-11-25T21:00:00Z')
    for (const templow of [null, 22, 23, NaN]) {
      expect(
        todaysRange([{ datetime: daily[0]!.datetime, templow, temperature: 22 }], now, zone),
      ).toBeUndefined()
    }
    expect(todaysRange(null, now, zone)).toBeUndefined()
  })

  it('shares a subscription and releases a late handle after removal', async () => {
    const changed = vi.fn()
    const unsubscribe = vi.fn(async () => {})
    let finish!: (stop: () => Promise<void>) => void
    const subscribe = vi.fn(
      () =>
        new Promise<() => Promise<void>>(resolve => {
          finish = resolve
        }),
    )
    const connection = { subscribeMessage: subscribe } as HassConnection
    const feed = new ComplicationForecasts(changed)
    const id = 'weather.home'
    feed.sync(connection, new Set([id, id]))
    feed.sync(connection, new Set([id]))
    expect(subscribe).toHaveBeenCalledTimes(1)
    feed.sync(connection, new Set())
    finish(unsubscribe)
    await Promise.resolve()
    expect(unsubscribe).toHaveBeenCalledOnce()
    expect(feed.read(id)).toBeUndefined()
  })
})
