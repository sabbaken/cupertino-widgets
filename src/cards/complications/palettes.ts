/** Fixed colour stops in measurement units keep each colour at the same position as a reading changes. */
type Stop = readonly [value: number, red: number, green: number, blue: number]

export const colourAt = (stops: readonly [Stop, ...Stop[]], value: number): string => {
  const index = stops.findIndex(stop => stop[0] >= value)
  const high = index < 0 ? stops.at(-1)! : stops[index]!
  if (index < 1) return `rgb(${high.slice(1).join(' ')})`
  const low = stops[index - 1]!
  const fraction = (value - low[0]) / (high[0] - low[0])
  return `rgb(${high
    .slice(1)
    .map((channel, i) => {
      const start = low[i + 1]!
      return Math.round(start + fraction * (channel - start))
    })
    .join(' ')})`
}

export const temperatureStops = [
  [-25, 79, 73, 224],
  [-10, 51, 122, 242],
  [0, 55, 174, 254],
  [12, 46, 199, 195],
  [18, 109, 213, 70],
  [23, 243, 216, 46],
  [29, 255, 143, 39],
  [35, 246, 65, 57],
  [45, 191, 42, 110],
] as const

export const humidityStops = [
  [0, 18, 202, 145],
  [25, 37, 193, 218],
  [55, 39, 167, 240],
  [75, 44, 111, 230],
  [100, 100, 75, 222],
] as const

// Sampled along the supplied watch dial's full 0–500 sweep, converted from Display P3 to sRGB.
export const aqiStops = [
  [0, 0, 227, 0],
  [20, 0, 227, 0],
  [42, 118, 238, 0],
  [75, 251, 252, 0],
  [100, 254, 190, 2],
  [130, 254, 116, 0],
  [150, 254, 81, 0],
  [165, 253, 30, 0],
  [180, 240, 16, 27],
  [200, 192, 60, 108],
  [235, 142, 63, 151],
  [265, 142, 63, 150],
  [300, 134, 38, 88],
  [340, 126, 0, 35],
  [500, 126, 0, 35],
] as const

export const co2Stops = [
  [400, 52, 199, 89],
  [1000, 161, 200, 53],
  [1400, 223, 181, 32],
  [1800, 245, 139, 42],
  [2500, 227, 79, 72],
] as const

export const uvStops = [
  [0, 31, 195, 42],
  [3, 247, 228, 0],
  [6, 248, 133, 0],
  [8, 229, 56, 45],
  [11, 137, 69, 212],
] as const
