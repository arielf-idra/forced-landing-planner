import bearing from '@turf/bearing'
import destination from '@turf/destination'
import distance from '@turf/distance'
import type { LatLon } from '../types/domain'

/** Point at `distanceM` meters from `origin`, along `bearingDeg` (degrees true). */
export function destinationPoint(origin: LatLon, distanceM: number, bearingDeg: number): LatLon {
  const pt = destination([origin.lon, origin.lat], distanceM, bearingDeg, { units: 'meters' })
  return { lon: pt.geometry.coordinates[0], lat: pt.geometry.coordinates[1] }
}

/** Great-circle distance between two points, meters. */
export function distanceMeters(a: LatLon, b: LatLon): number {
  return distance([a.lon, a.lat], [b.lon, b.lat], { units: 'meters' })
}

/** Initial bearing from `a` to `b`, normalized to 0–360 degrees true. */
export function bearingDegrees(a: LatLon, b: LatLon): number {
  return (bearing([a.lon, a.lat], [b.lon, b.lat]) + 360) % 360
}
