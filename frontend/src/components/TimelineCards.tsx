import type { AnalysisResult, ScenarioDefinition } from "../types";

interface TimelineCardsProps {
  result: AnalysisResult;
  scenario: ScenarioDefinition;
}

type Assessment = "adverse" | "mixed" | "favorable" | "neutral";

interface TimelineCard {
  periodKey: string;
  label: string;
  timeframe: string;
  assessment: Assessment;
  calculationStatus: "calculated" | "qualitative";
  explanation: string;
  drivers: string[];
  calculatedValues?: {
    label: string;
    value: string;
    sub?: string;
  }[];
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

function assessmentFromImpact(dollars: number): Assessment {
  if (dollars < -500) return "adverse";
  if (dollars > 500) return "favorable";
  return "neutral";
}

// Deterministic fallback content per scenario and period
const FALLBACK: Record<string, Record<string, { explanation: string; drivers: string[] }>> = {
  market_crash: {
    immediate: {
      explanation: "A broad equity sell-off reprices the portfolio immediately. Equity sleeves bear the largest losses; high-quality bonds partially offset the decline.",
      drivers: ["Equity beta is the dominant detractor", "Investment-grade bonds act as a partial shock absorber"],
    },
    short_term: {
      explanation: "In the 1–2 years following a market crash, outcomes depend on whether the underlying economic stress persists, deepens, or begins to ease. Credit conditions, central bank policy, and corporate earnings revisions are key uncertainties.",
      drivers: ["Policy response and credit availability", "Earnings revision cycle and corporate fundamentals"],
    },
    long_term: {
      explanation: "Over 3–5 years, the portfolio's trajectory depends on structural factors this model does not capture: rebalancing, contributions, withdrawals, taxes, and fees. Historical crashes have varied widely in recovery duration. This model does not project recovery.",
      drivers: ["Structural economic factors not modelled here", "Portfolio rebalancing and investor behaviour"],
    },
  },
  oil_shock: {
    immediate: {
      explanation: "A sustained oil price spike benefits the energy sleeve while weighing on the rest of the portfolio through higher input costs and margin pressure. The net effect is near-flat.",
      drivers: ["Energy sector equity is the dominant contributor", "Broad equities face modest headwinds from input costs"],
    },
    short_term: {
      explanation: "Over 1–2 years, the persistence of elevated oil prices is the key uncertainty. If prices normalise, the energy gain may reverse. If they remain elevated, broader inflation pass-through could affect bond valuations further.",
      drivers: ["Duration of the oil price elevation", "Inflation pass-through to bond yields"],
    },
    long_term: {
      explanation: "Over 3–5 years, energy transition dynamics, geopolitical factors, and demand shifts introduce significant uncertainty. This model does not project commodity prices or their long-run portfolio effects.",
      drivers: ["Energy transition and demand-side shifts", "Geopolitical supply factors"],
    },
  },
  inflation: {
    immediate: {
      explanation: "Under this purchasing-power illustration, no market move occurs at the moment of the shock. Nominal values are held flat. Purchasing-power erosion accumulates over time rather than occurring as an instantaneous loss.",
      drivers: ["No immediate market repricing in this model", "Erosion is a function of time and the assumed inflation rate"],
    },
    short_term: {
      explanation: "Over 1–2 years, sustained inflation erodes the real value of nominally flat holdings. The calculation uses the backend purchasing-power formula at each checkpoint.",
      drivers: ["Cumulative price-level rise reduces real purchasing power", "Inflation-linked holdings (TIPS) may partially offset erosion in practice"],
    },
    long_term: {
      explanation: "Over 3–5 years, compounding inflation has a larger effect on purchasing power. This model holds nominal returns at zero throughout; actual portfolios would include returns, contributions, and rebalancing not modelled here.",
      drivers: ["Compounding effect of sustained inflation", "Nominal returns, contributions, and fees are excluded from this illustration"],
    },
  },
  rate_rise: {
    immediate: {
      explanation: "An immediate rate repricing reduces the market value of fixed-income holdings and weighs on rate-sensitive equities. Cash is unaffected.",
      drivers: ["Fixed-income duration drives the largest losses", "Technology equity is the most rate-sensitive equity sleeve"],
    },
    short_term: {
      explanation: "Over 1–2 years, the path of rates is the key uncertainty. If rates stabilise, fixed-income prices may recover as bonds approach maturity. If rates rise further, additional losses could accumulate.",
      drivers: ["Future rate path and central bank policy", "Fixed-income maturity profile and reinvestment rates"],
    },
    long_term: {
      explanation: "Over 3–5 years, higher rates may benefit new bond purchases through higher yields, but this model does not capture reinvestment, maturity roll, or income. The long-run effect depends on factors not modelled here.",
      drivers: ["Reinvestment yield benefit not captured in this model", "Duration shortening over time not modelled"],
    },
  },
  tech_downturn: {
    immediate: {
      explanation: "A technology sector repricing hits the tech sleeve hardest and spills over into broad US equity. High-quality bonds provide a partial offset.",
      drivers: ["Technology sleeve is the dominant detractor", "US large-cap equity falls on sector spillover"],
    },
    short_term: {
      explanation: "Over 1–2 years, the depth and duration of the technology downturn depend on valuation re-rating, earnings revisions, and whether the sell-off spreads to other sectors.",
      drivers: ["Earnings revision cycle in technology", "Contagion risk to other growth sectors"],
    },
    long_term: {
      explanation: "Over 3–5 years, technology sector dynamics are highly uncertain. This model does not project sector rotation, innovation cycles, or recovery timelines.",
      drivers: ["Sector rotation and innovation cycle", "Regulatory and competitive landscape changes"],
    },
  },
  international_downturn: {
    immediate: {
      explanation: "A repricing of international developed equity is the dominant driver. US equities fall modestly on global contagion. Bonds provide a small offset.",
      drivers: ["International developed equity sleeve is the dominant detractor", "US equities face modest contagion pressure"],
    },
    short_term: {
      explanation: "Over 1–2 years, the recovery of international markets depends on the underlying cause of the downturn, currency movements, and policy responses in affected regions.",
      drivers: ["Underlying cause and policy response in affected regions", "Currency effects on international holdings"],
    },
    long_term: {
      explanation: "Over 3–5 years, international diversification effects and structural economic factors introduce significant uncertainty. This model does not project currency returns or regional economic cycles.",
      drivers: ["Regional economic and political factors", "Currency and diversification effects not modelled"],
    },
  },
};

function getPurchasingPowerAtMonths(
  nominalValue: number,
  annualRatePercent: number,
  months: number,
): number {
  const rate = annualRatePercent / 100;
  return nominalValue / Math.pow(1 + rate, months / 12);
}

function buildCards(result: AnalysisResult, scenario: ScenarioDefinition): TimelineCard[] {
  const fallback = FALLBACK[result.scenarioKey] ?? FALLBACK["market_crash"];
  const isPP = result.kind === "purchasing-power";

  if (isPP) {
    // Inflation: use backend formula at checkpoints
    const nominal = result.nominalValue ?? 100000;
    // Use the actual rate from the analysis result; fall back to scenario default
    const annualRate = result.inflationRatePercent ?? scenario.paramDefault; // e.g. 5.0

    const pp1y = getPurchasingPowerAtMonths(nominal, annualRate, 12);
    const pp2y = getPurchasingPowerAtMonths(nominal, annualRate, 24);
    const pp3y = getPurchasingPowerAtMonths(nominal, annualRate, 36);
    const pp5y = getPurchasingPowerAtMonths(nominal, annualRate, 60);

    return [
      {
        periodKey: "immediate",
        label: "Immediate impact",
        timeframe: "At the shock",
        assessment: "neutral",
        calculationStatus: "qualitative",
        explanation: fallback.immediate.explanation,
        drivers: fallback.immediate.drivers,
        calculatedValues: [
          { label: "Nominal value (unchanged)", value: wholeDollar.format(nominal), sub: "Nominal return held at 0%" },
          { label: "No elapsed-time change yet", value: "—", sub: "Erosion accumulates over time" },
        ],
      },
      {
        periodKey: "short_term",
        label: "Short-term outlook",
        timeframe: "1–2 years",
        assessment: "adverse",
        calculationStatus: "calculated",
        explanation: `At ${annualRate}% annual inflation, purchasing power erodes to approximately ${twoCents.format(pp1y)} after 1 year and ${twoCents.format(pp2y)} after 2 years. These are today's purchasing-power equivalents, not nominal investment losses.`,
        drivers: fallback.short_term.drivers,
        calculatedValues: [
          { label: "Purchasing power at 1 year", value: twoCents.format(pp1y), sub: signedCurrency(pp1y - nominal, true) },
          { label: "Purchasing power at 2 years", value: twoCents.format(pp2y), sub: signedCurrency(pp2y - nominal, true) },
        ],
      },
      {
        periodKey: "long_term",
        label: "Long-term outlook",
        timeframe: "3–5 years",
        assessment: "adverse",
        calculationStatus: "calculated",
        explanation: `At ${annualRate}% annual inflation, purchasing power falls to approximately ${twoCents.format(pp3y)} after 3 years and ${twoCents.format(pp5y)} after 5 years. Nominal returns, contributions, withdrawals, taxes, and fees are excluded from this illustration.`,
        drivers: fallback.long_term.drivers,
        calculatedValues: [
          { label: "Purchasing power at 3 years", value: twoCents.format(pp3y), sub: signedCurrency(pp3y - nominal, true) },
          { label: "Purchasing power at 5 years", value: twoCents.format(pp5y), sub: signedCurrency(pp5y - nominal, true) },
        ],
      },
    ];
  }

  // Asset-shock scenarios
  const impact = result.impactDollars ?? 0;
  const immediateAssessment = assessmentFromImpact(impact);

  return [
    {
      periodKey: "immediate",
      label: "Immediate impact",
      timeframe: "At the shock",
      assessment: immediateAssessment,
      calculationStatus: "calculated",
      explanation: fallback.immediate.explanation,
      drivers: fallback.immediate.drivers,
      calculatedValues: [
        { label: "Portfolio value", value: wholeDollar.format(result.scenarioValue ?? 0), sub: `from ${wholeDollar.format(result.currentValue ?? 0)}` },
        { label: "Change", value: signedCurrency(impact), sub: signedPct(result.impactPercent ?? 0) },
      ],
    },
    {
      periodKey: "short_term",
      label: "Short-term outlook",
      timeframe: "1–2 years",
      assessment: "mixed",
      calculationStatus: "qualitative",
      explanation: fallback.short_term.explanation,
      drivers: fallback.short_term.drivers,
    },
    {
      periodKey: "long_term",
      label: "Long-term outlook",
      timeframe: "3–5 years",
      assessment: "mixed",
      calculationStatus: "qualitative",
      explanation: fallback.long_term.explanation,
      drivers: fallback.long_term.drivers,
    },
  ];
}

const ASSESSMENT_CONFIG: Record<Assessment, { label: string; icon: string; className: string }> = {
  adverse: { label: "Adverse", icon: "↓", className: "timeline-card-adverse" },
  mixed: { label: "Mixed / uncertain", icon: "~", className: "timeline-card-mixed" },
  favorable: { label: "Favorable", icon: "↑", className: "timeline-card-favorable" },
  neutral: { label: "Neutral", icon: "→", className: "timeline-card-neutral" },
};

export function TimelineCards({ result, scenario }: TimelineCardsProps) {
  const cards = buildCards(result, scenario);

  return (
    <section className="timeline-section" aria-labelledby="timeline-title">
      <h3 id="timeline-title" className="timeline-heading">What this could mean over time</h3>
      <div className="timeline-cards-grid">
        {cards.map((card) => {
          const cfg = ASSESSMENT_CONFIG[card.assessment];
          return (
            <div key={card.periodKey} className={`timeline-card ${cfg.className}`}>
              <div className="timeline-card-header">
                <div>
                  <span className="timeline-card-label">{card.label}</span>
                  <span className="timeline-card-timeframe">{card.timeframe}</span>
                </div>
                <span className={`timeline-assessment-badge timeline-assessment-${card.assessment}`} aria-label={cfg.label}>
                  <span aria-hidden="true">{cfg.icon}</span> {cfg.label}
                </span>
              </div>

              {card.calculatedValues && (
                <div className="timeline-card-values">
                  {card.calculatedValues.map((cv) => (
                    <div key={cv.label} className="timeline-card-value">
                      <span className="timeline-value-label">{cv.label}</span>
                      <strong className="timeline-value-number">{cv.value}</strong>
                      {cv.sub && <span className="timeline-value-sub">{cv.sub}</span>}
                    </div>
                  ))}
                </div>
              )}

              {card.calculationStatus === "qualitative" && !card.calculatedValues && (
                <p className="timeline-qualitative-label">Qualitative outlook — not a calculated return</p>
              )}

              <p className="timeline-card-explanation">{card.explanation}</p>

              {card.drivers.length > 0 && (
                <ul className="timeline-card-drivers">
                  {card.drivers.map((d) => (
                    <li key={d}>{d}</li>
                  ))}
                </ul>
              )}
            </div>
          );
        })}
      </div>
      <p className="timeline-disclosure">
        Short- and long-term cards are qualitative outlooks, not calculated returns. No recovery, further growth, income, or additional shocks are modelled beyond the immediate shock.
      </p>
    </section>
  );
}
