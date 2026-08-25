# Forced Landing Planner

A web app to help Cessna 172 flight students plan a simulated forced landing (engine-out):
mark the event point (where the engine "fails"), see how far the aircraft can glide given
its glide ratio and the wind, pick a landing field, and get a suggested approach (High Key
/ Low Key pattern).

This is a ground-planning / lesson-prep / debrief tool. It runs entirely in the browser —
no accounts, no server, nothing is saved between sessions.

**Status: early development.** Working so far: a 3D terrain map of Israel, click-to-place
the engine-failure event point (with real terrain elevation lookup), and a live reachable-
glide circle driven by editable glide ratio and wind. Landing-site selection, terrain
clearance checking, and the approach-plan overlay are not built yet — see
[CLAUDE.md](./CLAUDE.md) for the phase-by-phase plan and current progress.

## Methodology & assumptions

- **Reachable glide footprint** is modeled as a circle of radius `glideRatio * heightAGL`
  centered on the event point, shifted downwind by `windSpeed * time-to-ground`. This
  reflects that best-glide airspeed and sink rate (and therefore time aloft) don't depend
  on heading — only wind drift over that time does. It ignores altitude lost in turns and
  wind changing with altitude.
- **Terrain clearance** between the event point and a candidate landing point is checked
  against a constant-gradient glide path — it will not catch every real-world hazard
  (wires, towers, other obstacles beyond bare terrain).
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

If the live site shows a blank page serving raw source (e.g. a `<script>` tag pointing at
`/src/main.tsx` instead of a hashed `/assets/*.js` bundle), check
**Settings → Pages → Build and deployment → Source** is set to "GitHub Actions", not
"Deploy from a branch". Note that changing that dropdown does not itself trigger a new
deployment — push a commit (or re-run the workflow) afterwards.
