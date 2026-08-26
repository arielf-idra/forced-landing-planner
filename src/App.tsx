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
import {
  computeApproachPlan,
  defaultLandingHeadingDeg,
  preferredLandingHeadingDeg,
  type ApproachParameters,
} from './lib/approach'
import { ApproachPanel } from './components/ApproachPanel'
import { CesiumMap } from './components/CesiumMap'
import { EventPointPanel } from './components/EventPointPanel'
import { LandingInfoPanel } from './components/LandingInfoPanel'
import { ParametersPanel } from './components/ParametersPanel'
import { WindIndicator } from './components/WindIndicator'
import { lookupFieldPolygon } from './lib/fieldLookup'
import { bearingDegrees, destinationPoint, distanceMeters } from './lib/geo'
import {
  AIRCRAFT_NOSE_FALLBACK_DISTANCE_FT,
  AIRCRAFT_NOSE_OFFSET_PX,
  ALTITUDE_CALLOUT_INTERVAL_NM,
  APPROACH_DEFAULTS,
  C172_DEFAULTS,
  FT_PER_NM,
  HEADING_HANDLE_DISTANCE_FRACTION,
  HEADING_HANDLE_FALLBACK_DISTANCE_FT,
  ROUTE_DEFAULTS,
  WIND_DEFAULTS,
} from './lib/geo-constants'
import { checkReachability, computeReachabilityCircle } from './lib/glide'
import { defaultManualStrip, estimateStripFromPolygon } from './lib/landingStrip'
import { altitudesAlongPath, buildHeadingLegRoute, pointAtDistance, roundCorners, turnRadiusFt } from './lib/route'
import { RUNWAY_TEXTURE_DATA_URI } from './lib/runwayTexture'
import { sampleGroundElevationFt, sampleTerrainProfile } from './lib/terrain'
import { checkTerrainClearance, type TerrainProfileSample } from './lib/terrainProfile'
import { feetToMeters, metersToFeet } from './lib/units'
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
  const [wind, setWind] = useState<WindVector>({ ...WIND_DEFAULTS })
  const [terrainProfile, setTerrainProfile] = useState<TerrainProfileSample[] | null>(null)
  const [isSamplingProfile, setIsSamplingProfile] = useState(false)
  const [landingStrip, setLandingStrip] = useState<LandingStrip | null>(null)
  const [isLookingUpField, setIsLookingUpField] = useState(false)
  const [landingHeadingDeg, setLandingHeadingDeg] = useState<number | null>(null)
  const [approachParams, setApproachParams] = useState<ApproachParameters>({ ...APPROACH_DEFAULTS })
  const [flyToRegion, setFlyToRegion] = useState<{ center: LatLon; radiusFt: number } | null>(null)
  const [metersPerPixelAtEvent, setMetersPerPixelAtEvent] = useState<number | null>(null)

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
        setLandingStrip((prev) => {
          if (!prev) return prev
          const next: LandingStrip = { start: point, end: prev.end, source: 'manual' }
          // Re-track the strip's new orientation (closest of its two directions to whatever
          // heading was already chosen), not just its new position — otherwise the pattern's
          // position follows the drag but its rotation stays stale relative to the strip.
          setLandingHeadingDeg((prevHeading) =>
            prevHeading === null ? prevHeading : defaultLandingHeadingDeg(next, prevHeading),
          )
          return next
        })
      } else if (entityId === STRIP_END_ID) {
        setLandingStrip((prev) => {
          if (!prev) return prev
          const next: LandingStrip = { start: prev.start, end: point, source: 'manual' }
          setLandingHeadingDeg((prevHeading) =>
            prevHeading === null ? prevHeading : defaultLandingHeadingDeg(next, prevHeading),
          )
          return next
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

  // Frame the reachability circle (with margin) whenever the event point is placed, finishes
  // being dragged, or its altitude/glide-ratio/wind changes (all of which move or resize the
  // circle) — not mid-drag, so the camera doesn't whip around while the marker is moving.
  useEffect(() => {
    if (!eventPoint || isDragging || !reachability) return
    const enclosingRadiusFt =
      reachability.radiusFt + metersToFeet(distanceMeters(eventPoint, reachability.center))
    // eslint-disable-next-line react-hooks/set-state-in-effect
    setFlyToRegion({ center: eventPoint, radiusFt: enclosingRadiusFt })
  }, [eventPoint, isDragging, reachability])

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

  // The route starts at the aircraft's nose, not the icon's anchor point (its center) — the
  // anchor is just where the icon is drawn, not where the aircraft "is" for planning purposes.
  // Sized from the camera's live meters-per-pixel at the event point (`metersPerPixelAtEvent`,
  // reported by CesiumMap) so it stays a constant ~10 screen pixels — just past the icon's
  // nose — at any zoom, rather than a fixed real-world distance that only looks right at one
  // specific zoom level (invisible when zoomed out, an obvious floating gap when zoomed in).
  const nosePosition = useMemo(() => {
    if (!eventPoint) return null
    const distanceM =
      metersPerPixelAtEvent !== null
        ? metersPerPixelAtEvent * AIRCRAFT_NOSE_OFFSET_PX
        : feetToMeters(AIRCRAFT_NOSE_FALLBACK_DISTANCE_FT)
    return destinationPoint(eventPoint, distanceM, eventPoint.headingDeg)
  }, [eventPoint, metersPerPixelAtEvent])

  // Shared turn radius for both the transit route's initial turn and the pattern's rounded
  // corners — same aircraft, same assumed max bank, so the same turn performance applies.
  const turnRadiusFtValue = useMemo(
    () => turnRadiusFt(glide.bestGlideSpeedKt, ROUTE_DEFAULTS.maxBankAngleDeg),
    [glide.bestGlideSpeedKt],
  )

  // Transit from the aircraft's nose to the pattern's Downwind entry: a single straight line.
  // `nosePosition` itself is already correctly placed (verified directly — its value tracks
  // the event point and scales properly with zoom); a heading leg before this straight shot
  // (tried, reverted) only helps when the required turn is small — for a large turn (heading
  // pointing well away from Downwind) it made the aircraft fly *away* from the target for 0.1
  // NM before sharply correcting, which reads as more broken than no heading cue at all. The
  // aircraft icon itself (already correctly rotated to heading) is the heading indicator; this
  // line's job is just to correctly connect the nose to Downwind, not to also depict heading.
  const routeToPattern = useMemo(() => {
    if (!eventPoint || !nosePosition || !approachPlan) return null
    return buildHeadingLegRoute(nosePosition, eventPoint.headingDeg, approachPlan.downwind, 0)
  }, [eventPoint, nosePosition, approachPlan])

  // The Downwind/Base/Final/Touchdown legs, with Base and Final's corners rounded to the
  // transit turn radius, instead of sharp pivots — this geometry (fillet between two known
  // leg bearings) was verified separately and doesn't share the arc-based transit route's bugs.
  const roundedPatternPath = useMemo(() => {
    if (!approachPlan) return null
    return roundCorners(
      [approachPlan.downwind, approachPlan.base, approachPlan.final, approachPlan.touchdown],
      turnRadiusFtValue,
    )
  }, [approachPlan, turnRadiusFtValue])

  // The entire flight — nose to Downwind, then around the pattern to Touchdown — as one
  // continuous line, single style throughout (no dashed-vs-solid split).
  const combinedRoutePositions = useMemo(() => {
    if (!routeToPattern || !roundedPatternPath || !eventPoint || !approachPlan) return null
    const startAltitudeMslFt = eventPoint.altitudeMslFt
    const endAltitudeMslFt = approachPlan.downwind.altitudeMslFt
    const transitTotalFt = routeToPattern.totalDistanceFt
    const transitPositions = routeToPattern.path.map((p) => {
      const t = transitTotalFt > 0 ? p.distanceFromStartFt / transitTotalFt : 0
      const altitudeMslFt = startAltitudeMslFt + (endAltitudeMslFt - startAltitudeMslFt) * t
      return Cartesian3.fromDegrees(p.lon, p.lat, feetToMeters(altitudeMslFt))
    })

    const patternWaypoints = [
      approachPlan.downwind,
      approachPlan.base,
      approachPlan.final,
      approachPlan.touchdown,
    ]
    const patternAltitudes = altitudesAlongPath(patternWaypoints, roundedPatternPath.path)
    const patternPositions = roundedPatternPath.path
      .map((p, i) => Cartesian3.fromDegrees(p.lon, p.lat, feetToMeters(patternAltitudes[i])))
      .slice(1) // first point duplicates the transit route's endpoint (Downwind)

    return [...transitPositions, ...patternPositions]
  }, [routeToPattern, roundedPatternPath, eventPoint, approachPlan])

  // Altitude (MSL + AGL) callouts every half NM along the transit portion of the route, per
  // the user's explicit request. AGL uses the ground elevation interpolated between the event
  // and landing points' sampled elevations — an approximation, not per-point terrain sampling.
  const routeAltitudeCallouts = useMemo(() => {
    if (!routeToPattern || !eventPoint || !approachPlan || !landingPoint) return []
    const intervalFt = ALTITUDE_CALLOUT_INTERVAL_NM * FT_PER_NM
    const totalFt = routeToPattern.totalDistanceFt
    const callouts: Array<LatLon & { altitudeMslFt: number; heightAglFt: number }> = []
    for (let distanceFt = intervalFt; distanceFt < totalFt; distanceFt += intervalFt) {
      const p = pointAtDistance(
        routeToPattern,
        distanceFt,
        eventPoint.altitudeMslFt,
        approachPlan.downwind.altitudeMslFt,
      )
      if (!p) continue
      const t = totalFt > 0 ? distanceFt / totalFt : 0
      const groundElevationMslFt =
        eventPoint.groundElevationMslFt +
        (landingPoint.groundElevationMslFt - eventPoint.groundElevationMslFt) * t
      callouts.push({ ...p, heightAglFt: p.altitudeMslFt - groundElevationMslFt })
    }
    return callouts
  }, [routeToPattern, eventPoint, approachPlan, landingPoint])

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
        // Prefer whichever landing direction needs less transit maneuvering from the event
        // point (falls back to the into-wind default when neither is a clear win) — needs the
        // event point, so only applies once one exists (always true by the time a landing
        // point can be placed, per the click-then-click flow, but eventPoint is nullable here).
        setLandingHeadingDeg(
          eventPoint
            ? preferredLandingHeadingDeg(
                strip,
                eventPoint,
                eventPoint.headingDeg,
                turnRadiusFt(glide.bestGlideSpeedKt, ROUTE_DEFAULTS.maxBankAngleDeg),
                glide.bestGlideSpeedKt,
                landingPoint.groundElevationMslFt,
                approachParams,
                wind,
              )
            : defaultLandingHeadingDeg(strip, wind.directionFromDeg),
        )
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
          flyToRegion={flyToRegion}
          pixelScaleReferencePosition={eventPoint}
          onMetersPerPixelChange={setMetersPerPixelAtEvent}
        >
          {eventPoint && (
            <Entity
              id={EVENT_POINT_ID}
              position={Cartesian3.fromDegrees(
                eventPoint.lon,
                eventPoint.lat,
                feetToMeters(eventPoint.altitudeMslFt),
              )}
            >
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
                    Cartesian3.fromDegrees(
                      eventPoint.lon,
                      eventPoint.lat,
                      feetToMeters(eventPoint.altitudeMslFt),
                    ),
                    Cartesian3.fromDegrees(
                      headingHandlePosition.lon,
                      headingHandlePosition.lat,
                      feetToMeters(eventPoint.altitudeMslFt),
                    ),
                  ]}
                  width={2}
                  material={Color.WHITE.withAlpha(0.6)}
                  depthFailMaterial={Color.WHITE.withAlpha(0.6)}
                />
              </Entity>
              <Entity
                id={HEADING_HANDLE_ID}
                position={Cartesian3.fromDegrees(
                  headingHandlePosition.lon,
                  headingHandlePosition.lat,
                  feetToMeters(eventPoint.altitudeMslFt),
                )}
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
                  pixelSize={22}
                  color={STRIP_COLOR}
                  outlineColor={Color.WHITE}
                  outlineWidth={3}
                  disableDepthTestDistance={Number.POSITIVE_INFINITY}
                />
              </Entity>
              <Entity
                id={STRIP_END_ID}
                position={Cartesian3.fromDegrees(landingStrip.end.lon, landingStrip.end.lat)}
              >
                <PointGraphics
                  pixelSize={22}
                  color={STRIP_COLOR}
                  outlineColor={Color.WHITE}
                  outlineWidth={3}
                  disableDepthTestDistance={Number.POSITIVE_INFINITY}
                />
              </Entity>
            </>
          )}
          {approachPlan && landingPoint && (
            <>
              {(
                [
                  { point: approachPlan.downwind, label: 'Downwind' },
                  { point: approachPlan.base, label: 'Base' },
                  { point: approachPlan.final, label: 'Final' },
                  { point: approachPlan.touchdown, label: 'Touchdown' },
                ] as const
              ).map(({ point, label }) => {
                const heightAglFt = point.altitudeMslFt - landingPoint.groundElevationMslFt
                return (
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
                      text={`${label} — ${Math.round(point.altitudeMslFt).toLocaleString()} ft MSL / ${Math.round(heightAglFt).toLocaleString()} ft AGL`}
                      font="12px sans-serif"
                      fillColor={Color.WHITE}
                      outlineColor={Color.BLACK}
                      outlineWidth={2}
                      style={LabelStyle.FILL_AND_OUTLINE}
                      pixelOffset={new Cartesian2(0, -14)}
                      disableDepthTestDistance={Number.POSITIVE_INFINITY}
                    />
                  </Entity>
                )
              })}
              {combinedRoutePositions && (
                <Entity>
                  <PolylineGraphics
                    positions={combinedRoutePositions}
                    width={3}
                    material={APPROACH_COLOR}
                    depthFailMaterial={APPROACH_COLOR}
                  />
                </Entity>
              )}
              {routeAltitudeCallouts.map((callout, i) => (
                <Entity
                  key={`route-callout-${i}`}
                  position={Cartesian3.fromDegrees(
                    callout.lon,
                    callout.lat,
                    feetToMeters(callout.altitudeMslFt),
                  )}
                >
                  <PointGraphics
                    pixelSize={6}
                    color={APPROACH_COLOR}
                    outlineColor={Color.WHITE}
                    outlineWidth={1}
                    disableDepthTestDistance={Number.POSITIVE_INFINITY}
                  />
                  <LabelGraphics
                    text={`${Math.round(callout.altitudeMslFt).toLocaleString()} ft MSL\n${Math.round(callout.heightAglFt).toLocaleString()} ft AGL`}
                    font="11px sans-serif"
                    fillColor={Color.WHITE}
                    outlineColor={Color.BLACK}
                    outlineWidth={2}
                    style={LabelStyle.FILL_AND_OUTLINE}
                    pixelOffset={new Cartesian2(0, -10)}
                    disableDepthTestDistance={Number.POSITIVE_INFINITY}
                  />
                </Entity>
              ))}
            </>
          )}
        </CesiumMap>
        <WindIndicator wind={wind} />
      </main>
    </div>
  )
}

export default App
