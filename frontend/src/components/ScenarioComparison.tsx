import { useCallback, useRef, useState } from "react";
import { analyzeScenario } from "../api";
import type {
  AnalysisResult,
  ScenarioDefinition,
  ScenarioKey,
} from "../types";
import { MagnitudeControl } from "./MagnitudeControl";

interface ComparisonSide {
  scenarioKey: ScenarioKey | null;
  magnitude: number | null;
  inflationHorizonMonths: number;
}

interface ComparisonResult {
  result: AnalysisResult | null;
  error: string | null;
  loading: boolean;
}

interface ScenarioComparisonProps {
  scenarios: ScenarioDefinition[];
  onClose: () => void;
}

const wholeDollar = new Intl.NumberFormat("en-US", {
  style: "currency", currency: "USD", maximumFractionDigits: 0,
});
const twoCents = new Intl.NumberFormat("en-US", {
  style: "currency", currency: "USD", minimumFractionDigits: 2, maximumFractionDigits: 2,
});

function signedCurrency(v: number, cents = false) {
  if (v === 0) return cents ? "$0.00" : "$0";
  return `${v > 0 ? "+" : "−"}${(cents ? twoCents : wholeDollar).format(Math.abs(v))}`;
}
function signedPct(v: number) {
  if (v === 0) return "0.00%";
  return `${v > 0 ? "+" : "−"}${Math.abs(v).toFixed(2)}%`;
}

function getResultValue(r: AnalysisResult): number {
  return r.kind === "purchasing-power"
    ? (r.purchasingPowerValue ?? 0)
    : (r.scenarioValue ?? 0);
}
function getResultImpactDollars(r: AnalysisResult): number {
  return r.kind === "purchasing-power"
    ? (r.purchasingPowerChangeDollars ?? 0)
    : (r.impactDollars ?? 0);
}
function getResultImpactPercent(r: AnalysisResult): number {
  return r.kind === "purchasing-power"
    ? (r.purchasingPowerChangePercent ?? 0)
    : (r.impactPercent ?? 0);
}
function getBaseValue(r: AnalysisResult): number {
  return r.kind === "purchasing-power"
    ? (r.nominalValue ?? 0)
    : (r.currentValue ?? 0);
}

function SideConfig({
  label,
  side,
  scenarios,
  onChange,
}: {
  label: string;
  side: ComparisonSide;
  scenarios: ScenarioDefinition[];
  onChange: (patch: Partial<ComparisonSide>) => void;
}) {
  const selectedScenario = scenarios.find((s) => s.key === side.scenarioKey) ?? null;

  return (
    <div className="cmp-side-config">
      <p className="cmp-side-label">{label}</p>
      <div className="cmp-scenario-select-grid">
        {scenarios.map((s) => (
          <button
            key={s.key}
            type="button"
            className={`cmp-scenario-btn ${side.scenarioKey === s.key ? "cmp-scenario-btn-active" : ""}`}
            onClick={() => onChange({ scenarioKey: s.key, magnitude: null, inflationHorizonMonths: 12 })}
            aria-pressed={side.scenarioKey === s.key}
          >
            <strong>{s.label}</strong>
            <span>{s.kind === "purchasing-power" ? "Purchasing power" : "Asset shock"}</span>
          </button>
        ))}
      </div>

      {selectedScenario && (
        <>
          <MagnitudeControl
            scenario={selectedScenario}
            value={side.magnitude ?? selectedScenario.paramDefault}
            onChange={(v) => onChange({ magnitude: v })}
          />

          {selectedScenario.kind === "purchasing-power" && (
            <div className="cmp-horizon-row">
              <label className="magnitude-label">Horizon</label>
              <div className="horizon-preset-buttons">
                {[3, 6, 12, 36, 60].map((mo) => (
                  <button
                    key={mo}
                    type="button"
                    className={`horizon-preset-btn ${side.inflationHorizonMonths === mo ? "horizon-preset-btn-active" : ""}`}
                    onClick={() => onChange({ inflationHorizonMonths: mo })}
                  >
                    {mo < 12 ? `${mo} mo` : mo === 12 ? "1 yr" : mo === 36 ? "3 yr" : "5 yr"}
                  </button>
                ))}
              </div>
            </div>
          )}
        </>
      )}
    </div>
  );
}

function ResultColumn({
  label,
  res,
  scenario,
}: {
  label: string;
  res: ComparisonResult;
  scenario: ScenarioDefinition | null;
}) {
  if (res.loading) {
    return (
      <div className="cmp-result-col">
        <p className="cmp-result-col-label">{label}</p>
        <div className="cmp-result-loading" role="status">Analyzing…</div>
      </div>
    );
  }
  if (res.error) {
    return (
      <div className="cmp-result-col">
        <p className="cmp-result-col-label">{label}</p>
        <div className="cmp-result-error" role="alert">{res.error}</div>
      </div>
    );
  }
  if (!res.result) {
    return (
      <div className="cmp-result-col">
        <p className="cmp-result-col-label">{label}</p>
        <div className="cmp-result-empty">No result yet</div>
      </div>
    );
  }

  const r = res.result;
  const isPP = r.kind === "purchasing-power";
  const impact = getResultImpactDollars(r);
  const impactPct = getResultImpactPercent(r);
  const resultValue = getResultValue(r);
  const baseValue = getBaseValue(r);

  return (
    <div className="cmp-result-col">
      <p className="cmp-result-col-label">{label}</p>
      {isPP && (
        <p className="cmp-pp-notice">Purchasing-power illustration — not an asset-return forecast</p>
      )}
      <div className="cmp-metric">
        <span>{isPP ? "Nominal value" : "Starting value"}</span>
        <strong>{wholeDollar.format(baseValue)}</strong>
      </div>
      <div className={`cmp-metric cmp-metric-emphasis ${impact < 0 ? "cmp-metric-negative" : "cmp-metric-positive"}`}>
        <span>{isPP ? "Purchasing power" : "Scenario value"}</span>
        <strong>{isPP ? twoCents.format(resultValue) : wholeDollar.format(resultValue)}</strong>
      </div>
      <div className="cmp-metric">
        <span>{isPP ? "Purchasing-power change" : "Portfolio change"}</span>
        <strong className={impact < 0 ? "number-negative" : "number-positive"}>
          {signedCurrency(impact, isPP)}
        </strong>
        <small className={impact < 0 ? "number-negative" : "number-positive"}>
          {signedPct(impactPct)}
        </small>
      </div>
      {isPP && r.inflationRatePercent != null && (
        <p className="cmp-result-note">
          {r.inflationRatePercent}% annual inflation · {r.horizon}
        </p>
      )}
      {!isPP && r.holdings && r.holdings.length > 0 && (
        <details className="cmp-holdings-detail">
          <summary>Holding contributions</summary>
          <table className="cmp-holdings-table">
            <thead>
              <tr>
                <th>Holding</th>
                <th>Shock</th>
                <th>Impact</th>
              </tr>
            </thead>
            <tbody>
              {r.holdings.map((h) => (
                <tr key={h.identifier}>
                  <td>{h.name}</td>
                  <td className={h.assumedReturnPercent < 0 ? "number-negative" : h.assumedReturnPercent > 0 ? "number-positive" : ""}>
                    {signedPct(h.assumedReturnPercent)}
                  </td>
                  <td className={h.contributionDollars < 0 ? "number-negative" : h.contributionDollars > 0 ? "number-positive" : ""}>
                    {signedCurrency(h.contributionDollars)}
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        </details>
      )}
      <details className="assumptions-details" style={{ marginTop: "12px" }}>
        <summary>Assumptions</summary>
        <div>
          <p><strong>Scenario:</strong> {r.label}</p>
          <p><strong>Horizon:</strong> {r.horizon}</p>
          {r.inflationRatePercent != null && (
            <p><strong>Inflation rate:</strong> {r.inflationRatePercent}%</p>
          )}
          {scenario && (
            <ul>
              {scenario.assumptionNotes.map((n) => <li key={n}>{n}</li>)}
            </ul>
          )}
          <p className="assumptions-version">Version: {r.assumptionsVersion}</p>
        </div>
      </details>
    </div>
  );
}

function DiffRow({
  resultA,
  resultB,
}: {
  resultA: AnalysisResult | null;
  resultB: AnalysisResult | null;
}) {
  if (!resultA || !resultB) return null;

  const incompatible = resultA.kind !== resultB.kind;
  if (incompatible) {
    return (
      <div className="cmp-diff-row cmp-diff-incompatible">
        <strong>Incompatible result types</strong>
        <span>
          Scenario A is a {resultA.kind === "purchasing-power" ? "purchasing-power illustration" : "nominal asset-shock"} and
          Scenario B is a {resultB.kind === "purchasing-power" ? "purchasing-power illustration" : "nominal asset-shock"}.
          These measure different things and cannot be directly compared.
        </span>
      </div>
    );
  }

  const impactA = getResultImpactDollars(resultA);
  const impactB = getResultImpactDollars(resultB);
  const diff = impactB - impactA;
  const valueA = getResultValue(resultA);
  const valueB = getResultValue(resultB);
  const valueDiff = valueB - valueA;

  return (
    <div className="cmp-diff-row">
      <p className="cmp-diff-heading">B vs A difference</p>
      <div className="cmp-diff-metrics">
        <div className="cmp-diff-metric">
          <span>Outcome value difference</span>
          <strong className={valueDiff < 0 ? "number-negative" : valueDiff > 0 ? "number-positive" : ""}>
            {signedCurrency(valueDiff, resultA.kind === "purchasing-power")}
          </strong>
          <small>B outcome minus A outcome</small>
        </div>
        <div className="cmp-diff-metric">
          <span>Impact difference</span>
          <strong className={diff < 0 ? "number-negative" : diff > 0 ? "number-positive" : ""}>
            {signedCurrency(diff, resultA.kind === "purchasing-power")}
          </strong>
          <small>B impact minus A impact</small>
        </div>
      </div>
      <p className="cmp-diff-note">
        Both scenarios use the same portfolio snapshot. Differences reflect only the scenario assumptions, not portfolio changes.
        Do not sum these impacts — they are independent stress tests, not additive shocks.
      </p>
    </div>
  );
}

export function ScenarioComparison({ scenarios, onClose }: ScenarioComparisonProps) {
  const [sideA, setSideA] = useState<ComparisonSide>({
    scenarioKey: null, magnitude: null, inflationHorizonMonths: 12,
  });
  const [sideB, setSideB] = useState<ComparisonSide>({
    scenarioKey: null, magnitude: null, inflationHorizonMonths: 12,
  });
  const [resA, setResA] = useState<ComparisonResult>({ result: null, error: null, loading: false });
  const [resB, setResB] = useState<ComparisonResult>({ result: null, error: null, loading: false });

  // Track config at run time to detect staleness
  const [runConfigA, setRunConfigA] = useState<string | null>(null);
  const [runConfigB, setRunConfigB] = useState<string | null>(null);

  const reqRef = useRef({ a: 0, b: 0 });

  function configKey(side: ComparisonSide): string {
    return `${side.scenarioKey}|${side.magnitude ?? "default"}|${side.inflationHorizonMonths}`;
  }

  const runSide = useCallback(async (
    which: "a" | "b",
    side: ComparisonSide,
    scenario: ScenarioDefinition,
  ) => {
    const id = ++reqRef.current[which];
    const setter = which === "a" ? setResA : setResB;
    const configSetter = which === "a" ? setRunConfigA : setRunConfigB;

    setter({ result: null, error: null, loading: true });

    const magnitudeOverride =
      side.magnitude !== null && side.magnitude !== scenario.paramDefault
        ? side.magnitude
        : null;
    const horizon = scenario.kind === "purchasing-power"
      ? `${side.inflationHorizonMonths}M`
      : scenario.horizon;

    try {
      const result = await analyzeScenario(
        scenario.key,
        horizon,
        null,
        null,
        magnitudeOverride,
      );
      if (reqRef.current[which] !== id) return;
      setter({ result, error: null, loading: false });
      configSetter(configKey(side));
    } catch (err) {
      if (reqRef.current[which] !== id) return;
      setter({
        result: null,
        error: err instanceof Error ? err.message : "Analysis failed.",
        loading: false,
      });
    }
  }, []);

  function handleRunBoth() {
    const scenA = scenarios.find((s) => s.key === sideA.scenarioKey);
    const scenB = scenarios.find((s) => s.key === sideB.scenarioKey);
    if (scenA) runSide("a", sideA, scenA);
    if (scenB) runSide("b", sideB, scenB);
  }

  const scenA = scenarios.find((s) => s.key === sideA.scenarioKey) ?? null;
  const scenB = scenarios.find((s) => s.key === sideB.scenarioKey) ?? null;

  const canRun =
    sideA.scenarioKey !== null &&
    sideB.scenarioKey !== null &&
    (scenA?.metadataValid !== false) &&
    (scenB?.metadataValid !== false) &&
    !resA.loading &&
    !resB.loading;

  const isStaleA = resA.result !== null && runConfigA !== configKey(sideA);
  const isStaleB = resB.result !== null && runConfigB !== configKey(sideB);
  const hasResults = resA.result !== null || resB.result !== null || resA.error !== null || resB.error !== null;

  return (
    <section className="cmp-panel" aria-labelledby="cmp-title">
      <div className="cmp-header">
        <div>
          <p className="section-kicker">Scenario comparison</p>
          <h2 id="cmp-title">Compare two scenarios</h2>
          <p className="cmp-subtitle">
            Configure two independent scenarios and run them against the same portfolio snapshot.
          </p>
        </div>
        <button className="text-button" type="button" onClick={onClose} aria-label="Close comparison">
          ✕ Close
        </button>
      </div>

      <div className="cmp-config-grid">
        <SideConfig
          label="Scenario A"
          side={sideA}
          scenarios={scenarios}
          onChange={(patch) => {
            setSideA((prev) => ({ ...prev, ...patch }));
            setResA({ result: null, error: null, loading: false });
          }}
        />
        <SideConfig
          label="Scenario B"
          side={sideB}
          scenarios={scenarios}
          onChange={(patch) => {
            setSideB((prev) => ({ ...prev, ...patch }));
            setResB({ result: null, error: null, loading: false });
          }}
        />
      </div>

      <div className="cmp-run-row">
        <button
          className="primary-button"
          type="button"
          onClick={handleRunBoth}
          disabled={!canRun}
          aria-disabled={!canRun}
        >
          {resA.loading || resB.loading ? "Analyzing…" : "Run comparison"}
        </button>
        {!sideA.scenarioKey && !sideB.scenarioKey && (
          <span className="cmp-run-hint">Select a scenario for each side above</span>
        )}
        {(sideA.scenarioKey || sideB.scenarioKey) && !sideA.scenarioKey && (
          <span className="cmp-run-hint">Select a scenario for A</span>
        )}
        {(sideA.scenarioKey || sideB.scenarioKey) && !sideB.scenarioKey && (
          <span className="cmp-run-hint">Select a scenario for B</span>
        )}
      </div>

      {(isStaleA || isStaleB) && (
        <div className="stale-result-banner" role="alert">
          <strong>Configuration changed.</strong> Results below are from a previous run.
          <button className="text-button" type="button" onClick={handleRunBoth} disabled={!canRun}>
            Re-run now
          </button>
        </div>
      )}

      {hasResults && (
        <>
          <div className="cmp-results-grid">
            <ResultColumn label="Scenario A" res={resA} scenario={scenA} />
            <ResultColumn label="Scenario B" res={resB} scenario={scenB} />
          </div>
          <DiffRow resultA={resA.result} resultB={resB.result} />
        </>
      )}

      <p className="disclosure">
        Both scenarios use the same synthetic $100,000 portfolio snapshot. Results are illustrative only and not investment advice.
        Purchasing-power and nominal asset-shock results measure different things and should not be summed.
      </p>
    </section>
  );
}
