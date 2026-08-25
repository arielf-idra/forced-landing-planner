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

// Roughly covers Israel; used as the initial camera view on load.
const ISRAEL_RECTANGLE = Rectangle.fromDegrees(34.2, 29.45, 35.9, 33.35)

interface CesiumMapProps {
  onTerrainReady: (provider: TerrainProvider) => void
  onMapClick: (point: LatLon) => void
  children?: ReactNode
}

export function CesiumMap({ onTerrainReady, onMapClick, children }: CesiumMapProps) {
  const terrainProviderPromise = useMemo(() => createWorldTerrainAsync(), [])
  const viewerRef = useRef<{ cesiumElement?: CesiumViewer } | null>(null)

  useEffect(() => {
    let cancelled = false
    terrainProviderPromise.then((provider) => {
      if (!cancelled) onTerrainReady(provider)
    })
    return () => {
      cancelled = true
    }
  }, [terrainProviderPromise, onTerrainReady])

  function handleClick(movement: { position: Cartesian2 } | { startPosition: Cartesian2; endPosition: Cartesian2 }) {
    const viewer = viewerRef.current?.cesiumElement
    if (!viewer || !('position' in movement)) return
    const ray = viewer.camera.getPickRay(movement.position)
    if (!ray) return
    const groundPosition = viewer.scene.globe.pick(ray, viewer.scene)
    if (!groundPosition) return
    const carto = Cartographic.fromCartesian(groundPosition)
    onMapClick({
      lat: CesiumMath.toDegrees(carto.latitude),
      lon: CesiumMath.toDegrees(carto.longitude),
    })
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
    >
      {/*
        `once` is required — resium's CameraFlyTo re-fires camera.flyTo on every render
        with no dependency check of its own, so without it the camera would snap back to
        Israel on every unrelated state change (placing a marker, editing a parameter).
      */}
      <CameraFlyTo once destination={ISRAEL_RECTANGLE} />
      <ScreenSpaceEventHandler>
        <ScreenSpaceEvent action={handleClick} type={ScreenSpaceEventType.LEFT_CLICK} />
      </ScreenSpaceEventHandler>
      {children}
    </Viewer>
  )
}
