import bearing from '@turf/bearing'
import destination from '@turf/destination'
import {
  Cartesian3,
  Color,
  HeightReference,
  Math as CesiumMath,
  type TerrainProvider,
} from 'cesium'
import { useCallback, useEffect, useMemo, useState } from 'react'
import { BillboardGraphics, Entity, EllipseGraphics, PointGraphics, PolylineGraphics } from 'resium'
import './App.css'
import { CesiumMap } from './components/CesiumMap'
import { EventPointPanel } from './components/EventPointPanel'
import { LandingInfoPanel } from './components/LandingInfoPanel'
import { ParametersPanel } from './components/ParametersPanel'
import { WindIndicator } from './components/WindIndicator'
import { checkReachability, computeReachabilityCircle } from './lib/glide'
import {
  C172_DEFAULTS,
  HEADING_HANDLE_DISTANCE_FRACTION,
  HEADING_HANDLE_FALLBACK_DISTANCE_FT,
} from './lib/geo-constants'
import { sampleGroundElevationFt, sampleTerrainProfile } from './lib/terrain'
import { checkTerrainClearance, type TerrainProfileSample } from './lib/terrainProfile'
import { feetToMeters } from './lib/units'
import type { EventPoint, GlideParameters, LandingPoint, LatLon, WindVector } from './types/domain'

const DEFAULT_ALTITUDE_MSL_FT = 2000

// Base-path-aware so it resolves correctly on GitHub Pages (served under /forced-landing-planner/).
const AIRCRAFT_ICON_URL = `${import.meta.env.BASE_URL}aircraft-icon.png`

const EVENT_POINT_ID = 'event-point'
const LANDING_POINT_ID = 'landing-point'
const HEADING_HANDLE_ID = 'heading-handle'
const DRAGGABLE_ENTITY_IDS = new Set([EVENT_POINT_ID, LANDING_POINT_ID, HEADING_HANDLE_ID])

function App() {
  const [terrainProvider, setTerrainProvider] = useState<TerrainProvider | null>(null)
  const [eventPoint, setEventPoint] = useState<EventPoint | null>(null)
  const [isSamplingEvent, setIsSamplingEvent] = useState(false)
  const [landingPoint, setLandingPoint] = useState<LandingPoint | null>(null)
  const [isSamplingLanding, setIsSamplingLanding] = useState(false)
  const [isDragging, setIsDragging] = useState(false)
  const [glide, setGlide] = useState<GlideParameters>({
    glideRatio: C172_DEFAULTS.glideRatio,
    bestGlideSpeedKt: C172_DEFAULTS.bestGlideSpeedKt,
  })
  const [wind, setWind] = useState<WindVector>({ speedKt: 0, directionFromDeg: 0 })
  const [terrainProfile, setTerrainProfile] = useState<TerrainProfileSample[] | null>(null)
  const [isSamplingProfile, setIsSamplingProfile] = useState(false)

  const handleTerrainReady = useCallback((provider: TerrainProvider) => {
    setTerrainProvider(provider)
  }, [])

  // First click places the event point, the next places the landing point; after that,
  // plain clicks are no-ops — repositioning happens by dragging the markers themselves.
  const handleMapClick = useCallback(
    async (point: LatLon) => {
      if (!terrainProvider) return
      if (!eventPoint) {
        setIsSamplingEvent(true)
        try {
          const groundElevationMslFt = await sampleGroundElevationFt(terrainProvider, point)
          setEventPoint({
            ...point,
            groundElevationMslFt,
            altitudeMslFt: DEFAULT_ALTITUDE_MSL_FT,
            headingDeg: 0,
          })
        } finally {
          setIsSamplingEvent(false)
        }
      } else if (!landingPoint) {
        setIsSamplingLanding(true)
        try {
          const groundElevationMslFt = await sampleGroundElevationFt(terrainProvider, point)
          setLandingPoint({ ...point, groundElevationMslFt })
        } finally {
          setIsSamplingLanding(false)
        }
      }
    },
    [terrainProvider, eventPoint, landingPoint],
  )

  const handlePointDrag = useCallback(
    (entityId: string, point: LatLon, phase: 'move' | 'end') => {
      if (entityId === EVENT_POINT_ID) {
        setIsDragging(phase === 'move')
        setEventPoint((prev) => (prev ? { ...prev, lat: point.lat, lon: point.lon } : prev))
        if (phase === 'end' && terrainProvider) {
          sampleGroundElevationFt(terrainProvider, point).then((groundElevationMslFt) => {
            setEventPoint((prev) => (prev ? { ...prev, groundElevationMslFt } : prev))
          })
        }
      } else if (entityId === LANDING_POINT_ID) {
        setIsDragging(phase === 'move')
        setLandingPoint((prev) => (prev ? { ...prev, lat: point.lat, lon: point.lon } : prev))
        if (phase === 'end' && terrainProvider) {
          sampleGroundElevationFt(terrainProvider, point).then((groundElevationMslFt) => {
            setLandingPoint((prev) => (prev ? { ...prev, groundElevationMslFt } : prev))
          })
        }
      } else if (entityId === HEADING_HANDLE_ID) {
        setEventPoint((prev) => {
          if (!prev) return prev
          const headingDeg = (bearing([prev.lon, prev.lat], [point.lon, point.lat]) + 360) % 360
          return { ...prev, headingDeg }
        })
      }
    },
    [terrainProvider],
  )

  const handleAltitudeChange = useCallback((altitudeMslFt: number) => {
    setEventPoint((prev) => (prev ? { ...prev, altitudeMslFt } : prev))
  }, [])

  const handleHeadingChange = useCallback((headingDeg: number) => {
    setEventPoint((prev) => (prev ? { ...prev, headingDeg } : prev))
  }, [])

  const heightAglFt = eventPoint
    ? Math.max(0, eventPoint.altitudeMslFt - eventPoint.groundElevationMslFt)
    : 0

  const reachability = useMemo(() => {
    if (!eventPoint) return null
    return computeReachabilityCircle(eventPoint, heightAglFt, glide, wind)
  }, [eventPoint, heightAglFt, glide, wind])

  const reachabilityCheck = useMemo(() => {
    if (!eventPoint || !landingPoint || !reachability) return null
    return checkReachability(eventPoint, landingPoint, reachability)
  }, [eventPoint, landingPoint, reachability])

  // Depend on lat/lon (not the whole objects) so tweaking altitude/glide/wind doesn't
  // trigger a re-sample of terrain that hasn't actually moved; `isDragging` holds off
  // re-sampling on every mid-drag position tick, only once the drag settles.
  useEffect(() => {
    if (!terrainProvider || !eventPoint || !landingPoint || isDragging) return
    let cancelled = false
    // Standard start-loading kickoff for an effect-driven async fetch; result lands in .then below.
    // eslint-disable-next-line react-hooks/set-state-in-effect
    setIsSamplingProfile(true)
    sampleTerrainProfile(terrainProvider, eventPoint, landingPoint)
      .then((profile) => {
        if (!cancelled) setTerrainProfile(profile)
      })
      .finally(() => {
        if (!cancelled) setIsSamplingProfile(false)
      })
    return () => {
      cancelled = true
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [terrainProvider, eventPoint?.lat, eventPoint?.lon, landingPoint?.lat, landingPoint?.lon, isDragging])

  const clearanceCheck = useMemo(() => {
    if (!terrainProfile || !eventPoint) return null
    return checkTerrainClearance(terrainProfile, eventPoint.altitudeMslFt, glide.glideRatio)
  }, [terrainProfile, eventPoint, glide.glideRatio])

  const landingMarkerColor =
    reachabilityCheck?.reachable && clearanceCheck?.clear ? Color.LIME : Color.ORANGE

  const headingHandlePosition = useMemo(() => {
    if (!eventPoint) return null
    const distanceFt =
      reachability && reachability.radiusFt > 0
        ? reachability.radiusFt * HEADING_HANDLE_DISTANCE_FRACTION
        : HEADING_HANDLE_FALLBACK_DISTANCE_FT
    const pt = destination(
      [eventPoint.lon, eventPoint.lat],
      feetToMeters(distanceFt),
      eventPoint.headingDeg,
      { units: 'meters' },
    )
    return { lon: pt.geometry.coordinates[0], lat: pt.geometry.coordinates[1] }
  }, [eventPoint, reachability])

  return (
    <div className="app">
      <aside className="sidebar">
        <h1>Forced Landing Planner</h1>
        <EventPointPanel
          eventPoint={eventPoint}
          isSampling={isSamplingEvent}
          onAltitudeChange={handleAltitudeChange}
          onHeadingChange={handleHeadingChange}
        />
        <ParametersPanel
          glide={glide}
          onGlideChange={setGlide}
          wind={wind}
          onWindChange={setWind}
          reachability={reachability}
        />
        <LandingInfoPanel
          landingPoint={landingPoint}
          isSampling={isSamplingLanding}
          reachabilityCheck={reachabilityCheck}
          clearanceCheck={clearanceCheck}
          isSamplingProfile={isSamplingProfile}
        />
      </aside>
      <main className="map">
        <CesiumMap
          onTerrainReady={handleTerrainReady}
          onMapClick={handleMapClick}
          draggableEntityIds={DRAGGABLE_ENTITY_IDS}
          onPointDrag={handlePointDrag}
        >
          {eventPoint && (
            <Entity id={EVENT_POINT_ID} position={Cartesian3.fromDegrees(eventPoint.lon, eventPoint.lat)}>
              <BillboardGraphics
                image={AIRCRAFT_ICON_URL}
                rotation={-CesiumMath.toRadians(eventPoint.headingDeg)}
                alignedAxis={Cartesian3.UNIT_Z}
                scale={0.2}
                disableDepthTestDistance={Number.POSITIVE_INFINITY}
              />
            </Entity>
          )}
          {eventPoint && headingHandlePosition && (
            <>
              <Entity>
                <PolylineGraphics
                  positions={[
                    Cartesian3.fromDegrees(eventPoint.lon, eventPoint.lat),
                    Cartesian3.fromDegrees(headingHandlePosition.lon, headingHandlePosition.lat),
                  ]}
                  width={2}
                  material={Color.WHITE.withAlpha(0.6)}
                  clampToGround
                />
              </Entity>
              <Entity
                id={HEADING_HANDLE_ID}
                position={Cartesian3.fromDegrees(headingHandlePosition.lon, headingHandlePosition.lat)}
              >
                <PointGraphics
                  pixelSize={10}
                  color={Color.WHITE}
                  outlineColor={Color.BLACK}
                  outlineWidth={2}
                  disableDepthTestDistance={Number.POSITIVE_INFINITY}
                />
              </Entity>
            </>
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
          {landingPoint && (
            <Entity id={LANDING_POINT_ID} position={Cartesian3.fromDegrees(landingPoint.lon, landingPoint.lat)}>
              <PointGraphics
                pixelSize={14}
                color={landingMarkerColor}
                outlineColor={Color.WHITE}
                outlineWidth={2}
                disableDepthTestDistance={Number.POSITIVE_INFINITY}
              />
            </Entity>
          )}
          {eventPoint && landingPoint && (
            <Entity>
              <PolylineGraphics
                positions={[
                  Cartesian3.fromDegrees(eventPoint.lon, eventPoint.lat),
                  Cartesian3.fromDegrees(landingPoint.lon, landingPoint.lat),
                ]}
                width={3}
                material={landingMarkerColor.withAlpha(0.7)}
                clampToGround
              />
            </Entity>
          )}
        </CesiumMap>
        <WindIndicator wind={wind} />
      </main>
    </div>
  )
}

export default App
