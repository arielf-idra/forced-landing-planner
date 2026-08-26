import {
  Cartesian2,
  Cartesian3,
  Color,
  HeightReference,
  ImageMaterialProperty,
  LabelStyle,
  Math as CesiumMath,
  PolygonHierarchy,
  type TerrainProvider,
} from 'cesium'
import { useCallback, useEffect, useMemo, useState } from 'react'
import {
  BillboardGraphics,
  Entity,
  EllipseGraphics,
  LabelGraphics,
  PointGraphics,
  PolygonGraphics,
  PolylineGraphics,
} from 'resium'
import './App.css'
import { computeApproachPlan, defaultLandingHeadingDeg, type ApproachParameters } from './lib/approach'
import { ApproachPanel } from './components/ApproachPanel'
import { CesiumMap } from './components/CesiumMap'
import { EventPointPanel } from './components/EventPointPanel'
import { LandingInfoPanel } from './components/LandingInfoPanel'
import { ParametersPanel } from './components/ParametersPanel'
import { WindIndicator } from './components/WindIndicator'
import { lookupFieldPolygon } from './lib/fieldLookup'
import { bearingDegrees, destinationPoint } from './lib/geo'
import {
  APPROACH_DEFAULTS,
  C172_DEFAULTS,
  HEADING_HANDLE_DISTANCE_FRACTION,
  HEADING_HANDLE_FALLBACK_DISTANCE_FT,
} from './lib/geo-constants'
import { checkReachability, computeReachabilityCircle } from './lib/glide'
import { defaultManualStrip, estimateStripFromPolygon } from './lib/landingStrip'
import { RUNWAY_TEXTURE_DATA_URI } from './lib/runwayTexture'
import { sampleGroundElevationFt, sampleTerrainProfile } from './lib/terrain'
import { checkTerrainClearance, type TerrainProfileSample } from './lib/terrainProfile'
import { feetToMeters } from './lib/units'
import type {
  EventPoint,
  GlideParameters,
  LandingPoint,
  LandingStrip,
  LatLon,
  WindVector,
} from './types/domain'

const DEFAULT_ALTITUDE_MSL_FT = 2000

// Base-path-aware so it resolves correctly on GitHub Pages (served under /forced-landing-planner/).
const AIRCRAFT_ICON_URL = `${import.meta.env.BASE_URL}aircraft-icon.png`

const STRIP_COLOR = Color.fromCssColorString('#c084fc')
const APPROACH_COLOR = Color.fromCssColorString('#38bdf8')

const EVENT_POINT_ID = 'event-point'
const LANDING_POINT_ID = 'landing-point'
const HEADING_HANDLE_ID = 'heading-handle'
const STRIP_START_ID = 'strip-start'
const STRIP_END_ID = 'strip-end'
const DRAGGABLE_ENTITY_IDS = new Set([
  EVENT_POINT_ID,
  LANDING_POINT_ID,
  HEADING_HANDLE_ID,
  STRIP_START_ID,
  STRIP_END_ID,
])

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
  const [landingStrip, setLandingStrip] = useState<LandingStrip | null>(null)
  const [isLookingUpField, setIsLookingUpField] = useState(false)
  const [landingHeadingDeg, setLandingHeadingDeg] = useState<number | null>(null)
  const [approachParams, setApproachParams] = useState<ApproachParameters>({ ...APPROACH_DEFAULTS })

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
          return { ...prev, headingDeg: bearingDegrees(prev, point) }
        })
      } else if (entityId === STRIP_START_ID) {
        setLandingStrip((prev) => (prev ? { ...prev, start: point, source: 'manual' } : prev))
      } else if (entityId === STRIP_END_ID) {
        setLandingStrip((prev) => (prev ? { ...prev, end: point, source: 'manual' } : prev))
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

  const handleLandingHeadingChange = useCallback((headingDeg: number) => {
    setLandingHeadingDeg(headingDeg)
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

  const approachPlan = useMemo(() => {
    if (!landingStrip || landingHeadingDeg === null || !landingPoint) return null
    return computeApproachPlan(
      landingStrip,
      landingHeadingDeg,
      landingPoint.groundElevationMslFt,
      approachParams,
    )
  }, [landingStrip, landingHeadingDeg, landingPoint, approachParams])

  const headingHandlePosition = useMemo(() => {
    if (!eventPoint) return null
    const distanceFt =
      reachability && reachability.radiusFt > 0
        ? reachability.radiusFt * HEADING_HANDLE_DISTANCE_FRACTION
        : HEADING_HANDLE_FALLBACK_DISTANCE_FT
    return destinationPoint(eventPoint, feetToMeters(distanceFt), eventPoint.headingDeg)
  }, [eventPoint, reachability])

  // Cesium maps an image material's U axis along the polyline's length, so this single
  // instance stretches to fit whatever length the strip's two endpoints define — no manual
  // scaling needed when the user drags them.
  const runwayMaterial = useMemo(
    () => new ImageMaterialProperty({ image: RUNWAY_TEXTURE_DATA_URI }),
    [],
  )

  // Re-suggest a strip whenever the landing point is placed or finishes being dragged (not on
  // every tweak of glide/wind/altitude, and not mid-drag). Overwrites any manual strip edits —
  // moving the landing point to a different spot means the old strip suggestion no longer
  // applies to whatever field is now there.
  useEffect(() => {
    if (!landingPoint || isDragging) return
    let cancelled = false
    // eslint-disable-next-line react-hooks/set-state-in-effect
    setIsLookingUpField(true)
    lookupFieldPolygon(landingPoint)
      .then((field) => {
        if (cancelled) return
        const strip = field
          ? { ...estimateStripFromPolygon(field.ring) }
          : { ...defaultManualStrip(landingPoint, wind.directionFromDeg) }
        setLandingStrip(
          field
            ? {
                ...strip,
                source: 'detected',
                fieldInfo: { cropName: field.cropName, category: field.category, dunam: field.dunam },
                fieldRing: field.ring,
              }
            : { ...strip, source: 'manual' },
        )
        setLandingHeadingDeg(defaultLandingHeadingDeg(strip, wind.directionFromDeg))
      })
      .finally(() => {
        if (!cancelled) setIsLookingUpField(false)
      })
    return () => {
      cancelled = true
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [landingPoint?.lat, landingPoint?.lon, isDragging])

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
          landingStrip={landingStrip}
          isLookingUpField={isLookingUpField}
        />
        {landingStrip && landingHeadingDeg !== null && (
          <ApproachPanel
            landingHeadingDeg={landingHeadingDeg}
            onLandingHeadingChange={handleLandingHeadingChange}
            approachParams={approachParams}
            onApproachParamsChange={setApproachParams}
          />
        )}
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
          {landingStrip?.fieldRing && (
            <Entity>
              <PolygonGraphics
                hierarchy={
                  new PolygonHierarchy(
                    landingStrip.fieldRing.map((p) => Cartesian3.fromDegrees(p.lon, p.lat)),
                  )
                }
                heightReference={HeightReference.CLAMP_TO_GROUND}
                material={STRIP_COLOR.withAlpha(0.2)}
                outline
                outlineColor={STRIP_COLOR}
                outlineWidth={2}
              />
            </Entity>
          )}
          {landingStrip && (
            <>
              <Entity>
                <PolylineGraphics
                  positions={[
                    Cartesian3.fromDegrees(landingStrip.start.lon, landingStrip.start.lat),
                    Cartesian3.fromDegrees(landingStrip.end.lon, landingStrip.end.lat),
                  ]}
                  width={26}
                  material={runwayMaterial}
                  clampToGround
                />
              </Entity>
              <Entity
                id={STRIP_START_ID}
                position={Cartesian3.fromDegrees(landingStrip.start.lon, landingStrip.start.lat)}
              >
                <PointGraphics
                  pixelSize={10}
                  color={STRIP_COLOR}
                  outlineColor={Color.WHITE}
                  outlineWidth={2}
                  disableDepthTestDistance={Number.POSITIVE_INFINITY}
                />
              </Entity>
              <Entity
                id={STRIP_END_ID}
                position={Cartesian3.fromDegrees(landingStrip.end.lon, landingStrip.end.lat)}
              >
                <PointGraphics
                  pixelSize={10}
                  color={STRIP_COLOR}
                  outlineColor={Color.WHITE}
                  outlineWidth={2}
                  disableDepthTestDistance={Number.POSITIVE_INFINITY}
                />
              </Entity>
            </>
          )}
          {approachPlan && (
            <>
              {(
                [
                  { point: approachPlan.downwind, label: 'Downwind' },
                  { point: approachPlan.base, label: 'Base' },
                  { point: approachPlan.final, label: 'Final' },
                  { point: approachPlan.touchdown, label: 'Touchdown' },
                ] as const
              ).map(({ point, label }) => (
                <Entity
                  key={label}
                  position={Cartesian3.fromDegrees(point.lon, point.lat, feetToMeters(point.altitudeMslFt))}
                >
                  <PointGraphics
                    pixelSize={10}
                    color={APPROACH_COLOR}
                    outlineColor={Color.WHITE}
                    outlineWidth={2}
                    disableDepthTestDistance={Number.POSITIVE_INFINITY}
                  />
                  <LabelGraphics
                    text={`${label} — ${Math.round(point.altitudeMslFt).toLocaleString()} ft`}
                    font="12px sans-serif"
                    fillColor={Color.WHITE}
                    outlineColor={Color.BLACK}
                    outlineWidth={2}
                    style={LabelStyle.FILL_AND_OUTLINE}
                    pixelOffset={new Cartesian2(0, -14)}
                    disableDepthTestDistance={Number.POSITIVE_INFINITY}
                  />
                </Entity>
              ))}
              <Entity>
                <PolylineGraphics
                  positions={[
                    approachPlan.downwind,
                    approachPlan.base,
                    approachPlan.final,
                    approachPlan.touchdown,
                  ].map((p) => Cartesian3.fromDegrees(p.lon, p.lat, feetToMeters(p.altitudeMslFt)))}
                  width={3}
                  material={APPROACH_COLOR}
                  depthFailMaterial={APPROACH_COLOR}
                />
              </Entity>
            </>
          )}
        </CesiumMap>
        <WindIndicator wind={wind} />
      </main>
    </div>
  )
}

export default App
