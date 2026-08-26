# Forced Landing Planner

A web app to help Cessna 172 flight students plan a simulated forced landing (engine-out):
mark the event point (where the engine "fails"), see how far the aircraft can glide given
its glide ratio and the wind, pick a landing field, get a suggested landing strip within it,
and get a suggested Downwind/Base/Final approach down to touchdown.

This is a ground-planning / lesson-prep / debrief tool. It runs entirely in the browser —
no accounts, no server, nothing is saved between sessions.

**Status: early development.** Working so far: a 3D terrain map, click-to-place the
engine-failure event point (real terrain elevation, editable heading shown as a Cessna 172
icon, drag to reposition), a live reachable-glide circle driven by editable glide ratio and
wind, picking a landing point with a distance/bearing/in-range readout plus a
terrain-clearance check, an auto-suggested landing strip (from real Israeli agricultural
field-boundary data where available, otherwise drag one out yourself) rendered as a
stretchable runway graphic, and a Downwind/Base/Final/Touchdown approach plan built from
that strip. Only polish (Phase 5) is left — see [CLAUDE.md](./CLAUDE.md) for the
phase-by-phase plan and current progress.

## Methodology & assumptions

- **Reachable glide footprint** is modeled as a circle of radius `glideRatio * heightAGL`
  centered on the event point, shifted downwind by `windSpeed * time-to-ground`. This
  reflects that best-glide airspeed and sink rate (and therefore time aloft) don't depend
  on heading — only wind drift over that time does. It ignores altitude lost in turns and
  wind changing with altitude.
- **Terrain clearance** between the event point and a candidate landing point is checked
  against a constant-gradient glide path — it will not catch every real-world hazard
  (wires, towers, other obstacles beyond bare terrain).
- **Landing strip auto-detection** uses Israel's Ministry of Agriculture agricultural-parcel
  data — coverage isn't complete or perfectly current everywhere, and the suggested strip is
  a rough estimate (the field polygon's long axis) that says nothing about surface
  condition, crop height, or obstacles. Always visually verify against the satellite imagery
  and adjust by dragging — the app never treats this as more than a starting suggestion.
- **The Downwind/Base/Final/Touchdown altitudes are fixed planning targets**, not something
  derived from aircraft performance — they represent a maneuvering descent (turns, energy
  management), not a straight glide, so treat them as briefed checkpoints to fly toward
  rather than a guaranteed profile.
- **This is a training aid, not a substitute for your POH, instructor, or judgment.**
  Always cross-check with real performance data and instructor guidance.

## Development

Requires Node.js 20+.

```bash
npm install
cp .env.local.example .env.local   # then fill in a Cesium ion token, see below
npm run dev
```

### Cesium ion token

The 3D terrain/imagery requires a free Cesium ion access token:

1. Sign up at https://ion.cesium.com/ and create a token at https://ion.cesium.com/tokens
2. Put it in `.env.local` as `VITE_CESIUM_ION_TOKEN=...` (gitignored, never commit it)
3. For deploys, the same value is stored as a GitHub Actions repo secret named
   `VITE_CESIUM_ION_TOKEN`

### Scripts

| Command | Purpose |
|---|---|
| `npm run dev` | Start the dev server |
| `npm run build` | Type-check and build for production |
| `npm run test` | Run unit tests (Vitest) |
| `npm run lint` | Lint |
| `npm run format` | Format with Prettier |

## Deployment

Pushes to `main` build and deploy automatically to GitHub Pages via
`.github/workflows/deploy.yml`. Pull requests run lint/test/build via
`.github/workflows/ci.yml`.

If the live site shows a blank page:

- **Raw source served** (a `<script>` tag pointing at `/src/main.tsx` instead of a hashed
  `/assets/*.js` bundle) — check **Settings → Pages → Build and deployment → Source** is
  set to "GitHub Actions", not "Deploy from a branch". Changing that dropdown does not
  itself trigger a new deployment — push a commit (or re-run the workflow) afterwards.
- **404s on `/cesium/...` in the console** — see the `vite-plugin-cesium` note in
  [CLAUDE.md](./CLAUDE.md#known-gotchas-hit-so-far); `npm run build` includes a fixup step
  for this, so it should only recur if that step is skipped or the repo is renamed.
