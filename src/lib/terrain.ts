import bearing from '@turf/bearing'
import destination from '@turf/destination'
import distance from '@turf/distance'
import { Cartographic, sampleTerrainMostDetailed, type TerrainProvider } from 'cesium'
import type { LatLon } from '../types/domain'
import type { TerrainProfileSample } from './terrainProfile'
import { metersToFeet } from './units'

/** Ground elevation (MSL, feet) at a point, via Cesium terrain sampling. */
export async function sampleGroundElevationFt(
  terrainProvider: TerrainProvider,
  point: LatLon,
): Promise<number> {
  const [sampled] = await sampleTerrainMostDetailed(terrainProvider, [
    Cartographic.fromDegrees(point.lon, point.lat),
  ])
  return metersToFeet(sampled.height)
}

/** Terrain elevation profile along the direct ground track from `from` to `to`, `numSamples + 1` evenly spaced points. */
export async function sampleTerrainProfile(
  terrainProvider: TerrainProvider,
  from: LatLon,
  to: LatLon,
  numSamples = 12,
): Promise<TerrainProfileSample[]> {
  const totalDistanceM = distance([from.lon, from.lat], [to.lon, to.lat], { units: 'meters' })
  const bearingDeg = bearing([from.lon, from.lat], [to.lon, to.lat])

  const points: LatLon[] = Array.from({ length: numSamples + 1 }, (_, i) => {
    if (i === 0) return from
    const fraction = i / numSamples
    const pt = destination([from.lon, from.lat], totalDistanceM * fraction, bearingDeg, {
      units: 'meters',
    })
    return { lon: pt.geometry.coordinates[0], lat: pt.geometry.coordinates[1] }
  })

  const sampled = await sampleTerrainMostDetailed(
    terrainProvider,
    points.map((p) => Cartographic.fromDegrees(p.lon, p.lat)),
  )

  return sampled.map((carto, i) => ({
    distanceFt: metersToFeet(totalDistanceM * (i / numSamples)),
    terrainElevationMslFt: metersToFeet(carto.height),
  }))
}
