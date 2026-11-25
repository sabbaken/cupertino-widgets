/**
 * The previews, and a drawer of the awkward cases under them.
 *
 * A preview is a label and a card, and deliberately nothing else. The canvas behind it is
 * painted with Home Assistant's own background, so every widget on the page stands on one
 * plane of dashboard rather than in a frame of its own, and the site gives each card a
 * width and a height and not one other property. That is what makes a preview here worth
 * looking at: it is the card a dashboard would draw, at the size it would draw it.
 *
 * A footprint is named in the Layout tab's own units (`6 × 4`) because that is what a
 * user drags in Home Assistant. Pixels are only what those units happen to resolve to on
 * one particular dashboard, so they would be a number nobody could act on.
 */

import { html, nothing, type TemplateResult } from 'lit'
import { mdiChevronRight } from '@mdi/js'

import { columnsToPx, gridOptions, rowsToPx } from '../../src/core/size'
import { CONTROL_STATES } from '../control-entities'
import type { Widget } from './catalog'
import type { EditorPanel } from './editor'
import { icon } from './icon'
import {
  MEDIUM,
  ODD_FOOTPRINTS,
  SMALL,
  dragBox,
  footprintBox,
  slotCard,
  type Box,
  type Footprint,
} from './stage'

/**
 * A card in a box the sections grid would have given it.
 *
 * The box is a plain block with an exact size, and it has to be: `base-styles.ts` gives a
 * card `display: block; height: 100%` and no width at all, because in the sections layout
 * it is a block child of the cell and a block child stretches for free. Let it become a
 * flex item and the card shrinks to its content instead, and then draws narrower than the
 * footprint says it is.
 */
const boxed = (box: Box, card: Node): TemplateResult => html`
  <div class="box" style=${`width:${box.width}px;height:${box.height}px`}>${card}</div>
`

/**
 * A named widget, or an unnamed one whose footprint is the whole label.
 *
 * The footprint arrives as a badge wherever it is known at all, so `6 × 4` reads the same
 * everywhere on the page. Only the box whose corner drags has none, because its footprint
 * is whatever the visitor last made it.
 */
const preview = (
  name: string | undefined,
  footprint: Footprint | undefined,
  body: TemplateResult | Node,
): TemplateResult => html`
  <figure class="preview">
    <figcaption class="preview-head">
      ${name ? html`<span>${name}</span>` : nothing}
      ${
        footprint
          ? html`<span class="badge">${footprint.columns} × ${footprint.rows}</span>`
          : nothing
      }
    </figcaption>
    ${body}
  </figure>
`

// ---- The three ------------------------------------------------------------------

/** The smallest footprint Home Assistant will let a card be dragged to. */
const floorBox = (sectionWidth: number): Box => {
  const options = gridOptions()
  return {
    width: Math.round(columnsToPx(options.min_columns ?? 4, sectionWidth)),
    height: rowsToPx(options.min_rows ?? 3),
  }
}

export function previews(
  widget: Widget,
  sectionWidth: number,
  onDrag: (box: Box) => void,
): TemplateResult {
  const floor = floorBox(sectionWidth)

  return html`
    <!-- The drag box's floor is Home Assistant's own 4 × 3, which moves with the section
         width, so it is handed to the CSS rather than written into it. -->
    <div
      class="previews"
      style=${`--drag-min-w:${floor.width}px;--drag-min-h:${floor.height}px`}
      tabindex="0"
      role="group"
      aria-label="Previews"
    >
      ${preview(
        'Small',
        SMALL,
        boxed(footprintBox(SMALL, sectionWidth), slotCard('preview:small', widget.tag)),
      )}
      ${preview(
        'Medium',
        MEDIUM,
        boxed(footprintBox(MEDIUM, sectionWidth), slotCard('preview:medium', widget.tag)),
      )}
      ${
        widget.id === 'controls'
          ? [
              { count: 2, name: 'Small · Two devices' },
              { count: 1, name: 'Small · One device' },
            ].map(({ count, name }) =>
              preview(
                name,
                SMALL,
                boxed(
                  footprintBox(SMALL, sectionWidth),
                  slotCard(`preview:controls-${count}`, widget.tag, config => ({
                    ...config,
                    entities: CONTROL_STATES.slice(0, count).map(entity => entity.entity_id),
                    recommend_devices: false,
                    tile_columns: count,
                    tile_rows: 1,
                  })),
                ),
              ),
            )
          : nothing
      }
      ${preview('Drag to resize', undefined, dragBox(slotCard('preview:drag', widget.tag), onDrag))}
    </div>
  `
}

// ---- Advanced ---------------------------------------------------------------------

const footprintsPanel = (widget: Widget, sectionWidth: number): TemplateResult => html`
  <section class="panel">
    <h3 class="panel-name">Other footprints</h3>
    <p class="panel-note">Anything the Layout tab can be dragged to, not only the two above.</p>
    <div class="previews" tabindex="0" role="group" aria-label="Other footprints">
      ${ODD_FOOTPRINTS.map(footprint =>
        preview(
          undefined,
          footprint,
          boxed(
            footprintBox(footprint, sectionWidth),
            slotCard(`odd:${footprint.columns}x${footprint.rows}`, widget.tag),
          ),
        ),
      )}
    </div>
  </section>
`

const editorSection = (
  widget: Widget,
  sectionWidth: number,
  panel: EditorPanel | undefined,
): TemplateResult => {
  const options = gridOptions()
  const box = footprintBox(
    { columns: options.columns as number, rows: options.rows as number },
    sectionWidth,
  )

  return html`
    <section class="panel">
      <h3 class="panel-name">Visual editor</h3>
      <p class="panel-note">
        The card's own editor, reached through <code>getConfigElement()</code> the way a dashboard
        reaches it. Its form controls are stand-ins.
      </p>
      ${
        panel === undefined
          ? html`<p class="panel-note">Loading…</p>`
          : panel.reason !== undefined
            ? html`<p class="panel-note">${panel.reason}</p>`
            : html`
                <div class="editor">
                  <div class="editor-form">${panel.editor ?? nothing}</div>
                  <pre
                    class="editor-config"
                  ><code>${JSON.stringify(panel.config, null, 2)}</code></pre>
                  ${preview(
                    'Preview',
                    { columns: options.columns as number, rows: options.rows as number },
                    boxed(
                      box,
                      slotCard('editor:preview', widget.tag, () => panel.config),
                    ),
                  )}
                </div>
              `
      }
    </section>
  `
}

export function advanced(
  widget: Widget,
  sectionWidth: number,
  open: boolean,
  panel: EditorPanel | undefined,
  onToggle: (isOpen: boolean) => void,
): TemplateResult {
  return html`
    <details
      class="advanced"
      ?open=${open}
      @toggle=${(event: Event) => onToggle((event.target as HTMLDetailsElement).open)}
    >
      <summary class="advanced-head">
        <span class="advanced-mark">${icon(mdiChevronRight)}</span>
        <span>Advanced</span>
      </summary>
      ${
        open
          ? html`<div class="advanced-body">
              ${footprintsPanel(widget, sectionWidth)}${editorSection(widget, sectionWidth, panel)}
            </div>`
          : nothing
      }
    </details>
  `
}
