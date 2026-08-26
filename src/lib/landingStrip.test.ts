import booleanPointInPolygon from '@turf/boolean-point-in-polygon'
import { point as turfPoint, polygon as turfPolygon } from '@turf/helpers'
import { describe, expect, it } from 'vitest'
import { estimateStripFromPolygon, stripLengthAndBearing } from './landingStrip'
import { destinationPoint, distanceMeters } from './geo'
import type { LatLon } from '../types/domain'

const origin: LatLon = { lat: 32.32, lon: 34.91 }

describe('estimateStripFromPolygon', () => {
  it('finds the long axis of an elongated rectangle and insets both ends', () => {
    // A ~400m x 40m rectangle oriented north-south (long axis bearing 0/180).
    const nw = destinationPoint(destinationPoint(origin, 20, 270), 400, 0)
    const ne = destinationPoint(destinationPoint(origin, 20, 90), 400, 0)
    const se = destinationPoint(origin, 20, 90)
    const sw = destinationPoint(origin, 20, 270)
    const ring: LatLon[] = [sw, se, ne, nw]

    const strip = estimateStripFromPolygon(ring)
    const { lengthFt, bearingDeg } = stripLengthAndBearing(strip)

    // Long axis is ~400m; inset 10% each end leaves ~80% = ~320m ≈ 1050 ft.
    expect(lengthFt).toBeGreaterThan(900)
    expect(lengthFt).toBeLessThan(1150)
    // Axis runs roughly north-south. The true farthest-apart pair on a rectangle is the
    // diagonal, not the long edge, so some skew is inherent to this heuristic — here
    // atan(20/400) per corner ≈ 5.7°, not a bug in the implementation.
    expect(Math.min(bearingDeg, Math.abs(360 - bearingDeg), Math.abs(180 - bearingDeg))).toBeLessThan(7)
  })

  it('insets symmetrically so the strip midpoint matches the axis midpoint', () => {
    const a: LatLon = origin
    const b = destinationPoint(origin, 300, 90)
    const ring: LatLon[] = [a, b]

    const strip = estimateStripFromPolygon(ring)

    // Inset is symmetric, so the strip's midpoint should match the original axis's midpoint.
    const midLon = (a.lon + b.lon) / 2
    const stripMidLon = (strip.start.lon + strip.end.lon) / 2
    expect(stripMidLon).toBeCloseTo(midLon, 3)
  })

  it('throws on a degenerate ring with fewer than 2 vertices', () => {
    expect(() => estimateStripFromPolygon([origin])).toThrow()
  })

  it('clips the strip to stay inside a non-convex (L-shaped) field', () => {
    // An L-shape: a tall left arm (0-100m east, 0-200m north) plus a short bottom-right
    // extension (100-200m east, 0-50m north). The farthest-apart vertex pair is the two
    // diagonal corners (200,0) and (0,200) — a straight line between them cuts through the
    // notch that isn't part of the field at all.
    const east = (m: number, from: LatLon) => destinationPoint(from, m, 90)
    const north = (m: number, from: LatLon) => destinationPoint(from, m, 0)
    const p0 = origin
    const p1 = east(200, p0)
    const p2 = north(50, p1)
    const p3 = east(-100, p2) // back to x=100
    const p4 = north(150, p3) // up to y=200 (100m more north)
    const p5 = north(200, p0)
    const ring: LatLon[] = [p0, p1, p2, p3, p4, p5]

    const strip = estimateStripFromPolygon(ring)

    const closedRing = [...ring, ring[0]].map((p) => [p.lon, p.lat])
    const poly = turfPolygon([closedRing])
    const isInside = (p: LatLon) => booleanPointInPolygon(turfPoint([p.lon, p.lat]), poly)

    expect(isInside(strip.start)).toBe(true)
    expect(isInside(strip.end)).toBe(true)
    // Clipped-and-inset length should be noticeably shorter than the raw ~283m diagonal —
    // confirms clipping actually trimmed it, not just the usual 10% inset.
    expect(distanceMeters(strip.start, strip.end)).toBeLessThan(283 * 0.7)
  })
})
