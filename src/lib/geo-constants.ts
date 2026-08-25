/** Cessna 172 POH defaults; all editable by the user in the parameters panel. */
export const C172_DEFAULTS = {
  glideRatio: 9,
  bestGlideSpeedKt: 65,
} as const

/** Default key-position altitudes for the High Key / Low Key overhead forced-landing pattern. */
export const APPROACH_DEFAULTS = {
  highKeyAglFt: 1500,
  lowKeyAglFt: 800,
} as const

export const FT_PER_NM = 6076.12
export const KT_TO_FT_PER_MIN = FT_PER_NM / 60
