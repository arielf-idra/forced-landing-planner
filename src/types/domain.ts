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
  highKey: LatLon & { altitudeMslFt: number }
  lowKey: LatLon & { altitudeMslFt: number }
  base: LatLon & { altitudeMslFt: number }
  final: LatLon & { altitudeMslFt: number }
  /** Landing heading, degrees true — the direction of travel on touchdown. */
  landingHeadingDeg: number
}
