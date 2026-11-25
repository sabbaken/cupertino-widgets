/** Allocate equal circles from the measured box, reserving space for the outer stroke. */
export const complicationGrid = (count: number, width: number, height: number, scale: number) => {
  const innerWidth = Math.max(0, (width - 2) / scale - 32)
  const innerHeight = Math.max(0, (height - 2) / scale - 32)
  const gap = 14
  const maxColumns = Math.max(1, Math.floor((innerWidth + gap) / (42 + gap)))
  const maxRows = Math.max(1, Math.floor((innerHeight + gap) / (42 + gap)))
  const visible = Math.min(count, maxColumns * maxRows)
  let columns = 1
  let diameter = 0
  for (let candidate = 1; candidate <= Math.min(visible, maxColumns); candidate++) {
    const rows = Math.ceil(visible / candidate)
    if (rows > maxRows) continue
    const fit = Math.min(
      (innerWidth - (candidate - 1) * gap) / candidate,
      (innerHeight - (rows - 1) * gap) / rows,
      120,
    )
    if (fit > diameter) {
      diameter = fit
      columns = candidate
    }
  }
  return { columns, diameter: Math.floor(diameter), visible }
}

/**
 * Budget the reading in ems so a decimal separator costs less room than a numeral.
 * The suffix shares the reading's baseline width at the gauge stylesheet's 0.58em.
 */
export const complicationReadingScale = (
  reading: string,
  suffix: string,
  ceiling: number,
): number => {
  const widthInEm = (text: string): number =>
    Array.from(text).reduce((width, glyph) => {
      if (/[.,:٫]/u.test(glyph)) return width + 0.32
      if (/\p{Nd}/u.test(glyph)) return width + 0.67
      if (glyph === '°') return width + 0.47
      if (glyph === '%') return width + 0.95
      return width + 0.8
    }, 0)

  const advance = widthInEm(reading) + widthInEm(suffix) * 0.58
  return advance > 0 ? Math.min(ceiling, 0.56 / advance) : ceiling
}
