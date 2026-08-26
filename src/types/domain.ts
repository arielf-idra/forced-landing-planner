export interface LatLon {
  lat: number
  lon: number
}

export interface EventPoint extends LatLon {
  /** Altitude at engine-failure, MSL, feet. */
  altitudeMslFt: number
  /** Ground elevation at this point, MSL, feet (from terrain sampling or manual override). */
  groundElevationMslFt: number
  /** Aircraft heading at the moment of engine failure, degrees true. Reference only — the reachable-glide circle is heading-independent (the aircraft can turn during the glide). */
  headingDeg: number
}

export interface LandingPoint extends LatLon {
  /** Ground elevation at this point, MSL, feet (from terrain sampling or manual override). */
  groundElevationMslFt: number
}

export interface LandingStrip {
  start: LatLon
  end: LatLon
  /** 'detected' — seeded from a Ministry of Agriculture field polygon; 'manual' — no field data found, user-placed default. Either way, both endpoints stay user-draggable. */
  source: 'detected' | 'manual'
  fieldInfo?: {
    cropName?: string
    category?: string
    dunam?: number
  }
  /** The detected field's polygon boundary, for map highlighting — undefined when `source` is 'manual' (no polygon exists). */
  fieldRing?: LatLon[]
}

export interface WindVector {
  /** Wind speed, knots. */
  speedKt: number
  /** Direction the wind is blowing FROM, degrees true (0-360). */
  directionFromDeg: number
}

export interface GlideParameters {
  /** Glide ratio (horizontal distance : height lost), e.g. 9 for a 9:1 glide. */
  glideRatio: number
  /** Best glide airspeed, knots. */
  bestGlideSpeedKt: number
}

export interface ApproachPlan {
  /** Abeam touchdown, on the downwind leg. */
  downwind: LatLon & { altitudeMslFt: number }
  /** Downwind-to-base turn point (same offset as downwind, but abeam Final). */
  base: LatLon & { altitudeMslFt: number }
  /** Base-to-final turn point, on the extended centerline. */
  final: LatLon & { altitudeMslFt: number }
  /** 1/3 of the way along the strip from start to end — leaves margin for undershoot. */
  touchdown: LatLon & { altitudeMslFt: number }
  /** Landing heading, degrees true — the direction of travel on touchdown. */
  landingHeadingDeg: number
}
