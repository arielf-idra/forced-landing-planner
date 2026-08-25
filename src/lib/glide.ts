import bearing from '@turf/bearing'
import destination from '@turf/destination'
import distance from '@turf/distance'
import type { GlideParameters, LatLon, WindVector } from '../types/domain'
import { KT_TO_FT_PER_MIN } from './geo-constants'
import { feetToMeters, metersToFeet } from './units'

export interface ReachabilityCircle {
  /** Center of the reachable-glide circle — the event point shifted downwind by wind drift. */
  center: LatLon
  /** Radius of the reachable-glide circle, feet (same in still air and with wind — wind shifts the center, not the radius). */
  radiusFt: number
  /** Time from the event to touchdown, minutes, at best-glide sink rate. */
  descentTimeMin: number
}

export interface ReachabilityCheck {
  distanceFromEventFt: number
  bearingFromEventDeg: number
  reachable: boolean
  /** Positive = spare distance within range; negative = short by this much. */
  marginFt: number
}

/** Sink rate at best-glide speed, feet/minute, derived from glide ratio (distance:height). */
export function sinkRateFtPerMin(glide: GlideParameters): number {
  return (glide.bestGlideSpeedKt * KT_TO_FT_PER_MIN) / glide.glideRatio
}

/**
 * The reachable-glide footprint. Best-glide TAS and sink rate don't depend on heading, so
 * time-to-ground is fixed and still-air range is a circle of radius `glideRatio * heightAGL`
 * around the event point. Wind translates every point on that circle by `wind * time` — so
 * this returns that same-radius circle re-centered downwind, not an ellipse.
 */
export function computeReachabilityCircle(
  eventPoint: LatLon,
  heightAglFt: number,
  glide: GlideParameters,
  wind: WindVector,
): ReachabilityCircle {
  if (heightAglFt <= 0) {
    return { center: eventPoint, radiusFt: 0, descentTimeMin: 0 }
  }

  const radiusFt = glide.glideRatio * heightAglFt
  const descentTimeMin = heightAglFt / sinkRateFtPerMin(glide)
  const driftFt = wind.speedKt * KT_TO_FT_PER_MIN * descentTimeMin

  if (driftFt <= 0) {
    return { center: eventPoint, radiusFt, descentTimeMin }
  }

  const downwindBearingDeg = (wind.directionFromDeg + 180) % 360
  const shifted = destination(
    [eventPoint.lon, eventPoint.lat],
    feetToMeters(driftFt),
    downwindBearingDeg,
    { units: 'meters' },
  )
  const [lon, lat] = shifted.geometry.coordinates

  return { center: { lat, lon }, radiusFt, descentTimeMin }
}

/** Distance/bearing from the event point plus whether the landing point sits within the reachable circle. */
export function checkReachability(
  eventPoint: LatLon,
  landingPoint: LatLon,
  circle: ReachabilityCircle,
): ReachabilityCheck {
  const distanceFromEventFt = metersToFeet(
    distance([eventPoint.lon, eventPoint.lat], [landingPoint.lon, landingPoint.lat], {
      units: 'meters',
    }),
  )
  const bearingFromEventDeg =
    (bearing([eventPoint.lon, eventPoint.lat], [landingPoint.lon, landingPoint.lat]) + 360) % 360

  const distanceFromCenterFt = metersToFeet(
    distance([circle.center.lon, circle.center.lat], [landingPoint.lon, landingPoint.lat], {
      units: 'meters',
    }),
  )
  const marginFt = circle.radiusFt - distanceFromCenterFt

  return {
    distanceFromEventFt,
    bearingFromEventDeg,
    reachable: marginFt >= 0,
    marginFt,
  }
}
