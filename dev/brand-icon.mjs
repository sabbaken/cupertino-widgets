/**
 * Export the shared vector mark for README renderers. A PNG travels through Home
 * Assistant's markdown renderer without depending on its treatment of SVG images;
 * drawing the vector in Chromium keeps a second, hand-maintained mark out of the repo.
 */

import { readFile } from 'node:fs/promises'
import { fileURLToPath } from 'node:url'

import { chromium } from 'playwright'

const source = new URL('../icon.svg', import.meta.url)
const output = new URL('../icon.png', import.meta.url)
const browser = await chromium.launch()

try {
  const page = await browser.newPage({
    viewport: { width: 256, height: 256 },
    deviceScaleFactor: 1,
  })
  await page.setContent(`
    <style>html, body { margin: 0 } svg { display: block; width: 256px; height: 256px }</style>
    ${await readFile(source, 'utf8')}
  `)
  await page.screenshot({ path: fileURLToPath(output), omitBackground: true })
  console.log('icon.png  256×256')
} finally {
  await browser.close()
}
