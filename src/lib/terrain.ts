import { Cartographic, sampleTerrainMostDetailed, type TerrainProvider } from 'cesium'
import type { LatLon } from '../types/domain'
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
