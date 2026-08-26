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
 * Fraction of the reachability circle's radius used as the distance from the event point to
 * its draggable heading handle — scaling with the radius (rather than a fixed distance in
 * feet) keeps the handle visually clear of the aircraft icon regardless of zoom/scenario
 * size. A fixed distance sat almost on top of the icon at typical zoom, picking up drags
 * meant for the aircraft itself.
 */
export const HEADING_HANDLE_DISTANCE_FRACTION = 0.25
/** Fallback handle distance, feet, for the brief window before a reachability radius exists. */
export const HEADING_HANDLE_FALLBACK_DISTANCE_FT = 1500
