import booleanPointInPolygon from '@turf/boolean-point-in-polygon'
import { point as turfPoint, polygon as turfPolygon } from '@turf/helpers'
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

/** Points sampled along the candidate axis when clipping it to the polygon's interior. */
const CLIP_SAMPLES = 60

/**
 * Estimates a landing strip from a field polygon's ring: the two farthest-apart vertices
 * approximate the field's long axis (fine for the handful of vertices a real field has;
 * O(n²) is not a concern at that scale). For a non-convex or curved field, the straight line
 * between those two points can exit the polygon partway along — so before insetting, the
 * candidate axis is clipped to the sub-segment that's actually inside the polygon (sampled at
 * `CLIP_SAMPLES` points; walking inward from each end to the first interior sample). Falls
 * back to the unclipped axis if no sampled point lands inside (shouldn't happen for a real
 * field polygon, but a farthest-pair heuristic on a degenerate ring could produce one).
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

  const [clippedA, clippedB] = clipSegmentToPolygon(a, b, ring) ?? [a, b]
  const axisBearingDeg = bearingDegrees(clippedA, clippedB)
  const insetM = distanceMeters(clippedA, clippedB) * INSET_FRACTION

  return {
    start: destinationPoint(clippedA, insetM, axisBearingDeg),
    end: destinationPoint(clippedB, insetM, axisBearingDeg + 180),
  }
}

/**
 * Trims the segment `a`–`b` to the *longest single unbroken sub-range* actually inside `ring`,
 * by sampling points along it. Using the longest contiguous run (not just the first/last
 * interior sample) matters for a non-convex field: the line can exit and re-enter the polygon
 * partway along (e.g. cutting across a notch), and both endpoints can still individually be
 * inside the polygon even though the middle of the line isn't — spanning first-to-last would
 * silently include that gap. Returns `null` if no sample lands inside at all.
 */
function clipSegmentToPolygon(a: LatLon, b: LatLon, ring: LatLon[]): [LatLon, LatLon] | null {
  // A linear ring needs at least 3 distinct vertices (4 positions once closed) — anything
  // smaller isn't a real polygon (e.g. a synthetic 2-point "ring" in a test), so there's
  // nothing to clip against.
  if (ring.length < 3) return null
  const closedRing = [...ring, ring[0]].map((p) => [p.lon, p.lat])
  const poly = turfPolygon([closedRing])
  const totalDistanceM = distanceMeters(a, b)
  const bearingDeg = bearingDegrees(a, b)

  const isInside = (p: LatLon) => booleanPointInPolygon(turfPoint([p.lon, p.lat]), poly)
  const sampleAt = (t: number) => destinationPoint(a, totalDistanceM * t, bearingDeg)

  let bestRunStart = -1
  let bestRunLength = 0
  let runStart = -1
  let runLength = 0
  for (let i = 0; i <= CLIP_SAMPLES; i++) {
    if (isInside(sampleAt(i / CLIP_SAMPLES))) {
      if (runStart === -1) runStart = i
      runLength++
      if (runLength > bestRunLength) {
        bestRunLength = runLength
        bestRunStart = runStart
      }
    } else {
      runStart = -1
      runLength = 0
    }
  }

  if (bestRunLength === 0) return null
  const startT = bestRunStart / CLIP_SAMPLES
  const endT = (bestRunStart + bestRunLength - 1) / CLIP_SAMPLES
  return [sampleAt(startT), sampleAt(endT)]
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
