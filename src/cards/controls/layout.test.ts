/**
 * The half-width Home Assistant section is the density baseline. The supplied
 * row and column counts are independent overrides of that measured grid.
 */
import { describe, expect, it } from 'vitest'

import { columnsToPx, rowsToPx } from '../../core/size'
import { CONTROLS_SPACING, controlsGrid } from './layout'

const halfWidth = columnsToPx(6, 500)
const fourRows = rowsToPx(4)

describe('tile capacity', () => {
  it('starts with rectangles for recommendations alone', () => {
    expect(controlsGrid(246, 248, 1, 0, 'auto')).toMatchObject({
      shape: 'rectangle',
      columns: 2,
      capacity: 6,
    })
  })

  it('fits three columns in a six by four dashboard cell', () => {
    expect(controlsGrid(halfWidth, fourRows, 1, 8, 'auto')).toMatchObject({
      shape: 'square',
      columns: 3,
      capacity: 9,
    })
  })

  it('budgets only four tiles in the smallest dashboard cell', () => {
    const width = columnsToPx(4, 500)
    const height = rowsToPx(3)
    expect(controlsGrid(width, height, 1, 8, 'auto')).toMatchObject({
      shape: 'square',
      columns: 2,
      capacity: 4,
    })
  })

  it('chooses two rectangle columns when three square columns would widen too far', () => {
    expect(controlsGrid(303, 248, 1, 8, 'auto')).toMatchObject({
      shape: 'rectangle',
      columns: 2,
      capacity: 6,
    })
    expect(controlsGrid(303, 248, 1, 8, 'square')).toMatchObject({
      shape: 'square',
      columns: 3,
      tileHeight: 114,
    })
  })

  it('shares three columns between both formats at full width', () => {
    expect(controlsGrid(500, fourRows, 1, 8, 'rectangle')).toMatchObject({
      shape: 'rectangle',
      columns: 3,
      tileHeight: 74,
      capacity: 9,
    })
    expect(controlsGrid(500, fourRows, 1, 8, 'square')).toMatchObject({
      shape: 'square',
      columns: 3,
      tileHeight: 114,
      capacity: 6,
    })
  })

  it('keeps the roomier wide grid when squares would show fewer entities', () => {
    expect(controlsGrid(500, fourRows, 1, 12, 'auto').shape).toBe('rectangle')
  })

  it('lets a manual column count override the wide default', () => {
    expect(controlsGrid(500, fourRows, 1, 8, 'square', { tile_columns: 4 }).columns).toBe(4)
  })

  it('uses the scale to recalculate capacity without a resize', () => {
    expect(controlsGrid(halfWidth, fourRows, 1, 8, 'auto').columns).toBe(3)
    expect(controlsGrid(halfWidth, fourRows, 1.3, 8, 'auto').columns).toBe(2)
  })

  it('fills the row tracks with square-format tiles at the requested density', () => {
    const grid = controlsGrid(halfWidth, fourRows, 1, 8, 'square', {
      tile_columns: 2,
      tile_rows: 2,
    })
    expect(grid).toMatchObject({ shape: 'square', columns: 2, capacity: 4, tileHeight: 114 })
  })

  it('applies a row override independently of automatic columns', () => {
    expect(controlsGrid(500, fourRows, 1, 10, 'rectangle', { tile_rows: 2 })).toMatchObject({
      shape: 'rectangle',
      columns: 3,
      capacity: 6,
    })
  })

  it('reduces the row count when the requested rows exceed the viewport', () => {
    expect(
      controlsGrid(halfWidth, fourRows, 1, 8, 'rectangle', {
        tile_columns: 2,
        tile_rows: 6,
      }),
    ).toMatchObject({ shape: 'rectangle', columns: 2, tileHeight: 74, capacity: 6 })
  })

  it.each(['square', 'rectangle'] as const)(
    'fills the measured height with equal padding and gaps in %s format',
    format => {
      const height = 263
      const scale = 1.2
      const grid = controlsGrid(307, height, scale, 20, format)
      const rows = grid.capacity / grid.columns
      expect(rows).toBeGreaterThan(1)
      expect(2 + scale * (rows * grid.tileHeight + (rows + 1) * CONTROLS_SPACING)).toBeCloseTo(
        height,
      )
    },
  )
})
