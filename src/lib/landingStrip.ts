import type { LatLon } from '../types/domain'
import { bearingDegrees, destinationPoint, distanceMeters } from './geo'
import { feetToMeters, metersToFeet } from './units'

/** Default strip length, feet, when no field data was found and the user hasn't dragged the endpoints yet. */
export const DEFAULT_MANUAL_STRIP_LENGTH_FT = 1000

export interface StripEndpoints {
  start: LatLon
  end: LatLon
}

/**
 * Fraction of the detected long-axis length trimmed from each end as a safety margin — the
 * farthest-apart vertices sit right at the field boundary/fence line, not somewhere a pilot
 * would actually plan to touch down or roll out.
 */
const INSET_FRACTION = 0.1

/**
 * Estimates a landing strip from a field polygon's ring: the two farthest-apart vertices
 * approximate the field's long axis (fine for the handful of vertices a real field has;
 * O(n²) is not a concern at that scale), inset by `INSET_FRACTION` from each end.
 */
export function estimateStripFromPolygon(ring: LatLon[]): StripEndpoints {
  if (ring.length < 2) {
    throw new Error('estimateStripFromPolygon requires at least 2 ring vertices')
  }

  let maxDistanceM = -1
  let a = ring[0]
  let b = ring[0]
  for (let i = 0; i < ring.length; i++) {
    for (let j = i + 1; j < ring.length; j++) {
      const d = distanceMeters(ring[i], ring[j])
      if (d > maxDistanceM) {
        maxDistanceM = d
        a = ring[i]
        b = ring[j]
      }
    }
  }

  const axisBearingDeg = bearingDegrees(a, b)
  const insetM = maxDistanceM * INSET_FRACTION

  return {
    start: destinationPoint(a, insetM, axisBearingDeg),
    end: destinationPoint(b, insetM, axisBearingDeg + 180),
  }
}

/**
 * Default strip when no field polygon was found — a short segment centered on `point`,
 * oriented along `bearingDeg` (typically into-wind), for the user to drag into place.
 */
export function defaultManualStrip(point: LatLon, bearingDeg: number): StripEndpoints {
  const halfLengthM = feetToMeters(DEFAULT_MANUAL_STRIP_LENGTH_FT) / 2
  return {
    start: destinationPoint(point, halfLengthM, bearingDeg + 180),
    end: destinationPoint(point, halfLengthM, bearingDeg),
  }
}

/** Strip length, feet, and its bearing (start → end), degrees true. */
export function stripLengthAndBearing(strip: StripEndpoints): { lengthFt: number; bearingDeg: number } {
  return {
    lengthFt: metersToFeet(distanceMeters(strip.start, strip.end)),
    bearingDeg: bearingDegrees(strip.start, strip.end),
  }
}
