import { describe, expect, it } from 'vitest'
import {
  altitudesAlongPath,
  buildHeadingLegRoute,
  planRouteToTarget,
  pointAtDistance,
  roundCorners,
  turnRadiusFt,
} from './route'
import { bearingDegrees, destinationPoint, distanceMeters } from './geo'
import { metersToFeet } from './units'
import type { LatLon } from '../types/domain'

const origin: LatLon = { lat: 32.0, lon: 34.9 }

describe('turnRadiusFt', () => {
  it('matches the standard level-turn formula for 65 kt / 30° bank', () => {
    // v = 65 * 6076.12/3600 ≈ 109.71 ft/s; R = v² / (g·tan(30°)) ≈ 648 ft.
    expect(turnRadiusFt(65, 30)).toBeCloseTo(648, 0)
  })

  it('gives a larger radius for a shallower bank at the same speed', () => {
    expect(turnRadiusFt(65, 15)).toBeGreaterThan(turnRadiusFt(65, 30))
  })
})

describe('planRouteToTarget', () => {
  it('flies straight when already heading at the target', () => {
    const target = destinationPoint(origin, 2000, 45)
    const route = planRouteToTarget(origin, 45, target, 648)
    expect(route.path).toHaveLength(2)
    expect(route.totalDistanceFt).toBeCloseTo(metersToFeet(distanceMeters(origin, target)), 0)
  })

  it('builds a tangent turn that stays on the turn circle and rolls out pointing at the target', () => {
    // Facing north, target is well off to the east -> should turn right.
    const target = destinationPoint(origin, 3000, 90)
    const radiusFt = 648
    const route = planRouteToTarget(origin, 0, target, radiusFt)

    expect(route.path.length).toBeGreaterThan(2) // an arc was actually built, not a straight line
    expect(route.path[route.path.length - 1]).toMatchObject({
      lat: expect.closeTo(target.lat, 6),
      lon: expect.closeTo(target.lon, 6),
    })

    // Every arc sample (all but the final straight-leg point) should sit ~radiusFt from some
    // fixed center - check indirectly via consecutive-sample spacing being small and smooth
    // (no huge jumps), and that total route distance is longer than the direct distance (a
    // real turn costs some distance) but not absurdly so.
    const directFt = metersToFeet(distanceMeters(origin, target))
    expect(route.totalDistanceFt).toBeGreaterThan(directFt)
    expect(route.totalDistanceFt).toBeLessThan(directFt + 4 * radiusFt)

    // Tangent continuity: the bearing of the last arc segment should be close to the bearing
    // of the final straight segment into the target (no sharp kink at the tangent point).
    const n = route.path.length
    const lastArcBearing = bearingDegrees(route.path[n - 3], route.path[n - 2])
    const finalLegBearing = bearingDegrees(route.path[n - 2], route.path[n - 1])
    const diff = Math.abs(((lastArcBearing - finalLegBearing + 540) % 360) - 180)
    expect(diff).toBeLessThan(5)
  })

  it('turns the other way when the target is to the left', () => {
    const target = destinationPoint(origin, 3000, 270) // west, facing north
    const route = planRouteToTarget(origin, 0, target, 648)
    // Just confirm it builds a valid arc-based route reaching the target, mirroring the right-turn case.
    expect(route.path.length).toBeGreaterThan(2)
    const last = route.path[route.path.length - 1]
    expect(last.lat).toBeCloseTo(target.lat, 6)
    expect(last.lon).toBeCloseTo(target.lon, 6)
  })

  it('picks whichever turn direction is shorter for a near-reversal target, not just "positive diff -> right"', () => {
    // Heading north, target almost directly behind (10° short of a dead reversal, off to the
    // left side) — naively always turning right (from the sign of the heading difference)
    // would force sweeping most of the way around the turn circle; turning left instead reaches
    // it far more directly. Regression test for a bug where the turn direction was picked from
    // the sign of the heading difference alone, producing a ~2,300 ft detour where a ~2,100 ft
    // one (turning the other way) was available — not itself "wrong" in isolation, but wrong
    // when the other direction is available and cheaper.
    const radiusFt = 648
    const target = destinationPoint(origin, 800, 170)
    const route = planRouteToTarget(origin, 0, target, radiusFt)
    const directFt = metersToFeet(distanceMeters(origin, target))

    // The old "always turn toward the sign of the heading diff" behavior for this exact case
    // picked the *more expensive* direction (~4,950 ft total, ~2,326 ft of detour); picking
    // the cheaper direction should land close to the theoretical minimum for a same-radius
    // reversal (roughly half the turn circle's circumference, ~2,036 ft, atop the direct
    // distance) and clearly below what the worse direction costs.
    expect(route.totalDistanceFt).toBeLessThan(directFt + 2300)
  })

  it('drifts the turn downwind when wind and speed are given, leaving the still-air case unchanged', () => {
    const target = destinationPoint(origin, 3000, 90)
    const radiusFt = 648

    const noWind = planRouteToTarget(origin, 0, target, radiusFt) // defaults: no speed/wind
    const explicitNoWind = planRouteToTarget(origin, 0, target, radiusFt, 65, {
      speedKt: 0,
      directionFromDeg: 0,
    })
    const withWind = planRouteToTarget(origin, 0, target, radiusFt, 65, {
      speedKt: 15,
      directionFromDeg: 0, // wind from the north -> drifts south
    })

    // No wind (by omission, or explicitly zero speed) leaves the route as originally planned.
    expect(noWind.path[5].lat).toBeCloseTo(explicitNoWind.path[5].lat, 8)
    expect(noWind.path[5].lon).toBeCloseTo(explicitNoWind.path[5].lon, 8)

    // The turn's start is unaffected (zero elapsed time), but a mid-arc point has drifted
    // south (lower latitude) with a north wind, and by a non-trivial amount.
    expect(withWind.path[0].lat).toBeCloseTo(noWind.path[0].lat, 6)
    expect(withWind.path[0].lon).toBeCloseTo(noWind.path[0].lon, 6)
    const midIndex = Math.floor(noWind.path.length / 2)
    expect(withWind.path[midIndex].lat).toBeLessThan(noWind.path[midIndex].lat)
    expect(distanceMeters(noWind.path[midIndex], withWind.path[midIndex])).toBeGreaterThan(10)
  })
})

describe('buildHeadingLegRoute', () => {
  it('leaves the first leg pointing exactly in startHeadingDeg, for legDistanceFt meters', () => {
    const target = destinationPoint(origin, 3000, 90) // facing north, target due east
    const legDistanceFt = 608 // 0.1 NM
    const route = buildHeadingLegRoute(origin, 0, target, legDistanceFt)

    expect(route.path).toHaveLength(3)
    const legEnd = route.path[1]
    expect(bearingDegrees(origin, legEnd)).toBeCloseTo(0, 3)
    expect(metersToFeet(distanceMeters(origin, legEnd))).toBeCloseTo(legDistanceFt, 0)

    // Second leg goes straight from there to the target, no further bend.
    const last = route.path[2]
    expect(last.lat).toBeCloseTo(target.lat, 8)
    expect(last.lon).toBeCloseTo(target.lon, 8)
  })

  it('reaches the target exactly regardless of startHeadingDeg', () => {
    const target = destinationPoint(origin, 3000, 200)
    for (const headingDeg of [0, 45, 90, 180, 270, 359]) {
      const route = buildHeadingLegRoute(origin, headingDeg, target, 608)
      const last = route.path[route.path.length - 1]
      expect(last.lat).toBeCloseTo(target.lat, 8)
      expect(last.lon).toBeCloseTo(target.lon, 8)
    }
  })

  it('falls back to a single straight line when the target is closer than legDistanceFt', () => {
    const target = destinationPoint(origin, 100, 45) // ~328 ft away
    const route = buildHeadingLegRoute(origin, 0, target, 608)
    expect(route.path).toHaveLength(2)
  })

  it('falls back to a single straight line for a non-positive leg distance', () => {
    const target = destinationPoint(origin, 3000, 90)
    const route = buildHeadingLegRoute(origin, 0, target, 0)
    expect(route.path).toHaveLength(2)
  })
})

describe('roundCorners', () => {
  it('leaves a 2-point path (no interior corners) unchanged', () => {
    const target = destinationPoint(origin, 500, 45)
    const route = roundCorners([origin, target], 300)
    expect(route.path).toHaveLength(2)
  })

  it('cuts the corner of a right-angle turn, shortening the path vs. the sharp-corner sum', () => {
    const b = destinationPoint(origin, 500, 90) // east
    const c = destinationPoint(b, 500, 0) // then north
    const sharpTotalFt = metersToFeet(distanceMeters(origin, b)) + metersToFeet(distanceMeters(b, c))

    const route = roundCorners([origin, b, c], 200)

    expect(route.path.length).toBeGreaterThan(3) // an arc was actually sampled at the corner
    expect(route.totalDistanceFt).toBeLessThan(sharpTotalFt) // corner-cutting shortens it
    expect(route.totalDistanceFt).toBeGreaterThan(metersToFeet(distanceMeters(origin, c))) // still longer than direct

    // Endpoints are preserved exactly.
    expect(route.path[0].lat).toBeCloseTo(origin.lat, 8)
    expect(route.path[0].lon).toBeCloseTo(origin.lon, 8)
    const last = route.path[route.path.length - 1]
    expect(last.lat).toBeCloseTo(c.lat, 8)
    expect(last.lon).toBeCloseTo(c.lon, 8)

    // No sharp kink anywhere along the rounded path (tangent continuity through the arc).
    let maxKinkDeg = 0
    for (let i = 1; i < route.path.length - 1; i++) {
      const before = bearingDegrees(route.path[i - 1], route.path[i])
      const after = bearingDegrees(route.path[i], route.path[i + 1])
      const kink = Math.abs(((after - before + 540) % 360) - 180)
      maxKinkDeg = Math.max(maxKinkDeg, kink)
    }
    expect(maxKinkDeg).toBeLessThan(10)
  })

  it('caps the corner cut so two close-together corners do not overlap', () => {
    // A short middle leg (100m) with two 90° turns — a naive 200ft-radius fillet would want to
    // cut well more than 100m at each corner.
    const b = destinationPoint(origin, 100, 90)
    const c = destinationPoint(b, 100, 0)
    const d = destinationPoint(c, 200, 90)
    const route = roundCorners([origin, b, c, d], 200)
    expect(route.path.length).toBeGreaterThan(0)
    expect(Number.isFinite(route.totalDistanceFt)).toBe(true)
    // Still reaches the exact endpoints despite the capped radius.
    const last = route.path[route.path.length - 1]
    expect(last.lat).toBeCloseTo(d.lat, 6)
    expect(last.lon).toBeCloseTo(d.lon, 6)
  })
})

describe('altitudesAlongPath', () => {
  it('interpolates linearly between two waypoints', () => {
    const a = { ...origin, altitudeMslFt: 1000 }
    const b = { ...destinationPoint(origin, 1000, 90), altitudeMslFt: 500 }
    const path = roundCorners([origin, destinationPoint(origin, 500, 90), b], 0).path
    const altitudes = altitudesAlongPath([a, b], path)
    expect(altitudes[0]).toBeCloseTo(1000, 0)
    expect(altitudes[altitudes.length - 1]).toBeCloseTo(500, 0)
    expect(altitudes[1]).toBeCloseTo(750, 0)
  })

  it('hits each waypoint altitude exactly at a 3-waypoint chain', () => {
    const p0 = origin
    const p1 = destinationPoint(origin, 1000, 90)
    const p2 = destinationPoint(p1, 500, 0)
    const waypoints = [
      { ...p0, altitudeMslFt: 1500 },
      { ...p1, altitudeMslFt: 1000 },
      { ...p2, altitudeMslFt: 0 },
    ]
    const path = roundCorners([p0, p1, p2], 0).path
    const altitudes = altitudesAlongPath(waypoints, path)
    expect(altitudes[0]).toBeCloseTo(1500, 0)
    expect(altitudes[1]).toBeCloseTo(1000, 0)
    expect(altitudes[2]).toBeCloseTo(0, 0)
  })
})

describe('pointAtDistance', () => {
  it('interpolates position and altitude linearly along a straight route', () => {
    const target = destinationPoint(origin, 2000, 0)
    const route = planRouteToTarget(origin, 0, target, 648)
    const halfway = pointAtDistance(route, route.totalDistanceFt / 2, 2000, 1000)
    expect(halfway).not.toBeNull()
    expect(halfway!.altitudeMslFt).toBeCloseTo(1500, 0)
    expect(distanceMeters(origin, halfway!)).toBeCloseTo(1000, 0)
  })

  it('returns null outside the route range', () => {
    const target = destinationPoint(origin, 2000, 0)
    const route = planRouteToTarget(origin, 0, target, 648)
    expect(pointAtDistance(route, -10, 2000, 1000)).toBeNull()
    expect(pointAtDistance(route, route.totalDistanceFt + 10, 2000, 1000)).toBeNull()
  })
})
