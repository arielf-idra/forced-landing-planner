export interface TerrainProfileSample {
  /** Distance from the event point along the direct ground track, feet. */
  distanceFt: number
  terrainElevationMslFt: number
}

export interface ClearanceCheck {
  clear: boolean
  /** Minimum clearance between the assumed glide path and terrain along the profile, feet. Negative = terrain pokes through. */
  worstMarginFt: number
  /** Distance from the event point where the worst margin occurs, feet. */
  worstMarginAtFt: number
}

/**
 * Checks sampled terrain against the assumed constant-gradient glide path — altitude loses
 * `1 / glideRatio` ft per ft of horizontal distance from the event point — and reports the
 * tightest clearance anywhere along it. Pure function: `profile` is pre-sampled terrain
 * data (see `sampleTerrainProfile` in `terrain.ts`), no Cesium dependency here.
 */
export function checkTerrainClearance(
  profile: TerrainProfileSample[],
  eventAltitudeMslFt: number,
  glideRatio: number,
): ClearanceCheck {
  let worstMarginFt = Number.POSITIVE_INFINITY
  let worstMarginAtFt = 0

  for (const sample of profile) {
    const glidePathAltitudeMslFt = eventAltitudeMslFt - sample.distanceFt / glideRatio
    const marginFt = glidePathAltitudeMslFt - sample.terrainElevationMslFt
    if (marginFt < worstMarginFt) {
      worstMarginFt = marginFt
      worstMarginAtFt = sample.distanceFt
    }
  }

  return { clear: worstMarginFt >= 0, worstMarginFt, worstMarginAtFt }
}
