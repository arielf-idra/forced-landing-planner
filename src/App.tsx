import { Cartesian3, Color, HeightReference, type TerrainProvider } from 'cesium'
import { useCallback, useMemo, useState } from 'react'
import { Entity, EllipseGraphics, PointGraphics } from 'resium'
import './App.css'
import { CesiumMap } from './components/CesiumMap'
import { EventPointPanel } from './components/EventPointPanel'
import { ParametersPanel } from './components/ParametersPanel'
import { computeReachabilityCircle } from './lib/glide'
import { C172_DEFAULTS } from './lib/geo-constants'
import { sampleGroundElevationFt } from './lib/terrain'
import { feetToMeters } from './lib/units'
import type { EventPoint, GlideParameters, LatLon, WindVector } from './types/domain'

function App() {
  const [terrainProvider, setTerrainProvider] = useState<TerrainProvider | null>(null)
  const [eventPoint, setEventPoint] = useState<EventPoint | null>(null)
  const [isSampling, setIsSampling] = useState(false)
  const [glide, setGlide] = useState<GlideParameters>({
    glideRatio: C172_DEFAULTS.glideRatio,
    bestGlideSpeedKt: C172_DEFAULTS.bestGlideSpeedKt,
  })
  const [wind, setWind] = useState<WindVector>({ speedKt: 0, directionFromDeg: 0 })

  const handleTerrainReady = useCallback((provider: TerrainProvider) => {
    setTerrainProvider(provider)
  }, [])

  const handleMapClick = useCallback(
    async (point: LatLon) => {
      if (!terrainProvider) return
      setIsSampling(true)
      try {
        const groundElevationMslFt = await sampleGroundElevationFt(terrainProvider, point)
        setEventPoint((prev) => ({
          ...point,
          groundElevationMslFt,
          altitudeMslFt: prev?.altitudeMslFt ?? groundElevationMslFt + 3000,
        }))
      } finally {
        setIsSampling(false)
      }
    },
    [terrainProvider],
  )

  const handleAltitudeChange = useCallback((altitudeMslFt: number) => {
    setEventPoint((prev) => (prev ? { ...prev, altitudeMslFt } : prev))
  }, [])

  const heightAglFt = eventPoint
    ? Math.max(0, eventPoint.altitudeMslFt - eventPoint.groundElevationMslFt)
    : 0

  const reachability = useMemo(() => {
    if (!eventPoint) return null
    return computeReachabilityCircle(eventPoint, heightAglFt, glide, wind)
  }, [eventPoint, heightAglFt, glide, wind])

  return (
    <div className="app">
      <aside className="sidebar">
        <h1>Forced Landing Planner</h1>
        <EventPointPanel
          eventPoint={eventPoint}
          isSampling={isSampling}
          onAltitudeChange={handleAltitudeChange}
        />
        <ParametersPanel
          glide={glide}
          onGlideChange={setGlide}
          wind={wind}
          onWindChange={setWind}
          reachability={reachability}
        />
      </aside>
      <main className="map">
        <CesiumMap onTerrainReady={handleTerrainReady} onMapClick={handleMapClick}>
          {eventPoint && (
            <Entity position={Cartesian3.fromDegrees(eventPoint.lon, eventPoint.lat)}>
              <PointGraphics
                pixelSize={14}
                color={Color.RED}
                outlineColor={Color.WHITE}
                outlineWidth={2}
              />
            </Entity>
          )}
          {reachability && reachability.radiusFt > 0 && (
            <>
              <Entity position={Cartesian3.fromDegrees(eventPoint!.lon, eventPoint!.lat)}>
                <EllipseGraphics
                  semiMajorAxis={feetToMeters(reachability.radiusFt)}
                  semiMinorAxis={feetToMeters(reachability.radiusFt)}
                  heightReference={HeightReference.CLAMP_TO_GROUND}
                  fill={false}
                  outline
                  outlineColor={Color.YELLOW.withAlpha(0.6)}
                  outlineWidth={2}
                />
              </Entity>
              <Entity
                position={Cartesian3.fromDegrees(
                  reachability.center.lon,
                  reachability.center.lat,
                )}
              >
                <EllipseGraphics
                  semiMajorAxis={feetToMeters(reachability.radiusFt)}
                  semiMinorAxis={feetToMeters(reachability.radiusFt)}
                  heightReference={HeightReference.CLAMP_TO_GROUND}
                  material={Color.CYAN.withAlpha(0.15)}
                  outline
                  outlineColor={Color.CYAN}
                  outlineWidth={2}
                />
              </Entity>
            </>
          )}
        </CesiumMap>
      </main>
    </div>
  )
}

export default App
