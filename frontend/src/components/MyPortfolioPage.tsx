import {
  DEFAULT_HOLDINGS,
  HOLDING_ASSET_CLASS,
  HOLDING_LABELS,
  SUPPORTED_HOLDING_IDS,
  type DemoAccount,
} from "../demo-storage";

type AssetClass = "Equity" | "Fixed Income" | "Cash";
const ASSET_CLASS_COLORS: Record<AssetClass, string> = {
  Equity: "#2dd4bf",
  "Fixed Income": "#fbbf24",
  Cash: "#94a3b8",
};

interface MyPortfolioPageProps {
  account: DemoAccount;
  onExplore: () => void;
  onCustomize: () => void;
}

interface AllocationData {
  assetClass: AssetClass;
  amount: number;
  percent: number;
}

const currencyFormatter = new Intl.NumberFormat("en-US", {
  style: "currency",
  currency: "USD",
  maximumFractionDigits: 0,
});

function DonutChart({ allocations, total }: { allocations: AllocationData[]; total: number }) {
  const size = 180;
  const strokeWidth = 32;
  const radius = (size - strokeWidth) / 2;
  const circumference = 2 * Math.PI * radius;
  const center = size / 2;

  if (total <= 0) {
    return (
      <svg width={size} height={size} viewBox={`0 0 ${size} ${size}`} role="img" aria-label="Empty portfolio chart">
        <circle cx={center} cy={center} r={radius} fill="none" stroke="currentColor" strokeWidth={strokeWidth} style={{ color: "var(--color-border)" }} />
      </svg>
    );
  }

  const validAllocations = allocations.filter((a) => a.amount > 0);
  const cumulativePcts = validAllocations.reduce<number[]>((acc, _, i) => {
    acc.push(i === 0 ? 0 : acc[i - 1] + validAllocations[i - 1].amount / total);
    return acc;
  }, []);

  const segments = validAllocations.map((alloc, i) => {
    const dashLength = (alloc.amount / total) * circumference;
    const dashOffset = -cumulativePcts[i] * circumference;
    return { ...alloc, dashLength, dashOffset };
  });

  return (
    <svg
      width={size}
      height={size}
      viewBox={`0 0 ${size} ${size}`}
      role="img"
      aria-label={`Portfolio allocation: ${segments.map((s) => `${s.assetClass} ${s.percent.toFixed(1)}%`).join(", ")}`}
      style={{ transform: "rotate(-90deg)" }}
    >
      {segments.map((seg) => (
        <circle
          key={seg.assetClass}
          cx={center}
          cy={center}
          r={radius}
          fill="none"
          stroke={ASSET_CLASS_COLORS[seg.assetClass]}
          strokeWidth={strokeWidth}
          strokeDasharray={`${seg.dashLength} ${circumference - seg.dashLength}`}
          strokeDashoffset={seg.dashOffset}
          strokeLinecap="butt"
        />
      ))}
    </svg>
  );
}

export function MyPortfolioPage({ account, onExplore, onCustomize }: MyPortfolioPageProps) {
  const isCustom = account.customHoldings !== null;
  const source = isCustom
    ? Object.fromEntries(account.customHoldings!.map((h) => [h.holdingId, h.value]))
    : DEFAULT_HOLDINGS;

  const holdings = SUPPORTED_HOLDING_IDS.map((id) => ({
    id,
    name: HOLDING_LABELS[id],
    assetClass: HOLDING_ASSET_CLASS[id] as AssetClass,
    value: (source as Record<string, number>)[id] ?? 0,
  })).filter((h) => h.value > 0);

  const total = holdings.reduce((sum, h) => sum + h.value, 0);

  const allocationByClass: AllocationData[] = (["Equity", "Fixed Income", "Cash"] as AssetClass[]).map((ac) => {
    const amount = holdings.filter((h) => h.assetClass === ac).reduce((sum, h) => sum + h.value, 0);
    return {
      assetClass: ac,
      amount,
      percent: total > 0 ? (amount / total) * 100 : 0,
    };
  });

  // Find largest holding(s)
  const maxValue = Math.max(...holdings.map((h) => h.value), 0);
  const largestHoldings = holdings.filter((h) => h.value === maxValue && h.value > 0);

  return (
    <div className="my-portfolio-page">
      <section className="my-portfolio-header" aria-labelledby="my-portfolio-title">
        <div>
          <p className="section-kicker">My Portfolio</p>
          <h1 id="my-portfolio-title">{account.name}</h1>
          <p className="my-portfolio-subtitle">
            {isCustom ? "Your saved custom portfolio" : "Synthetic demo portfolio"}
          </p>
        </div>
        <span className="portfolio-badge">{isCustom ? "Custom" : "Demo"}</span>
      </section>

      <div className="my-portfolio-grid">
        <div className="my-portfolio-chart-section">
          <div className="my-portfolio-total">
            <span>Total value</span>
            <strong>{currencyFormatter.format(total)}</strong>
          </div>

          <div className="my-portfolio-chart-wrap">
            <DonutChart allocations={allocationByClass} total={total} />
          </div>

          <div className="my-portfolio-legend" role="list" aria-label="Asset allocation by class">
            {allocationByClass.map((alloc) => (
              <div key={alloc.assetClass} className="my-portfolio-legend-item" role="listitem">
                <span
                  className="my-portfolio-legend-dot"
                  style={{ background: ASSET_CLASS_COLORS[alloc.assetClass] }}
                  aria-hidden="true"
                />
                <span className="my-portfolio-legend-label">{alloc.assetClass}</span>
                <span className="my-portfolio-legend-value">
                  <strong>{currencyFormatter.format(alloc.amount)}</strong>
                  <span>{alloc.percent.toFixed(1)}%</span>
                </span>
              </div>
            ))}
          </div>

          {largestHoldings.length > 0 && (
            <div className="my-portfolio-largest">
              <span className="my-portfolio-largest-label">Largest holding</span>
              {largestHoldings.length === 1 ? (
                <div className="my-portfolio-largest-value">
                  <strong>{largestHoldings[0].name}</strong>
                  <span>
                    {currencyFormatter.format(largestHoldings[0].value)} ·{" "}
                    {total > 0 ? ((largestHoldings[0].value / total) * 100).toFixed(1) : 0}%
                  </span>
                </div>
              ) : (
                <div className="my-portfolio-largest-value">
                  <strong>{largestHoldings.length} holdings tied</strong>
                  <span>
                    {currencyFormatter.format(maxValue)} each ·{" "}
                    {total > 0 ? ((maxValue / total) * 100).toFixed(1) : 0}% each
                  </span>
                </div>
              )}
            </div>
          )}
        </div>

        <div className="my-portfolio-holdings-section">
          <h2 className="my-portfolio-holdings-title">Holdings</h2>
          <ul className="my-portfolio-holdings-list" aria-label="Portfolio holdings">
            {holdings.map((h) => (
              <li key={h.id} className="my-portfolio-holding-row">
                <div className="my-portfolio-holding-info">
                  <strong>{h.name}</strong>
                  <span>{h.assetClass}</span>
                </div>
                <div className="my-portfolio-holding-value">
                  <strong>{currencyFormatter.format(h.value)}</strong>
                  <span>{total > 0 ? ((h.value / total) * 100).toFixed(1) : 0}%</span>
                </div>
              </li>
            ))}
          </ul>
        </div>
      </div>

      <div className="my-portfolio-actions">
        <button className="primary-button" type="button" onClick={onExplore}>
          Explore scenarios
        </button>
        <button className="secondary-button" type="button" onClick={onCustomize}>
          Customize portfolio
        </button>
      </div>

      <p className="my-portfolio-disclosure">
        {isCustom
          ? "Custom portfolio saved in your browser. Changes are local and not synced."
          : "This fictional portfolio is used consistently across all WealthLens demonstrations."}
        {" "}All values are illustrative only.
      </p>
    </div>
  );
}
