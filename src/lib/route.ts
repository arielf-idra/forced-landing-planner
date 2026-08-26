import type { LatLon, WindVector } from '../types/domain'
import { bearingDegrees, destinationPoint, distanceMeters } from './geo'
import { FT_PER_NM, GRAVITY_FT_PER_S2 } from './geo-constants'
import { feetToMeters, metersToFeet } from './units'

/** Points sampled along the turn arc, for rendering and distance/altitude interpolation. */
const ARC_SAMPLES = 24

export interface RoutePoint extends LatLon {
  /** Cumulative distance from the route's start, feet. */
  distanceFromStartFt: number
}

export interface PlannedRoute {
  /** Every sampled point along the route (arc, if any, then the straight final leg), in order. */
  path: RoutePoint[]
  totalDistanceFt: number
}

/** Level-turn radius, feet, for `speedKt` at `bankAngleDeg` of bank (`radius = v² / (g·tan(bank))`). */
export function turnRadiusFt(speedKt: number, bankAngleDeg: number): number {
  const speedFtPerS = (speedKt * FT_PER_NM) / 3600
  return speedFtPerS ** 2 / (GRAVITY_FT_PER_S2 * Math.tan((bankAngleDeg * Math.PI) / 180))
}

/**
 * A simple two-leg alternative to the constant-radius-turn model (`planRouteToTarget`): a
 * short straight leg in `start`'s current heading (`legDistanceFt` long — long enough to
 * unambiguously show which way the aircraft is pointed before it turns toward `target`), then
 * a straight leg the rest of the way. Trades the arc's physical realism (a real turn can't
 * pivot instantly) for a design with no turn-radius/turn-direction geometry to get wrong —
 * every visual "jumps around the icon" and "223° sweep the wrong way" bug found while
 * debugging the arc came from that geometry, not from anything a straight leg can get wrong.
 * Falls back to a single straight line if `target` is already closer than `legDistanceFt`.
 */
export function buildHeadingLegRoute(
  start: LatLon,
  startHeadingDeg: number,
  target: LatLon,
  legDistanceFt: number,
): PlannedRoute {
  const legDistanceM = feetToMeters(legDistanceFt)
  if (legDistanceFt <= 0 || distanceMeters(start, target) <= legDistanceM) {
    return straightRoute(start, target)
  }
  const legEnd = destinationPoint(start, legDistanceM, startHeadingDeg)
  return withCumulativeDistance([start, legEnd, target])
}

const NO_WIND: WindVector = { speedKt: 0, directionFromDeg: 0 }

/**
 * A flyable route from `start` (heading `startHeadingDeg`) to `target`: a single constant-
 * radius turn immediately at the start, rolling out on a straight line toward `target`, then
 * straight the rest of the way — rather than an instant-turn straight line, which isn't
 * something an aircraft can actually fly. Tries turning *both* directions and keeps whichever
 * is shorter — picking the direction from the sign of the heading difference alone (as if
 * "target to the right always means turn right") breaks down when the target is close to
 * directly behind the aircraft: one direction can require sweeping most of the way around the
 * turn circle to roll out toward the target, while the other reaches it directly. If
 * `startHeadingDeg` is already within ~1° of the direct bearing to `target`, or neither turn
 * direction has a valid tangent geometry (target inside the turn circle — only possible at
 * very short range), falls back to a straight line.
 *
 * `speedKt` and `wind` (both optional, defaulting to no wind) account for drift *during the
 * turn* — same "distance = speed × time" model `glide.ts` uses to shift the reachability
 * circle downwind. The straight legs before and after the turn are flown as a corrected ground
 * track (the pilot aims directly at `start`/`target`, so wind doesn't distort their shape,
 * only how long they take) — but a turn held at constant bank isn't actively crab-corrected
 * for the few seconds it takes to complete, so the ground track drifts downwind over that time,
 * and the pilot then re-aims the following straight leg from wherever that left them, not from
 * the still-air tangent point.
 */
export function planRouteToTarget(
  start: LatLon,
  startHeadingDeg: number,
  target: LatLon,
  radiusFt: number,
  speedKt = 0,
  wind: WindVector = NO_WIND,
): PlannedRoute {
  const directBearingDeg = bearingDegrees(start, target)
  const headingDiffDeg = signedAngleDiffDeg(directBearingDeg, startHeadingDeg)

  if (Math.abs(headingDiffDeg) < 1 || radiusFt <= 0) {
    return straightRoute(start, target)
  }

  const candidates = [1 as const, -1 as const]
    .map((turnSign) => buildTurnRoute(start, startHeadingDeg, target, radiusFt, turnSign, speedKt, wind))
    .filter((route): route is PlannedRoute => route !== null)

  if (candidates.length === 0) return straightRoute(start, target)
  return candidates.reduce((best, route) => (route.totalDistanceFt < best.totalDistanceFt ? route : best))
}

/** Builds the turn-then-straight route for one specific turn direction, or `null` if that
 * direction has no valid tangent geometry (target inside the turn circle on that side). */
function buildTurnRoute(
  start: LatLon,
  startHeadingDeg: number,
  target: LatLon,
  radiusFt: number,
  turnSign: 1 | -1,
  speedKt: number,
  wind: WindVector,
): PlannedRoute | null {
  const radiusM = feetToMeters(radiusFt)
  const center = destinationPoint(start, radiusM, startHeadingDeg + turnSign * 90)
  const centerToTargetM = distanceMeters(center, target)

  if (centerToTargetM <= radiusM) return null

  const tangentPoint = findTangentPoint(center, radiusM, target, turnSign)
  if (!tangentPoint) return null

  const arcPoints = sampleArc(center, radiusM, start, tangentPoint, turnSign)
  const driftedArcPoints = applyWindDriftDuringTurn(arcPoints, speedKt, wind)
  return withCumulativeDistance([...driftedArcPoints, target])
}

/**
 * Displaces each arc sample downwind by the wind drift accumulated since the turn began
 * (`start`, at index 0, is left exactly as planned — zero elapsed time). Same "distance =
 * speed × time" drift model as `glide.ts`'s reachability circle. No-ops if there's no wind or
 * no speed reference to derive elapsed time from.
 */
function applyWindDriftDuringTurn(arcPoints: LatLon[], speedKt: number, wind: WindVector): LatLon[] {
  if (wind.speedKt <= 0 || speedKt <= 0 || arcPoints.length === 0) return arcPoints

  const downwindBearingDeg = (wind.directionFromDeg + 180) % 360
  const speedFtPerS = (speedKt * FT_PER_NM) / 3600
  const windFtPerS = (wind.speedKt * FT_PER_NM) / 3600

  let cumulativeArcFt = 0
  return arcPoints.map((p, i) => {
    if (i > 0) cumulativeArcFt += metersToFeet(distanceMeters(arcPoints[i - 1], p))
    const driftFt = windFtPerS * (cumulativeArcFt / speedFtPerS)
    return driftFt > 0 ? destinationPoint(p, feetToMeters(driftFt), downwindBearingDeg) : p
  })
}

function straightRoute(start: LatLon, target: LatLon): PlannedRoute {
  return withCumulativeDistance([start, target])
}

/**
 * Of the two tangent lines from external point `target` to the circle (`center`, `radiusM`),
 * returns the one consistent with continuing the arc in `turnSign`'s rotational direction —
 * i.e. where the arc's exit velocity at the tangent point actually points toward `target`,
 * not away from it.
 */
function findTangentPoint(
  center: LatLon,
  radiusM: number,
  target: LatLon,
  turnSign: 1 | -1,
): LatLon | null {
  const centerToTargetM = distanceMeters(center, target)
  const bearingCenterToTargetDeg = bearingDegrees(center, target)
  // Angle at the circle's center between (center->target) and (center->tangentPoint): in the
  // right triangle center/tangentPoint/target (right angle at the tangent point, since a
  // tangent line is perpendicular to the radius), that angle's adjacent/hypotenuse ratio is
  // radius/distance, so it's arccos, not arcsin (which would give the *complementary* angle).
  const offsetDeg = (Math.acos(radiusM / centerToTargetM) * 180) / Math.PI

  let best: LatLon | null = null
  let bestScore = Infinity
  for (const bearingCenterToTangentDeg of [
    bearingCenterToTargetDeg + offsetDeg,
    bearingCenterToTargetDeg - offsetDeg,
  ]) {
    const candidate = destinationPoint(center, radiusM, bearingCenterToTangentDeg)
    const exitVelocityDeg = (bearingCenterToTangentDeg + turnSign * 90 + 360) % 360
    const bearingToTargetDeg = bearingDegrees(candidate, target)
    const score = Math.abs(signedAngleDiffDeg(exitVelocityDeg, bearingToTargetDeg))
    if (score < bestScore) {
      bestScore = score
      best = candidate
    }
  }
  return best
}

/** Samples the arc from `start` to `tangentPoint`, sweeping around `center` in `turnSign`'s direction. */
function sampleArc(
  center: LatLon,
  radiusM: number,
  start: LatLon,
  tangentPoint: LatLon,
  turnSign: 1 | -1,
): LatLon[] {
  const startBearingDeg = bearingDegrees(center, start)
  const endBearingDeg = bearingDegrees(center, tangentPoint)
  const clockwiseSweepDeg = ((endBearingDeg - startBearingDeg) % 360 + 360) % 360
  const sweepDeg = turnSign === 1 ? clockwiseSweepDeg : 360 - clockwiseSweepDeg

  const points: LatLon[] = []
  for (let i = 0; i <= ARC_SAMPLES; i++) {
    const t = i / ARC_SAMPLES
    const bearingAtT = startBearingDeg + turnSign * sweepDeg * t
    points.push(destinationPoint(center, radiusM, bearingAtT))
  }
  return points
}

function withCumulativeDistance(points: LatLon[]): PlannedRoute {
  const path: RoutePoint[] = []
  let cumulativeFt = 0
  for (let i = 0; i < points.length; i++) {
    if (i > 0) cumulativeFt += metersToFeet(distanceMeters(points[i - 1], points[i]))
    path.push({ ...points[i], distanceFromStartFt: cumulativeFt })
  }
  return { path, totalDistanceFt: cumulativeFt }
}

/** Signed difference `a - b`, normalized to (-180, 180]. */
function signedAngleDiffDeg(a: number, b: number): number {
  return ((a - b + 540) % 360) - 180
}

/**
 * Rounds each interior corner of `points` with a constant-radius arc (`radiusFt`) instead of a
 * sharp pivot — mirrors how the aircraft actually banks through a turn. The tangent distance
 * cut from each corner (`radius * tan(deflection/2)`) is capped at 45% of the corner's shorter
 * adjacent leg, so two corners close together (e.g. Base and Final, a short leg apart) can't
 * each claim more than the leg has to give and end up overlapping. First and last points are
 * always kept as given.
 */
export function roundCorners(points: LatLon[], radiusFt: number): PlannedRoute {
  if (points.length < 3 || radiusFt <= 0) return withCumulativeDistance(points)
  const radiusM = feetToMeters(radiusFt)
  const result: LatLon[] = [points[0]]

  for (let i = 1; i < points.length - 1; i++) {
    const prev = points[i - 1]
    const corner = points[i]
    const next = points[i + 1]
    const inBearingDeg = bearingDegrees(prev, corner)
    const outBearingDeg = bearingDegrees(corner, next)
    const turnDeg = signedAngleDiffDeg(outBearingDeg, inBearingDeg)

    if (Math.abs(turnDeg) < 1) {
      result.push(corner)
      continue
    }

    const turnSign = turnDeg > 0 ? 1 : -1
    const halfTurnRad = (Math.abs(turnDeg) * Math.PI) / 360
    const maxTangentM = 0.45 * Math.min(distanceMeters(prev, corner), distanceMeters(corner, next))
    const tangentM = Math.min(radiusM * Math.tan(halfTurnRad), maxTangentM)
    const effectiveRadiusM = tangentM / Math.tan(halfTurnRad)

    const arcStart = destinationPoint(corner, tangentM, inBearingDeg + 180)
    const arcEnd = destinationPoint(corner, tangentM, outBearingDeg)
    const center = destinationPoint(arcStart, effectiveRadiusM, inBearingDeg + turnSign * 90)

    result.push(...sampleArc(center, effectiveRadiusM, arcStart, arcEnd, turnSign))
  }

  result.push(points[points.length - 1])
  return withCumulativeDistance(result)
}

/**
 * Altitude at each point of `path` (e.g. from `roundCorners`), assuming altitude changes
 * linearly between consecutive `waypoints`' known altitudes, in proportion to distance along
 * the *original* straight-line waypoint chain — the rounded arcs cut corners geometrically,
 * but this keeps altitude assignment simple and anchored to the waypoints' own briefed targets
 * (exact at each original waypoint; only the cut-corner arc samples are approximate).
 */
export function altitudesAlongPath(
  waypoints: ReadonlyArray<LatLon & { altitudeMslFt: number }>,
  path: ReadonlyArray<LatLon & { distanceFromStartFt: number }>,
): number[] {
  if (waypoints.length === 0) return path.map(() => 0)
  if (waypoints.length === 1) return path.map(() => waypoints[0].altitudeMslFt)

  const waypointDistancesFt: number[] = [0]
  for (let i = 1; i < waypoints.length; i++) {
    waypointDistancesFt.push(
      waypointDistancesFt[i - 1] + metersToFeet(distanceMeters(waypoints[i - 1], waypoints[i])),
    )
  }
  const totalOriginalFt = waypointDistancesFt[waypointDistancesFt.length - 1]
  const totalPathFt = path.length > 0 ? path[path.length - 1].distanceFromStartFt : 0

  return path.map((p) => {
    const fraction = totalPathFt > 0 ? p.distanceFromStartFt / totalPathFt : 0
    const targetFt = fraction * totalOriginalFt
    for (let i = 1; i < waypointDistancesFt.length; i++) {
      if (targetFt <= waypointDistancesFt[i] || i === waypointDistancesFt.length - 1) {
        const segLengthFt = waypointDistancesFt[i] - waypointDistancesFt[i - 1]
        const segFraction = segLengthFt > 0 ? (targetFt - waypointDistancesFt[i - 1]) / segLengthFt : 0
        return (
          waypoints[i - 1].altitudeMslFt +
          (waypoints[i].altitudeMslFt - waypoints[i - 1].altitudeMslFt) * segFraction
        )
      }
    }
    return waypoints[waypoints.length - 1].altitudeMslFt
  })
}

/**
 * Point + altitude at `distanceFt` along `route`, assuming altitude changes linearly with
 * distance from `startAltitudeMslFt` to `endAltitudeMslFt` over the route's full length.
 */
export function pointAtDistance(
  route: PlannedRoute,
  distanceFt: number,
  startAltitudeMslFt: number,
  endAltitudeMslFt: number,
): (LatLon & { altitudeMslFt: number }) | null {
  if (distanceFt < 0 || distanceFt > route.totalDistanceFt || route.path.length < 2) return null

  for (let i = 1; i < route.path.length; i++) {
    const prev = route.path[i - 1]
    const curr = route.path[i]
    if (distanceFt <= curr.distanceFromStartFt) {
      const bearingDeg = bearingDegrees(prev, curr)
      const point = destinationPoint(prev, feetToMeters(distanceFt - prev.distanceFromStartFt), bearingDeg)
      const overallT = route.totalDistanceFt > 0 ? distanceFt / route.totalDistanceFt : 0
      return {
        ...point,
        altitudeMslFt: startAltitudeMslFt + (endAltitudeMslFt - startAltitudeMslFt) * overallT,
      }
    }
  }
  return null
}
