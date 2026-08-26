import type { ApproachParameters } from '../lib/approach'

interface ApproachPanelProps {
  landingHeadingDeg: number
  onLandingHeadingChange: (deg: number) => void
  approachParams: ApproachParameters
  onApproachParamsChange: (params: ApproachParameters) => void
}

export function ApproachPanel({
  landingHeadingDeg,
  onLandingHeadingChange,
  approachParams,
  onApproachParamsChange,
}: ApproachPanelProps) {
  return (
    <section className="panel">
      <h2>Approach plan</h2>
      <label className="field">
        Landing heading (° true)
        <input
          type="number"
          value={Math.round(landingHeadingDeg)}
          min={0}
          max={360}
          step={5}
          onChange={(e) => onLandingHeadingChange(Number(e.target.value))}
        />
      </label>

      <div className="mode-toggle">
        <button
          type="button"
          className={approachParams.turnDirection === 'left' ? 'active' : ''}
          onClick={() => onApproachParamsChange({ ...approachParams, turnDirection: 'left' })}
        >
          Left pattern
        </button>
        <button
          type="button"
          className={approachParams.turnDirection === 'right' ? 'active' : ''}
          onClick={() => onApproachParamsChange({ ...approachParams, turnDirection: 'right' })}
        >
          Right pattern
        </button>
      </div>

      <label className="field">
        Downwind (ft AGL)
        <input
          type="number"
          value={approachParams.downwindAglFt}
          step={100}
          onChange={(e) =>
            onApproachParamsChange({ ...approachParams, downwindAglFt: Number(e.target.value) })
          }
        />
      </label>
      <label className="field">
        Base (ft AGL)
        <input
          type="number"
          value={approachParams.baseAglFt}
          step={100}
          onChange={(e) =>
            onApproachParamsChange({ ...approachParams, baseAglFt: Number(e.target.value) })
          }
        />
      </label>
      <label className="field">
        Final (ft AGL)
        <input
          type="number"
          value={approachParams.finalAglFt}
          step={100}
          onChange={(e) =>
            onApproachParamsChange({ ...approachParams, finalAglFt: Number(e.target.value) })
          }
        />
      </label>
      <label className="field">
        Final leg distance (m before threshold)
        <input
          type="number"
          value={approachParams.finalLegDistanceM}
          step={50}
          onChange={(e) =>
            onApproachParamsChange({
              ...approachParams,
              finalLegDistanceM: Number(e.target.value),
            })
          }
        />
      </label>
      <label className="field">
        Downwind offset (ft from centerline)
        <input
          type="number"
          value={approachParams.downwindOffsetFt}
          step={100}
          onChange={(e) =>
            onApproachParamsChange({
              ...approachParams,
              downwindOffsetFt: Number(e.target.value),
            })
          }
        />
      </label>
    </section>
  )
}
