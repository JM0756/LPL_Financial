/**
 * Focused tests for inflation scenario adapter and metadata validation.
 * Run with: node src/tests/inflation-adapter.test.mjs
 */

let passed = 0;
let failed = 0;

function assert(condition, label) {
  if (condition) {
    console.log(`  \u2713 ${label}`);
    passed++;
  } else {
    console.error(`  \u2717 FAIL: ${label}`);
    failed++;
  }
}

// Replicate adapter logic from api.ts
function adaptScenarioDefinition(raw) {
  const valuationBasis = typeof raw["valuation_basis"] === "string" ? raw["valuation_basis"] : "nominal_market_value";
  const paramDefault = typeof raw["param_default"] === "number" ? raw["param_default"] : null;
  const paramMin = typeof raw["param_min"] === "number" ? raw["param_min"] : null;
  const paramMax = typeof raw["param_max"] === "number" ? raw["param_max"] : null;
  const paramStep = typeof raw["param_step"] === "number" ? raw["param_step"] : null;
  const metadataValid =
    paramDefault !== null && Number.isFinite(paramDefault) &&
    paramMin !== null && Number.isFinite(paramMin) &&
    paramMax !== null && Number.isFinite(paramMax) &&
    paramStep !== null && Number.isFinite(paramStep) && paramStep > 0 &&
    paramMin <= paramDefault && paramDefault <= paramMax;
  return { key: raw["scenario_key"], paramDefault: paramDefault ?? 0, paramMin: paramMin ?? 0, paramMax: paramMax ?? 100, paramStep: paramStep ?? 1, metadataValid, kind: valuationBasis === "real_purchasing_power" ? "purchasing-power" : "market" };
}

function adaptAnalysisResult(raw) {
  const isPP = raw["valuation_basis"] === "real_purchasing_power";
  const base = {
    analysisId: raw["analysis_id"],
    scenarioKey: raw["scenario_key"],
    kind: isPP ? "purchasing-power" : "market",
    horizon: raw["horizon"],
    inflationRatePercent: typeof raw["inflation_rate_percent"] === "number" ? raw["inflation_rate_percent"] : undefined,
  };
  if (isPP) {
    return { ...base, nominalValue: raw["nominal_value"], purchasingPowerValue: raw["scenario_value"], purchasingPowerChangeDollars: raw["impact_dollars"], purchasingPowerChangePercent: raw["impact_percent"] };
  }
  return { ...base, currentValue: raw["current_value"], scenarioValue: raw["scenario_value"] };
}

function ppFormula(nominal, annualRatePct, months) {
  return nominal / Math.pow(1 + annualRatePct / 100, months / 12);
}

// --- metadata validation ---
console.log("\nTest group: metadata validation");

const inf = adaptScenarioDefinition({ scenario_key: "inflation", valuation_basis: "real_purchasing_power", param_default: 5.0, param_min: 0.0, param_max: 15.0, param_step: 0.5 });
assert(inf.metadataValid === true, "inflation param_min=0 accepted (metadataValid=true)");
assert(inf.paramMin === 0, "inflation paramMin is 0 not null");
assert(inf.kind === "purchasing-power", "inflation kind is purchasing-power");

assert(adaptScenarioDefinition({ scenario_key: "x", param_default: 5, param_min: 0, param_max: 15 }).metadataValid === false, "missing param_step -> false");
assert(adaptScenarioDefinition({ scenario_key: "x", param_default: 5, param_max: 15, param_step: 1 }).metadataValid === false, "missing param_min -> false");
assert(adaptScenarioDefinition({ scenario_key: "x", param_default: 5, param_min: 0, param_max: 15, param_step: NaN }).metadataValid === false, "NaN param_step -> false");
assert(adaptScenarioDefinition({ scenario_key: "x", param_default: 5, param_min: 0, param_max: Infinity, param_step: 1 }).metadataValid === false, "Infinity param_max -> false");
assert(adaptScenarioDefinition({ scenario_key: "x", param_default: 5, param_min: 0, param_max: 15, param_step: 0 }).metadataValid === false, "param_step=0 -> false");
assert(adaptScenarioDefinition({ scenario_key: "x", param_default: 20, param_min: 0, param_max: 15, param_step: 1 }).metadataValid === false, "default > max -> false");

// --- all six scenarios ---
console.log("\nTest group: all six scenario metadata");
const six = [
  { scenario_key: "market_crash", valuation_basis: "nominal_market_value", param_default: 20, param_min: 1, param_max: 60, param_step: 1 },
  { scenario_key: "oil_shock", valuation_basis: "nominal_market_value", param_default: 40, param_min: 5, param_max: 150, param_step: 5 },
  { scenario_key: "inflation", valuation_basis: "real_purchasing_power", param_default: 5, param_min: 0, param_max: 15, param_step: 0.5 },
  { scenario_key: "rate_rise", valuation_basis: "nominal_market_value", param_default: 1, param_min: 0.25, param_max: 5, param_step: 0.25 },
  { scenario_key: "tech_downturn", valuation_basis: "nominal_market_value", param_default: 30, param_min: 5, param_max: 80, param_step: 5 },
  { scenario_key: "international_downturn", valuation_basis: "nominal_market_value", param_default: 20, param_min: 5, param_max: 60, param_step: 5 },
];
for (const raw of six) {
  assert(adaptScenarioDefinition(raw).metadataValid === true, `${raw.scenario_key} metadataValid=true`);
}

// --- analysis result adapter ---
console.log("\nTest group: analysis result adapter");
const r = adaptAnalysisResult({ analysis_id: "an_001", scenario_key: "inflation", valuation_basis: "real_purchasing_power", horizon: "12M", nominal_value: 100000, scenario_value: 95238.10, impact_dollars: -4761.90, impact_percent: -4.76, inflation_rate_percent: 5.0 });
assert(r.inflationRatePercent === 5.0, "inflationRatePercent=5.0 extracted");
assert(r.horizon === "12M", "horizon=12M preserved");
assert(Math.abs((r.purchasingPowerValue ?? 0) - 95238.10) < 0.01, "purchasingPowerValue=95238.10");

const mr = adaptAnalysisResult({ analysis_id: "an_002", scenario_key: "market_crash", valuation_basis: "nominal_market_value", horizon: "1Y", current_value: 100000, scenario_value: 87050, impact_dollars: -12950, impact_percent: -12.95 });
assert(mr.inflationRatePercent === undefined, "non-inflation result has no inflationRatePercent");

// --- purchasing power formula ---
console.log("\nTest group: purchasing power formula");
assert(Math.abs(ppFormula(100000, 5, 12) - 95238.10) < 0.01, "5% / 12 months / $100,000 -> $95,238.10");
for (const mo of [1, 12, 24, 60]) {
  assert(Math.abs(ppFormula(100000, 0, mo) - 100000) < 0.001, `0% / ${mo} months -> $100,000 unchanged`);
}
const pp36 = ppFormula(100000, 5, 36);
assert(Math.abs(pp36 - 100000 / Math.pow(1.05, 3)) < 0.001, "5% / 36 months uses (1.05)^3");
assert(Math.abs(pp36 - 86383.76) < 0.01, "5% / 36 months -> ~$86,383.76");

// --- summary ---
console.log(`\n${passed + failed} tests: ${passed} passed, ${failed} failed`);
if (failed > 0) process.exit(1);
