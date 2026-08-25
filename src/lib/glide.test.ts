import distance from '@turf/distance'
import { describe, expect, it } from 'vitest'
import type { GlideParameters, LatLon, WindVector } from '../types/domain'
import { checkReachability, computeReachabilityCircle, sinkRateFtPerMin } from './glide'
import { feetToMeters } from './units'

const eventPoint: LatLon = { lat: 32.0, lon: 34.9 }
const glide: GlideParameters = { glideRatio: 9, bestGlideSpeedKt: 65 }
const calmWind: WindVector = { speedKt: 0, directionFromDeg: 0 }

describe('sinkRateFtPerMin', () => {
  it('matches best-glide-speed / glide-ratio, converted to ft/min', () => {
    // 65 kt = 65 * 6076.12 / 60 ft/min ≈ 6578.13 ft/min forward speed; /9 glide ratio.
    expect(sinkRateFtPerMin(glide)).toBeCloseTo(730.9, 0)
  })
})

describe('computeReachabilityCircle', () => {
  it('returns a zero-radius circle at or below the ground', () => {
    const circle = computeReachabilityCircle(eventPoint, 0, glide, calmWind)
    expect(circle.radiusFt).toBe(0)
    expect(circle.center).toEqual(eventPoint)
  })

  it('is centered on the event point in still air, radius = glideRatio * heightAGL', () => {
    const circle = computeReachabilityCircle(eventPoint, 1000, glide, calmWind)
    expect(circle.radiusFt).toBeCloseTo(9000, 0)
    expect(circle.center).toEqual(eventPoint)
    expect(circle.descentTimeMin).toBeCloseTo(1000 / 730.9, 2)
  })

  it('keeps the same radius but shifts the center downwind when there is wind', () => {
    const wind: WindVector = { speedKt: 20, directionFromDeg: 360 } // wind FROM north -> drifts south
    const calm = computeReachabilityCircle(eventPoint, 1000, glide, calmWind)
    const windy = computeReachabilityCircle(eventPoint, 1000, glide, wind)

    expect(windy.radiusFt).toBeCloseTo(calm.radiusFt, 6)
    expect(windy.center.lat).toBeLessThan(eventPoint.lat) // shifted south
    expect(windy.center.lon).toBeCloseTo(eventPoint.lon, 3) // no east/west shift for due-north wind

    const expectedDriftFt = wind.speedKt * (6076.12 / 60) * windy.descentTimeMin
    const actualDriftMeters = distance(
      [eventPoint.lon, eventPoint.lat],
      [windy.center.lon, windy.center.lat],
      { units: 'meters' },
    )
    expect(actualDriftMeters).toBeCloseTo(feetToMeters(expectedDriftFt), 0)
  })
})

describe('checkReachability', () => {
  const circle = computeReachabilityCircle(eventPoint, 1000, glide, calmWind) // radius ~9000 ft

  it('flags a nearby point as reachable with positive margin', () => {
    const nearby: LatLon = { lat: 32.01, lon: 34.9 } // ~1.1 km north, well inside 9000 ft (~2.7 km) radius
    const check = checkReachability(eventPoint, nearby, circle)
    expect(check.reachable).toBe(true)
    expect(check.marginFt).toBeGreaterThan(0)
    expect(check.bearingFromEventDeg).toBeCloseTo(0, 0) // due north
  })

  it('flags a far point as unreachable with negative margin', () => {
    const far: LatLon = { lat: 32.5, lon: 34.9 } // way beyond a ~2.7 km radius
    const check = checkReachability(eventPoint, far, circle)
    expect(check.reachable).toBe(false)
    expect(check.marginFt).toBeLessThan(0)
  })
})
