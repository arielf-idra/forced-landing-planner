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
  downwind by `windSpeed * t`**, not an ellipse. Implemented in `src/lib/glide.ts`. This
  circle is still a flat 2D model — it doesn't account for the landing point's own elevation
  or terrain in between; that's what the terrain-clearance check below adds for a *specific*
  candidate landing point, on top of (not instead of) the circle.
- **Terrain clearance**: sample terrain height along the direct ground track from event to
  landing point, compare against the assumed constant-gradient glide path (`1/glideRatio`),
  flag if terrain pokes above it. Split across two files: `sampleTerrainProfile` in
  `src/lib/terrain.ts` (Cesium-dependent sampling) produces the profile,
  `checkTerrainClearance` in `src/lib/terrainProfile.ts` (pure, unit-tested) evaluates it.
- **Landing strip detection**: once a landing point is picked, `src/lib/fieldLookup.ts`
  queries the Israel Ministry of Agriculture's public agricultural-parcel ArcGIS layer for
  the field polygon at that point (exact point, then a small buffered envelope for a
  near-miss). `src/lib/landingStrip.ts`'s `estimateStripFromPolygon` (pure, unit-tested)
  takes the polygon's farthest-apart pair of vertices as the field's long axis, inset 10%
  from each end. No field found → falls back to a short default manual strip the user drags
  into place. **Both endpoints are always user-draggable regardless of source** —
  field-suitability is a pilot judgment call, never fully automated.
- **Approach plan**: Downwind (1500 ft AGL default, abeam the touchdown point) → Base (1000 ft
  AGL, on the downwind leg) → Final (500 ft AGL, 500 m before the landing threshold, on the
  extended centerline) → Touchdown (1/3 of the way along the strip from the threshold — margin
  for undershoot). Geometry confirmed against a hand-drawn diagram from the user, not a
  generic rectangular-pattern guess — see `src/lib/approach.ts`'s doc comment for the full
  derivation. All three altitudes are fixed briefed targets, **not** derived from glide
  ratio — unlike the reachability circle, this represents a maneuvering descent. Landing
  heading defaults to whichever of the strip's two directions is closer to into-wind
  (`defaultLandingHeadingDeg`), editable afterward.
- Defaults (glide ratio ~9:1, best glide ~65 KIAS, approach altitudes) live in
  `src/lib/geo-constants.ts` and are starting points, always user-editable in the UI — never
  hardcode them elsewhere.

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
  components/   CesiumMap, EventPointPanel, ParametersPanel, LandingInfoPanel,
                ApproachPanel, WindIndicator
                (SummaryPanel, Legend — Phase 5, not built yet)
  lib/          glide.ts, terrainProfile.ts, landingStrip.ts, approach.ts,
                geo.ts, geo-constants.ts, units.ts, runwayTexture.ts         (pure, tested)
                terrain.ts, cesiumIonSetup.ts, fieldLookup.ts                (Cesium/network-dependent glue)
  types/        domain.ts
```
`geo.ts` holds shared geodesy helpers (`destinationPoint`/`distanceMeters`/`bearingDegrees`,
thin wrappers over `@turf/*`) — reuse these instead of calling turf directly in new pure-lib
code, to avoid re-deriving the same `{lon,lat}` ↔ turf-array conversion in every file.

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
- [x] Phase 1 — 3D map + event point selection. `CesiumMap` (globe flown to a default view on
      load, click-to-place via `scene.globe.pick`), `EventPointPanel` (altitude + heading
      inputs, ground elevation via `sampleGroundElevationFt`/`sampleTerrainMostDetailed`),
      wired in `App.tsx`. The event point renders as a top-down Cessna 172 PNG icon
      (`public/aircraft-icon.png`, user-supplied artwork) via `BillboardGraphics`, rotated to
      `eventPoint.headingDeg`. Interaction model: the *first* map click places the event
      point, the *second* places the landing point; after that, plain clicks are no-ops and
      repositioning happens by **dragging** the marker itself (or the small white heading
      handle, which sets heading by dragging — see `CesiumMap`'s generic drag support below).
      Verified in a real browser (Playwright): placement, both drags, and typing a heading
      directly all update state correctly, no console errors.
- [x] Phase 2 — glide parameters + reachability circle. `ParametersPanel` (glide ratio —
      defaults to C172's ~1.5 NM/1,000 ft, best glide speed, wind speed/direction),
      `computeReachabilityCircle` in `src/lib/glide.ts` (unit-tested in `glide.test.ts`),
      rendered as a cyan wind-shifted circle + yellow still-air reference circle, both
      `HeightReference.CLAMP_TO_GROUND`. Wind also drives `WindIndicator`, a fixed top-left
      screen-space (not geo-anchored) reference widget — a white comet-shaped arrow rotated
      via CSS `transform: rotate()`, wind speed/direction printed on the shaft.
- [x] Phase 3 — landing site selection + feasibility + terrain clearance. `LandingInfoPanel`
      (distance/bearing, in-range margin via `checkReachability`, terrain clearance via
      `checkTerrainClearance`), landing marker + event↔landing connector line color-coded
      green (reachable and clear) or orange (either check fails). Same click-then-drag
      interaction model as the event point.
- [x] Phase 4 — landing strip detection + approach plan overlay. `fieldLookup.ts` queries the
      Israel Ministry of Agriculture ArcGIS parcel layer at the landing point;
      `estimateStripFromPolygon` derives a draggable strip from the result (or a manual
      default if no field data). The strip renders as an actual stretchable runway graphic
      (`runwayTexture.ts`, an `ImageMaterialProperty` on the strip's `PolylineGraphics` —
      Cesium maps the image along the line's length, so it stretches to fit automatically)
      plus a highlighted outline of the detected field polygon. `approach.ts` computes the
      Downwind/Base/Final/Touchdown checkpoints from the strip + landing heading;
      `ApproachPanel` exposes heading, turn direction, and the altitude/distance defaults.
      All rendered at absolute altitude with `depthFailMaterial`/`disableDepthTestDistance`
      per the gotchas below. A dashed leg (`routeToPatternMaterial`) connects the event point
      to the Downwind checkpoint, so the full route is planned end to end, not just the
      pattern in isolation. Verified against real Ministry-of-Agriculture field data in a
      real browser (both the detected-field and no-field-found/manual paths, plus dragging
      both strip endpoints and confirming the pattern recomputes from the new strip).
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
- `viewer.scene.pick()` returns an `Entity` for **any** entity under the cursor, including
  ones that never got an explicit `id` prop — Cesium auto-assigns a random UUID `.id` to
  those. A drag-detection handler that treats "picked *any* entity" as "start a drag" will
  misfire on decorative/non-interactive entities (here: the reachability circles and the
  event↔landing connector line, which are mostly-filled and cover a lot of screen area) —
  this silently ate every click meant to place a landing point inside the circle. Fix:
  `CesiumMap` takes an explicit `draggableEntityIds: ReadonlySet<string>` prop and only
  starts a drag when the picked id is in that set; everything else falls through to a plain
  map click. Only entities that are meant to be draggable should get an explicit `id` at all.
- A Cesium billboard `image` given as an SVG data URI needs explicit `width`/`height`
  attributes on the root `<svg>` — a `viewBox` alone can rasterize to invalid/zero
  dimensions, which then fails uploading as a WebGL texture (`texSubImage2D: bad image
  data`, rendering as a solid black box instead of the icon). Ended up switching to a real
  PNG (`public/aircraft-icon.png`) instead of an inline SVG, sidestepping this class of
  issue entirely.
- `BillboardGraphics` heading: `alignedAxis: Cartesian3.UNIT_Z` makes the billboard's "up"
  point true north (regardless of camera orientation — more robust than `WindIndicator`'s
  CSS-rotation approach, which assumes a north-up camera); combine with
  `rotation: -CesiumMath.toRadians(headingDeg)` — **negated**, because Cesium's `rotation` is
  counterclockwise while compass heading is clockwise (confirmed via Cesium's own doc
  example: `alignedAxis = UNIT_Z; rotation = -PI_OVER_TWO` points the billboard east).
- A UI handle positioned at a **fixed real-world distance** from a marker it's meant to be
  visually/functionally distinct from is fragile — the heading-handle drag target sat only
  800 ft from the event point, which at typical map zoom (framing a reachability circle tens
  of thousands of feet across) rendered close enough to overlap the aircraft icon on screen,
  so drags meant for the plane picked up the handle instead. Fixed by scaling the handle
  distance as a fraction of the reachability circle's own radius
  (`HEADING_HANDLE_DISTANCE_FRACTION`) instead of a fixed feet value — same lesson as the
  original wind-arrow-length choice in Phase 2, just rediscovered the hard way.
- **Field-boundary data source**: tried OpenStreetMap's Overpass API first for agricultural
  field polygons — coverage was poor (an exact-point query at a real test coordinate found
  nothing; a small-radius search mostly surfaced huge administrative/reserve polygons, not
  individual fields). The Israel Ministry of Agriculture's public "חלקות חקלאיות" ArcGIS
  FeatureServer (`services3.arcgis.com/.../FeatureServer/0/query`, `f=geojson`,
  `spatialRel=esriSpatialRelIntersects`, no key needed) returns real individual field
  polygons with crop/area attributes — verified live via curl and reused directly in
  `fieldLookup.ts`. Worth checking for an official/government open-data layer before reaching
  for OSM on anything land-use-specific in Israel.
- **Agricultural parcel boundaries shift over time** — an exact point that returned a field
  polygon earlier in the same session later returned nothing at the identical coordinate (a
  wider radius search still found the same crop nearby, confirming the dataset itself was
  fine — the parcel boundary had just moved slightly, presumably from a data refresh).
  `fieldLookup.ts`'s near-miss buffer (~30 m) and the always-available manual-strip fallback
  exist specifically for this — don't assume a field polygon found once will always be found
  again at that exact point.
- **A Cesium `PolylineGraphics` image `material` stretches to fit the line's length** — the
  U axis maps along the polyline, V across its width — so a single wide texture (the runway
  graphic in `runwayTexture.ts`) automatically fits whatever length the strip endpoints
  define, no manual scaling math needed. Same SVG-needs-explicit-`width`/`height` requirement
  as the billboard icon applies here too.
- **`PolygonGraphics` with `HeightReference.CLAMP_TO_GROUND` logs the same "outlines are
  unsupported on terrain" warning** we'd already seen on the reachability-circle ellipses —
  benign, the fill still renders and reads fine (used for the highlighted field-boundary
  polygon); harmless console noise, not a rendering bug.
- **A small `PointGraphics` drag handle sitting on top of a wide `PolylineGraphics` loses the
  pick to the line, not the point** — the landing-strip's draggable endpoint handles
  (`pixelSize={10}`) sat directly on the 26px-wide runway polyline; clicking anywhere on the
  visible runway graphic (not the exact ~5px handle radius) picked the polyline's
  auto-generated id instead, which isn't in `draggableEntityIds`, so the drag silently fell
  through to Cesium's default camera-rotate gesture — the strip (and everything downstream
  computed from it: the whole Downwind/Base/Final/Touchdown pattern) looked like it "wasn't
  updating" on drag, when actually the drag was never starting at all. Fixed by bumping the
  handles to `pixelSize={22}` for a pick target that reliably wins. Same root lesson as the
  heading-handle-overlapping-the-aircraft-icon gotcha above — verify a fix like this by
  checking whether the *underlying state* actually changed (e.g. the strip's `source`
  flipping to `'manual'`), not just that a screenshot looks plausible; a picking miss that
  falls through to native camera panning can look like nothing-happened rather than an
  error.

## Cross-project learnings

[arielf-idra/flight-pattern](https://github.com/arielf-idra/flight-pattern) is a sibling
Vite + React + Cesium/Resium app (visualizes an airport traffic pattern in 3D, same author,
same GitHub Pages deployment shape) built and hardened before this one. Worth re-reading its
`CLAUDE.md` before touching the approach-overlay rendering (`App.tsx`'s Downwind/Base/
Final/Touchdown block) or adding anything that renders geometry at real altitude. Uses React
18 / Cesium ~1.121 / Vite 6 vs. this repo's React 19 / Cesium ~1.144 / Vite 8 — noticeably
older toolchain, so it won't have hit issues specific to our newer versions. Lessons pulled
from it (Phase 3/4 are now built and these were all applied — kept here as the reference for
why, not as forward-looking guesses):

**Already fixed here, confirmed not a one-off:**
- The exact same `vite-plugin-cesium` double-base-path asset bug (their
  `scripts/fix-cesium-assets.mjs` is effectively the same fix as ours) — a real plugin bug,
  not something we misconfigured.
- The `CameraFlyTo once` pattern in `CesiumMap.tsx` matches their `CesiumViewer.tsx` exactly.

**Directly relevant to Phase 3 (terrain clearance) / Phase 4 (approach overlay):**
- **`PolylineGraphics` at a real altitude above terrain silently vanishes** wherever terrain
  later rises above the line's altitude — Cesium depth-tests it against the terrain mesh
  like any other primitive, even though the line's coordinates are correct. Fix:
  `depthFailMaterial` set to the same color/material as `material`:
  `<PolylineGraphics positions={p} width={3} material={color} depthFailMaterial={color} />`.
  Add this by default to Phase 3's terrain-clearance line and Phase 4's approach-plan legs —
  both are lines at altitude over terrain — rather than waiting to discover a visually
  "truncated" line over hilly terrain (their LLIB/RWY33 case; Israel has plenty of terrain
  this could bite on, e.g. the Galilee or Judean hills).
- **Point/label entities need `disableDepthTestDistance={Number.POSITIVE_INFINITY}`** to
  stay visible through terrain — `PointGraphics`, `LabelGraphics`, `BillboardGraphics` all
  support this prop; `PolylineGraphics` does not (use `depthFailMaterial` there instead).
  Used on Phase 4's Downwind/Base/Final/Touchdown markers and labels.
- **Absolute heights vs. `HeightReference.CLAMP_TO_GROUND`**: our Phase 2 reachability circle
  correctly uses `CLAMP_TO_GROUND` — it represents a footprint *on* the ground. But Phase 3's
  terrain-clearance line and Phase 4's approach-plan legs/markers represent a real altitude
  the aircraft would be flying at, which is the whole point of drawing them — use absolute
  `Cartesian3.fromDegrees(lon, lat, feetToMeters(altFt))` positions for those, not
  terrain-clamping. Clamping ties height to terrain-tile resolution/accuracy, which varies by
  location/zoom; absolute heights render identically regardless.
- **Cesium renders a dead gray screen with no error/exception given a NaN position or
  orientation** (e.g. from a degenerate near-zero-length segment in computed geometry) —
  sanity-check computed points (`Number.isFinite`) before handing them to
  `Cartesian3.fromDegrees` once Phase 3/4 introduce more derived geometry (terrain-profile
  sampling, key-position placement), rather than assuming a blank map means a
  network/token problem.
- **Geodesy building blocks, beyond what `glide.ts` already uses** (`@turf/destination`,
  `@turf/distance`, `@turf/bearing`): the sibling project also leans on a line-intersection
  primitive (`intersectLines(p1, bearing1, p2, bearing2)`, infinite bearing-rays not segments
  — `@turf/line-intersect` works on actual segments/strings, which isn't quite the same
  shape) for reconstructing a corner from two fixed headings. Not needed for the currently
  straight-line Downwind/Base/Final/Touchdown legs we actually built, but relevant if the
  approach overlay ever wants a corner derived from two heading constraints rather than a
  plain bearing+distance placement.
- **Curved turn arcs** (fillet-curve geometry: tangent distance `radius * tan(deflection/2)`
  from a corner along each leg, arc center found via the offset-parallel-lines intersection
  above, tangent heading at any arc point is `bearing ± 90°` from the arc center) are what
  the sibling project uses to make its animated aircraft bank through a real curve instead of
  pivoting at a corner. Speculative for us — only relevant if a future polish pass wants
  curved corners in the approach-plan overlay instead of sharp angles between legs; not
  needed for the straight-leg Downwind/Base/Final/Touchdown plan we actually built.

**General resium/Cesium patterns, keep in mind as the scene grows:**
- resium doesn't wrap everything — `createOsmBuildingsAsync()`, `viewer.scene.primitives`,
  `viewer.camera.setView`, etc. have no declarative component. Reach for `useCesium()` to get
  the live viewer and drive it imperatively in a `useEffect` when resium has no component for
  something.
- `globe.tileCacheSize` (default ~100) is worth raising (e.g. 1000) once, globally, if a
  feature revisits the same small area repeatedly (their looping cockpit flythrough);
  unlikely to matter for this app's click-once-per-scenario usage, but worth knowing if
  terrain reloading is ever visibly janky.
- A glTF aircraft model's baked-in axis orientation and Cesium's `HeadingPitchRoll`
  convention (local frame is `+Y = forward`, `+X = east/right`, `+Z = up` — not the
  intuitive-but-wrong `+X = forward`) only matters if a future phase adds an animated 3D
  aircraft (not currently planned here — see their `AircraftEntity.tsx`/`CockpitCamera.tsx`
  if that ever happens). Their hard-won caution: fixing model-orientation bugs by composing a
  correction quaternion instead of summing correction degrees into one `HeadingPitchRoll`
  Euler call sounds like the theoretically-correct fix for gimbal-lock artifacts, but made
  their result visibly worse in practice — don't apply that "fix" from theory alone, only
  with a tight visual feedback loop, ready to revert.

**Verifying geometry math without a browser:**
- `npx tsx some-script.ts` against the real files in `src/lib` (not reimplemented copies) is
  fast for catching sign errors and NaN-producing edge cases before loading the page — but
  Vitest (`glide.test.ts`) already covers this role here, so reach for a throwaway `tsx`
  script only for one-off exploration, not as a substitute for a real test.
- Careful with `import.meta.env` at module scope (e.g. `cesiumIonSetup.ts` reads
  `VITE_CESIUM_ION_TOKEN`) — a file referencing it can't be imported directly by a standalone
  Node/`tsx` script outside Vite. Doesn't affect `src/lib` (deliberately framework-agnostic,
  no env access), but keep it in mind if that ever changes.
- For actual visual confirmation (not just "the math doesn't throw"): headless Chromium via
  Playwright against the Vite dev server, `page.goto` the dev URL, wait for the initial
  tile/terrain load, drive the UI, screenshot. This is the approach already used to verify
  Phase 1/2 in this repo (see git history) and the deployed site — it's the only reliable way
  to confirm a rendered circle/line/marker position actually looks right, not just that it's
  numerically well-formed. `npx playwright install chromium` if not already cached. Run it
  from an isolated scratch directory (`npm install playwright` there, not in this repo) so it
  doesn't become a project dependency — and see the note elsewhere in this session about not
  killing Chrome processes by image name, since that can hit the user's own browser.

Keep this file and `README.md` updated as phases land — don't let them drift from what's
actually implemented.
