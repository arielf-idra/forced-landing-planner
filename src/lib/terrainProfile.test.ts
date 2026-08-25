import { describe, expect, it } from 'vitest'
import { checkTerrainClearance, type TerrainProfileSample } from './terrainProfile'

const eventAltitudeMslFt = 3000
const glideRatio = 9 // loses 1 ft of altitude per 9 ft flown

describe('checkTerrainClearance', () => {
  it('is clear when terrain stays well below the glide path', () => {
    const profile: TerrainProfileSample[] = [
      { distanceFt: 0, terrainElevationMslFt: 500 },
      { distanceFt: 9000, terrainElevationMslFt: 600 }, // glide path here: 3000 - 1000 = 2000
      { distanceFt: 18000, terrainElevationMslFt: 700 }, // glide path here: 3000 - 2000 = 1000
    ]
    const result = checkTerrainClearance(profile, eventAltitudeMslFt, glideRatio)
    expect(result.clear).toBe(true)
    expect(result.worstMarginFt).toBeCloseTo(1000 - 700, 6) // tightest point is the far end
  })

  it('flags an obstruction where terrain pokes above the glide path', () => {
    const profile: TerrainProfileSample[] = [
      { distanceFt: 0, terrainElevationMslFt: 500 },
      { distanceFt: 4500, terrainElevationMslFt: 2600 }, // glide path here: 3000 - 500 = 2500 -> blocked
      { distanceFt: 9000, terrainElevationMslFt: 600 },
    ]
    const result = checkTerrainClearance(profile, eventAltitudeMslFt, glideRatio)
    expect(result.clear).toBe(false)
    expect(result.worstMarginFt).toBeCloseTo(2500 - 2600, 6)
    expect(result.worstMarginAtFt).toBe(4500)
  })

  it('treats exact tangency (terrain exactly on the glide path) as clear', () => {
    const profile: TerrainProfileSample[] = [{ distanceFt: 9000, terrainElevationMslFt: 2000 }]
    const result = checkTerrainClearance(profile, eventAltitudeMslFt, glideRatio)
    expect(result.clear).toBe(true)
    expect(result.worstMarginFt).toBeCloseTo(0, 6)
  })
})
