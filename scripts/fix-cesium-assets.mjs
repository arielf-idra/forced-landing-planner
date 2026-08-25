import { existsSync, renameSync, rmSync } from 'node:fs'
import path from 'node:path'

// vite-plugin-cesium's closeBundle hook copies its static assets to
// `<outDir>/<base>/cesium/...` instead of `<outDir>/cesium/...`, double-applying the
// GitHub Pages base path (base is meant to only prefix *URLs*, not the physical build
// output). The generated index.html correctly requests `/<base>/cesium/...`, so on a
// non-root base the files end up one directory level too deep and 404. Flatten it here.
// If the repo is ever renamed, keep this in sync with `base` in vite.config.ts.
const BASE_SEGMENT = 'forced-landing-planner'
const OUT_DIR = 'dist'

const wrongPath = path.join(OUT_DIR, BASE_SEGMENT, 'cesium')
const correctPath = path.join(OUT_DIR, 'cesium')

if (!existsSync(wrongPath)) {
  console.log(
    `[fix-cesium-assets] ${wrongPath} not found — nothing to fix (did vite-plugin-cesium's ` +
      `behavior change, or vite.config.ts's base?).`,
  )
  process.exit(0)
}

rmSync(correctPath, { recursive: true, force: true })
renameSync(wrongPath, correctPath)
rmSync(path.join(OUT_DIR, BASE_SEGMENT), { recursive: true, force: true })
console.log(`[fix-cesium-assets] moved ${wrongPath} -> ${correctPath}`)
