import type { ScenarioDefinition } from "../types";

interface MagnitudeControlProps {
  scenario: ScenarioDefinition;
  value: number;
  onChange: (value: number) => void;
}

export function MagnitudeControl({ scenario, value, onChange }: MagnitudeControlProps) {
  const { paramLabel, paramUnit, paramMin, paramMax, paramStep, paramMethodology, metadataValid } = scenario;

  // Guard: if metadata is missing or invalid, show a configuration error
  if (metadataValid === false) {
    return (
      <div className="magnitude-config-error" role="alert">
        <strong>Configuration error</strong>
        <span>
          Required parameter metadata (default, min, max, step) is missing for this scenario.
          Analysis is disabled until the backend provides valid configuration.
        </span>
      </div>
    );
  }

  const isDefault = value === scenario.paramDefault;
  const unitSuffix = paramUnit === "percentage_points" ? " pp" : "%";

  // Canonical methodology text: use backend value if substantive, else standard fallback
  const methodologyText = paramMethodology && paramMethodology.trim().length > 20
    ? paramMethodology
    : "Holding impacts scale in proportion to the selected scenario severity, using predefined illustrative sensitivities. This is not a forecast.";

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

      {!isDefault && (
        <p className="magnitude-customized-note">
          <strong>Note:</strong> The assumption bullets below describe the baseline scenario.
          Your selected severity ({value}{unitSuffix}) scales all holding impacts proportionally.
          Re-run analysis to see results for this configuration.
        </p>
      )}

      <details className="magnitude-methodology" open={false}>
        <summary>Sensitivity methodology</summary>
        <p>{methodologyText}</p>
      </details>
    </div>
  );
}
