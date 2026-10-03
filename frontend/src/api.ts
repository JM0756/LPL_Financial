import { analysisFixtures, portfolioFixture, scenarioFixtures } from "./mocks/fixtures";
import type {
  AnalysisResult,
  AdvisorQuestionResult,
  DiscussionRecord,
  DiscussionResult,
  ExplanationSource,
  HoldingAnalysis,
  InterpretResult,
  Portfolio,
  PortfolioHolding,
  ScenarioDefinition,
  ScenarioKey,
} from "./types";

export type ApiMode = "mock" | "real";

export const API_MODE: ApiMode =
  import.meta.env.VITE_API_MODE === "real" ? "real" : "mock";

const API_BASE_URL = (import.meta.env.VITE_API_BASE_URL as string | undefined) ?? "";

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

function wait(ms: number, signal?: AbortSignal): Promise<void> {
  return new Promise((resolve, reject) => {
    const id = window.setTimeout(resolve, ms);
    signal?.addEventListener("abort", () => {
      window.clearTimeout(id);
      reject(new DOMException("Request was cancelled.", "AbortError"));
    }, { once: true });
  });
}

/** Extract a readable string from FastAPI's detail field, which can be a string or object. */
function extractDetail(detail: unknown): string | null {
  if (typeof detail === "string") return detail;
  if (detail && typeof detail === "object") {
    const d = detail as Record<string, unknown>;
    if (typeof d["message"] === "string") return d["message"];
    if (typeof d["error"] === "string") return d["error"];
  }
  return null;
}

async function parseResponse<T>(response: Response): Promise<T> {
  if (!response.ok) {
    let message = `API request failed (${response.status}): ${response.statusText || "Error"}`;
    try {
      const body = await response.json() as Record<string, unknown>;
      const extracted = extractDetail(body["detail"]) ?? extractDetail(body["message"]);
      if (extracted) message = extracted;
    } catch {
      // keep status-based message
    }
    throw new Error(message);
  }
  try {
    return await response.json() as T;
  } catch {
    throw new Error(`API returned non-JSON response (${response.status})`);
  }
}

async function apiFetch<T>(path: string, init?: RequestInit): Promise<T> {
  const response = await fetch(`${API_BASE_URL}${path}`, {
    headers: { Accept: "application/json", ...init?.headers },
    ...init,
  });
  return parseResponse<T>(response);
}

// ---------------------------------------------------------------------------
// Response adapters — transform backend snake_case to frontend camelCase
// and validate that essential fields are present.
// ---------------------------------------------------------------------------

function adaptPortfolioHolding(raw: Record<string, unknown>): PortfolioHolding {
  const identifier = raw["holding_id"];
  const value = raw["value"];
  const allocation = raw["weight_percent"];
  if (typeof identifier !== "string" || identifier === "") throw new Error("holding_id missing");
  if (typeof value !== "number") throw new Error(`value missing for holding ${identifier}`);
  if (typeof allocation !== "number") throw new Error(`weight_percent missing for holding ${identifier}`);
  return {
    identifier,
    name: typeof raw["name"] === "string" ? raw["name"] : identifier,
    assetClass: typeof raw["asset_class"] === "string" ? raw["asset_class"] : "",
    sector: typeof raw["sector"] === "string" ? raw["sector"] : "",
    value,
    allocation,
  };
}

function adaptPortfolio(raw: Record<string, unknown>): Portfolio {
  const totalValue = raw["total_value"];
  if (typeof totalValue !== "number") throw new Error("total_value missing from portfolio response");
  const rawHoldings = Array.isArray(raw["holdings"]) ? raw["holdings"] as Record<string, unknown>[] : [];
  return {
    id: typeof raw["client_id"] === "string" ? raw["client_id"] : "unknown",
    name: typeof raw["client_name"] === "string" ? raw["client_name"] : "Portfolio",
    totalValue,
    currency: typeof raw["currency"] === "string" ? raw["currency"] : "USD",
    asOf: typeof raw["as_of"] === "string" ? raw["as_of"] : "",
    assumptionsVersion: typeof raw["assumptions_version"] === "string" ? raw["assumptions_version"] : "",
    holdings: rawHoldings.map(adaptPortfolioHolding),
  };
}

function adaptScenarioDefinition(raw: Record<string, unknown>): ScenarioDefinition {
  const key = raw["scenario_key"] as ScenarioKey;
  const valuationBasis = typeof raw["valuation_basis"] === "string" ? raw["valuation_basis"] : "nominal_market_value";
  return {
    key,
    label: typeof raw["label"] === "string" ? raw["label"] : key,
    summary: typeof raw["summary"] === "string" ? raw["summary"] : "",
    horizon: typeof raw["horizon"] === "string" ? raw["horizon"] : "",
    direction: typeof raw["direction"] === "string" ? raw["direction"] : "",
    magnitudeLabel: typeof raw["magnitude_label"] === "string" ? raw["magnitude_label"] : "",
    valuationBasis,
    assumptionsVersion: typeof raw["assumptions_version"] === "string" ? raw["assumptions_version"] : "",
    assumptionNotes: Array.isArray(raw["assumption_notes"]) ? raw["assumption_notes"] as string[] : [],
    kind: valuationBasis === "real_purchasing_power" ? "purchasing-power" : "market",
    paramLabel: typeof raw["param_label"] === "string" ? raw["param_label"] : "Magnitude",
    paramUnit: typeof raw["param_unit"] === "string" ? raw["param_unit"] : "percent",
    paramDefault: typeof raw["param_default"] === "number" ? raw["param_default"] : 0,
    paramMin: typeof raw["param_min"] === "number" ? raw["param_min"] : 0,
    paramMax: typeof raw["param_max"] === "number" ? raw["param_max"] : 100,
    paramStep: typeof raw["param_step"] === "number" ? raw["param_step"] : 1,
    paramMethodology: typeof raw["param_methodology"] === "string" ? raw["param_methodology"] : "",
    baselineMagnitude: typeof raw["baseline_magnitude"] === "number" ? raw["baseline_magnitude"] : 0,
  };
}

function adaptHoldingAnalysis(raw: Record<string, unknown>): HoldingAnalysis {
  const identifier = raw["holding_id"];
  const startingValue = raw["current_value"];
  const contributionDollars = raw["impact_dollars"];
  if (typeof identifier !== "string") throw new Error("holding_id missing in analysis holding");
  if (typeof startingValue !== "number") throw new Error(`current_value missing for holding ${identifier}`);
  if (typeof contributionDollars !== "number") throw new Error(`impact_dollars missing for holding ${identifier}`);
  return {
    identifier,
    name: typeof raw["name"] === "string" ? raw["name"] : identifier,
    assetClass: typeof raw["asset_class"] === "string" ? raw["asset_class"] : "",
    sector: typeof raw["sector"] === "string" ? raw["sector"] : "",
    startingValue,
    assumedReturnPercent: typeof raw["shock_percent"] === "number" ? raw["shock_percent"] : 0,
    contributionDollars,
  };
}

function adaptExplanationSource(raw: unknown): ExplanationSource {
  if (raw === "bedrock") return "bedrock";
  if (raw === "standard_explanation") return "backend-standard";
  return "unknown";
}

function adaptAnalysisResult(raw: Record<string, unknown>): AnalysisResult {
  const analysisId = raw["analysis_id"];
  const scenarioKey = raw["scenario_key"] as ScenarioKey;
  if (typeof analysisId !== "string" || analysisId === "") throw new Error("analysis_id missing");
  if (!scenarioKey) throw new Error("scenario_key missing");

  const valuationBasis = raw["valuation_basis"];
  const isPurchasingPower = valuationBasis === "real_purchasing_power";

  const base = {
    analysisId,
    scenarioKey,
    kind: (isPurchasingPower ? "purchasing-power" : "market") as "market" | "purchasing-power",
    label: typeof raw["scenario_label"] === "string" ? raw["scenario_label"] : scenarioKey,
    horizon: typeof raw["horizon"] === "string" ? raw["horizon"] : "",
    horizonType: (raw["horizon_type"] as AnalysisResult["horizonType"]) ?? undefined,
    assumptionsVersion: typeof raw["assumptions_version"] === "string" ? raw["assumptions_version"] : "",
    explanation: typeof raw["explanation"] === "string" ? raw["explanation"] : "",
    explanationSource: adaptExplanationSource(raw["explanation_source"]),
  };

  if (isPurchasingPower) {
    const nominalValue = raw["nominal_value"];
    const purchasingPowerValue = raw["scenario_value"];
    const purchasingPowerChangeDollars = raw["impact_dollars"];
    const purchasingPowerChangePercent = raw["impact_percent"];
    if (typeof nominalValue !== "number") throw new Error("nominal_value missing for inflation analysis");
    if (typeof purchasingPowerValue !== "number") throw new Error("scenario_value missing for inflation analysis");
    if (typeof purchasingPowerChangeDollars !== "number") throw new Error("impact_dollars missing for inflation analysis");
    if (typeof purchasingPowerChangePercent !== "number") throw new Error("impact_percent missing for inflation analysis");
    return {
      ...base,
      nominalValue,
      nominalReturnPercent: typeof raw["nominal_impact_percent"] === "number" ? raw["nominal_impact_percent"] : 0,
      purchasingPowerValue,
      purchasingPowerChangeDollars,
      purchasingPowerChangePercent,
    };
  }

  const currentValue = raw["current_value"];
  const scenarioValue = raw["scenario_value"];
  const impactDollars = raw["impact_dollars"];
  const impactPercent = raw["impact_percent"];
  if (typeof currentValue !== "number") throw new Error("current_value missing");
  if (typeof scenarioValue !== "number") throw new Error("scenario_value missing");
  if (typeof impactDollars !== "number") throw new Error("impact_dollars missing");
  if (typeof impactPercent !== "number") throw new Error("impact_percent missing");

  const rawHoldings = Array.isArray(raw["holdings"]) ? raw["holdings"] as Record<string, unknown>[] : [];

  return {
    ...base,
    currentValue,
    scenarioValue,
    impactDollars,
    impactPercent,
    holdings: rawHoldings.map(adaptHoldingAnalysis),
  };
}

function adaptInterpretResult(raw: Record<string, unknown>): InterpretResult {
  return {
    status: raw["status"] as InterpretResult["status"],
    scenarioKey: (raw["scenario_key"] as ScenarioKey) ?? null,
    scenarioLabel: typeof raw["scenario_label"] === "string" ? raw["scenario_label"] : null,
    horizon: typeof raw["horizon"] === "string" ? raw["horizon"] : null,
    message: typeof raw["message"] === "string" ? raw["message"] : "",
    mismatchReasons: Array.isArray(raw["mismatch_reasons"]) ? raw["mismatch_reasons"] as string[] : [],
    offeredPresets: Array.isArray(raw["offered_presets"]) ? raw["offered_presets"] as InterpretResult["offeredPresets"] : [],
    requiresConfirmation: raw["requires_confirmation"] === true,
  };
}

function adaptDiscussionRecord(raw: Record<string, unknown>): DiscussionRecord {
  const rtype = (raw["request_type"] as string) === "unmodeled_question"
    ? "unmodeled_question" as const
    : "analysis_discussion" as const;
  const scenarioDetails = raw["scenario_details"] as Record<string, unknown> | null ?? null;
  return {
    requestType: rtype,
    discussionId: typeof raw["discussion_id"] === "string" ? raw["discussion_id"] : "",
    analysisId: typeof raw["analysis_id"] === "string" ? raw["analysis_id"] : undefined,
    clientName: typeof raw["client_name"] === "string" ? raw["client_name"] : "",
    scenarioKey: typeof raw["scenario_key"] === "string" ? raw["scenario_key"] : undefined,
    scenarioLabel: typeof raw["scenario_label"] === "string" ? raw["scenario_label"] : null,
    horizon: typeof raw["horizon"] === "string" ? raw["horizon"] : undefined,
    result: rtype === "analysis_discussion" ? (raw["result"] as DiscussionRecord["result"] ?? null) : null,
    scenarioDetails: scenarioDetails && rtype === "analysis_discussion" ? {
      summary: typeof scenarioDetails["summary"] === "string" ? scenarioDetails["summary"] : null,
      explanation: typeof scenarioDetails["explanation"] === "string" ? scenarioDetails["explanation"] : null,
      explanation_source: typeof scenarioDetails["explanation_source"] === "string" ? scenarioDetails["explanation_source"] : null,
      assumption_notes: Array.isArray(scenarioDetails["assumption_notes"]) ? scenarioDetails["assumption_notes"] as string[] : [],
    } : null,
    sourceQuestion: typeof raw["source_question"] === "string" ? raw["source_question"] : null,
    question: typeof raw["question"] === "string" ? raw["question"] : null,
    clientNote: typeof raw["client_note"] === "string" ? raw["client_note"] : null,
    status: typeof raw["status"] === "string" ? raw["status"] : "",
    createdAt: typeof raw["created_at"] === "string" ? raw["created_at"] : "",
  };
}

// ---------------------------------------------------------------------------
// Public API functions
// ---------------------------------------------------------------------------

export async function getPortfolio(signal?: AbortSignal): Promise<Portfolio> {
  if (API_MODE === "mock") {
    await wait(250, signal);
    return structuredClone(portfolioFixture);
  }
  const raw = await apiFetch<Record<string, unknown>>("/api/portfolio", { signal });
  return adaptPortfolio(raw);
}

export async function getScenarios(signal?: AbortSignal): Promise<ScenarioDefinition[]> {
  if (API_MODE === "mock") {
    await wait(150, signal);
    return structuredClone(scenarioFixtures);
  }
  const raw = await apiFetch<Record<string, unknown>>("/api/scenarios", { signal });
  const list = Array.isArray(raw["scenarios"]) ? raw["scenarios"] as Record<string, unknown>[] : [];
  return list.map(adaptScenarioDefinition);
}

export async function interpretQuestion(
  question: string,
  signal?: AbortSignal,
): Promise<InterpretResult> {
  // No mock path — interpret always hits the real backend (or fails clearly).
  const raw = await apiFetch<Record<string, unknown>>("/api/interpret", {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ question }),
    signal,
  });
  return adaptInterpretResult(raw);
}

export async function analyzeScenario(
  scenarioKey: ScenarioKey,
  horizon: string,
  originalQuestion: string | null,
  customHoldings?: Array<{ holdingId: string; value: number }> | null,
  requestedMagnitude?: number | null,
  signal?: AbortSignal,
): Promise<AnalysisResult> {
  if (API_MODE === "mock") {
    await wait(650, signal);
    const fixture = (analysisFixtures as Record<string, AnalysisResult>)[scenarioKey];
    if (!fixture) throw new Error(`No mock fixture for scenario: ${scenarioKey}`);
    return structuredClone(fixture);
  }
  const body: Record<string, unknown> = {
    scenario_key: scenarioKey,
    horizon,
    confirmed: true,
  };
  if (originalQuestion) body["question"] = originalQuestion;
  if (customHoldings && customHoldings.length > 0) {
    body["custom_portfolio"] = customHoldings.map((h) => ({
      holding_id: h.holdingId,
      value: h.value,
    }));
  }
  if (requestedMagnitude != null) {
    body["requested_magnitude"] = requestedMagnitude;
  }

  const raw = await apiFetch<Record<string, unknown>>("/api/analyze", {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify(body),
    signal,
  });
  return adaptAnalysisResult(raw);
}

export async function createDiscussion(
  analysisId: string,
  signal?: AbortSignal,
): Promise<DiscussionResult> {
  const raw = await apiFetch<Record<string, unknown>>("/api/discussions", {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ analysis_id: analysisId }),
    signal,
  });
  return {
    discussionId: typeof raw["discussion_id"] === "string" ? raw["discussion_id"] : "",
    analysisId: typeof raw["analysis_id"] === "string" ? raw["analysis_id"] : "",
    status: typeof raw["status"] === "string" ? raw["status"] : "",
    createdAt: typeof raw["created_at"] === "string" ? raw["created_at"] : "",
  };
}

export async function createAdvisorQuestion(
  question: string,
  clientNote: string | null,
  idempotencyKey: string,
  signal?: AbortSignal,
): Promise<AdvisorQuestionResult> {
  const raw = await apiFetch<Record<string, unknown>>("/api/advisor-questions", {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({
      question,
      client_note: clientNote || undefined,
      idempotency_key: idempotencyKey,
    }),
    signal,
  });
  return {
    discussionId: typeof raw["discussion_id"] === "string" ? raw["discussion_id"] : "",
    status: typeof raw["status"] === "string" ? raw["status"] : "",
    createdAt: typeof raw["created_at"] === "string" ? raw["created_at"] : "",
    storageDurable: raw["storage_durable"] === true,
  };
}

export interface DiscussionListResult {
  discussions: DiscussionRecord[];
  storageBackend: string | null;
}

export async function listDiscussions(signal?: AbortSignal): Promise<DiscussionListResult> {
  const raw = await apiFetch<Record<string, unknown>>("/api/discussions", { signal });
  const items = Array.isArray(raw["discussions"]) ? raw["discussions"] as Record<string, unknown>[] : [];
  return {
    discussions: items.map(adaptDiscussionRecord),
    storageBackend: typeof raw["storage_backend"] === "string" ? raw["storage_backend"] : null,
  };
}
