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

export const CONTROLS_INSET = 6
export const CONTROLS_GAP = 6
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
  const innerWidth = Math.max(0, (width - 2) / scale - 2 * CONTROLS_INSET)
  const innerHeight = Math.max(0, (height - 2) / scale - 2 * CONTROLS_INSET)
  const step = (size: number) => size + CONTROLS_GAP
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
  const fit = (space: number, slots: number) => Math.max(1, step(space) / slots - CONTROLS_GAP)
  const rowsFor = (pitch: number) => Math.floor((step(innerHeight) + 0.01) / step(pitch))
  const rowHeight = (preferred: number) =>
    requestedRows ? Math.max(56, fit(innerHeight, requestedRows)) : preferred

  const rectangleColumns = columnsFor(112)
  const squareColumns = columnsFor(68)
  const rectangleHeight = rowHeight(wide ? 70 : 56)
  const squareLimit = wide ? Math.min(114, Math.max(80, fit(innerHeight, 2))) : 80
  const squareSize = Math.min(squareLimit, fit(innerWidth, squareColumns), rowHeight(squareLimit))
  const squareTrackHeight = requestedRows ? rowHeight(squareSize) : squareSize
  const rectangleCapacity = rectangleColumns * rowsFor(rectangleHeight)
  const squareCapacity = squareColumns * rowsFor(squareTrackHeight)
  // The narrower square uses more of the tile for the name. On wide cards
  // compare the visible counts before switching to a different format.
  const compact =
    count > 0 &&
    !wide &&
    !requestedColumns &&
    rectangleColumns < 3 &&
    squareColumns >= 3 &&
    squareCapacity >= Math.min(count, rectangleCapacity)
  // Edge padding anchors the square grid, so surplus width lands in the gaps.
  // Allow a little more room around larger squares before switching to rectangles.
  const squareGap =
    squareColumns > 1 ? (innerWidth - squareColumns * squareSize) / (squareColumns - 1) : 0
  const balancedSquares =
    rectangleCapacity === 0 || squareGap <= Math.max(2 * CONTROLS_GAP, squareSize / 5)
  const useSquares =
    format === 'square' ||
    (format === 'auto' &&
      balancedSquares &&
      (compact || (count > rectangleCapacity && squareCapacity > rectangleCapacity)))
  return useSquares
    ? {
        shape: 'square',
        columns: squareColumns,
        tileHeight: squareSize,
        trackHeight: squareTrackHeight,
        capacity: squareCapacity,
      }
    : {
        shape: 'rectangle',
        columns: rectangleColumns,
        tileHeight: rectangleHeight,
        trackHeight: rectangleHeight,
        capacity: rectangleCapacity,
      }
}
