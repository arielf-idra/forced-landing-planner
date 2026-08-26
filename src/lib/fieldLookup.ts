import type { LatLon } from '../types/domain'

// Israel Ministry of Agriculture agricultural-parcel layer ("חלקות חקלאיות ציבורי") — public
// ArcGIS FeatureServer, no key needed. Verified live during planning: a spatial-intersects
// point query at a real coordinate in our test area returned a real ~2.5-dunam field polygon
// with crop/category attributes. See CLAUDE.md for the source discussion (OSM was tried
// first and had much worse coverage — mostly huge administrative/reserve polygons, not
// individual fields).
const SERVICE_URL =
  'https://services3.arcgis.com/Fqk0gVrfcnumlR5m/arcgis/rest/services/' +
  encodeURIComponent('חלקות_חקלאיות_ציבורי') +
  '/FeatureServer/0/query'

const QUERY_TIMEOUT_MS = 8000
/** Small tolerance buffer, meters, for a near-miss when the exact point misses a parcel. */
const NEAR_MISS_BUFFER_M = 30

export interface FieldPolygon {
  ring: LatLon[]
  cropName?: string
  category?: string
  dunam?: number
}

interface ArcGisGeoJsonResponse {
  features: Array<{
    geometry: { coordinates: [number, number][][] }
    properties: Record<string, unknown>
  }>
}

/**
 * Looks up the agricultural field parcel containing (or very near) `point`. Returns `null` on
 * no match, network error, or timeout — this is a nice-to-have assist, never load-bearing, so
 * callers should always have a manual fallback rather than treating a `null` as an error.
 */
export async function lookupFieldPolygon(point: LatLon): Promise<FieldPolygon | null> {
  const exact = await queryAt(pointGeometry(point))
  if (exact) return exact
  return queryAt(envelopeGeometry(point, NEAR_MISS_BUFFER_M))
}

function pointGeometry(point: LatLon) {
  return {
    geometry: `${point.lon},${point.lat}`,
    geometryType: 'esriGeometryPoint',
  }
}

function envelopeGeometry(point: LatLon, bufferM: number) {
  // ~1 degree latitude ≈ 111,320 m; longitude scaled by cos(latitude) for a roughly-square buffer.
  const dLat = bufferM / 111320
  const dLon = bufferM / (111320 * Math.cos((point.lat * Math.PI) / 180))
  const envelope = {
    xmin: point.lon - dLon,
    ymin: point.lat - dLat,
    xmax: point.lon + dLon,
    ymax: point.lat + dLat,
    spatialReference: { wkid: 4326 },
  }
  return {
    geometry: JSON.stringify(envelope),
    geometryType: 'esriGeometryEnvelope',
  }
}

async function queryAt(geometryParams: {
  geometry: string
  geometryType: string
}): Promise<FieldPolygon | null> {
  const params = new URLSearchParams({
    ...geometryParams,
    inSR: '4326',
    spatialRel: 'esriSpatialRelIntersects',
    outFields: 'GrowthName,AnafName,Dunam',
    returnGeometry: 'true',
    f: 'geojson',
  })

  try {
    const controller = new AbortController()
    const timeout = setTimeout(() => controller.abort(), QUERY_TIMEOUT_MS)
    const response = await fetch(`${SERVICE_URL}?${params}`, { signal: controller.signal })
    clearTimeout(timeout)
    if (!response.ok) return null

    const data = (await response.json()) as ArcGisGeoJsonResponse
    const feature = data.features?.[0]
    if (!feature) return null

    const ring: LatLon[] = feature.geometry.coordinates[0].map(([lon, lat]) => ({ lat, lon }))
    const props = feature.properties
    return {
      ring,
      cropName: typeof props.GrowthName === 'string' ? props.GrowthName : undefined,
      category: typeof props.AnafName === 'string' ? props.AnafName : undefined,
      dunam: typeof props.Dunam === 'number' ? props.Dunam : undefined,
    }
  } catch {
    return null
  }
}
