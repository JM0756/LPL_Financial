/**
 * Focused tests for inflation scenario adapter and metadata validation.
 * Tests use the actual API response shape: top-level param_default/param_min/param_max/param_step.
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

// --- actual API response shape (top-level param_* fields) ---
console.log("\nTest group: actual API response shape (top-level param_* fields)");

// These objects mirror what scenario_catalog() now emits after the fix.
const apiShapeFixtures = [
  { scenario_key: "market_crash",          valuation_basis: "nominal_market_value",  param_label: "Market decline (%)",                  param_unit: "percent",            param_default: 20.0, param_min: 1.0,   param_max: 60.0,  param_step: 1.0  },
  { scenario_key: "oil_shock",             valuation_basis: "nominal_market_value",  param_label: "Crude oil price increase (%)",         param_unit: "percent",            param_default: 40.0, param_min: 5.0,   param_max: 150.0, param_step: 5.0  },
  { scenario_key: "inflation",             valuation_basis: "real_purchasing_power", param_label: "Annual inflation rate (%)",            param_unit: "percent",            param_default: 5.0,  param_min: 0.0,   param_max: 15.0,  param_step: 0.5  },
  { scenario_key: "rate_rise",             valuation_basis: "nominal_market_value",  param_label: "Rate increase (percentage points)",    param_unit: "percentage_points",  param_default: 1.0,  param_min: 0.25,  param_max: 5.0,   param_step: 0.25 },
  { scenario_key: "tech_downturn",         valuation_basis: "nominal_market_value",  param_label: "Technology sector decline (%)",        param_unit: "percent",            param_default: 30.0, param_min: 5.0,   param_max: 80.0,  param_step: 5.0  },
  { scenario_key: "international_downturn",valuation_basis: "nominal_market_value",  param_label: "International equity decline (%)",     param_unit: "percent",            param_default: 20.0, param_min: 5.0,   param_max: 60.0,  param_step: 5.0  },
];

for (const raw of apiShapeFixtures) {
  const adapted = adaptScenarioDefinition(raw);
  assert(adapted.metadataValid === true, `${raw.scenario_key}: top-level param_* fields -> metadataValid=true`);
  assert(adapted.paramDefault === raw.param_default, `${raw.scenario_key}: paramDefault=${raw.param_default}`);
  assert(adapted.paramMin === raw.param_min, `${raw.scenario_key}: paramMin=${raw.param_min}`);
  assert(adapted.paramMax === raw.param_max, `${raw.scenario_key}: paramMax=${raw.param_max}`);
  assert(adapted.paramStep === raw.param_step, `${raw.scenario_key}: paramStep=${raw.param_step}`);
}

// Verify nested "parameters" object (old broken shape) does NOT produce valid metadata
console.log("\nTest group: old nested shape must NOT pass validation");
const oldBrokenShape = { scenario_key: "international_downturn", valuation_basis: "nominal_market_value", parameters: { default: 20, min: 15, max: 25, step: 1 } };
assert(adaptScenarioDefinition(oldBrokenShape).metadataValid === false, "nested parameters object -> metadataValid=false (old broken shape)");

// --- metadata validation edge cases ---
console.log("\nTest group: metadata validation edge cases");

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
