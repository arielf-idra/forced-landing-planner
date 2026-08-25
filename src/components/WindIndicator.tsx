import type { WindVector } from '../types/domain'

interface WindIndicatorProps {
  wind: WindVector
}

/**
 * Fixed reference widget in the map corner — not a geographic overlay — showing wind
 * direction/speed. Rotation assumes a north-up, straight-down camera; it's a quick
 * reference, not a precise indicator tied to the current camera orientation.
 */
export function WindIndicator({ wind }: WindIndicatorProps) {
  if (wind.speedKt <= 0) return null

  const downwindBearingDeg = (wind.directionFromDeg + 180) % 360

  return (
    <div className="wind-indicator">
      <svg
        viewBox="0 0 100 140"
        className="wind-indicator-arrow"
        style={{ transform: `rotate(${downwindBearingDeg}deg)` }}
      >
        <defs>
          <linearGradient id="wind-indicator-fade" x1="0" y1="1" x2="0" y2="0">
            <stop offset="0%" stopColor="white" stopOpacity="0" />
            <stop offset="100%" stopColor="white" stopOpacity="1" />
          </linearGradient>
        </defs>
        <path
          d="M 50 136
             C 22 108, 18 78, 30 56
             C 34 49, 38 44, 40 38
             L 24 34
             L 50 4
             L 76 34
             L 60 38
             C 62 44, 66 49, 70 56
             C 82 78, 78 108, 50 136
             Z"
          fill="url(#wind-indicator-fade)"
        />
      </svg>
      <div className="wind-indicator-text">
        <div>{Math.round(wind.speedKt)} kt</div>
        <div>{Math.round(wind.directionFromDeg).toString().padStart(3, '0')}°</div>
      </div>
    </div>
  )
}
