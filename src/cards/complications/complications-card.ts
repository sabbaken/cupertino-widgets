/** The standalone complications card arranges readings in a grid fitted to its box. */
import { css, html, type TemplateResult } from 'lit'
import { styleMap } from 'lit/directives/style-map.js'
import { defineElement, registerCard } from '../../core/register'
import type { LovelaceCardEditor } from '../../core/types/ha'
import {
  CupertinoComplicationCardBase,
  type ComplicationsCardConfig,
} from './complication-card-base'
import { COMPLICATION_EDITOR_TAG } from './complications-editor'
import { complicationGrid } from './layout'

export type { ComplicationsCardConfig } from './complication-card-base'

export const COMPLICATIONS_CARD_TAG = 'cupertino-complications-card'
export const LEGACY_GAUGE_CARD_TAG = 'cupertino-gauge-card'

class CupertinoComplicationsCard extends CupertinoComplicationCardBase<ComplicationsCardConfig> {
  static override styles = [
    CupertinoComplicationCardBase.styles,
    css`
      .widget {
        display: flex;
        align-items: center;
        justify-content: center;
        padding: var(--cw-inset);
        box-sizing: border-box;
        width: 100%;
        height: 100%;
      }
      .grid {
        display: grid;
        grid-template-columns: repeat(var(--cw-gauge-columns), var(--cw-gauge-size));
        gap: calc(14px * var(--cw-scale));
      }
      .empty {
        font: var(--cw-text-callout);
        color: var(--cw-label-secondary);
      }
    `,
  ]

  public static getStubConfig(): ComplicationsCardConfig {
    return { type: `custom:${COMPLICATIONS_CARD_TAG}` }
  }

  public static getConfigElement(): LovelaceCardEditor {
    return document.createElement(COMPLICATION_EDITOR_TAG) as LovelaceCardEditor
  }

  protected override render(): TemplateResult {
    const rows = this.complicationRows()
    const grid = complicationGrid(rows.length, this.boxWidth, this.boxHeight, this.scaleFactor)
    const content = rows.length
      ? html`
          <div
            class="grid"
            style=${styleMap({
              '--cw-gauge-columns': grid.columns,
              '--cw-gauge-size': `calc(${grid.diameter}px * var(--cw-scale))`,
            })}
          >
            ${rows.slice(0, grid.visible).map(row => this.renderComplicationCell(row, grid.diameter))}
          </div>
        `
      : html`<div class="empty">Choose entities to display.</div>`
    return html`<ha-card><div class="widget">${content}</div></ha-card>`
  }
}

registerCard(COMPLICATIONS_CARD_TAG, CupertinoComplicationsCard, {
  name: 'Cupertino Complications',
  description: 'Read multiple entities in rings, dials and discs.',
})

// Saved dashboards can still load the original tag. Only the new tag appears in the picker.
defineElement(LEGACY_GAUGE_CARD_TAG, class extends CupertinoComplicationsCard {})
