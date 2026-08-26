import { describe, expect, it } from 'vitest'
import { computeApproachPlan, defaultLandingHeadingDeg, type ApproachParameters } from './approach'
import { bearingDegrees, destinationPoint, distanceMeters } from './geo'
import { feetToMeters } from './units'
import type { LatLon } from '../types/domain'

const south: LatLon = { lat: 32.0, lon: 34.9 }
// Strip runs due north from `south`, 900m long.
const north = destinationPoint(south, 900, 0)
const strip = { start: south, end: north }

const groundElevationMslFt = 100

const params: ApproachParameters = {
  downwindAglFt: 1500,
  baseAglFt: 1000,
  finalAglFt: 500,
  finalLegDistanceM: 500,
  downwindOffsetFt: 1000,
  turnDirection: 'left',
}

describe('defaultLandingHeadingDeg', () => {
  it('picks the strip direction closest to into-wind', () => {
    // Wind from the north -> land heading north (start -> end, i.e. 0°).
    expect(defaultLandingHeadingDeg(strip, 0)).toBeCloseTo(0, 3)
    // Wind from the south -> land heading south (end -> start, i.e. 180°).
    expect(defaultLandingHeadingDeg(strip, 180)).toBeCloseTo(180, 3)
    // Wind roughly from the north-ish (20°) should still prefer 0° over 180°.
    expect(defaultLandingHeadingDeg(strip, 20)).toBeCloseTo(0, 3)
  })
})

describe('computeApproachPlan', () => {
  it('places touchdown 1/3 of the way from the threshold toward the far end', () => {
    const plan = computeApproachPlan(strip, 0, groundElevationMslFt, params)
    expect(distanceMeters(south, plan.touchdown)).toBeCloseTo(300, 0) // 900 / 3
    expect(bearingDegrees(south, plan.touchdown)).toBeCloseTo(0, 0)
    expect(plan.touchdown.altitudeMslFt).toBeCloseTo(groundElevationMslFt, 6)
  })

  it('places Final 500m before the threshold, on the extended centerline', () => {
    const plan = computeApproachPlan(strip, 0, groundElevationMslFt, params)
    expect(distanceMeters(south, plan.final)).toBeCloseTo(params.finalLegDistanceM, 0)
    expect(bearingDegrees(south, plan.final)).toBeCloseTo(180, 0) // behind the threshold
    expect(plan.final.altitudeMslFt).toBeCloseTo(groundElevationMslFt + params.finalAglFt, 6)
  })

  it('offsets Base from Final, and Downwind from Touchdown, by the same downwind distance', () => {
    const plan = computeApproachPlan(strip, 0, groundElevationMslFt, params)
    const offsetM = feetToMeters(params.downwindOffsetFt)
    expect(distanceMeters(plan.final, plan.base)).toBeCloseTo(offsetM, 0)
    expect(distanceMeters(plan.touchdown, plan.downwind)).toBeCloseTo(offsetM, 0)
    // Left turn from a 0° landing heading -> offset toward 270° (west).
    expect(bearingDegrees(plan.final, plan.base)).toBeCloseTo(270, 0)
    expect(bearingDegrees(plan.touchdown, plan.downwind)).toBeCloseTo(270, 0)
    expect(plan.base.altitudeMslFt).toBeCloseTo(groundElevationMslFt + params.baseAglFt, 6)
    expect(plan.downwind.altitudeMslFt).toBeCloseTo(groundElevationMslFt + params.downwindAglFt, 6)
  })

  it('offsets to the right for a right-pattern turn direction', () => {
    const plan = computeApproachPlan(strip, 0, groundElevationMslFt, {
      ...params,
      turnDirection: 'right',
    })
    expect(bearingDegrees(plan.final, plan.base)).toBeCloseTo(90, 0)
  })

  it('lands the other direction (end -> start) when landingHeadingDeg points that way', () => {
    const plan = computeApproachPlan(strip, 180, groundElevationMslFt, params)
    // Threshold is now the north end.
    expect(distanceMeters(north, plan.touchdown)).toBeCloseTo(300, 0)
    expect(bearingDegrees(north, plan.touchdown)).toBeCloseTo(180, 0)
    expect(bearingDegrees(north, plan.final)).toBeCloseTo(0, 0)
  })
})
