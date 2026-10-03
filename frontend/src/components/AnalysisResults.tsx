import type { AnalysisResult, ScenarioDefinition } from "../types";
import { HoldingContributions } from "./HoldingContributions";

interface DiscussState {
  status: "idle" | "saving" | "saved" | "error";
  error: string;
}

interface AnalysisResultsProps {
  result: AnalysisResult;
  scenario: ScenarioDefinition;
  discussState: DiscussState;
  onDiscuss: () => void;
  onTryAnother: () => void;
}

const wholeDollar = new Intl.NumberFormat("en-US", {
  style: "currency", currency: "USD", maximumFractionDigits: 0,
});
const twoCents = new Intl.NumberFormat("en-US", {
  style: "currency", currency: "USD", minimumFractionDigits: 2, maximumFractionDigits: 2,
});

function signedCurrency(value: number, cents = false): string {
  if (value === 0) return cents ? "$0.00" : "$0";
  return `${value > 0 ? "+" : "−"}${(cents ? twoCents : wholeDollar).format(Math.abs(value))}`;
}

function signedPercent(value: number): string {
  if (value === 0) return "0.00%";
  return `${value > 0 ? "+" : "−"}${Math.abs(value).toFixed(2)}%`;
}

function explanationSourceLabel(source: AnalysisResult["explanationSource"]): string {
  if (source === "bedrock") return "AI-assisted explanation (Amazon Bedrock)";
  if (source === "backend-standard") return "Standard explanation";
  return "Explanation (source unconfirmed)";
}

export function AnalysisResults({
  result,
  scenario,
  discussState,
  onDiscuss,
  onTryAnother,
}: AnalysisResultsProps) {
  const isPurchasingPower = result.kind === "purchasing-power";

  const discussButtonLabel =
    discussState.status === "saving"
      ? "Saving request…"
      : discussState.status === "saved"
        ? "Discussion request created"
        : "Discuss with my advisor";

  return (
    <section
      id="analysis-results"
      className="results-card"
      aria-labelledby="results-title"
      aria-live="polite"
    >
      <div className="results-header">
        <div>
          <p className="section-kicker">Illustrative result</p>
          <h2 id="results-title">{result.label}</h2>
          <p>Horizon: {result.horizon}</p>
        </div>
        <span className="result-status">Analysis complete</span>
      </div>

      {isPurchasingPower ? (
        <>
          <div className="inflation-notice">
            <strong>Purchasing-power illustration</strong>
            <span>This is not an asset-return forecast or an investment loss.</span>
          </div>

          <div className="result-metrics result-metrics-inflation">
            <div className="metric">
              <span>Nominal portfolio value</span>
              <strong>{wholeDollar.format(result.nominalValue ?? 0)}</strong>
              <small>Nominal return held at 0%</small>
            </div>
            <div className="metric metric-emphasis">
              <span>Purchasing power in today's dollars</span>
              <strong>{twoCents.format(result.purchasingPowerValue ?? 0)}</strong>
              <small>After assumed 5% inflation</small>
            </div>
            <div className="metric">
              <span>Purchasing-power change</span>
              <strong className="number-negative">
                {signedCurrency(result.purchasingPowerChangeDollars ?? 0, true)}
              </strong>
              <small className="number-negative">
                {signedPercent(result.purchasingPowerChangePercent ?? 0)}
              </small>
            </div>
          </div>
        </>
      ) : (
        <>
          <div className="result-metrics">
            <div className="metric">
              <span>Current portfolio value</span>
              <strong>{wholeDollar.format(result.currentValue ?? 0)}</strong>
            </div>
            <div className="metric metric-emphasis">
              <span>Illustrative scenario value</span>
              <strong>{wholeDollar.format(result.scenarioValue ?? 0)}</strong>
            </div>
            <div className="metric">
              <span>Portfolio change</span>
              <strong className={(result.impactDollars ?? 0) < 0 ? "number-negative" : "number-positive"}>
                {signedCurrency(result.impactDollars ?? 0)}
              </strong>
              <small>{signedPercent(result.impactPercent ?? 0)}</small>
            </div>
          </div>

          {result.holdings && <HoldingContributions holdings={result.holdings} />}
        </>
      )}

      <section className="explanation-card" aria-labelledby="explanation-title">
        <p className="section-kicker">In plain language</p>
        <h3 id="explanation-title">Why does this affect me?</h3>
        <p>{result.explanation}</p>
        <span className="explanation-source">
          {explanationSourceLabel(result.explanationSource)}
        </span>
      </section>

      <details className="assumptions-details">
        <summary>Review assumptions and horizon</summary>
        <div>
          <p><strong>Horizon:</strong> {result.horizon}</p>
          <ul>
            {scenario.assumptionNotes.map((note) => (
              <li key={note}>{note}</li>
            ))}
          </ul>
          <p className="assumptions-version">
            Assumptions version: {result.assumptionsVersion}
          </p>
        </div>
      </details>

      <div className="result-actions">
        <button className="secondary-button" type="button" onClick={onTryAnother}>
          Try another scenario
        </button>
        <button
          className="primary-button"
          type="button"
          onClick={onDiscuss}
          disabled={discussState.status === "saving" || discussState.status === "saved"}
        >
          {discussButtonLabel}
        </button>
      </div>

      {discussState.status === "saved" && (
        <p className="advisor-success-note" role="status">
          Discussion request created. Switch to Advisor view to see it.
        </p>
      )}

      {discussState.status === "error" && (
        <div className="error-message" role="alert">
          <strong>Request could not be saved</strong>
          <span>{discussState.error}</span>
          <button className="text-button" type="button" onClick={onDiscuss}>
            Try again
          </button>
        </div>
      )}

      <p className="disclosure">
        Illustrative scenario analysis based on predefined assumptions. This is not a
        forecast or investment recommendation.
      </p>
    </section>
  );
}
