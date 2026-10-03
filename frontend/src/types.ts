// ---------------------------------------------------------------------------
// Canonical scenario keys — must match backend scenarios.py SCENARIO_KEYS
// ---------------------------------------------------------------------------
export type ScenarioKey =
  | "market_crash"
  | "oil_shock"
  | "inflation"
  | "rate_rise"
  | "tech_downturn"
  | "international_downturn";
export type ScenarioKind = "market" | "purchasing-power";
export type ExplanationSource = "bedrock" | "backend-standard" | "unknown";

// ---------------------------------------------------------------------------
// Portfolio — adapted from backend portfolio_payload()
// ---------------------------------------------------------------------------
export interface PortfolioHolding {
  /** Backend holding_id, e.g. "US_LARGE_CAP" */
  identifier: string;
  name: string;
  assetClass: string;
  sector: string;
  value: number;
  /** Weight as a percentage, e.g. 35.00 means 35% */
  allocation: number;
}

export interface Portfolio {
  id: string;
  name: string;
  totalValue: number;
  currency: string;
  asOf: string;
  assumptionsVersion: string;
  holdings: PortfolioHolding[];
}

// ---------------------------------------------------------------------------
// Scenario catalog — adapted from backend scenario_catalog()
// ---------------------------------------------------------------------------
export interface ScenarioDefinition {
  key: ScenarioKey;
  label: string;
  summary: string;
  horizon: string;
  direction: string;
  magnitudeLabel: string;
  valuationBasis: string;
  assumptionsVersion: string;
  /** Human-readable assumption bullets from backend */
  assumptionNotes: string[];
  kind: ScenarioKind;
  // Editable parameter metadata
  paramLabel: string;
  paramUnit: string;
  paramDefault: number;
  paramMin: number;
  paramMax: number;
  paramStep: number;
  paramMethodology: string;
  baselineMagnitude: number;
  /** False if required parameter metadata was missing from the backend response */
  metadataValid?: boolean;
}

// ---------------------------------------------------------------------------
// Holding-level analysis — adapted from backend engine.py holdings[]
// ---------------------------------------------------------------------------
export interface HoldingAnalysis {
  /** Backend holding_id */
  identifier: string;
  name: string;
  assetClass: string;
  sector: string;
  startingValue: number;
  /** shock_percent from backend, e.g. -20.00 means -20% */
  assumedReturnPercent: number;
  /** impact_dollars: scenario_value - current_value for this holding */
  contributionDollars: number;
}

// ---------------------------------------------------------------------------
// Analysis result — adapted from backend engine.analyze()
// ---------------------------------------------------------------------------
export interface AnalysisResult {
  analysisId: string;
  scenarioKey: ScenarioKey;
  kind: ScenarioKind;
  label: string;
  horizon: string;
  horizonType?: "immediate_shock" | "purchasing_power_illustration";
  assumptionsVersion: string;
  explanation: string;
  explanationSource: ExplanationSource;

  // market / asset_shock fields
  currentValue?: number;
  scenarioValue?: number;
  impactDollars?: number;
  impactPercent?: number;
  holdings?: HoldingAnalysis[];

  // purchasing-power fields (inflation scenario)
  nominalValue?: number;
  nominalReturnPercent?: number;
  purchasingPowerValue?: number;
  purchasingPowerChangeDollars?: number;
  purchasingPowerChangePercent?: number;
  /** Annual inflation rate percent used in the calculation, e.g. 5.0 means 5% */
  inflationRatePercent?: number;
}

// ---------------------------------------------------------------------------
// Interpret result — adapted from backend bedrock_service.Interpretation
// ---------------------------------------------------------------------------
export type InterpretStatus = "matched" | "preset_offered" | "unsupported";

export interface OfferedPreset {
  scenario_key: ScenarioKey;
  label: string;
  horizon: string;
  magnitude_label: string;
  summary: string;
  assumption_notes: string[];
}

export interface InterpretResult {
  status: InterpretStatus;
  scenarioKey: ScenarioKey | null;
  scenarioLabel: string | null;
  horizon: string | null;
  message: string;
  mismatchReasons: string[];
  offeredPresets: OfferedPreset[];
  requiresConfirmation: boolean;
}

// ---------------------------------------------------------------------------
// Discussion
// ---------------------------------------------------------------------------
export interface DiscussionResult {
  discussionId: string;
  analysisId: string;
  status: string;
  createdAt: string;
}

// Discriminated union for the advisor feed
export type FeedRecordType = "analysis_discussion" | "unmodeled_question";

export interface AdvisorQuestionResult {
  discussionId: string;
  status: string;
  createdAt: string;
  storageDurable: boolean;
}

export interface DiscussionRecord {
  requestType: FeedRecordType;
  discussionId: string;
  // analysis_discussion fields
  analysisId?: string;
  clientName: string;
  scenarioKey?: string;
  scenarioLabel?: string | null;
  horizon?: string;
  result: {
    current_value: number | null;
    scenario_value: number | null;
    impact_dollars: number | null;
    impact_percent: number | null;
    valuation_basis: string | null;
  } | null;
  scenarioDetails: {
    summary: string | null;
    explanation: string | null;
    explanation_source: string | null;
    assumption_notes: string[];
  } | null;
  sourceQuestion: string | null;
  // unmodeled_question fields
  question?: string | null;
  clientNote?: string | null;
  status: string;
  createdAt: string;
}
