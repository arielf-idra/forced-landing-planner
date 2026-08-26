export const FT_PER_NM = 6076.12
export const KT_TO_FT_PER_MIN = FT_PER_NM / 60

/** Cessna 172 POH defaults; all editable by the user in the parameters panel. */
export const C172_DEFAULTS = {
  // Published glide performance is ~1.5 NM per 1,000 ft ((1.5 * FT_PER_NM) / 1000 = 9.11418),
  // expressed here as the dimensionless distance:height ratio glide.ts works with, rounded
  // to 2 decimals for a clean default in the number input.
  glideRatio: 9.11,
  bestGlideSpeedKt: 65,
} as const

/** Default wind, editable by the user in the parameters panel. */
export const WIND_DEFAULTS = {
  speedKt: 5,
  // Compass bearing the wind blows *from* — 270° is west.
  directionFromDeg: 270,
} as const

/**
 * Default targets for the Downwind/Base/Final approach pattern. These are briefed checkpoint
 * altitudes (a maneuvering descent), not derived from glide ratio the way the reachability
 * circle is — see `src/lib/approach.ts`.
 */
export const APPROACH_DEFAULTS = {
  downwindAglFt: 1500,
  baseAglFt: 1000,
  finalAglFt: 500,
  /** Distance from the strip's start to the Final (base-to-final turn) point. */
  finalLegDistanceM: 500,
  /** Lateral offset of the downwind leg from the extended strip centerline. */
  downwindOffsetFt: 1000,
  /** Left turns are the default: better outside visual reference for the pilot judging the field during the descending turn. */
  turnDirection: 'left' as 'left' | 'right',
} as const

/**
 * Route (event point → pattern entry) planning defaults. `maxBankAngleDeg` sets the turn
 * radius via the standard level-turn formula (`speed² / (g * tan(bankAngle))`) — a gentler
 * bank than a steep turn, appropriate for a power-off glide where airspeed control matters.
 */
export const ROUTE_DEFAULTS = {
  maxBankAngleDeg: 30,
} as const

/**
 * Length of `buildHeadingLegRoute`'s optional initial straight leg in the aircraft's actual
 * heading, before its second (also straight) leg turns toward the target. **Currently unused**
 * — `App.tsx` passes `legDistanceFt=0` (a single straight line, no heading leg) after this
 * fixed-length leg turned out to make the aircraft fly *away* from Downwind for 0.1 NM before
 * sharply correcting whenever the required turn was large (see CLAUDE.md gotcha). Kept as a
 * named constant in case a future version reintroduces the heading leg capped to small turn
 * angles only, where it doesn't have that problem.
 */
export const NOSE_HEADING_LEG_NM = 0.1

/** If the two landing-direction options' transit routes differ by less than this, treat them
 * as a maneuvering tie and fall back to the into-wind preference instead. */
export const MANEUVER_COST_TIE_MARGIN_FT = 500
/** Standard gravity, ft/s², used by the turn-radius formula. */
export const GRAVITY_FT_PER_S2 = 32.174
/** How often to label altitude along the transit route. */
export const ALTITUDE_CALLOUT_INTERVAL_NM = 0.5

/**
 * Screen-pixel distance from the event point to the transit route's start ("the aircraft's
 * nose", not the icon's center/anchor point). The source artwork (`aircraft-icon.png`) is
 * 320×267 px, rendered at `scale={0.2}` → ~64 px along its longer (fuselage) axis, so ~32 px
 * is already the *center-to-nose-tip* distance of the icon itself — an offset smaller than
 * that (an earlier attempt used 10 px) leaves the route's start still inside the icon's own
 * footprint, so the line only becomes visible wherever it happens to curve clear of the icon,
 * which can look like it's emerging from a wingtip or the tail instead of the nose. This value
 * clears that footprint with a bit of margin. Converted to a real-world distance via the
 * camera's live meters-per-pixel at the event point (`CesiumMap`'s
 * `pixelScaleReferencePosition`/`onMetersPerPixelChange`) — a *fixed* real-world distance
 * can't work here at all: the icon renders at a constant pixel size regardless of zoom, so any
 * fixed-feet offset looks correct at exactly one zoom level and wrong (invisible when too
 * small, an obvious floating gap when too large) at every other.
 */
export const AIRCRAFT_NOSE_OFFSET_PX = 45
/** Fallback nose offset, feet, for the brief window before a live pixel-scale reading exists. */
export const AIRCRAFT_NOSE_FALLBACK_DISTANCE_FT = 20

/** Extra padding (as a multiple of the reachability circle's enclosing radius) the camera
 * leaves around the circle when auto-framing it, so the circle's edge isn't flush with the
 * viewport. */
export const FLY_TO_MARGIN_FACTOR = 1.3

/**
 * Fraction of the reachability circle's radius used as the distance from the event point to
 * its draggable heading handle — scaling with the radius (rather than a fixed distance in
 * feet) keeps the handle visually clear of the aircraft icon regardless of zoom/scenario
 * size. A fixed distance sat almost on top of the icon at typical zoom, picking up drags
 * meant for the aircraft itself.
 */
export const HEADING_HANDLE_DISTANCE_FRACTION = 0.25
/** Fallback handle distance, feet, for the brief window before a reachability radius exists. */
export const HEADING_HANDLE_FALLBACK_DISTANCE_FT = 1500
