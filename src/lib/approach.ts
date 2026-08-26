import type { ApproachPlan, LatLon } from '../types/domain'
import { bearingDegrees, destinationPoint, distanceMeters } from './geo'
import { feetToMeters } from './units'

export interface ApproachParameters {
  downwindAglFt: number
  baseAglFt: number
  finalAglFt: number
  /** Distance from the landing threshold to the Final (base-to-final turn) point, meters. */
  finalLegDistanceM: number
  /** Lateral offset of the downwind leg from the extended strip centerline, feet. */
  downwindOffsetFt: number
  turnDirection: 'left' | 'right'
}

/**
 * The strip direction (whichever of its two ends is closer to facing into `windDirectionFromDeg`)
 * to use as the default landing heading — a starting point the user can then edit directly.
 */
export function defaultLandingHeadingDeg(
  strip: { start: LatLon; end: LatLon },
  windDirectionFromDeg: number,
): number {
  const forwardBearingDeg = bearingDegrees(strip.start, strip.end)
  const reverseBearingDeg = (forwardBearingDeg + 180) % 360
  return angularDifferenceDeg(forwardBearingDeg, windDirectionFromDeg) <=
    angularDifferenceDeg(reverseBearingDeg, windDirectionFromDeg)
    ? forwardBearingDeg
    : reverseBearingDeg
}

/**
 * Downwind / Base / Final / Touchdown checkpoints for a descending approach onto `strip`,
 * landing on heading `landingHeadingDeg` (must be one of the strip's two directions, within
 * 90° — this determines which end is the threshold you're landing toward).
 *
 * Geometry (confirmed against a hand-drawn diagram, not a generic rectangular-pattern guess):
 * Touchdown sits 1/3 of the way from the threshold to the far end (margin for undershoot).
 * Final is `finalLegDistanceM` before the threshold, on the extended centerline — the
 * base-to-final turn point. Base is a perpendicular offset from Final by `downwindOffsetFt` —
 * the downwind-to-base turn point. Downwind is that same offset, but abeam Touchdown instead
 * of abeam Final — so Downwind and Base sit on the same line (the downwind leg), Base→Final
 * is the perpendicular "base leg", and Final→Touchdown is the final leg down the centerline.
 *
 * All three altitudes are fixed briefed targets (not derived from glide ratio like the
 * reachability circle) — this represents a maneuvering descent, not a straight glide.
 */
export function computeApproachPlan(
  strip: { start: LatLon; end: LatLon },
  landingHeadingDeg: number,
  groundElevationMslFt: number,
  params: ApproachParameters,
): ApproachPlan {
  const turnSign = params.turnDirection === 'right' ? 1 : -1
  const forwardBearingDeg = bearingDegrees(strip.start, strip.end)
  const flyingForward = angularDifferenceDeg(forwardBearingDeg, landingHeadingDeg) < 90
  const threshold = flyingForward ? strip.start : strip.end
  const farEnd = flyingForward ? strip.end : strip.start

  const touchdownPoint = destinationPoint(
    threshold,
    distanceMeters(threshold, farEnd) / 3,
    landingHeadingDeg,
  )
  const finalPoint = destinationPoint(threshold, params.finalLegDistanceM, landingHeadingDeg + 180)
  const basePoint = destinationPoint(
    finalPoint,
    feetToMeters(params.downwindOffsetFt),
    landingHeadingDeg + turnSign * 90,
  )
  const downwindPoint = destinationPoint(
    touchdownPoint,
    feetToMeters(params.downwindOffsetFt),
    landingHeadingDeg + turnSign * 90,
  )

  return {
    downwind: { ...downwindPoint, altitudeMslFt: groundElevationMslFt + params.downwindAglFt },
    base: { ...basePoint, altitudeMslFt: groundElevationMslFt + params.baseAglFt },
    final: { ...finalPoint, altitudeMslFt: groundElevationMslFt + params.finalAglFt },
    touchdown: { ...touchdownPoint, altitudeMslFt: groundElevationMslFt },
    landingHeadingDeg,
  }
}

function angularDifferenceDeg(a: number, b: number): number {
  const diff = Math.abs(a - b) % 360
  return diff > 180 ? 360 - diff : diff
}
