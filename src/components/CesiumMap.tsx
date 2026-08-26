import {
  BoundingSphere,
  Cartesian2,
  Cartesian3,
  Cartographic,
  createWorldTerrainAsync,
  Math as CesiumMath,
  Rectangle,
  ScreenSpaceEventType,
  type TerrainProvider,
  type Viewer as CesiumViewer,
} from 'cesium'
import { useEffect, useMemo, useRef, useState, type ReactNode } from 'react'
import { CameraFlyTo, ScreenSpaceEvent, ScreenSpaceEventHandler, Viewer } from 'resium'
import '../lib/cesiumIonSetup'
import { destinationPoint } from '../lib/geo'
import { FLY_TO_MARGIN_FACTOR } from '../lib/geo-constants'
import { feetToMeters } from '../lib/units'
import type { LatLon } from '../types/domain'
import 'cesium/Build/Cesium/Widgets/widgets.css'

// Initial camera view — a bounding box around the requested default area (a stretch of
// central Israel), not an exact match to its four corner points.
const DEFAULT_VIEW_RECTANGLE = Rectangle.fromDegrees(34.74, 32.15, 35.05, 32.52)

type ClickMovement = { position: Cartesian2 } | { startPosition: Cartesian2; endPosition: Cartesian2 }

interface CesiumMapProps {
  onTerrainReady: (provider: TerrainProvider) => void
  /** A plain click that didn't start on a draggable entity (see `onPointDrag`). */
  onMapClick: (point: LatLon) => void
  /**
   * Ids of the entities `onPointDrag` cares about. Cesium auto-assigns every Entity a random
   * id if none is given explicitly — the reachability circles and connector lines don't set
   * one on purpose, but `scene.pick()` still returns their auto-generated id, so treating
   * "any picked entity" as a drag target swallowed clicks anywhere inside the (mostly
   * filled) circle. Only ids in this set start a drag; anything else falls through to a
   * plain `onMapClick`.
   */
  draggableEntityIds: ReadonlySet<string>
  /**
   * Fires when a press-drag-release starts on one of `draggableEntityIds`. `move` fires
   * continuously while dragging (cheap ground pick only); `end` fires once on release, for
   * callers to do an authoritative re-sample (e.g. terrain elevation).
   */
  onPointDrag: (entityId: string, point: LatLon, phase: 'move' | 'end') => void
  /** When set (or its center/radius changes), the camera flies to frame this circular region
   * with margin — e.g. the reachability circle around the event point. */
  flyToRegion: { center: LatLon; radiusFt: number } | null
  /**
   * Position to track the camera's current real-world-meters-per-screen-pixel at (e.g. the
   * event point) — lets callers size on-screen-constant offsets (like the gap between the
   * aircraft icon and the transit route's start) that stay visually correct as the user zooms,
   * rather than a fixed real-world distance that renders at a different pixel size every zoom
   * level. Reported via `onMetersPerPixelChange` continuously while the camera moves.
   * `altitudeMslFt` (optional, feet) must match whatever real altitude the thing being sized
   * is actually rendered at (e.g. the aircraft billboard's real flying altitude) — `getPixelSize`
   * depends on distance from the camera to this exact 3D point, so measuring at ground level
   * while the icon renders thousands of feet up gives a meters-per-pixel value for the wrong
   * point entirely, and the resulting offset can be wrong by several times its intended size.
   */
  pixelScaleReferencePosition: (LatLon & { altitudeMslFt?: number }) | null
  onMetersPerPixelChange: (metersPerPixel: number | null) => void
  children?: ReactNode
}

export function CesiumMap({
  onTerrainReady,
  onMapClick,
  draggableEntityIds,
  onPointDrag,
  flyToRegion,
  pixelScaleReferencePosition,
  onMetersPerPixelChange,
  children,
}: CesiumMapProps) {
  const terrainProviderPromise = useMemo(() => createWorldTerrainAsync(), [])
  const viewerRef = useRef<{ cesiumElement?: CesiumViewer } | null>(null)
  const draggingIdRef = useRef<string | null>(null)
  const downHitMarkerRef = useRef(false)
  const [viewerReady, setViewerReady] = useState(false)

  useEffect(() => {
    let cancelled = false
    terrainProviderPromise.then((provider) => {
      if (cancelled) return
      onTerrainReady(provider)
      // Terrain resolving is already used elsewhere in this file as a safe proxy for "the
      // Viewer has attached to the ref" (see the flyTo effect's comment below) — reused here
      // to gate the pixel-scale-tracking effect until the viewer genuinely exists.
      setViewerReady(true)
    })
    return () => {
      cancelled = true
    }
  }, [terrainProviderPromise, onTerrainReady])

  // Imperative flyTo (not the declarative <CameraFlyTo once> below, which is one-shot for the
  // initial default view) — this one re-fires whenever the caller hands us a new region. Safe
  // to call `viewer.camera.flyTo` here (unlike on first mount) because by the time a region
  // exists the Viewer has long since attached to the ref (it requires a terrain-ready click
  // first).
  useEffect(() => {
    const viewer = viewerRef.current?.cesiumElement
    if (!viewer || !flyToRegion || flyToRegion.radiusFt <= 0) return
    const marginRadiusM = feetToMeters(flyToRegion.radiusFt * FLY_TO_MARGIN_FACTOR)
    const west = destinationPoint(flyToRegion.center, marginRadiusM, 270).lon
    const east = destinationPoint(flyToRegion.center, marginRadiusM, 90).lon
    const north = destinationPoint(flyToRegion.center, marginRadiusM, 0).lat
    const south = destinationPoint(flyToRegion.center, marginRadiusM, 180).lat
    viewer.camera.flyTo({ destination: Rectangle.fromDegrees(west, south, east, north) })
  }, [flyToRegion])

  // `pixelScaleReferencePosition` changes on nearly every frame while the caller is dragging
  // the event point — tracked via a ref (updated every render, no effect re-run) rather than
  // an effect dependency, so the postRender listener below is set up exactly once instead of
  // being torn down and rebuilt on every drag tick. An earlier version depended directly on
  // `pixelScaleReferencePosition?.lat/lon`, which resubscribed a scene-level event listener on
  // every single mouse-move sample during a drag — enough churn to make the whole page hang
  // during a drag in testing. Same treatment for `onMetersPerPixelChange`, so a new inline
  // callback from the caller doesn't retrigger this either.
  const pixelScaleReferencePositionRef = useRef(pixelScaleReferencePosition)
  useEffect(() => {
    pixelScaleReferencePositionRef.current = pixelScaleReferencePosition
  }, [pixelScaleReferencePosition])
  const onMetersPerPixelChangeRef = useRef(onMetersPerPixelChange)
  useEffect(() => {
    onMetersPerPixelChangeRef.current = onMetersPerPixelChange
  }, [onMetersPerPixelChange])

  // Reports real-world meters per screen pixel at the (live-tracked) reference position,
  // recomputed on every rendered frame while the camera moves (zoom, pan, tilt all change it)
  // — this is what actually makes an on-screen-constant offset adapt live as the user zooms,
  // rather than only updating at discrete moments like a flyTo. Only reports a new value when
  // it changed by more than ~2% (or the reference position itself moved), so a settled camera
  // doesn't spam the parent with identical values every frame.
  useEffect(() => {
    if (!viewerReady) return
    const viewer = viewerRef.current?.cesiumElement
    if (!viewer) return

    let lastReported: number | null = null
    let lastLat: number | null = null
    let lastLon: number | null = null
    let lastAlt: number | null = null

    function report() {
      const pos = pixelScaleReferencePositionRef.current
      if (!pos) {
        if (lastReported !== null) {
          lastReported = null
          onMetersPerPixelChangeRef.current(null)
        }
        return
      }
      const altitudeMslFt = pos.altitudeMslFt ?? 0
      const boundingSphere = new BoundingSphere(
        Cartesian3.fromDegrees(pos.lon, pos.lat, feetToMeters(altitudeMslFt)),
        1,
      )
      const metersPerPixel = viewer!.camera.getPixelSize(
        boundingSphere,
        viewer!.scene.drawingBufferWidth,
        viewer!.scene.drawingBufferHeight,
      )
      const positionMoved = pos.lat !== lastLat || pos.lon !== lastLon || altitudeMslFt !== lastAlt
      if (
        lastReported === null ||
        positionMoved ||
        Math.abs(metersPerPixel - lastReported) / lastReported > 0.02
      ) {
        lastReported = metersPerPixel
        lastLat = pos.lat
        lastLon = pos.lon
        lastAlt = altitudeMslFt
        onMetersPerPixelChangeRef.current(metersPerPixel)
      }
    }

    viewer.scene.postRender.addEventListener(report)
    report()
    return () => {
      viewer.scene.postRender.removeEventListener(report)
    }
  }, [viewerReady])

  function pickGround(viewer: CesiumViewer, position: Cartesian2): LatLon | null {
    const ray = viewer.camera.getPickRay(position)
    if (!ray) return null
    const groundPosition = viewer.scene.globe.pick(ray, viewer.scene)
    if (!groundPosition) return null
    const carto = Cartographic.fromCartesian(groundPosition)
    return { lat: CesiumMath.toDegrees(carto.latitude), lon: CesiumMath.toDegrees(carto.longitude) }
  }

  function handleLeftDown(movement: ClickMovement) {
    const viewer = viewerRef.current?.cesiumElement
    if (!viewer || !('position' in movement)) return
    const picked = viewer.scene.pick(movement.position)
    const entityId: string | undefined = picked?.id?.id
    if (entityId && draggableEntityIds.has(entityId)) {
      downHitMarkerRef.current = true
      draggingIdRef.current = entityId
      // Imperative Cesium object mutation (not React state) — safe outside React's render
      // cycle; flagged only because the flyTo effect below also reads `viewerRef`.
      // eslint-disable-next-line react-hooks/immutability
      viewer.scene.screenSpaceCameraController.enableInputs = false
    }
  }

  function handleMouseMove(movement: ClickMovement) {
    const viewer = viewerRef.current?.cesiumElement
    const entityId = draggingIdRef.current
    if (!viewer || !entityId || !('endPosition' in movement)) return
    const point = pickGround(viewer, movement.endPosition)
    if (point) onPointDrag(entityId, point, 'move')
  }

  function handleLeftUp(movement: ClickMovement) {
    const viewer = viewerRef.current?.cesiumElement
    // eslint-disable-next-line react-hooks/immutability
    if (viewer) viewer.scene.screenSpaceCameraController.enableInputs = true
    const entityId = draggingIdRef.current
    if (viewer && entityId && 'position' in movement) {
      const point = pickGround(viewer, movement.position)
      if (point) onPointDrag(entityId, point, 'end')
    }
    draggingIdRef.current = null
  }

  function handleClick(movement: ClickMovement) {
    // LEFT_DOWN + LEFT_UP with no movement in between still fires LEFT_CLICK afterward —
    // skip placement if this click started on an existing marker (that's a non-drag tap on
    // it, not a request to place a new point).
    if (downHitMarkerRef.current) {
      downHitMarkerRef.current = false
      return
    }
    const viewer = viewerRef.current?.cesiumElement
    if (!viewer || !('position' in movement)) return
    const point = pickGround(viewer, movement.position)
    if (point) onMapClick(point)
  }

  return (
    <Viewer
      full
      ref={viewerRef}
      terrainProvider={terrainProviderPromise}
      timeline={false}
      animation={false}
      baseLayerPicker={false}
      homeButton={false}
      sceneModePicker={false}
      navigationHelpButton={false}
      geocoder={false}
      infoBox={false}
      selectionIndicator={false}
    >
      {/*
        `once` is required — resium's CameraFlyTo re-fires camera.flyTo on every render
        with no dependency check of its own, so without it the camera would snap back to
        Israel on every unrelated state change (placing a marker, editing a parameter).
      */}
      <CameraFlyTo once destination={DEFAULT_VIEW_RECTANGLE} />
      <ScreenSpaceEventHandler>
        <ScreenSpaceEvent action={handleClick} type={ScreenSpaceEventType.LEFT_CLICK} />
        <ScreenSpaceEvent action={handleLeftDown} type={ScreenSpaceEventType.LEFT_DOWN} />
        <ScreenSpaceEvent action={handleMouseMove} type={ScreenSpaceEventType.MOUSE_MOVE} />
        <ScreenSpaceEvent action={handleLeftUp} type={ScreenSpaceEventType.LEFT_UP} />
      </ScreenSpaceEventHandler>
      {children}
    </Viewer>
  )
}
