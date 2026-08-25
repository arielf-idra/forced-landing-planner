import {
  Cartesian2,
  Cartographic,
  createWorldTerrainAsync,
  Math as CesiumMath,
  Rectangle,
  ScreenSpaceEventType,
  type TerrainProvider,
  type Viewer as CesiumViewer,
} from 'cesium'
import { useEffect, useMemo, useRef, type ReactNode } from 'react'
import { CameraFlyTo, ScreenSpaceEvent, ScreenSpaceEventHandler, Viewer } from 'resium'
import '../lib/cesiumIonSetup'
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
  children?: ReactNode
}

export function CesiumMap({
  onTerrainReady,
  onMapClick,
  draggableEntityIds,
  onPointDrag,
  children,
}: CesiumMapProps) {
  const terrainProviderPromise = useMemo(() => createWorldTerrainAsync(), [])
  const viewerRef = useRef<{ cesiumElement?: CesiumViewer } | null>(null)
  const draggingIdRef = useRef<string | null>(null)
  const downHitMarkerRef = useRef(false)

  useEffect(() => {
    let cancelled = false
    terrainProviderPromise.then((provider) => {
      if (!cancelled) onTerrainReady(provider)
    })
    return () => {
      cancelled = true
    }
  }, [terrainProviderPromise, onTerrainReady])

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
