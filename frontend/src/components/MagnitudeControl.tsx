import type { ScenarioDefinition } from "../types";

interface MagnitudeControlProps {
  scenario: ScenarioDefinition;
  value: number;
  onChange: (value: number) => void;
}

export function MagnitudeControl({ scenario, value, onChange }: MagnitudeControlProps) {
  const { paramLabel, paramUnit, paramMin, paramMax, paramStep, paramMethodology } = scenario;

  const isDefault = value === scenario.paramDefault;
  const unitSuffix = paramUnit === "percentage_points" ? " pp" : "%";

  function handleSlider(e: React.ChangeEvent<HTMLInputElement>) {
    onChange(parseFloat(e.target.value));
  }

  function handleInput(e: React.ChangeEvent<HTMLInputElement>) {
    const raw = parseFloat(e.target.value);
    if (!isNaN(raw)) {
      const clamped = Math.min(paramMax, Math.max(paramMin, raw));
      onChange(clamped);
    }
  }

  return (
    <div className="magnitude-control">
      <div className="magnitude-control-header">
        <label className="magnitude-label" htmlFor={`mag-input-${scenario.key}`}>
          {paramLabel}
        </label>
        {!isDefault && (
          <button
            type="button"
            className="text-button magnitude-reset"
            onClick={() => onChange(scenario.paramDefault)}
          >
            Reset to default ({scenario.paramDefault}{unitSuffix})
          </button>
        )}
      </div>

      <div className="magnitude-input-row">
        <input
          type="range"
          className="magnitude-slider"
          min={paramMin}
          max={paramMax}
          step={paramStep}
          value={value}
          onChange={handleSlider}
          aria-label={`${paramLabel} slider`}
        />
        <div className="magnitude-number-wrap">
          <input
            id={`mag-input-${scenario.key}`}
            type="number"
            className="magnitude-number-input"
            min={paramMin}
            max={paramMax}
            step={paramStep}
            value={value}
            onChange={handleInput}
            aria-label={`${paramLabel} value`}
          />
          <span className="magnitude-unit">{unitSuffix}</span>
        </div>
      </div>

      <div className="magnitude-range-labels">
        <span>{paramMin}{unitSuffix}</span>
        <span>{paramMax}{unitSuffix}</span>
      </div>

      {paramUnit === "percentage_points" && (
        <p className="magnitude-pp-note">
          This is a change in percentage points (pp), not a percent-relative change.
          For example, 1 pp means rates move from 3% to 4%.
        </p>
      )}

      <details className="magnitude-methodology">
        <summary>Sensitivity methodology</summary>
        <p>{paramMethodology}</p>
      </details>
    </div>
  );
}
