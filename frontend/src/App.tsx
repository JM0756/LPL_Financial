import { useCallback, useEffect, useRef, useState, type FormEvent } from "react";
import "./App.css";
import {
  analyzeScenario,
  API_MODE,
  createAdvisorQuestion,
  getPortfolio,
  getScenarios,
  interpretQuestion,
} from "./api";
import {
  AUTH_ENABLED,
  clearSession,
  getStoredSession,
  type StoredSession,
} from "./auth";
import { AccountMenu } from "./components/AccountMenu";
import { AnalysisResults } from "./components/AnalysisResults";
import { AuthGate } from "./components/AuthGate";
import { MagnitudeControl } from "./components/MagnitudeControl";
import { MyPortfolioPage } from "./components/MyPortfolioPage";
import { PortfolioPage } from "./components/PortfolioPage";
import { PortfolioToolbar } from "./components/PortfolioToolbar";
import { ProfileManager } from "./components/ProfileManager";
import { RemovePortfolioDialog } from "./components/RemovePortfolioDialog";
import { ScenarioComparison } from "./components/ScenarioComparison";
import {
  getActiveAccount,
  getActiveProfile,
  removeAccount,
  type DemoAccount,
  type DemoProfile,
} from "./demo-storage";
import wealthLensLogo from "./assets/Wealth Lens image .jpeg";
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

type NavTab = "my-portfolio" | "explore" | "customize";
type UnsavedGuardAction = "save" | "discard" | "stay";

function App() {
  // Cognito session state (only used when AUTH_ENABLED)
  const [session, setSession] = useState<StoredSession | null>(() => AUTH_ENABLED ? getStoredSession() : null);

  // Demo profile state (only used when !AUTH_ENABLED)
  const [activeProfile, setActiveProfile] = useState<DemoProfile | null>(() => AUTH_ENABLED ? null : getActiveProfile());
  // Active account - used for BOTH demo mode and authenticated mode
  // For authenticated users, we create a synthetic account from the backend portfolio
  const [activeAccount, setActiveAccount] = useState<DemoAccount | null>(() => AUTH_ENABLED ? null : getActiveAccount());
  // For authenticated users, we need to track portfolios separately
  const [authPortfolios, setAuthPortfolios] = useState<DemoAccount[]>([]);
  const [portfolio, setPortfolio] = useState<Portfolio | null>(null);
  const [scenarios, setScenarios] = useState<ScenarioDefinition[]>([]);
  const [loadError, setLoadError] = useState("");
  const [isLoading, setIsLoading] = useState(true);
  const [navTab, setNavTab] = useState<NavTab>("my-portfolio");
  const [pendingNav, setPendingNav] = useState<NavTab | null>(null);
  const [pendingAccountSwitch, setPendingAccountSwitch] = useState<string | null>(null);
  const [portfolioIsDirty, setPortfolioIsDirty] = useState(false);
  const [removeDialogAccount, setRemoveDialogAccount] = useState<DemoAccount | null>(null);
  const [selectedKey, setSelectedKey] = useState<ScenarioKey | null>(null);
  const [magnitude, setMagnitude] = useState<number | null>(null);
  const [inflationHorizonMonths, setInflationHorizonMonths] = useState<number>(12);
  const [question, setQuestion] = useState("");
  const [questionStatus, setQuestionStatus] = useState("");
  const [isInterpreting, setIsInterpreting] = useState(false);
  const [interpretResult, setInterpretResult] = useState<InterpretResult | null>(null);
  const [analysis, setAnalysis] = useState<AnalysisResult | null>(null);
  const [analysisError, setAnalysisError] = useState("");
  const [isAnalyzing, setIsAnalyzing] = useState(false);
  const [analysisConfigKey, setAnalysisConfigKey] = useState<string | null>(null);
  const [showComparison, setShowComparison] = useState(false);

  type AdvisorQState = { status: "idle" | "saving" | "saved" | "error"; error: string };
  const [advisorQNote, setAdvisorQNote] = useState("");
  const [advisorQState, setAdvisorQState] = useState<AdvisorQState>({ status: "idle", error: "" });
  const advisorQIdempotencyRef = useRef("");
  const requestIdRef = useRef(0);

  function makeConfigKey() {
    const holdingsKey = activeAccount?.customHoldings
      ? activeAccount.customHoldings.map((h) => `${h.holdingId}:${h.value}`).join(",")
      : "default";
    return `${selectedKey}|${magnitude ?? "default"}|${inflationHorizonMonths}|${holdingsKey}`;
  }

  const refreshDemoState = useCallback(() => {
    if (!AUTH_ENABLED) {
      setActiveProfile(getActiveProfile());
      setActiveAccount(getActiveAccount());
    }
    setAnalysis(null);
    setAnalysisError("");
  }, []);

  function handleSignOut() {
    if (AUTH_ENABLED) {
      clearSession();
      setSession(null);
    } else {
      // Demo mode sign out handled by ProfileManager
    }
  }

  function requestNavTo(tab: NavTab) {
    if (navTab === "customize" && portfolioIsDirty) {
      setPendingNav(tab);
    } else {
      setNavTab(tab);
    }
  }

  function handleAccountSwitchRequest(accountId: string) {
    if (navTab === "customize" && portfolioIsDirty) {
      setPendingAccountSwitch(accountId);
    } else {
      import("./demo-storage").then(({ selectAccount }) => {
        selectAccount(accountId);
        refreshDemoState();
      });
    }
  }

  // Used by PortfolioToolbar when switching accounts
  void handleAccountSwitchRequest;

  function handleGuardAction(action: UnsavedGuardAction) {
    if (action === "stay") {
      setPendingNav(null);
      setPendingAccountSwitch(null);
      return;
    }
    if (action === "discard") {
      setPortfolioIsDirty(false);
      if (pendingNav) {
        setNavTab(pendingNav);
        setPendingNav(null);
      }
      if (pendingAccountSwitch) {
        import("./demo-storage").then(({ selectAccount }) => {
          selectAccount(pendingAccountSwitch);
          setPendingAccountSwitch(null);
          refreshDemoState();
        });
      }
    }
  }

  function handleRemovePortfolio() {
    if (!removeDialogAccount) return;
    const result = removeAccount(removeDialogAccount.id);
    if (result.success) {
      setRemoveDialogAccount(null);
      setPortfolioIsDirty(false);
      setAnalysis(null);
      setAnalysisError("");
      refreshDemoState();
      if (navTab === "customize") setNavTab("my-portfolio");
    }
  }

  useEffect(() => {
    const ac = new AbortController();
    Promise.all([getPortfolio(ac.signal), getScenarios(ac.signal)])
      .then(([p, s]) => {
        setPortfolio(p);
        setScenarios(s);
        // For authenticated users, create a default account from the backend portfolio
        if (AUTH_ENABLED && !activeAccount) {
          const defaultAccount: DemoAccount = {
            id: "auth_default",
            name: "My Portfolio",
            customHoldings: null,
            createdAt: new Date().toISOString(),
          };
          setActiveAccount(defaultAccount);
          setAuthPortfolios([defaultAccount]);
        }
      })
      .catch((err: unknown) => {
        if (err instanceof DOMException && err.name === "AbortError") return;
        setLoadError(err instanceof Error ? err.message : "Could not load portfolio data.");
      })
      .finally(() => setIsLoading(false));
    return () => ac.abort();
  }, []);

  const selectedScenario = scenarios.find((s) => s.key === selectedKey) ?? null;

  function selectScenario(key: ScenarioKey) {
    requestIdRef.current += 1;
    setSelectedKey(key);
    setMagnitude(null);
    setInflationHorizonMonths(12);
    setAnalysis(null);
    setAnalysisError("");
    setQuestionStatus("");
    setInterpretResult(null);
    setIsAnalyzing(false);
  }

  function clearSelection() {
    requestIdRef.current += 1;
    setSelectedKey(null);
    setMagnitude(null);
    setInflationHorizonMonths(12);
    setAnalysis(null);
    setAnalysisError("");
    setInterpretResult(null);
  }

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
      }
    } catch (err) {
      setQuestionStatus(err instanceof Error ? err.message : "Interpretation failed.");
    } finally {
      setIsInterpreting(false);
    }
  }

  async function handleSendToAdvisor() {
    if (!question.trim() || advisorQState.status === "saving" || advisorQState.status === "saved") return;
    if (!advisorQIdempotencyRef.current) {
      advisorQIdempotencyRef.current = `aq_${Date.now()}_${Math.random().toString(36).slice(2, 8)}`;
    }
    setAdvisorQState({ status: "saving", error: "" });
    try {
      await createAdvisorQuestion(question.trim(), advisorQNote.trim() || null, advisorQIdempotencyRef.current);
      setAdvisorQState({ status: "saved", error: "" });
    } catch (err) {
      setAdvisorQState({ status: "error", error: err instanceof Error ? err.message : "Could not save question." });
    }
  }

  async function handleAnalyze() {
    if (!selectedKey || !selectedScenario) return;
    const requestId = ++requestIdRef.current;
    setIsAnalyzing(true);
    setAnalysis(null);
    setAnalysisError("");
    const customHoldings = activeAccount?.customHoldings ?? null;
    const portfolioTotal = customHoldings ? customHoldings.reduce((sum, h) => sum + h.value, 0) : null;
    const magnitudeOverride = magnitude !== null && selectedScenario && magnitude !== selectedScenario.paramDefault ? magnitude : null;
    const horizonToUse = selectedScenario.kind === "purchasing-power" ? `${inflationHorizonMonths}M` : selectedScenario.horizon;
    try {
      const result = await analyzeScenario(
        selectedKey, horizonToUse,
        interpretResult?.status !== "unsupported" ? (question.trim() || null) : null,
        customHoldings ? customHoldings.map((h) => ({ holdingId: h.holdingId, value: h.value })) : null,
        magnitudeOverride, portfolioTotal,
      );
      if (requestId !== requestIdRef.current) return;
      setAnalysis(result);
      setAnalysisConfigKey(makeConfigKey());
      window.setTimeout(() => { document.getElementById("analysis-results")?.scrollIntoView({ behavior: "smooth", block: "start" }); }, 0);
    } catch (err) {
      if (requestId !== requestIdRef.current) return;
      setAnalysisError(err instanceof Error ? err.message : "The analysis could not be completed.");
    } finally {
      if (requestId === requestIdRef.current) setIsAnalyzing(false);
    }
  }

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
    document.getElementById("scenario-panel-title")?.scrollIntoView({ behavior: "smooth", block: "start" });
  }

  // ── Authentication gate ─────────────────────────────────────────────────
  // When Cognito is configured, require sign-in via AuthGate.
  // When Cognito is NOT configured, use demo profiles (ProfileManager).
  if (AUTH_ENABLED) {
    if (!session) {
      return <AuthGate onAuthenticated={(s) => setSession(s)} />;
    }
  } else {
    // Demo mode: require a demo profile
    if (!activeProfile) {
      return <ProfileManager activeProfile={null} onProfileChange={refreshDemoState} />;
    }
  }

  // Determine display name for header - now handled by AccountMenu
  // const displayName = AUTH_ENABLED ? session?.email : activeProfile?.name;

  return (
    <div className="app-shell">
      <header className="site-header">
        <div className="site-header-inner">
          <a className="brand" href="#main-content" aria-label="WealthLens home">
            <img src={wealthLensLogo} alt="WealthLens" className="brand-logo-img" />
          </a>
          <nav className="main-nav-inline" aria-label="Main navigation">
            <button className={`nav-tab ${navTab === "my-portfolio" ? "nav-tab-active" : ""}`} type="button" onClick={() => requestNavTo("my-portfolio")}>My Portfolio</button>
            <button className={`nav-tab ${navTab === "explore" ? "nav-tab-active" : ""}`} type="button" onClick={() => requestNavTo("explore")}>Explore</button>
            <button className={`nav-tab ${navTab === "customize" ? "nav-tab-active" : ""}`} type="button" onClick={() => requestNavTo("customize")}>Customize Portfolio</button>
          </nav>
          <div className="header-right">
            {API_MODE === "mock" && <span className="mock-mode-label">Demo data</span>}
            {AUTH_ENABLED && session ? (
              <AccountMenu session={session} onSignOut={handleSignOut} />
            ) : (
              <ProfileManager activeProfile={activeProfile} onProfileChange={refreshDemoState} />
            )}
          </div>
        </div>
      </header>

      {/* Portfolio toolbar - shown for both demo and authenticated users */}
      {activeAccount && (
        <div className="account-bar">
          <div className="account-bar-inner">
            {AUTH_ENABLED ? (
              <PortfolioToolbar
                profile={{
                  id: "auth_profile",
                  name: session?.email ?? "User",
                  accounts: authPortfolios,
                  activeAccountId: activeAccount.id,
                  createdAt: activeAccount.createdAt,
                }}
                onAccountChange={() => {
                  // For authenticated users, refresh from authPortfolios state
                  setAnalysis(null);
                  setAnalysisError("");
                }}
                onRemoveRequest={(account) => setRemoveDialogAccount(account)}
                disabled={portfolioIsDirty}
              />
            ) : activeProfile ? (
              <PortfolioToolbar
                profile={activeProfile}
                onAccountChange={refreshDemoState}
                onRemoveRequest={(account) => setRemoveDialogAccount(account)}
                disabled={portfolioIsDirty}
              />
            ) : null}
          </div>
        </div>
      )}

      <div className="mobile-nav" aria-label="Main navigation">
        <div className="mobile-nav-inner">
          <button className={`nav-tab ${navTab === "my-portfolio" ? "nav-tab-active" : ""}`} type="button" onClick={() => requestNavTo("my-portfolio")}>My Portfolio</button>
          <button className={`nav-tab ${navTab === "explore" ? "nav-tab-active" : ""}`} type="button" onClick={() => requestNavTo("explore")}>Explore</button>
          <button className={`nav-tab ${navTab === "customize" ? "nav-tab-active" : ""}`} type="button" onClick={() => requestNavTo("customize")}>Customize</button>
        </div>
      </div>

      <main id="main-content" className="main-content">
        {(pendingNav || pendingAccountSwitch) && (
          <div className="unsaved-guard-overlay" role="dialog" aria-modal="true" aria-labelledby="guard-title">
            <div className="unsaved-guard-card">
              <h2 id="guard-title" className="unsaved-guard-title">Unsaved changes</h2>
              <p className="unsaved-guard-body">
                {pendingAccountSwitch
                  ? "Your portfolio has unsaved edits. Save or discard before switching portfolios."
                  : "Your portfolio has unsaved edits."}
              </p>
              <div className="unsaved-guard-actions">
                <button className="primary-button" type="button" onClick={() => window.dispatchEvent(new CustomEvent("wl:portfolio-save-request"))}>Save changes</button>
                <button className="secondary-button" type="button" onClick={() => handleGuardAction("discard")}>Discard</button>
                <button className="text-button" type="button" onClick={() => handleGuardAction("stay")}>Stay</button>
              </div>
            </div>
          </div>
        )}

        {removeDialogAccount && (
          <RemovePortfolioDialog
            account={removeDialogAccount}
            hasUnsavedEdits={portfolioIsDirty}
            onConfirm={handleRemovePortfolio}
            onCancel={() => setRemoveDialogAccount(null)}
          />
        )}

        {navTab === "my-portfolio" && activeAccount && portfolio ? (
          <MyPortfolioPage
            account={activeAccount}
            onExplore={() => setNavTab("explore")}
            onCustomize={() => setNavTab("customize")}
          />
        ) : navTab === "customize" && activeAccount && portfolio ? (
          <PortfolioPage
            account={activeAccount}
            onDirtyChange={setPortfolioIsDirty}
            onSave={() => { setPortfolioIsDirty(false); refreshDemoState(); setAnalysis(null); setAnalysisError(""); if (pendingNav) { setNavTab(pendingNav); setPendingNav(null); } if (pendingAccountSwitch) { import("./demo-storage").then(({ selectAccount }) => { selectAccount(pendingAccountSwitch); setPendingAccountSwitch(null); refreshDemoState(); }); } }}
            saveRequested={!!(pendingNav || pendingAccountSwitch)}
            onExplore={() => setNavTab("explore")}
          />
        ) : navTab === "explore" ? (
          <>
            <section className="intro-section" aria-labelledby="page-title">
              <h1 id="page-title">See your portfolio from a new perspective.</h1>
              <p className="intro-copy">Explore a market change, understand its potential impact, and prepare for your next advisor conversation.</p>
            </section>

            {isLoading && <div className="loading-state" role="status">Loading portfolio data…</div>}
            {loadError && (
              <div className="error-message" role="alert">
                <strong>Could not load portfolio</strong>
                <span>{loadError}</span>
                <button className="text-button" type="button" onClick={() => window.location.reload()}>Reload page</button>
              </div>
            )}

            {!isLoading && !loadError && portfolio && (
              <div className="workspace-grid">
                <aside className="portfolio-card" aria-labelledby="portfolio-title">
                  <div className="card-heading">
                    <div>
                      <p className="section-kicker">{activeAccount?.customHoldings ? "Custom portfolio" : "Synthetic portfolio"}</p>
                      <h2 id="portfolio-title">{activeAccount?.name ?? "Your starting point"}</h2>
                    </div>
                    <span className="portfolio-badge">{activeAccount?.customHoldings ? "Custom" : "Demo"}</span>
                  </div>
                  <div className="portfolio-total">
                    <span>Current value</span>
                    <strong>{currencyFormatter.format(activeAccount?.customHoldings ? activeAccount.customHoldings.reduce((s, h) => s + h.value, 0) : portfolio.totalValue)}</strong>
                  </div>
                  <div className="allocation-bar" aria-hidden="true">
                    {(activeAccount?.customHoldings
                      ? activeAccount.customHoldings.map((h) => ({ identifier: h.holdingId, allocation: (h.value / activeAccount.customHoldings!.reduce((s, x) => s + x.value, 0)) * 100 }))
                      : portfolio.holdings
                    ).map((h, i) => <span key={h.identifier} className={HOLDING_COLORS[i % HOLDING_COLORS.length]} style={{ width: `${h.allocation}%` }} />)}
                  </div>
                  <ul className="holdings-list">
                    {(activeAccount?.customHoldings
                      ? activeAccount.customHoldings.map((h) => ({ identifier: h.holdingId, name: h.holdingId.replace(/_/g, " "), assetClass: "", value: h.value, allocation: (h.value / activeAccount.customHoldings!.reduce((s, x) => s + x.value, 0)) * 100 }))
                      : portfolio.holdings
                    ).map((h, i) => (
                      <li key={h.identifier} className="holding-row">
                        <span className={`holding-dot ${HOLDING_COLORS[i % HOLDING_COLORS.length]}`} aria-hidden="true" />
                        <span className="holding-identity"><strong>{h.name}</strong><span>{h.assetClass}</span></span>
                        <span className="holding-value"><strong>{currencyFormatter.format(h.value)}</strong><span>{h.allocation.toFixed(0)}%</span></span>
                      </li>
                    ))}
                  </ul>
                  <p className="portfolio-note">{activeAccount?.customHoldings ? "Custom portfolio saved in your browser." : "This fictional portfolio is used consistently across all WealthLens demonstrations."}</p>
                  <div className="portfolio-card-actions">
                    <button className="text-button portfolio-edit-link" type="button" onClick={() => requestNavTo("customize")}>Customize portfolio →</button>
                  </div>
                </aside>

                <section className="scenario-panel" aria-labelledby="scenario-panel-title">
                  <div className="panel-heading">
                    <p className="section-kicker">Step 1 of 2</p>
                    <h2 id="scenario-panel-title">Explore a market scenario</h2>
                    <p>Choose a supported scenario or enter a question for interpretation.</p>
                    <button className="secondary-button" type="button" style={{ marginTop: "12px" }} onClick={() => { setShowComparison(true); window.setTimeout(() => document.getElementById("cmp-panel-anchor")?.scrollIntoView({ behavior: "smooth", block: "start" }), 0); }}>Compare two scenarios</button>
                  </div>

                  <form className="question-form" onSubmit={handleQuestionSubmit}>
                    <label htmlFor="scenario-question">What market change are you considering?</label>
                    <div className="question-field-row">
                      <textarea id="scenario-question" value={question} onChange={(e) => { setQuestion(e.target.value); setQuestionStatus(""); setInterpretResult(null); setAdvisorQState({ status: "idle", error: "" }); setAdvisorQNote(""); advisorQIdempotencyRef.current = ""; }} placeholder="For example: What if the market crashes?" rows={2} />
                      <button className="secondary-button" type="submit" disabled={isInterpreting}>{isInterpreting ? "Interpreting…" : "Interpret question"}</button>
                    </div>
                    {questionStatus && <p className="field-message" role="status">{questionStatus}</p>}
                    {interpretResult && (
                      <div className={`interpret-result interpret-result-${interpretResult.status}`} role="status">
                        <p>{interpretResult.message}</p>
                        {interpretResult.mismatchReasons.length > 0 && <ul className="mismatch-reasons">{interpretResult.mismatchReasons.map((r) => <li key={r}>{r}</li>)}</ul>}
                        {interpretResult.status === "unsupported" && interpretResult.offeredPresets.length > 0 && (
                          <div className="offered-presets">
                            <p>Supported scenarios:</p>
                            {interpretResult.offeredPresets.map((p) => (
                              <button key={p.scenario_key} className="scenario-option" type="button" onClick={() => selectScenario(p.scenario_key)}>
                                <span className="scenario-option-topline"><strong>{p.label}</strong></span>
                                <span className="scenario-description">{p.magnitude_label}</span>
                              </button>
                            ))}
                          </div>
                        )}
                        {interpretResult.status === "unsupported" && (
                          <div className="advisor-handoff-panel">
                            <p className="advisor-handoff-heading">We don't have a supported calculation for that scenario yet.</p>
                            <p className="advisor-handoff-question">Your question: <em>"{question.trim()}"</em></p>
                            <label htmlFor="advisor-note" className="advisor-note-label">Optional note for your advisor</label>
                            <textarea id="advisor-note" className="advisor-note-input" value={advisorQNote} onChange={(e) => setAdvisorQNote(e.target.value)} placeholder="Add any context…" rows={2} disabled={advisorQState.status === "saved"} />
                            {advisorQState.status !== "saved" && <button className="secondary-button" type="button" onClick={handleSendToAdvisor} disabled={advisorQState.status === "saving"}>{advisorQState.status === "saving" ? "Saving…" : "Send question to advisor"}</button>}
                            {advisorQState.status === "saved" && <p className="advisor-q-success" role="status">Question saved.</p>}
                            {advisorQState.status === "error" && <div className="error-message" role="alert"><strong>Could not save</strong><span>{advisorQState.error}</span></div>}
                          </div>
                        )}
                        {interpretResult.status === "preset_offered" && interpretResult.scenarioKey && (
                          <>
                            <p className="interpret-confirm-note">Select the preset below to review its exact assumptions before running the analysis.</p>
                            <div className="advisor-handoff-panel advisor-handoff-panel-inline">
                              <p className="advisor-handoff-heading">Or send your original question to your advisor instead.</p>
                              {advisorQState.status !== "saved" && <button className="text-button" type="button" onClick={handleSendToAdvisor} disabled={advisorQState.status === "saving"}>{advisorQState.status === "saving" ? "Saving…" : "Send question to advisor"}</button>}
                              {advisorQState.status === "saved" && <p className="advisor-q-success" role="status">Question saved.</p>}
                            </div>
                          </>
                        )}
                      </div>
                    )}
                  </form>

                  <div className="divider"><span>or choose a supported scenario</span></div>

                  <div className="scenario-options">
                    {scenarios.map((scenario) => (
                      <button className={`scenario-option ${selectedKey === scenario.key ? "scenario-option-selected" : ""}`} type="button" key={scenario.key} aria-pressed={selectedKey === scenario.key} onClick={() => selectScenario(scenario.key)}>
                        <span className="scenario-option-topline"><strong>{scenario.label}</strong><span className="selection-indicator" aria-hidden="true">{selectedKey === scenario.key ? "✓" : ""}</span></span>
                        <span className="scenario-description">{scenario.summary}</span>
                        {scenario.kind === "purchasing-power" && <span className="scenario-horizon">Horizon: variable (1–60 months)</span>}
                      </button>
                    ))}
                  </div>

                  {selectedScenario ? (
                    <section className="confirmation-card" aria-labelledby="confirmation-title">
                      <div className="confirmation-heading">
                        <div><p className="section-kicker">Step 2 of 2</p><h3 id="confirmation-title">Customize your scenario</h3></div>
                        <button className="text-button" type="button" onClick={clearSelection}>Clear</button>
                      </div>
                      <div className="confirmed-scenario">
                        <strong>{selectedScenario.label}</strong>
                        {selectedScenario.kind === "purchasing-power" 
                          ? <span>Annual inflation: {magnitude ?? selectedScenario.paramDefault}%</span>
                          : <span>Shock timing: immediate</span>
                        }
                      </div>
                      {selectedScenario.kind === "purchasing-power" && <p className="context-note">This is a purchasing-power illustration, not an asset-return forecast.</p>}
                      <MagnitudeControl scenario={selectedScenario} value={magnitude ?? selectedScenario.paramDefault} onChange={(v) => { setMagnitude(v); setAnalysis(null); setAnalysisError(""); }} />
                      {selectedScenario.kind === "purchasing-power" ? (
                        <div className="horizon-control">
                          <label className="magnitude-label">Purchasing-power horizon</label>
                          <div className="horizon-preset-buttons">
                            {[3, 6, 12, 36, 60].map((mo) => <button key={mo} type="button" className={`horizon-preset-btn ${inflationHorizonMonths === mo ? "horizon-preset-btn-active" : ""}`} onClick={() => { setInflationHorizonMonths(mo); setAnalysis(null); setAnalysisError(""); }}>{mo < 12 ? `${mo} mo` : mo === 12 ? "1 yr" : mo === 36 ? "3 yr" : "5 yr"}</button>)}
                          </div>
                          <div className="magnitude-input-row" style={{marginTop: "10px"}}>
                            <input type="range" className="magnitude-slider" min={1} max={60} step={1} value={inflationHorizonMonths} onChange={(e) => { setInflationHorizonMonths(parseInt(e.target.value, 10)); setAnalysis(null); setAnalysisError(""); }} />
                            <div className="magnitude-number-wrap">
                              <input type="number" className="magnitude-number-input" min={1} max={60} step={1} value={inflationHorizonMonths} onChange={(e) => { const v = Math.min(60, Math.max(1, parseInt(e.target.value, 10) || 1)); setInflationHorizonMonths(v); setAnalysis(null); setAnalysisError(""); }} aria-label="Horizon in months" />
                              <span className="magnitude-unit">mo</span>
                            </div>
                          </div>
                          <div className="magnitude-range-labels"><span>1 mo</span><span>60 mo</span></div>
                        </div>
                      ) : (
                        <div className="horizon-disabled-note"><strong>Shock timing: immediate.</strong> This scenario models an instantaneous asset-price repricing.</div>
                      )}
                      <ul className="assumption-list">
                        {(selectedScenario.kind === "purchasing-power"
                          ? [`Nominal return held at 0%.`, `Annual inflation: ${magnitude ?? selectedScenario.paramDefault}%.`, `This is an illustration of real value.`]
                          : selectedScenario.assumptionNotes
                        ).map((note) => <li key={note}>{note}</li>)}
                      </ul>
                      <button className="primary-button" type="button" onClick={handleAnalyze} disabled={isAnalyzing}>{isAnalyzing ? "Analyzing scenario…" : "Analyze this scenario"}</button>
                      {analysisError && <div className="error-message" role="alert"><strong>Analysis unavailable</strong><span>{analysisError}</span><button className="text-button" type="button" onClick={handleAnalyze}>Try again</button></div>}
                    </section>
                  ) : (
                    <div className="empty-confirmation"><span aria-hidden="true">↑</span>Select a scenario to review its exact assumptions before analysis.</div>
                  )}
                </section>
              </div>
            )}

            {showComparison && (
              <div id="cmp-panel-anchor">
                <ScenarioComparison scenarios={scenarios} customHoldings={activeAccount?.customHoldings ?? null} portfolioTotal={activeAccount?.customHoldings ? activeAccount.customHoldings.reduce((s, h) => s + h.value, 0) : 100_000} onClose={() => setShowComparison(false)} />
              </div>
            )}

            {analysis && selectedScenario && (
              <>
                {analysisConfigKey && analysisConfigKey !== makeConfigKey() && (
                  <div className="stale-result-banner" role="alert"><strong>Configuration changed.</strong> Re-run the analysis to see updated results.<button className="text-button" type="button" onClick={handleAnalyze}>Re-run now</button></div>
                )}
                <AnalysisResults result={analysis} scenario={selectedScenario} onTryAnother={handleTryAnother} onCompare={() => { setShowComparison(true); window.setTimeout(() => document.getElementById("cmp-panel-anchor")?.scrollIntoView({ behavior: "smooth", block: "start" }), 0); }} />
              </>
            )}

            <p className="disclosure">Illustrative scenario analysis based on predefined assumptions. This is not a forecast or investment recommendation.</p>
          </>
        ) : (
          <div className="loading-state" role="status">
            {isLoading ? "Loading portfolio data…" : "Initializing…"}
          </div>
        )}
      </main>

      <footer className="site-footer">
        <img src={wealthLensLogo} alt="WealthLens" className="footer-logo-img" />
        <span>Demo · Synthetic data only · Not investment advice · Browser-local storage</span>
      </footer>
    </div>
  );
}

export default App;
