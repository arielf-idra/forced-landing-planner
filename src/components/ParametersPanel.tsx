import type { GlideParameters, WindVector } from '../types/domain'

interface ParametersPanelProps {
  glide: GlideParameters
  onGlideChange: (glide: GlideParameters) => void
  wind: WindVector
  onWindChange: (wind: WindVector) => void
  reachability: { radiusFt: number; descentTimeMin: number } | null
}

export function ParametersPanel({
  glide,
  onGlideChange,
  wind,
  onWindChange,
  reachability,
}: ParametersPanelProps) {
  return (
    <section className="panel">
      <h2>Glide parameters</h2>
      <label className="field">
        Glide ratio (X:1 — C172 default ≈ 1.5 NM per 1,000 ft)
        <input
          type="number"
          value={glide.glideRatio}
          min={1}
          step={0.5}
          onChange={(e) => onGlideChange({ ...glide, glideRatio: Number(e.target.value) })}
        />
      </label>
      <label className="field">
        Best glide speed (KIAS)
        <input
          type="number"
          value={glide.bestGlideSpeedKt}
          min={1}
          step={1}
          onChange={(e) => onGlideChange({ ...glide, bestGlideSpeedKt: Number(e.target.value) })}
        />
      </label>

      <h2>Wind</h2>
      <label className="field">
        Speed (kt)
        <input
          type="number"
          value={wind.speedKt}
          min={0}
          step={1}
          onChange={(e) => onWindChange({ ...wind, speedKt: Number(e.target.value) })}
        />
      </label>
      <label className="field">
        Direction — from (° true)
        <input
          type="number"
          value={wind.directionFromDeg}
          min={0}
          max={360}
          step={10}
          onChange={(e) => onWindChange({ ...wind, directionFromDeg: Number(e.target.value) })}
        />
      </label>

      {reachability && (
        <dl>
          <dt>Reachable radius</dt>
          <dd>
            {Math.round(reachability.radiusFt).toLocaleString()} ft (
            {(reachability.radiusFt / 6076.12).toFixed(1)} nm)
          </dd>
          <dt>Time to touchdown</dt>
          <dd>{reachability.descentTimeMin.toFixed(1)} min</dd>
        </dl>
      )}
    </section>
  )
}
