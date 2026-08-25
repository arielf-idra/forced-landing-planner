import type { EventPoint } from '../types/domain'

interface EventPointPanelProps {
  eventPoint: EventPoint | null
  isSampling: boolean
  onAltitudeChange: (altitudeMslFt: number) => void
}

export function EventPointPanel({ eventPoint, isSampling, onAltitudeChange }: EventPointPanelProps) {
  return (
    <section className="panel">
      <h2>Event point</h2>
      {!eventPoint && !isSampling && <p>Click the map to mark where the engine fails.</p>}
      {isSampling && <p>Sampling ground elevation…</p>}
      {eventPoint && (
        <>
          <dl>
            <dt>Location</dt>
            <dd>
              {eventPoint.lat.toFixed(4)}, {eventPoint.lon.toFixed(4)}
            </dd>
            <dt>Ground elevation</dt>
            <dd>{Math.round(eventPoint.groundElevationMslFt).toLocaleString()} ft MSL</dd>
          </dl>
          <label className="field">
            Altitude at engine failure (ft MSL)
            <input
              type="number"
              value={Math.round(eventPoint.altitudeMslFt)}
              step={100}
              onChange={(e) => onAltitudeChange(Number(e.target.value))}
            />
          </label>
          <dl>
            <dt>Height AGL</dt>
            <dd>
              {Math.round(
                Math.max(0, eventPoint.altitudeMslFt - eventPoint.groundElevationMslFt),
              ).toLocaleString()}{' '}
              ft
            </dd>
          </dl>
          <p className="hint">Click the map again to move the event point.</p>
        </>
      )}
    </section>
  )
}
