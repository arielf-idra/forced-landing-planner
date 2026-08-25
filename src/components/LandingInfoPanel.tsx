import type { ClearanceCheck } from '../lib/terrainProfile'
import type { ReachabilityCheck } from '../lib/glide'
import { FT_PER_NM } from '../lib/geo-constants'
import type { LandingPoint } from '../types/domain'

interface LandingInfoPanelProps {
  landingPoint: LandingPoint | null
  isSampling: boolean
  reachabilityCheck: ReachabilityCheck | null
  clearanceCheck: ClearanceCheck | null
  isSamplingProfile: boolean
}

export function LandingInfoPanel({
  landingPoint,
  isSampling,
  reachabilityCheck,
  clearanceCheck,
  isSamplingProfile,
}: LandingInfoPanelProps) {
  return (
    <section className="panel">
      <h2>Landing point</h2>
      {!landingPoint && !isSampling && <p>Click the map to pick a field to land in.</p>}
      {isSampling && <p>Sampling ground elevation…</p>}
      {landingPoint && (
        <>
          <dl>
            <dt>Location</dt>
            <dd>
              {landingPoint.lat.toFixed(4)}, {landingPoint.lon.toFixed(4)}
            </dd>
            <dt>Ground elevation</dt>
            <dd>{Math.round(landingPoint.groundElevationMslFt).toLocaleString()} ft MSL</dd>
          </dl>

          {reachabilityCheck && (
            <dl>
              <dt>Distance / bearing</dt>
              <dd>
                {(reachabilityCheck.distanceFromEventFt / FT_PER_NM).toFixed(1)} nm @{' '}
                {Math.round(reachabilityCheck.bearingFromEventDeg).toString().padStart(3, '0')}°
              </dd>
              <dt>Within glide range</dt>
              <dd className={reachabilityCheck.reachable ? 'ok' : 'warn'}>
                {reachabilityCheck.reachable ? 'Yes' : 'No'} (margin{' '}
                {Math.round(reachabilityCheck.marginFt).toLocaleString()} ft)
              </dd>
            </dl>
          )}

          {isSamplingProfile && <p>Checking terrain along the glide path…</p>}
          {clearanceCheck && (
            <dl>
              <dt>Terrain clearance</dt>
              <dd className={clearanceCheck.clear ? 'ok' : 'warn'}>
                {clearanceCheck.clear
                  ? `Clear (min margin ${Math.round(clearanceCheck.worstMarginFt).toLocaleString()} ft)`
                  : `Blocked — terrain intrudes ${Math.round(-clearanceCheck.worstMarginFt).toLocaleString()} ft, ${(clearanceCheck.worstMarginAtFt / FT_PER_NM).toFixed(1)} nm out`}
              </dd>
            </dl>
          )}
          <p className="hint">Drag the marker to reposition it.</p>
        </>
      )}
    </section>
  )
}
