import { useCallback, useEffect, useRef, useState, type FormEvent } from "react";
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
import { AccountManager } from "./components/AccountManager";
import { AdvisorView } from "./components/AdvisorView";
import { AnalysisResults } from "./components/AnalysisResults";
import { MagnitudeControl } from "./components/MagnitudeControl";
import { PortfolioPage } from "./components/PortfolioPage";
import { ProfileManager } from "./components/ProfileManager";
import {
  getActiveAccount,
  getActiveProfile,
  type DemoAccount,
  type DemoProfile,
} from "./demo-storage";
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
type NavTab = "explore" | "portfolio" | "advisor";

function App() {
  // --- profile/account state ---
  const [activeProfile, setActiveProfile] = useState<DemoProfile | null>(() => getActiveProfile());
  const [activeAccount, setActiveAccount] = useState<DemoAccount | null>(() => getActiveAccount());

  // --- data loading ---
  const [portfolio, setPortfolio] = useState<Portfolio | null>(null);
  const [scenarios, setScenarios] = useState<ScenarioDefinition[]>([]);
  const [loadError, setLoadError] = useState("");
  const [isLoading, setIsLoading] = useState(true);

  // --- nav ---
  const [navTab, setNavTab] = useState<NavTab>("explore");

  // --- scenario selection ---
  const [selectedKey, setSelectedKey] = useState<ScenarioKey | null>(null);
  const [magnitude, setMagnitude] = useState<number | null>(null);
  const [inflationHorizonMonths, setInflationHorizonMonths] = useState<number>(12);
  const [question, setQuestion] = useState("");
  const [questionStatus, setQuestionStatus] = useState("");
  const [isInterpreting, setIsInterpreting] = useState(false);
  const [interpretResult, setInterpretResult] = useState<InterpretResult | null>(null);

  // --- analysis ---
  const [analysis, setAnalysis] = useState<AnalysisResult | null>(null);
  const [analysisError, setAnalysisError] = useState("");
  const [isAnalyzing, setIsAnalyzing] = useState(false);
  // Track config at analysis time to detect staleness
  const [analysisConfigKey, setAnalysisConfigKey] = useState<string | null>(null);

  function makeConfigKey() {
    const holdingsKey = activeAccount?.customHoldings
      ? activeAccount.customHoldings.map((h) => `${h.holdingId}:${h.value}`).join(",")
      : "default";
    return `${selectedKey}|${magnitude ?? "default"}|${inflationHorizonMonths}|${holdingsKey}`;
  }

  // --- discuss ---
  const [discussState, setDiscussState] = useState<DiscussState>({ status: "idle", error: "" });

  // --- unsupported question advisor handoff ---
  type AdvisorQState = { status: "idle" | "saving" | "saved" | "error"; error: string };
  const [advisorQNote, setAdvisorQNote] = useState("");
  const [advisorQState, setAdvisorQState] = useState<AdvisorQState>({ status: "idle", error: "" });
  const advisorQIdempotencyRef = useRef("");

  const requestIdRef = useRef(0);

  const refreshDemoState = useCallback(() => {
    setActiveProfile(getActiveProfile());
    setActiveAccount(getActiveAccount());
    // Invalidate analysis when account changes
    setAnalysis(null);
    setAnalysisError("");
    setDiscussState({ status: "idle", error: "" });
  }, []);

  // ---------------------------------------------------------------------------
  // Load portfolio + scenarios on mount
  // ---------------------------------------------------------------------------
  useEffect(() => {
    const ac = new AbortController();
    Promise.all([getPortfolio(ac.signal), getScenarios(ac.signal)])
      .then(([p, s]) => {
        setPortfolio(p);
        setScenarios(s);
      })
      .catch((err: unknown) => {
        if (err instanceof DOMException && err.name === "AbortError") return;
        setLoadError(err instanceof Error ? err.message : "Could not load portfolio data.");
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
    setMagnitude(null); // reset to default when switching scenarios
    setInflationHorizonMonths(12);
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
    setMagnitude(null);
    setInflationHorizonMonths(12);
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

    // Build custom holdings from active account if set
    const customHoldings = activeAccount?.customHoldings ?? null;
    // Use magnitude override if set and different from default
    const magnitudeOverride =
      magnitude !== null && selectedScenario && magnitude !== selectedScenario.paramDefault
        ? magnitude
        : null;

    // For inflation, use the editable horizon; for others, use the preset horizon
    const horizonToUse = selectedScenario.kind === "purchasing-power"
      ? `${inflationHorizonMonths}M`
      : selectedScenario.horizon;

    try {
      const result = await analyzeScenario(
        selectedKey,
        horizonToUse,
        interpretResult?.status !== "unsupported" ? (question.trim() || null) : null,
        customHoldings
          ? customHoldings.map((h) => ({ holdingId: h.holdingId, value: h.value }))
          : null,
        magnitudeOverride,
      );
      if (requestId !== requestIdRef.current) return;
      setAnalysis(result);
      setAnalysisConfigKey(makeConfigKey());
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
    setMagnitude(null);
    setInflationHorizonMonths(12);
    setAnalysis(null);
    setAnalysisError("");
    setQuestion("");
    setQuestionStatus("");
    setInterpretResult(null);
    setDiscussState({ status: "idle", error: "" });
    document.getElementById("scenario-panel-title")?.scrollIntoView({ behavior: "smooth", block: "start" });
  }

  // ---------------------------------------------------------------------------
  // Render — profile gate
  // ---------------------------------------------------------------------------
  if (!activeProfile) {
    return (
      <ProfileManager activeProfile={null} onProfileChange={refreshDemoState} />
    );
  }

  // ---------------------------------------------------------------------------
  // Render — main app
  // ---------------------------------------------------------------------------
  const displayPortfolio = activeAccount?.customHoldings
    ? {
        ...portfolio,
        totalValue: activeAccount.customHoldings.reduce((s, h) => s + h.value, 0),
        holdings: activeAccount.customHoldings.map((h) => ({
          identifier: h.holdingId,
          name: h.holdingId.replace(/_/g, " "),
          assetClass: "",
          sector: "",
          value: h.value,
          allocation: 0,
        })),
      }
    : portfolio;

  // Compute allocations for display
  if (displayPortfolio?.holdings && displayPortfolio.totalValue > 0) {
    displayPortfolio.holdings = displayPortfolio.holdings.map((h) => ({
      ...h,
      allocation: (h.value / displayPortfolio.totalValue) * 100,
    }));
  }

  return (
    <div className="app-shell">
      <header className="site-header">
        <div className="site-header-inner">
          <a className="brand" href="#main-content" aria-label="WealthLens home">
            <span className="brand-logo" aria-hidden="true">
              <svg viewBox="0 0 40 40" fill="none" xmlns="http://www.w3.org/2000/svg" width="36" height="36">
                <circle cx="20" cy="20" r="18" stroke="#e8f0f8" strokeWidth="2.5" fill="#102B46"/>
                <circle cx="20" cy="20" r="11" fill="#1a4a6b"/>
                <circle cx="20" cy="20" r="6.5" fill="#2563a8"/>
                <circle cx="20" cy="20" r="3" fill="#60a5d8"/>
                <ellipse cx="16.5" cy="16.5" rx="2.5" ry="1.6" fill="white" opacity="0.3" transform="rotate(-20 16.5 16.5)"/>
                <circle cx="24" cy="16" r="1" fill="white" opacity="0.45"/>
              </svg>
            </span>
            <span className="brand-name">WealthLens</span>
          </a>

          <nav className="main-nav-inline" aria-label="Main navigation">
            <button
              className={`nav-tab ${navTab === "explore" ? "nav-tab-active" : ""}`}
              type="button"
              onClick={() => setNavTab("explore")}
            >Explore</button>
            <button
              className={`nav-tab ${navTab === "portfolio" ? "nav-tab-active" : ""}`}
              type="button"
              onClick={() => setNavTab("portfolio")}
            >Holdings</button>
            <button
              className={`nav-tab ${navTab === "advisor" ? "nav-tab-active" : ""}`}
              type="button"
              onClick={() => setNavTab("advisor")}
            >Advisor View</button>
          </nav>

          <div className="header-right">
            {API_MODE === "mock" && <span className="mock-mode-label">Demo data</span>}
            <ProfileManager activeProfile={activeProfile} onProfileChange={refreshDemoState} />
          </div>
        </div>
      </header>

      {/* Portfolio toolbar */}
      {activeProfile && (
        <div className="account-bar">
          <div className="account-bar-inner">
            <AccountManager
              profile={activeProfile}
              onAccountChange={refreshDemoState}
            />
          </div>
        </div>
      )}

      {/* Mobile nav (hidden on desktop via CSS) */}
      <div className="mobile-nav" aria-label="Main navigation">
        <div className="mobile-nav-inner">
          <button className={`nav-tab ${navTab === "explore" ? "nav-tab-active" : ""}`} type="button" onClick={() => setNavTab("explore")}>Explore</button>
          <button className={`nav-tab ${navTab === "portfolio" ? "nav-tab-active" : ""}`} type="button" onClick={() => setNavTab("portfolio")}>Holdings</button>
          <button className={`nav-tab ${navTab === "advisor" ? "nav-tab-active" : ""}`} type="button" onClick={() => setNavTab("advisor")}>Advisor View</button>
        </div>
      </div>

      <main id="main-content" className="main-content">
        {navTab === "advisor" ? (
          <AdvisorView />
        ) : navTab === "portfolio" && activeAccount ? (
          <PortfolioPage
            account={activeAccount}
            onSave={() => {
              refreshDemoState();
              // Invalidate analysis since portfolio changed
              setAnalysis(null);
              setAnalysisError("");
            }}
          />
        ) : (
          <>
            <section className="intro-section" aria-labelledby="page-title">
              <h1 id="page-title">See your portfolio from a new perspective.</h1>
              <p className="intro-copy">
                Explore a market change, understand its potential impact, and prepare
                for your next advisor conversation.
              </p>
            </section>

            {isLoading && (
              <div className="loading-state" role="status">
                Loading portfolio data…
              </div>
            )}

            {loadError && (
              <div className="error-message" role="alert">
                <strong>Could not load portfolio</strong>
                <span>{loadError}</span>
                <button className="text-button" type="button" onClick={() => window.location.reload()}>
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
                      <p className="section-kicker">
                        {activeAccount?.customHoldings ? "Custom portfolio" : "Synthetic portfolio"}
                      </p>
                      <h2 id="portfolio-title">{activeAccount?.name ?? "Your starting point"}</h2>
                    </div>
                    <span className="portfolio-badge">
                      {activeAccount?.customHoldings ? "Custom" : "Demo"}
                    </span>
                  </div>

                  <div className="portfolio-total">
                    <span>Current value</span>
                    <strong>
                      {currencyFormatter.format(
                        activeAccount?.customHoldings
                          ? activeAccount.customHoldings.reduce((s, h) => s + h.value, 0)
                          : portfolio.totalValue
                      )}
                    </strong>
                  </div>

                  {/* Allocation bar */}
                  <div className="allocation-bar" aria-hidden="true">
                    {(activeAccount?.customHoldings
                      ? activeAccount.customHoldings.map((h) => ({
                          identifier: h.holdingId,
                          allocation: (h.value / activeAccount.customHoldings!.reduce((s, x) => s + x.value, 0)) * 100,
                        }))
                      : portfolio.holdings
                    ).map((h, _i) => (
                      <span
                        key={h.identifier}
                        className={HOLDING_COLORS[_i % HOLDING_COLORS.length]}
                        style={{ width: `${h.allocation}%` }}
                      />
                    ))}
                  </div>

                  <ul className="holdings-list">
                    {(activeAccount?.customHoldings
                      ? activeAccount.customHoldings.map((h) => ({
                          identifier: h.holdingId,
                          name: h.holdingId.replace(/_/g, " "),
                          assetClass: "",
                          value: h.value,
                          allocation: (h.value / activeAccount.customHoldings!.reduce((s, x) => s + x.value, 0)) * 100,
                        }))
                      : portfolio.holdings
                    ).map((h, _i) => (
                      <li key={h.identifier} className="holding-row">
                        <span className={`holding-dot ${HOLDING_COLORS[_i % HOLDING_COLORS.length]}`} aria-hidden="true" />
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
                    {activeAccount?.customHoldings
                      ? "Custom portfolio saved in your browser. Edit it on the Portfolio tab."
                      : "This fictional portfolio is used consistently across all WealthLens demonstrations. All values are synthetic."}
                  </p>

                  <button
                    className="text-button portfolio-edit-link"
                    type="button"
                    onClick={() => setNavTab("portfolio")}
                  >
                    Edit holdings →
                  </button>
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
                      <button className="secondary-button" type="submit" disabled={isInterpreting}>
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

                        {interpretResult.status === "preset_offered" && interpretResult.scenarioKey && (
                          <>
                            <p className="interpret-confirm-note">
                              Select the preset below to review its exact assumptions before running the analysis.
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

                      <MagnitudeControl
                        scenario={selectedScenario}
                        value={magnitude ?? selectedScenario.paramDefault}
                        onChange={(v) => {
                          setMagnitude(v);
                          setAnalysis(null);
                          setAnalysisError("");
                        }}
                      />

                      {selectedScenario.kind === "purchasing-power" ? (
                        <div className="horizon-control">
                          <label className="magnitude-label" htmlFor="inflation-horizon">
                            Horizon (months)
                          </label>
                          <div className="magnitude-input-row">
                            <input
                              type="range"
                              className="magnitude-slider"
                              id="inflation-horizon"
                              min={1}
                              max={60}
                              step={1}
                              value={inflationHorizonMonths}
                              onChange={(e) => {
                                setInflationHorizonMonths(parseInt(e.target.value, 10));
                                setAnalysis(null);
                                setAnalysisError("");
                              }}
                            />
                            <div className="magnitude-number-wrap">
                              <input
                                type="number"
                                className="magnitude-number-input"
                                min={1}
                                max={60}
                                step={1}
                                value={inflationHorizonMonths}
                                onChange={(e) => {
                                  const v = Math.min(60, Math.max(1, parseInt(e.target.value, 10) || 1));
                                  setInflationHorizonMonths(v);
                                  setAnalysis(null);
                                  setAnalysisError("");
                                }}
                                aria-label="Horizon in months"
                              />
                              <span className="magnitude-unit">mo</span>
                            </div>
                          </div>
                          <div className="magnitude-range-labels"><span>1 mo</span><span>60 mo</span></div>
                          <p className="magnitude-pp-note">
                            Horizon only applies to the purchasing-power illustration.
                            Formula: real value = nominal ÷ (1 + annual rate)^(months ÷ 12).
                          </p>
                        </div>
                      ) : (
                        <div className="horizon-disabled-note">
                          <strong>Horizon:</strong> Immediate shock — this scenario models an
                          instantaneous asset-price repricing, not a time-compounded return.
                          A time-dependent method is not yet implemented for this scenario type.
                        </div>
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
              <>
                {analysisConfigKey && analysisConfigKey !== makeConfigKey() && (
                  <div className="stale-result-banner" role="alert">
                    <strong>Configuration changed.</strong> The result below is from a previous
                    run. Re-run the analysis to see updated results.
                    <button className="text-button" type="button" onClick={handleAnalyze}>
                      Re-run now
                    </button>
                  </div>
                )}
                <AnalysisResults
                  result={analysis}
                  scenario={selectedScenario}
                  discussState={discussState}
                  onDiscuss={handleDiscuss}
                  onTryAnother={handleTryAnother}
                />
              </>
            )}

            <p className="disclosure">
              Illustrative scenario analysis based on predefined assumptions. This is not a
              forecast or investment recommendation.
            </p>
          </>
        )}
      </main>

      <footer className="site-footer">
        <span>WealthLens</span>
        <span>Demo · Synthetic data only · Not investment advice · Browser-local storage</span>
      </footer>
    </div>
  );
}

export default App;
