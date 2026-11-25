/**
 * The dashboard supplies the viewport. Grid settings control the density inside
 * it, and the measured row budget determines how many tiles can be drawn.
 */
import { LAYOUT_THRESHOLD } from '../../core/size'

export type ControlsFormat = 'auto' | 'rectangle' | 'square'

export interface ControlsDensity {
  tile_columns?: number
  tile_rows?: number
}

export const CONTROLS_SPACING = 6
export const CONTROLS_MAX_COLUMNS = 8
export const CONTROLS_MAX_ROWS = 12

const tracks = (value: number | undefined, max: number): number | undefined =>
  typeof value === 'number' && value > 0 && Number.isFinite(value)
    ? Math.min(max, Math.max(1, Math.round(value)))
    : undefined

export const controlsGrid = (
  width: number,
  height: number,
  scale: number,
  count: number,
  format: ControlsFormat,
  density: ControlsDensity = {},
) => {
  const innerWidth = Math.max(0, (width - 2) / scale - 2 * CONTROLS_SPACING)
  const innerHeight = Math.max(0, (height - 2) / scale - 2 * CONTROLS_SPACING)
  const step = (size: number) => size + CONTROLS_SPACING
  const requestedColumns = tracks(density.tile_columns, CONTROLS_MAX_COLUMNS)
  const requestedRows = tracks(density.tile_rows, CONTROLS_MAX_ROWS)
  // A full-width card keeps three tracks in both formats. Scale still sets the
  // height and padding of the tiles inside those tracks.
  const wide = width >= LAYOUT_THRESHOLD
  const columnsFor = (minWidth: number) => {
    if (requestedColumns !== undefined) return requestedColumns
    if (wide) return 3
    return Math.max(1, Math.floor(step(innerWidth) / step(minWidth)))
  }
  const fit = (space: number, slots: number) => Math.max(1, step(space) / slots - CONTROLS_SPACING)
  const rowsFor = (pitch: number) => Math.floor((step(innerHeight) + 0.01) / step(pitch))
  const rowHeight = (preferred: number) =>
    requestedRows ? Math.max(56, fit(innerHeight, requestedRows)) : preferred

  const rectangleColumns = columnsFor(112)
  const squareColumns = columnsFor(68)
  const rectangleHeight = rowHeight(wide ? 70 : 56)
  const squareLimit = wide ? Math.min(114, Math.max(80, fit(innerHeight, 2))) : 80
  const squareSize = Math.min(squareLimit, fit(innerWidth, squareColumns), rowHeight(squareLimit))
  const squareTrackHeight = requestedRows ? rowHeight(squareSize) : squareSize
  const rectangleRows = rowsFor(rectangleHeight)
  const squareRows = rowsFor(squareTrackHeight)
  const rectangleCapacity = rectangleColumns * rectangleRows
  const squareCapacity = squareColumns * squareRows
  // The narrower square uses more of the tile for the name. On wide cards
  // compare the visible counts before switching to a different format.
  const compact =
    count > 0 &&
    !wide &&
    !requestedColumns &&
    rectangleColumns < 3 &&
    squareColumns >= 3 &&
    squareCapacity >= Math.min(count, rectangleCapacity)
  // Keep the stacked layout in Auto when its columns can stay close to the preferred width.
  const squareExcess = innerWidth - squareColumns * squareSize
  const balancedSquares =
    rectangleCapacity === 0 ||
    squareColumns === 1 ||
    squareExcess <= (squareColumns - 1) * Math.max(2 * CONTROLS_SPACING, squareSize / 5)
  const useSquares =
    format === 'square' ||
    (format === 'auto' &&
      balancedSquares &&
      (compact || (count > rectangleCapacity && squareCapacity > rectangleCapacity)))
  const rows = useSquares ? squareRows : rectangleRows
  const columns = useSquares ? squareColumns : rectangleColumns
  return {
    shape: useSquares ? ('square' as const) : ('rectangle' as const),
    columns,
    rows,
    tileHeight: rows > 0 ? fit(innerHeight, rows) : 0,
    capacity: columns * rows,
  }
}
