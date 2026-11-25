/**
 * Controls uses the same ordered entity selector as Home Assistant. Its value is
 * already the list of IDs the card needs.
 */
import { mdiTune } from '@mdi/js'

import { CupertinoCardEditor } from '../../core/card-editor'
import { defineElement } from '../../core/register'
import { scaleFactor } from '../../core/scale'
import { columnsToPx, DEFAULT_HEIGHT, DEFAULT_WIDTH, rowsToPx } from '../../core/size'
import type { HaFormSchema } from '../../core/types/ha'
import { CONTROLS_MAX_COLUMNS, CONTROLS_MAX_ROWS, controlsGrid } from './layout'
import { controlsEntities, type ControlsConfig } from './model'

export const CONTROLS_EDITOR_TAG = 'cupertino-widgets-controls-editor'

const fields: HaFormSchema[] = [
  { name: 'entities', selector: { entity: { multiple: true, reorder: true } } },
  {
    name: 'tile_columns',
    selector: { number: { min: 1, max: CONTROLS_MAX_COLUMNS, step: 1, mode: 'box' } },
  },
  {
    name: 'tile_rows',
    selector: { number: { min: 1, max: CONTROLS_MAX_ROWS, step: 1, mode: 'box' } },
  },
]

const advanced: HaFormSchema = {
  name: 'advanced',
  type: 'expandable',
  flatten: true,
  title: 'Advanced',
  iconPath: mdiTune,
  schema: [
    {
      name: 'format',
      selector: {
        select: {
          mode: 'list',
          options: [
            { value: 'auto', label: 'Auto' },
            { value: 'rectangle', label: 'Rectangles' },
            { value: 'square', label: 'Squares' },
          ],
        },
      },
    },
    { name: 'show_name', selector: { boolean: {} } },
    { name: 'show_area', selector: { boolean: {} } },
  ],
}

const labels: Record<string, string> = {
  entities: 'Entities',
  format: 'Tile format',
  tile_columns: 'Columns',
  tile_rows: 'Rows',
  show_name: 'Show entity name',
  show_area: 'Show area',
}

class CupertinoControlsEditor extends CupertinoCardEditor<ControlsConfig> {
  protected override fields(): readonly HaFormSchema[] {
    return fields
  }

  protected override trailingFields(): readonly HaFormSchema[] {
    return [advanced]
  }

  protected override toForm(config: ControlsConfig): Record<string, unknown> {
    return { ...config, entities: controlsEntities(config.entities) }
  }

  protected override defaults(): Partial<ControlsConfig> {
    return { format: 'auto', show_name: true, show_area: true }
  }

  protected override label(schema: HaFormSchema): string {
    return labels[schema.name] ?? super.label(schema)
  }

  protected override helper(schema: HaFormSchema): string | undefined {
    if (schema.name === 'tile_columns' || schema.name === 'tile_rows') {
      return 'Leave blank to fit automatically.'
    }
    const config = this._config
    if (schema.name !== 'entities' || !config) return super.helper(schema)

    const ids = controlsEntities(config.entities)
    const grid = config.grid_options as { columns?: number; rows?: number } | undefined
    const width =
      typeof grid?.columns === 'number' ? columnsToPx(grid.columns, DEFAULT_WIDTH) : DEFAULT_WIDTH
    const height = typeof grid?.rows === 'number' ? rowsToPx(grid.rows) : DEFAULT_HEIGHT
    const { capacity } = controlsGrid(
      width,
      height,
      scaleFactor(config.scale),
      ids.length,
      config.format ?? 'auto',
      config,
    )
    const hint = `Estimated visible tiles at the configured Layout and Scale: ${capacity}.`
    return ids.length > capacity
      ? `${hint} ${ids.length - capacity} additional tiles are hidden.`
      : hint
  }
}

defineElement(CONTROLS_EDITOR_TAG, CupertinoControlsEditor)
