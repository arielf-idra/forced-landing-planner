# CLAUDE.md

Guidance for Claude Code (or any future contributor) working in this repo.

## What this is

A client-side web app that helps Israeli Cessna 172 flight students plan a forced landing
(simulated engine failure): pick an event point (lat/lon/altitude), see the reachable glide
footprint given glide ratio and wind, pick a landing point, and get a suggested High Key /
Low Key approach plan. Ground-planning/debrief tool — not an in-flight or offline tool.
No backend, no accounts, single-session (state lives only in the browser tab).

Full build plan (context, phased delivery, rationale for decisions) — ask the user for the
plan file if it's not visible in this session; it's not checked into the repo.

## Domain model (safety-relevant — keep this in sync with `src/lib`)

- **Reachable glide footprint**: at best-glide speed, TAS and sink rate are ~constant
  regardless of heading, so time-to-ground `t = heightAGL / sinkRate` doesn't depend on
  direction flown. Still-air range is a circle of radius `R = glideRatio * heightAGL`
  around the event point. Wind translates every point on that circle by `wind * t` — so
  the reachable set is **a circle of radius R, centered at the event point shifted
  downwind by `windSpeed * t`**, not an ellipse. Implemented in `src/lib/glide.ts`.
- **Terrain clearance**: sample terrain height along the direct ground track from event to
  landing point, compare against the assumed constant-gradient glide path (`1/glideRatio`),
  flag if terrain pokes above it. Implemented in `src/lib/terrainProfile.ts`.
- **Approach plan**: classic power-off High Key (overhead landing point, default 1500 ft
  AGL) / Low Key (abeam threshold, default 800 ft AGL) / base / final. Landing heading
  defaults to into-wind, editable. Implemented in `src/lib/approach.ts`.
- Defaults (glide ratio ~9:1, best glide ~65 KIAS) live in `src/lib/geo-constants.ts` and
  are POH-derived starting points, always user-editable in the UI — never hardcode them
  elsewhere.

Keep `src/lib/*` framework-agnostic (no Cesium imports) — it's the safety-relevant math and
must stay unit-testable in isolation. Cesium-specific glue (terrain sampling, entity
rendering) belongs in `src/hooks` and `src/components`.

## Tech stack

- React + TypeScript + Vite (static SPA)
- CesiumJS + Resium (3D globe/terrain), via `vite-plugin-cesium`
- `@turf/destination`, `@turf/distance`, `@turf/bearing` for geodesy
- Vitest for unit tests on `src/lib`
- No state library (plain React state) — scope doesn't justify one

## Structure

```
src/
  components/   CesiumMap, ParametersPanel, LandingInfoPanel, ApproachOverlay, SummaryPanel, Legend
  lib/          glide.ts, approach.ts, terrainProfile.ts, geo-constants.ts  (pure, tested)
  hooks/        useTerrainElevation.ts, useReachability.ts                  (Cesium-aware glue)
  types/        domain.ts
```

## Commands

- `npm run dev` — dev server
- `npm run build` — `tsc -b && vite build`, then `postbuild` runs `scripts/fix-cesium-assets.mjs`
  automatically (also what CI/deploy run)
- `npm run test` — Vitest, single run (`npm run test:watch` for watch mode)
- `npm run lint` — ESLint
- `npm run format` — Prettier write

## Environment

Requires a free Cesium ion access token (https://ion.cesium.com/tokens) for terrain +
imagery. Copy `.env.local.example` to `.env.local` and set `VITE_CESIUM_ION_TOKEN`.
`.env.local` is gitignored (matched by the `*.local` rule) — never commit a real token.
The same variable name is used as a GitHub Actions repo secret (`VITE_CESIUM_ION_TOKEN`)
so `deploy.yml`/`ci.yml` can inject it at build time.

GitHub Pages base path is `/forced-landing-planner/`, set in `vite.config.ts`. If the repo
is ever renamed, update `base` there to match.

## Status

- [x] Phase 0 — scaffolding (Vite/React/TS, Cesium/Resium/Turf/Vitest installed, lint/test/
      build wired, GitHub Actions CI + Pages deploy workflows, ion token configured)
- [x] Phase 1 — 3D map + event point selection. `CesiumMap` (globe flown to Israel on load,
      click-to-place via `scene.globe.pick`), `EventPointPanel` (altitude input, ground
      elevation via `sampleGroundElevationFt`/`sampleTerrainMostDetailed`), wired in `App.tsx`.
      Verified in a real browser (Playwright): click places the marker at correct lat/lon,
      terrain elevation resolves, no console errors.
- [x] Phase 2 — glide parameters + reachability circle. `ParametersPanel` (glide ratio, best
      glide speed, wind speed/direction), `computeReachabilityCircle` in `src/lib/glide.ts`
      (unit-tested in `glide.test.ts`), rendered as a cyan wind-shifted circle + yellow
      still-air reference circle, both `HeightReference.CLAMP_TO_GROUND`.
- [ ] Phase 3 — landing site selection + feasibility + terrain clearance
- [ ] Phase 4 — approach plan overlay
- [ ] Phase 5 — polish

### Known gotchas hit so far

- `vite-plugin-cesium`'s default export needs `moduleResolution: "bundler"` in
  `tsconfig.node.json` (not `nodenext`) — under `nodenext`, TS resolves its `.d.ts` as a CJS
  ambient declaration (the package has no `"type": "module"`) and the default import comes
  back as a non-callable namespace object.
- Resium's `<Viewer ref={...}>`: don't fly the camera in a `useEffect(() => {...}, [])` with a
  plain `useRef` — it can run before Resium attaches `.cesiumElement` to the ref, and the
  `flyTo` silently no-ops (camera stays at Cesium's default whole-globe view). Use the
  declarative `<CameraFlyTo once destination={...} />` as a child of `<Viewer>` instead (see
  `CesiumMap.tsx`) — `once` is required, or resium re-fires `camera.flyTo` on every render
  (any state change anywhere would snap the camera back). Confirmed against a sibling
  project, see below.
- `vite-plugin-cesium` + a non-root `base` (needed for a GitHub Pages *project* site, e.g.
  `/forced-landing-planner/`) — the plugin's `closeBundle` hook copies Cesium's static
  assets to `<outDir>/<base>/cesium/...` instead of `<outDir>/cesium/...`, double-applying
  `base` (which should only prefix URLs, not the physical build output). The built
  `index.html` correctly requests `/<base>/cesium/...`, so the files end up nested one
  level too deep and 404 in production (dev server is unaffected — it serves the plugin's
  own middleware, not the built files). Fixed with a post-build step,
  `scripts/fix-cesium-assets.mjs`, run as part of `npm run build`, that flattens the extra
  nesting. If the repo is ever renamed, update the `BASE_SEGMENT` constant in that script
  alongside `base` in `vite.config.ts`.
- GitHub Pages "Source" defaults to "Deploy from a branch", not "GitHub Actions" — if the
  live site serves the raw unbuilt `index.html` (references `/src/main.tsx`, 404s in the
  console), check Settings → Pages → Build and deployment → Source. Changing that dropdown
  does not itself trigger a redeploy — push a commit (or re-run the workflow) afterwards.

## Cross-project learnings

[arielf-idra/flight-pattern](https://github.com/arielf-idra/flight-pattern) is a sibling
Vite + React + Cesium/Resium app (visualizes an airport traffic pattern in 3D, same author,
same GitHub Pages deployment shape) built and hardened before this one. Worth re-reading its
`CLAUDE.md` when working on Phase 3/4 here — it independently hit and documented:

- **The exact same `vite-plugin-cesium` double-base-path asset bug** (its
  `scripts/fix-cesium-assets.mjs` is effectively the same fix as ours, confirming it's a
  real plugin bug, not something we misconfigured).
- **`PolylineGraphics` at a real altitude above terrain silently vanishes** wherever the
  terrain later rises above the line's altitude — Cesium depth-tests the line against the
  terrain mesh. Fix: every such polyline needs `depthFailMaterial` set to the same
  color/material as `material`. **Directly relevant to Phase 3's terrain-clearance line and
  Phase 4's approach-plan legs**, both of which are lines at altitude over terrain — add
  `depthFailMaterial` to them from the start rather than rediscovering this via a visually
  "truncated" line over hilly terrain (their LLIB/RWY33 case).
- **Point/label entities above terrain need `disableDepthTestDistance={Number.POSITIVE_INFINITY}`**
  (not a `PolylineGraphics` prop — that one only takes `depthFailMaterial`) to stay visible
  through terrain rather than being occluded. Relevant to Phase 4's High Key/Low Key/base/
  final markers and labels.
- **Cesium renders a dead gray screen with no error/exception if fed a NaN position or
  orientation** (e.g. from a degenerate near-zero-length segment in computed geometry) —
  worth a sanity check on computed points before handing them to `Cartesian3.fromDegrees`
  once Phase 3/4 introduce more derived geometry (terrain-profile sampling, key-position
  placement), rather than assuming a blank map means a network/token problem.
- `globe.tileCacheSize` (default ~100) is worth raising if a feature revisits the same small
  area repeatedly (their cockpit-view flythrough); likely not needed for this app's
  click-once-per-scenario usage pattern, but worth knowing if terrain reloading is ever
  visibly janky.
- Uses React 18 / Cesium ~1.121 / Vite 6 vs. this repo's React 19 / Cesium ~1.144 / Vite 8 —
  noticeably older toolchain, so it won't have hit issues specific to our newer versions.

Keep this file and `README.md` updated as phases land — don't let them drift from what's
actually implemented.
