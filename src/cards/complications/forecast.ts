/**
 * Daily forecast ranges are indexed by the server's civil day. The viewer's clock
 * preference only affects displayed times and cannot select the forecast record.
 */
import { dayNumber } from '../calendar/datetime'
import type { HassConnection } from '../../core/types/ha'

export interface TemperatureRange {
  min: number
  max: number
}

export interface DailyForecast {
  datetime: string
  temperature?: number | null
  templow?: number | null
}

export const todaysRange = (
  forecast: readonly DailyForecast[] | null | undefined,
  now: number,
  zone: string,
): TemperatureRange | undefined => {
  const today = dayNumber(new Date(now), zone)
  for (const { datetime, temperature: max, templow: min } of forecast ?? []) {
    const time = Date.parse(datetime)
    if (
      Number.isFinite(time) &&
      dayNumber(new Date(time), zone) === today &&
      typeof min === 'number' &&
      typeof max === 'number' &&
      Number.isFinite(min) &&
      Number.isFinite(max) &&
      min < max
    )
      return { min, max }
  }
  return undefined
}

interface Subscription {
  forecast?: readonly DailyForecast[] | null
  unsubscribe?: () => Promise<void>
  retryAt?: number
}

export class ComplicationForecasts {
  private connection: HassConnection | undefined
  private readonly subscriptions = new Map<string, Subscription>()

  constructor(private readonly changed: () => void) {}

  public read(id: string): readonly DailyForecast[] | null | undefined {
    return this.subscriptions.get(id)?.forecast
  }

  public sync(connection: HassConnection | undefined, ids: ReadonlySet<string>): void {
    if (this.connection !== connection) this.stop()
    this.connection = connection
    for (const [id, current] of this.subscriptions) {
      if (!ids.has(id) || (current.retryAt !== undefined && current.retryAt <= Date.now())) {
        this.subscriptions.delete(id)
        void current.unsubscribe?.().catch(() => {})
      }
    }
    if (!connection) return
    for (const id of ids) {
      if (this.subscriptions.has(id)) continue
      const current: Subscription = {}
      this.subscriptions.set(id, current)
      const active = () => this.subscriptions.get(id) === current
      void connection
        .subscribeMessage<{ forecast: DailyForecast[] | null }>(
          message => {
            if (!active()) return
            current.forecast = message.forecast
            this.changed()
          },
          { type: 'weather/subscribe_forecast', entity_id: id, forecast_type: 'daily' },
        )
        .then(unsubscribe => {
          if (active()) current.unsubscribe = unsubscribe
          else void unsubscribe().catch(() => {})
        })
        .catch(() => {
          if (!active()) return
          delete current.forecast
          current.retryAt = Date.now() + 60_000
          this.changed()
        })
    }
  }

  public stop(): void {
    for (const current of this.subscriptions.values()) void current.unsubscribe?.().catch(() => {})
    this.subscriptions.clear()
  }
}
