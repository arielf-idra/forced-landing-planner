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
- `npm run build` — `tsc -b && vite build` (also what CI/deploy run)
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
- Resium's `<Viewer ref={...}>`: don't fly the camera in a `useEffect(() => {...}, [])` with
  a plain `useRef` — it can run before Resium attaches `.cesiumElement` to the ref, and the
  `flyTo` silently no-ops (camera stays at Cesium's default whole-globe view). Use a callback
  ref that fires exactly when the instance becomes available instead (see `CesiumMap.tsx`).

Keep this file and `README.md` updated as phases land — don't let them drift from what's
actually implemented.
