import { describe, expect, it } from 'vitest'
import { estimateStripFromPolygon, stripLengthAndBearing } from './landingStrip'
import { destinationPoint } from './geo'
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
})
