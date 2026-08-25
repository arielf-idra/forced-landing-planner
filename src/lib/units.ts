export const METERS_TO_FEET = 3.28084

export function metersToFeet(meters: number): number {
  return meters * METERS_TO_FEET
}

export function feetToMeters(feet: number): number {
  return feet / METERS_TO_FEET
}
