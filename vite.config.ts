import { defineConfig } from 'vite'
import packageJson from './package.json' with { type: 'json' }

const { version } = packageJson

/**
 * Kept in the shipped file on purpose. The bundle is served to every dashboard
 * visitor's browser, which is distribution, and the AGPL wants the notice and a route
 * to the source to travel with it. `/*!` marks it a legal comment so minifiers keep it.
 */
const LICENCE_BANNER = `/*! cupertino-widgets v${version} | Copyright (C) 2026 Kirill Verenih | AGPL-3.0-only | Source: https://github.com/sabbaken/cupertino-widgets */`

/**
 * Where the showcase site is served from, as a URL path.
 *
 * GitHub Pages puts a project site under the repository name, so every asset URL has
 * to carry that prefix or the built page loads nothing. Overridable, because a fork
 * with its own domain, or a Netlify drop, is served from the root instead:
 *
 *     SITE_BASE=/ pnpm build:site
 */
const SITE_BASE = process.env.SITE_BASE ?? '/cupertino-widgets/'

/**
 * Three jobs, one config:
 *
 *   `vite`                    -> the showcase, with HMR and no Home Assistant needed.
 *                                Serves dev/index.html against a mock `hass` object.
 *   `vite build`              -> the shippable artifact: a single self-contained ES
 *                                module that Home Assistant loads as a dashboard
 *                                resource. `--mode development` (`pnpm watch`) is still
 *                                this one, which is why the site keys off the mode name
 *                                rather than off "not production".
 *   `vite build --mode site`  -> the same showcase as a static site, for GitHub Pages.
 */
export default defineConfig(({ command, mode }) => {
  const site = mode === 'site'

  return {
    define: {
      __CW_VERSION__: JSON.stringify(version),
    },

    // dev/ is the root for everything that renders a page: the dev server and the
    // site build alike. The library build has no HTML in it and keeps the repo root.
    ...(command === 'serve' || site ? { root: 'dev' } : {}),
    ...(site ? { base: SITE_BASE } : {}),

    server: {
      port: 5173,
      // dev/ imports from ../src, which lives outside the serve root.
      fs: { allow: ['..'] },
    },

    build: site
      ? {
          // Relative to `root`, which is dev/, so this lands at the repo root, beside
          // dist/ rather than inside the source tree.
          outDir: '../dist-site',
          // Safe to wipe, unlike dist/: nothing is bind-mounted here, and a stale
          // hashed asset left behind would be served forever.
          emptyOutDir: true,
          minify: 'oxc',
          target: 'es2022',
          // The page ships the card sources to every visitor, which is distribution.
          rollupOptions: { output: { banner: LICENCE_BANNER } },
        }
      : {
          lib: {
            entry: 'src/index.ts',
            formats: ['es'],
            // Fixed name: it is baked into every user's dashboard resource URL.
            fileName: () => 'cupertino-widgets.js',
          },
          rollupOptions: {
            output: { banner: LICENCE_BANNER },
          },
          // Vite 8 replaced `rollupOptions.output.inlineDynamicImports` with this.
          // Home Assistant loads one URL, so the bundle must not be split.
          codeSplitting: false,
          // Vite 8 dropped the bundled esbuild; `'esbuild'` here throws at build time.
          minify: 'oxc',
          target: 'es2022',
          sourcemap: true,
          // MUST stay false. Emptying the directory recreates it with a new inode, which
          // silently detaches docker-compose's bind mount of ./dist -- the dev Home
          // Assistant then serves 404 for a bundle that is sitting right there on the
          // host. Output filenames are fixed anyway, so there is nothing to clean.
          emptyOutDir: false,
        },
  }
})
