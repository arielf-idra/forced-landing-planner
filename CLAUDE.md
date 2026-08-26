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
  heading defaults to whichever of the strip's two directions needs *less transit
  maneuvering* from the event point (`preferredLandingHeadingDeg` — computes both
  directions' full approach plan and transit route, compares total transit distance, and
  falls back to whichever is closer to into-wind — `defaultLandingHeadingDeg` — only when the
  two are within `MANEUVER_COST_TIE_MARGIN_FT` of each other), editable afterward. Landing
  one way can put Downwind almost directly ahead of the aircraft; landing the other way can
  put it nearly behind, forcing a much longer transit turn — usually a bigger practical
  concern than a small wind misalignment. Dragging either strip endpoint re-derives the
  landing heading from the strip's new orientation (not just its new position, and still via
  the plain into-wind `defaultLandingHeadingDeg` here, not the maneuver-cost comparison — a
  drag re-tracks orientation continuity from whatever heading was already chosen, it doesn't
  re-evaluate the transit tradeoff), so the whole pattern rotates to match, not just
  translates.
- **Transit route (event point → pattern entry)**: `src/lib/route.ts`'s `buildHeadingLegRoute`
  builds the path from the aircraft's nose (event point offset forward along its heading by
  `AIRCRAFT_NOSE_OFFSET_PX` screen pixels, converted to a real-world distance via the camera's
  live meters-per-pixel at the event point — not the icon's anchor/center point, and not a
  fixed real-world distance either — see gotcha below for why) to the approach plan's Downwind
  checkpoint. Currently called with `legDistanceFt=0` — a **single straight line**, no turn
  geometry at all — after two more elaborate designs (a constant-radius turn arc; a turn arc
  plus a short heading-establishing leg) were each tried, shipped, and reverted following
  real, reproducible bugs (turn-direction selection, wind-drift-during-turn, and a heading leg
  that flew *away* from Downwind before correcting when the required turn was large — see
  gotchas below for the full history). `buildHeadingLegRoute`'s optional heading leg
  (`legDistanceFt` param, `NOSE_HEADING_LEG_NM` constant) is kept and still tested, in case a
  future version reintroduces it capped to small turn angles only. `roundCorners` (same file)
  still rounds the pattern's Base and Final corners to the transit turn radius — that geometry
  was verified separately and never shared the transit route's bugs. The transit route and the
  rounded pattern render as one continuous line, single style throughout (`App.tsx`'s
  `combinedRoutePositions`), not a dashed transit leg plus separate solid pattern legs.
  `altitudesAlongPath` assigns each rounded-path point an altitude by its distance fraction
  along the *original* straight-line waypoint chain — exact at each real waypoint, approximate
  only on the cut-corner arc samples. `pointAtDistance` interpolates position/altitude along
  the transit route for the altitude (MSL + AGL) callouts placed every
  `ALTITUDE_CALLOUT_INTERVAL_NM` (0.5 NM).
- **Camera auto-framing**: `CesiumMap`'s `flyToRegion` prop drives an imperative
  `viewer.camera.flyTo` (not the one-shot `<CameraFlyTo once>` used for the initial default
  view) to frame the reachability circle, with `FLY_TO_MARGIN_FACTOR` (1.3×) of padding,
  whenever the event point is placed, finishes being dragged, or its altitude/glide
  ratio/wind changes — anything that moves or resizes the circle — but not on every
  intermediate position during a drag itself (`App.tsx` gates this on `!isDragging`).
- Defaults (glide ratio ~9:1, best glide ~65 KIAS, wind 5 kt from the west, approach
  altitudes) live in `src/lib/geo-constants.ts` and are starting points, always user-editable
  in the UI — never hardcode them elsewhere.

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
  lib/          glide.ts, terrainProfile.ts, landingStrip.ts, approach.ts, route.ts,
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
      per the gotchas below. A dashed leg, now built by `route.ts`'s `planRouteToTarget`
      (constant-radius turn from the event point's heading, then straight, radius from best
      glide speed + a 30° max bank default), connects the event point to the Downwind
      checkpoint with altitude callouts every 0.5 NM (`pointAtDistance`) — a flyable transit,
      not an instant-turn straight line. The strip-estimation axis is clipped to the field
      polygon's interior (longest contiguous inside run, handles non-convex/L-shaped fields —
      see `landingStrip.ts`'s `clipSegmentToPolygon`) so a suggested strip never extends past
      the actual field boundary. Verified against real Ministry-of-Agriculture field data in
      a real browser (both the detected-field and no-field-found/manual paths, dragging both
      strip endpoints and confirming the pattern's position *and* heading recompute from the
      new strip, and the turn-radius route + altitude callouts rendering correctly).
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
- **The farthest-vertex-pair axis for a non-convex field can cut outside the polygon** — a
  straight line between the two farthest-apart ring vertices of an L-shaped (or otherwise
  concave) field can pass through a notch that isn't part of the field at all, even though
  both endpoints individually sit inside it (so a naive first/last-inside-sample clip would
  miss the gap). `landingStrip.ts`'s `clipSegmentToPolygon` fixes this by sampling the
  candidate segment and keeping the *longest single contiguous run* of inside samples, not
  just the outermost inside samples — caught by an L-shaped-field unit test, not by eyeballing
  a convex rectangle fixture.
- **Tangent-point-on-a-circle geometry: `arccos(radius/distance)`, not `arcsin`** —
  `route.ts`'s `findTangentPoint` computes the angle at the turn circle's center between the
  bearing to the target and the bearing to the tangent point. In the right triangle
  (center, tangent point, target) the right angle is *at the tangent point* (a tangent line
  is perpendicular to the radius), so `radius/distance` is the ratio adjacent to the center's
  angle over the hypotenuse — that's `cos`, not `sin`. Using `asin` instead produced the
  *complementary* angle, which put the "tangent point" candidates roughly 90° away from the
  real tangent points; every downstream check (exit-velocity-matches-bearing-to-target)
  still ran without throwing, it just silently picked a wrong-but-plausible-looking point,
  producing an arc whose exit heading kinked ~80° off the following straight leg instead of
  rolling out smoothly. Caught by a unit test asserting tangent continuity (<5° kink), not by
  visual inspection — the wrongness isn't obvious from a screenshot at typical zoom. If a
  similar circle/external-point tangent construction comes up again, derive the angle from
  the right triangle explicitly (which side is opposite/adjacent to which angle) rather than
  reaching for `asin` vs `acos` from memory.
- **Adding a `useEffect` that reads a ref makes the React Compiler ESLint rule
  (`react-hooks/immutability`) flag *other, pre-existing* direct mutations through that same
  ref elsewhere in the component** — even plain event-handler functions (not effects) that
  imperatively set a Cesium object property (e.g. `CesiumMap`'s `handleLeftDown`/`handleLeftUp`
  toggling `viewer.scene.screenSpaceCameraController.enableInputs`) start erroring the moment
  *any* effect in the same component also reads `viewerRef.current`, as `flyToRegion`'s
  camera-framing effect does. The mutations themselves are fine (imperative Cesium glue
  outside React's render cycle, the same pattern already used throughout `CesiumMap`) — this
  is the static analysis being conservative about a ref now being "effect-tracked," not a real
  bug. Fixed with a targeted `// eslint-disable-next-line react-hooks/immutability` at each
  flagged mutation site, same as the existing `react-hooks/set-state-in-effect` suppression
  already used for the terrain-profile-sampling effect's synchronous `setIsSamplingProfile`
  call. Expect this to recur if a new effect starts reading `viewerRef` — check for newly
  flagged mutations elsewhere in the file, not just the new effect itself.
- **`planRouteToTarget` picking a turn direction from the sign of the heading difference alone
  breaks down badly for a near-reversal target** (event point heading close to 180° away from
  the bearing to Downwind — not a rare configuration; it just depends on where the user drags
  the event point and its heading relative to wherever the strip/pattern ends up). "Target to
  the right → turn right" is a fine heuristic normally, but near an exact reversal the *other*
  direction can be dramatically shorter — one direction found in testing needed a 223° sweep
  around the turn circle (visibly a huge, nonsensical loop swinging away from the target before
  correcting) where the other needed a normal reversal-turn's worth (~140–180°). Reported by
  the user as "the connection from route to pattern doesn't make sense, it's not a physical
  turn" — a real bug, not just an ugly-but-technically-valid path: for that specific case the
  *shorter* direction was available and simply never tried. Fixed by computing the route for
  *both* turn directions (`buildTurnRoute`, called once per sign) and keeping whichever has
  the smaller `totalDistanceFt`, rather than committing to one direction upfront. Note this
  doesn't (and can't) make a genuine ~180° reversal cheap — flying a same-radius turn to
  reverse course inherently costs about half the turn circle's circumference no matter which
  way you turn (confirmed: for an exact 180° case the two directions are equidistant by
  symmetry, so "try both" doesn't help *that* specific case, only asymmetric near-reversals
  where one direction really is shorter) — that's a real physical cost of the maneuver, not a
  bug. Caught by sweeping many heading/target combinations and flagging any route whose
  `totalDistanceFt` was disproportionate to the turn radius, not by eyeballing one scenario —
  the original 90°-turn unit test that shipped with this feature passed cleanly and gave no
  hint of the problem, since it never exercised a near-reversal heading. `roundCorners` (the
  pattern's own corner rounding) does **not** share this bug — it derives its turn direction
  from the actual known deflection angle between two explicit leg bearings (an unambiguous
  fillet), not from picking between two candidate tangent points to an arbitrary external
  target, so there's no "which direction is shorter" question to get wrong there.
- **A large, sweeping loop near the event point in the transit route is not automatically a
  bug** — even after the turn-direction fix above (which picks whichever direction is
  *shorter*), a near-180° heading difference between the event point's heading and the
  bearing to Downwind is inherently expensive to fly with a single constant-radius turn: a
  same-radius course reversal costs roughly half the turn circle's circumference no matter
  which way you turn (confirmed via a sweep test — a 5 kt wind on top of an already-near-180°
  case shifted total distance by only ~160 ft, nowhere near enough to explain a dramatically
  larger loop; the loop's size is dominated by the turn radius and how far from "straight
  ahead" Downwind actually is, not by wind). Before treating a big loop as a bug, check the
  actual heading difference between the event point and Downwind — if it's genuinely close to
  180°, this is the aircraft correctly flying most of a circle to reverse course, not a
  miscalculation. Verify with the same sweep-test technique as the turn-direction bug (vary
  bearing/distance/wind and look for a route whose direction choice or distance changes
  *unexpectedly* between similar inputs) before assuming the geometry itself is wrong.
- **The transit route's start ("the aircraft's nose") needs a *live, per-frame* pixel-to-
  meters conversion to track the aircraft billboard icon correctly at arbitrary zoom — no
  real-world-distance offset, fixed or scaled, can do this.** The icon renders at a fixed
  *pixel* size (`scale=0.2` billboard, no distance-based scaling) regardless of camera zoom,
  so any constant real-world offset renders at a different pixel size every zoom level: a
  fixed ~13 ft offset (half the C172's length) was invisible at the zoom levels this app
  operates at; scaling it to a fraction of the reachability circle's radius made it visible at
  the zoom the auto-zoom feature settles on but wrong everywhere else, and — the actual bug
  the user caught by name ("using the location of the left wing instead of the nose") — even
  a visible-enough offset can still land *inside* the icon's own rendered footprint if it's
  smaller than the icon's half-length, in which case the route's start is invisible (occluded
  by the icon) and what you actually see is wherever the arc's curve happens to first poke out
  from behind it — which side that is depends on which way the turn goes, not on the aircraft's
  heading, so it can easily look like it's coming from a wingtip or the tail. `aircraft-
  icon.png` is 320×267 px source, ~64×53 px rendered at `scale=0.2` — an offset has to clear
  *that* footprint (`AIRCRAFT_NOSE_OFFSET_PX` = 45, found by actually reading the PNG's IHDR
  chunk for its pixel dimensions rather than guessing from scale alone) before "does it track
  zoom" even matters. Fixed properly: `CesiumMap` takes `pixelScaleReferencePosition` (the
  event point) and reports live meters-per-pixel there via `onMetersPerPixelChange`, computed
  on every `viewer.scene.postRender` frame (throttled to only re-report past a ~2% change) —
  not just at discrete moments like a flyTo, since the user must be able to manually zoom
  further than the auto-zoom's chosen level and still see the offset track correctly. `App.tsx`
  turns that into a real-world offset (`metersPerPixelAtEvent * AIRCRAFT_NOSE_OFFSET_PX`) for
  `nosePosition`. Verified across three different zoom levels in a real browser (not just one
  screenshot) — the earlier fraction-based attempt *looked* plausible in a single screenshot
  and still turned out wrong at a different zoom/heading combination.
- **A live per-frame Cesium event listener must not be re-subscribed on every position
  update, or a drag can hang the whole page** — the pixel-tracking effect above initially
  depended directly on `pixelScaleReferencePosition?.lat`/`.lon`, which change on nearly every
  `mousemove` sample while the caller is dragging the event point. Each change tore down and
  rebuilt a `viewer.scene.postRender` listener (plus a new `BoundingSphere`) — cheap once, but
  enough churn across dozens of drag-tick re-subscriptions to reliably hang the page during a
  drag in Playwright testing (confirmed by adding step-by-step logging: execution stopped
  exactly at the `mouse.move` call that generated the intermediate drag samples). Fixed by
  tracking the reference position and the callback in refs (updated via their own tiny
  effects, not written during render — the React Compiler's `react-hooks/refs` rule catches a
  direct `ref.current = x` in the render body) and setting up the `postRender` listener itself
  only once, gated on a `viewerReady` state flag rather than on the position. General lesson:
  anything hooked to `postRender`/`preRender`/similar high-frequency Cesium events should
  never have a *value that changes every frame* in its effect's dependency array — only
  *setup*-triggering conditions (viewer readiness, entity identity) belong there.
- **The real, final root cause of "the route doesn't start at the nose" — after the pixel-
  scale fix above was already correct and verified — was that the aircraft billboard and the
  route were rendered at different altitudes.** The billboard's `position` used
  `Cartesian3.fromDegrees(lon, lat)` (2-argument form — height defaults to 0, i.e. the
  ellipsoid surface / roughly ground level), while the route's first point used
  `Cartesian3.fromDegrees(lon, lat, feetToMeters(altitudeMslFt))` with `altitudeMslFt` equal
  to the event point's real flying altitude (e.g. 2000 ft MSL, ~1800 ft above ground in a
  typical scenario) — because, correctly per this file's own domain-model section, the route
  represents a real flying altitude and must use absolute height, not ground-clamping. Two
  points can share the exact same lat/lon and still project to *different screen pixels*
  under Cesium's tilted 3D camera if they sit at very different heights — and by how much
  differs continuously with the camera's zoom and tilt angle, which is exactly the "changes
  with zoom, connects to a different location around the plane" symptom that survived every
  attempted fix to the route's *geometry* (arc, straight line, heading-leg) — none of which
  could have fixed it, because the bug was never in the lat/lon math. Diagnosed by disabling
  the route line entirely and adding two plain `PointGraphics` debug markers — one at the
  event point's exact position, one at `nosePosition` — both still using the 2-argument
  ground-level `fromDegrees`. Both tracked perfectly across zoom, rotation, and dragging,
  which meant the *positions* were right and the *rendering height* was the only remaining
  variable — reading the route's own position code immediately confirmed the height mismatch.
  Fixed by giving the aircraft billboard (and, while debugging, the plain markers) the same
  3-argument `Cartesian3.fromDegrees(lon, lat, feetToMeters(eventPoint.altitudeMslFt))` the
  route already used. Lesson for any future "two things that should visually coincide don't"
  bug involving Cesium entities: check whether both are rendered at the *same height*
  (ground-clamped vs. absolute-altitude) before suspecting the lat/lon calculation — a
  same-lat/lon, different-height mismatch is invisible in the numbers (both points can print
  identical lat/lon in a debug readout) and only shows up as a camera-angle-dependent visual
  offset, which looks exactly like a flaky calculation bug but isn't one.
- **Fixing the billboard's render height (above) wasn't the whole fix — the meters-per-pixel
  *measurement point* had the identical bug, one layer deeper.** `CesiumMap`'s pixel-scale
  effect built its `BoundingSphere` at `Cartesian3.fromDegrees(pos.lon, pos.lat)` — ground
  level — even after the aircraft itself moved to real altitude. `camera.getPixelSize`'s
  result depends on distance from the camera to that exact 3D point, so measuring at the
  ground while the icon actually renders thousands of feet up returns a meters-per-pixel value
  for the wrong point — and the resulting nose offset can be wrong by several times its
  intended size, worse at higher altitude and at closer zoom (both increase the ground-vs-icon
  distance error relative to the total camera distance). This one hid behind the first fix:
  at the default 2000 ft scenario used throughout most of this session's testing the error was
  small enough to look fixed, and only became obviously wrong when the user tried a much
  higher altitude (4000 ft) — **always sweep a parameter's range (low/default/high), not just
  the value already being tested, before declaring a fix complete.** Fixed by threading
  `altitudeMslFt` through `pixelScaleReferencePosition` (now `LatLon & { altitudeMslFt?:
  number }`) so the `BoundingSphere` is built at the same real-altitude 3D point the icon
  actually renders at. The heading-handle line and its draggable point had the same
  ground-level-position bug (caught by the user, "check the heading white line, it seems not
  to be exactly on the nose") — fixed the same way, switched from `clampToGround` to absolute
  altitude at `eventPoint.altitudeMslFt`; its drag behavior is unaffected, since drag-target
  computation (`CesiumMap`'s `pickGround`) always ray-casts against the terrain regardless of
  where the entity is rendered, and initiating a drag (`scene.pick`) picks against the
  rendered scene, which correctly accounts for the entity's actual (now-elevated) screen
  position either way.

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
