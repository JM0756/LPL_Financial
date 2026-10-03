import { useEffect, useRef, useState, type FormEvent } from "react";
import "./App.css";
import {
  analyzeScenario,
  API_MODE,
  createAdvisorQuestion,
  createDiscussion,
  getPortfolio,
  getScenarios,
  interpretQuestion,
} from "./api";
import { AdvisorView } from "./components/AdvisorView";
import { AnalysisResults } from "./components/AnalysisResults";
import type {
  AnalysisResult,
  InterpretResult,
  Portfolio,
  ScenarioDefinition,
  ScenarioKey,
} from "./types";

const currencyFormatter = new Intl.NumberFormat("en-US", {
  style: "currency",
  currency: "USD",
  maximumFractionDigits: 0,
});

// Stable color classes for up to 7 holdings by index
const HOLDING_COLORS = [
  "holding-color-0",
  "holding-color-1",
  "holding-color-2",
  "holding-color-3",
  "holding-color-4",
  "holding-color-5",
  "holding-color-6",
];

type DiscussState = { status: "idle" | "saving" | "saved" | "error"; error: string };

function App() {
  // --- data loading ---
  const [portfolio, setPortfolio] = useState<Portfolio | null>(null);
  const [scenarios, setScenarios] = useState<ScenarioDefinition[]>([]);
  const [loadError, setLoadError] = useState("");
  const [isLoading, setIsLoading] = useState(true);

  // --- scenario selection ---
  const [selectedKey, setSelectedKey] = useState<ScenarioKey | null>(null);
  const [question, setQuestion] = useState("");
  const [questionStatus, setQuestionStatus] = useState("");
  const [isInterpreting, setIsInterpreting] = useState(false);
  const [interpretResult, setInterpretResult] = useState<InterpretResult | null>(null);

  // --- analysis ---
  const [analysis, setAnalysis] = useState<AnalysisResult | null>(null);
  const [analysisError, setAnalysisError] = useState("");
  const [isAnalyzing, setIsAnalyzing] = useState(false);

  // --- discuss ---
  const [discussState, setDiscussState] = useState<DiscussState>({ status: "idle", error: "" });

  // --- unsupported question advisor handoff ---
  type AdvisorQState = { status: "idle" | "saving" | "saved" | "error"; error: string };
  const [advisorQNote, setAdvisorQNote] = useState("");
  const [advisorQState, setAdvisorQState] = useState<AdvisorQState>({ status: "idle", error: "" });
  const advisorQIdempotencyRef = useRef("");

  // --- view ---
  const [advisorView, setAdvisorView] = useState(false);

  const requestIdRef = useRef(0);
  const loadAbortRef = useRef<AbortController | null>(null);

  // ---------------------------------------------------------------------------
  // Load portfolio + scenarios on mount
  // ---------------------------------------------------------------------------
  useEffect(() => {
    const ac = new AbortController();
    loadAbortRef.current = ac;

    Promise.all([getPortfolio(ac.signal), getScenarios(ac.signal)])
      .then(([p, s]) => {
        setPortfolio(p);
        setScenarios(s);
      })
      .catch((err: unknown) => {
        if (err instanceof DOMException && err.name === "AbortError") return;
        setLoadError(
          err instanceof Error ? err.message : "Could not load portfolio data.",
        );
      })
      .finally(() => setIsLoading(false));

    return () => ac.abort();
  }, []);

  // ---------------------------------------------------------------------------
  // Helpers
  // ---------------------------------------------------------------------------
  const selectedScenario = scenarios.find((s) => s.key === selectedKey) ?? null;

  function selectScenario(key: ScenarioKey) {
    requestIdRef.current += 1;
    setSelectedKey(key);
    setAnalysis(null);
    setAnalysisError("");
    setQuestionStatus("");
    setInterpretResult(null);
    setIsAnalyzing(false);
    setDiscussState({ status: "idle", error: "" });
  }

  function clearSelection() {
    requestIdRef.current += 1;
    setSelectedKey(null);
    setAnalysis(null);
    setAnalysisError("");
    setInterpretResult(null);
    setDiscussState({ status: "idle", error: "" });
  }

  // ---------------------------------------------------------------------------
  // Interpret typed question
  // ---------------------------------------------------------------------------
  async function handleQuestionSubmit(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    if (!question.trim()) {
      setQuestionStatus("Enter a market question or choose a supported scenario.");
      return;
    }

    setIsInterpreting(true);
    setQuestionStatus("");
    setInterpretResult(null);

    try {
      const result = await interpretQuestion(question.trim());
      setInterpretResult(result);

      if (result.status === "matched" && result.scenarioKey) {
        // Pre-select but don't auto-analyze — user must still confirm
        setSelectedKey(result.scenarioKey);
        setAnalysis(null);
        setAnalysisError("");
        setDiscussState({ status: "idle", error: "" });
      }
    } catch (err) {
      setQuestionStatus(
        err instanceof Error ? err.message : "Interpretation failed. Choose a scenario below.",
      );
    } finally {
      setIsInterpreting(false);
    }
  }

  // ---------------------------------------------------------------------------
  // Send unsupported question to advisor
  // ---------------------------------------------------------------------------
  async function handleSendToAdvisor() {
    if (!question.trim() || advisorQState.status === "saving" || advisorQState.status === "saved") return;
    // Generate a stable idempotency key for this question on first attempt
    if (!advisorQIdempotencyRef.current) {
      advisorQIdempotencyRef.current = `aq_${Date.now()}_${Math.random().toString(36).slice(2, 8)}`;
    }
    setAdvisorQState({ status: "saving", error: "" });
    try {
      await createAdvisorQuestion(
        question.trim(),
        advisorQNote.trim() || null,
        advisorQIdempotencyRef.current,
      );
      setAdvisorQState({ status: "saved", error: "" });
    } catch (err) {
      setAdvisorQState({
        status: "error",
        error: err instanceof Error ? err.message : "Could not save question.",
      });
    }
  }

  // ---------------------------------------------------------------------------
  // Analyze
  // ---------------------------------------------------------------------------
  async function handleAnalyze() {
    if (!selectedKey || !selectedScenario) return;

    const requestId = ++requestIdRef.current;
    setIsAnalyzing(true);
    setAnalysis(null);
    setAnalysisError("");
    setDiscussState({ status: "idle", error: "" });

    try {
      const result = await analyzeScenario(
        selectedKey,
        selectedScenario.horizon,
        interpretResult?.status !== "unsupported" ? (question.trim() || null) : null,
      );
      if (requestId !== requestIdRef.current) return;
      setAnalysis(result);
      window.setTimeout(() => {
        document.getElementById("analysis-results")?.scrollIntoView({ behavior: "smooth", block: "start" });
      }, 0);
    } catch (err) {
      if (requestId !== requestIdRef.current) return;
      setAnalysisError(
        err instanceof Error ? err.message : "The analysis could not be completed.",
      );
    } finally {
      if (requestId === requestIdRef.current) setIsAnalyzing(false);
    }
  }

  // ---------------------------------------------------------------------------
  // Discuss
  // ---------------------------------------------------------------------------
  async function handleDiscuss() {
    if (!analysis) return;
    setDiscussState({ status: "saving", error: "" });
    try {
      await createDiscussion(analysis.analysisId);
      setDiscussState({ status: "saved", error: "" });
    } catch (err) {
      setDiscussState({
        status: "error",
        error: err instanceof Error ? err.message : "Could not save discussion request.",
      });
    }
  }

  // ---------------------------------------------------------------------------
  // Try another
  // ---------------------------------------------------------------------------
  function handleTryAnother() {
    requestIdRef.current += 1;
    setSelectedKey(null);
    setAnalysis(null);
    setAnalysisError("");
    setQuestion("");
    setQuestionStatus("");
    setInterpretResult(null);
    setDiscussState({ status: "idle", error: "" });
    document.getElementById("scenario-panel-title")?.scrollIntoView({ behavior: "smooth", block: "start" });
  }

  // ---------------------------------------------------------------------------
  // Render
  // ---------------------------------------------------------------------------
  return (
    <div className="app-shell">
      <header className="site-header">
        <a className="brand" href="#main-content" aria-label="ScenarioCraft home">
          <span className="brand-mark" aria-hidden="true">SC</span>
          <span>
            <span className="brand-name">ScenarioCraft</span>
            <span className="brand-subtitle">Investor demo</span>
          </span>
        </a>

        <div className="header-actions">
          {API_MODE === "mock" && <span className="mock-mode-label">Demo data</span>}
          <span className="demo-label">Educational prototype</span>
          <button
            className={`view-switch ${advisorView ? "view-switch-active" : ""}`}
            type="button"
            onClick={() => setAdvisorView((v) => !v)}
          >
            {advisorView ? "Investor view" : "Advisor view"}
          </button>
        </div>
      </header>

      <main id="main-content" className="main-content">
        {advisorView ? (
          <AdvisorView />
        ) : (
          <>
            <section className="intro-section" aria-labelledby="page-title">
              <p className="eyebrow">Portfolio scenario explorer</p>
              <h1 id="page-title">
                Ask "What if?" Understand what it means for your portfolio.
              </h1>
              <p className="intro-copy">
                Explore predefined market conditions and see their illustrative effect on a
                synthetic portfolio.
              </p>
            </section>

            {/* Loading / error state for initial data */}
            {isLoading && (
              <div className="loading-state" role="status">
                Loading portfolio data…
              </div>
            )}

            {loadError && (
              <div className="error-message" role="alert">
                <strong>Could not load portfolio</strong>
                <span>{loadError}</span>
                <button
                  className="text-button"
                  type="button"
                  onClick={() => window.location.reload()}
                >
                  Reload page
                </button>
              </div>
            )}

            {!isLoading && !loadError && portfolio && (
              <div className="workspace-grid">
                {/* Portfolio card */}
                <aside className="portfolio-card" aria-labelledby="portfolio-title">
                  <div className="card-heading">
                    <div>
                      <p className="section-kicker">Synthetic portfolio</p>
                      <h2 id="portfolio-title">Your starting point</h2>
                    </div>
                    <span className="portfolio-badge">Demo</span>
                  </div>

                  <div className="portfolio-total">
                    <span>Current value</span>
                    <strong>{currencyFormatter.format(portfolio.totalValue)}</strong>
                  </div>

                  {/* Allocation bar — proportional widths from backend data */}
                  <div className="allocation-bar" aria-hidden="true">
                    {portfolio.holdings.map((h, i) => (
                      <span
                        key={h.identifier}
                        className={HOLDING_COLORS[i % HOLDING_COLORS.length]}
                        style={{ width: `${h.allocation}%` }}
                      />
                    ))}
                  </div>

                  <ul className="holdings-list">
                    {portfolio.holdings.map((h, i) => (
                      <li key={h.identifier} className="holding-row">
                        <span
                          className={`holding-dot ${HOLDING_COLORS[i % HOLDING_COLORS.length]}`}
                          aria-hidden="true"
                        />
                        <span className="holding-identity">
                          <strong>{h.name}</strong>
                          <span>{h.assetClass}</span>
                        </span>
                        <span className="holding-value">
                          <strong>{currencyFormatter.format(h.value)}</strong>
                          <span>{h.allocation.toFixed(0)}%</span>
                        </span>
                      </li>
                    ))}
                  </ul>

                  <p className="portfolio-note">
                    This fictional portfolio is used consistently across all ScenarioCraft
                    demonstrations.
                  </p>
                </aside>

                {/* Scenario panel */}
                <section className="scenario-panel" aria-labelledby="scenario-panel-title">
                  <div className="panel-heading">
                    <p className="section-kicker">Step 1 of 2</p>
                    <h2 id="scenario-panel-title">Explore a market scenario</h2>
                    <p>Choose a supported scenario or enter a question for interpretation.</p>
                  </div>

                  <form className="question-form" onSubmit={handleQuestionSubmit}>
                    <label htmlFor="scenario-question">
                      What market change are you considering?
                    </label>
                    <div className="question-field-row">
                      <textarea
                        id="scenario-question"
                        value={question}
                        onChange={(e) => {
                          setQuestion(e.target.value);
                          setQuestionStatus("");
                          setInterpretResult(null);
                          setAdvisorQState({ status: "idle", error: "" });
                          setAdvisorQNote("");
                          advisorQIdempotencyRef.current = "";
                        }}
                        placeholder="For example: What if the market crashes?"
                        rows={2}
                      />
                      <button
                        className="secondary-button"
                        type="submit"
                        disabled={isInterpreting}
                      >
                        {isInterpreting ? "Interpreting…" : "Interpret question"}
                      </button>
                    </div>

                    {questionStatus && (
                      <p className="field-message" role="status">{questionStatus}</p>
                    )}

                    {interpretResult && (
                      <div
                        className={`interpret-result interpret-result-${interpretResult.status}`}
                        role="status"
                      >
                        <p>{interpretResult.message}</p>

                        {interpretResult.mismatchReasons.length > 0 && (
                          <ul className="mismatch-reasons">
                            {interpretResult.mismatchReasons.map((r) => (
                              <li key={r}>{r}</li>
                            ))}
                          </ul>
                        )}

                        {interpretResult.status === "unsupported" &&
                          interpretResult.offeredPresets.length > 0 && (
                            <div className="offered-presets">
                              <p>Supported scenarios:</p>
                              {interpretResult.offeredPresets.map((p) => (
                                <button
                                  key={p.scenario_key}
                                  className="scenario-option"
                                  type="button"
                                  onClick={() => selectScenario(p.scenario_key)}
                                >
                                  <span className="scenario-option-topline">
                                    <strong>{p.label}</strong>
                                  </span>
                                  <span className="scenario-description">{p.magnitude_label}</span>
                                </button>
                              ))}
                            </div>
                          )}

                        {interpretResult.status === "unsupported" && (
                          <div className="advisor-handoff-panel">
                            <p className="advisor-handoff-heading">
                              We don't have a supported calculation for that scenario yet.
                            </p>
                            <p className="advisor-handoff-question">Your question: <em>"{question.trim()}"</em></p>
                            <label htmlFor="advisor-note" className="advisor-note-label">
                              Optional note for your advisor
                            </label>
                            <textarea
                              id="advisor-note"
                              className="advisor-note-input"
                              value={advisorQNote}
                              onChange={(e) => setAdvisorQNote(e.target.value)}
                              placeholder="Add any context you'd like your advisor to know…"
                              rows={2}
                              disabled={advisorQState.status === "saved"}
                            />
                            {advisorQState.status !== "saved" && (
                              <button
                                className="secondary-button"
                                type="button"
                                onClick={handleSendToAdvisor}
                                disabled={advisorQState.status === "saving"}
                              >
                                {advisorQState.status === "saving" ? "Saving…" : "Send question to advisor"}
                              </button>
                            )}
                            {advisorQState.status === "saved" && (
                              <p className="advisor-q-success" role="status">
                                Question saved. Switch to Advisor view to see it.
                              </p>
                            )}
                            {advisorQState.status === "error" && (
                              <div className="error-message" role="alert">
                                <strong>Could not save</strong>
                                <span>{advisorQState.error}</span>
                                <button className="text-button" type="button" onClick={handleSendToAdvisor}>Retry</button>
                              </div>
                            )}
                          </div>
                        )}

                        {interpretResult.status === "preset_offered" &&
                          interpretResult.scenarioKey && (
                            <>
                              <p className="interpret-confirm-note">
                                Select the preset below to review its exact assumptions before
                                running the analysis.
                              </p>
                              <div className="advisor-handoff-panel advisor-handoff-panel-inline">
                                <p className="advisor-handoff-heading">Or send your original question to your advisor instead.</p>
                                {advisorQState.status !== "saved" && (
                                  <button
                                    className="text-button"
                                    type="button"
                                    onClick={handleSendToAdvisor}
                                    disabled={advisorQState.status === "saving"}
                                  >
                                    {advisorQState.status === "saving" ? "Saving…" : "Send question to advisor"}
                                  </button>
                                )}
                                {advisorQState.status === "saved" && (
                                  <p className="advisor-q-success" role="status">Question saved.</p>
                                )}
                                {advisorQState.status === "error" && (
                                  <span className="advisor-q-error">{advisorQState.error} <button className="text-button" type="button" onClick={handleSendToAdvisor}>Retry</button></span>
                                )}
                              </div>
                            </>
                          )}
                      </div>
                    )}
                  </form>

                  <div className="divider">
                    <span>or choose a supported scenario</span>
                  </div>

                  <div className="scenario-options">
                    {scenarios.map((scenario) => {
                      const isSelected = selectedKey === scenario.key;
                      return (
                        <button
                          className={`scenario-option ${isSelected ? "scenario-option-selected" : ""}`}
                          type="button"
                          key={scenario.key}
                          aria-pressed={isSelected}
                          onClick={() => selectScenario(scenario.key)}
                        >
                          <span className="scenario-option-topline">
                            <strong>{scenario.label}</strong>
                            <span className="selection-indicator" aria-hidden="true">
                              {isSelected ? "✓" : ""}
                            </span>
                          </span>
                          <span className="scenario-description">{scenario.summary}</span>
                          <span className="scenario-horizon">Horizon: {scenario.horizon}</span>
                        </button>
                      );
                    })}
                  </div>

                  {selectedScenario ? (
                    <section className="confirmation-card" aria-labelledby="confirmation-title">
                      <div className="confirmation-heading">
                        <div>
                          <p className="section-kicker">Step 2 of 2</p>
                          <h3 id="confirmation-title">Confirm the assumptions</h3>
                        </div>
                        <button className="text-button" type="button" onClick={clearSelection}>
                          Clear
                        </button>
                      </div>

                      <div className="confirmed-scenario">
                        <strong>{selectedScenario.label}</strong>
                        <span>Horizon: {selectedScenario.horizon}</span>
                      </div>

                      {selectedScenario.kind === "purchasing-power" && (
                        <p className="context-note">
                          This is a purchasing-power illustration, not an asset-return forecast.
                        </p>
                      )}

                      <ul className="assumption-list">
                        {selectedScenario.assumptionNotes.map((note) => (
                          <li key={note}>{note}</li>
                        ))}
                      </ul>

                      <button
                        className="primary-button"
                        type="button"
                        onClick={handleAnalyze}
                        disabled={isAnalyzing}
                      >
                        {isAnalyzing ? "Analyzing scenario…" : "Analyze this scenario"}
                      </button>

                      {analysisError && (
                        <div className="error-message" role="alert">
                          <strong>Analysis unavailable</strong>
                          <span>{analysisError}</span>
                          <button className="text-button" type="button" onClick={handleAnalyze}>
                            Try again
                          </button>
                        </div>
                      )}
                    </section>
                  ) : (
                    <div className="empty-confirmation">
                      <span aria-hidden="true">↑</span>
                      Select a scenario to review its exact assumptions before analysis.
                    </div>
                  )}
                </section>
              </div>
            )}

            {analysis && selectedScenario && (
              <AnalysisResults
                result={analysis}
                scenario={selectedScenario}
                discussState={discussState}
                onDiscuss={handleDiscuss}
                onTryAnother={handleTryAnother}
              />
            )}

            <p className="disclosure">
              Illustrative scenario analysis based on predefined assumptions. This is not a
              forecast or investment recommendation.
            </p>
          </>
        )}
      </main>

      <footer className="site-footer">
        <span>ScenarioCraft</span>
        <span>University hackathon educational prototype</span>
      </footer>
    </div>
  );
}

export default App;
