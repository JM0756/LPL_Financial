import type { HoldingAnalysis } from "../types";

interface HoldingContributionsProps {
  holdings: HoldingAnalysis[];
}

const currencyFormatter = new Intl.NumberFormat("en-US", {
  style: "currency",
  currency: "USD",
  maximumFractionDigits: 0,
});

function formatSignedCurrency(value: number): string {
  if (value === 0) return "$0";
  return `${value > 0 ? "+" : "−"}${currencyFormatter.format(Math.abs(value))}`;
}

function formatSignedPercent(value: number): string {
  if (value === 0) return "0%";
  return `${value > 0 ? "+" : "−"}${Math.abs(value).toFixed(1)}%`;
}

export function HoldingContributions({ holdings }: HoldingContributionsProps) {
  const largestContribution = Math.max(
    ...holdings.map((h) => Math.abs(h.contributionDollars)),
    1,
  );

  return (
    <section className="contribution-section" aria-labelledby="contribution-title">
      <div className="result-section-heading">
        <div>
          <p className="section-kicker">Holding attribution</p>
          <h3 id="contribution-title">What drove the change?</h3>
        </div>
        <span className="zero-line-key">Center line = $0</span>
      </div>

      <div
        className="contribution-chart"
        role="img"
        aria-label="Horizontal chart showing each holding's contribution to the portfolio change. Negative contributions extend left of zero and positive contributions extend right."
      >
        {holdings.map((holding) => {
          const width = (Math.abs(holding.contributionDollars) / largestContribution) * 48;
          const isNegative = holding.contributionDollars < 0;
          const isPositive = holding.contributionDollars > 0;

          return (
            <div className="contribution-row" key={holding.identifier}>
              <div className="contribution-label">
                <strong>{holding.name}</strong>
                <span>{holding.assetClass}</span>
              </div>

              <div className="contribution-track" aria-hidden="true">
                <span className="chart-zero-line" />
                {(isNegative || isPositive) && (
                  <span
                    className={`contribution-bar ${isNegative ? "contribution-bar-negative" : "contribution-bar-positive"}`}
                    style={{
                      width: `${width}%`,
                      ...(isNegative ? { right: "50%" } : { left: "50%" }),
                    }}
                  />
                )}
                {!isNegative && !isPositive && <span className="zero-marker" />}
              </div>

              <strong
                className={
                  holding.contributionDollars < 0
                    ? "number-negative"
                    : holding.contributionDollars > 0
                      ? "number-positive"
                      : ""
                }
              >
                {formatSignedCurrency(holding.contributionDollars)}
              </strong>
            </div>
          );
        })}
      </div>

      <div className="table-scroll">
        <table className="holding-table">
          <caption>Holding-level scenario assumptions and contributions</caption>
          <thead>
            <tr>
              <th scope="col">Holding</th>
              <th scope="col">Starting value</th>
              <th scope="col">Assumed return</th>
              <th scope="col">Contribution</th>
            </tr>
          </thead>
          <tbody>
            {holdings.map((holding) => (
              <tr key={holding.identifier}>
                <th scope="row">
                  <strong>{holding.name}</strong>
                  <span>{holding.sector}</span>
                </th>
                <td>{currencyFormatter.format(holding.startingValue)}</td>
                <td>{formatSignedPercent(holding.assumedReturnPercent)}</td>
                <td>
                  <strong>{formatSignedCurrency(holding.contributionDollars)}</strong>
                </td>
              </tr>
            ))}
          </tbody>
        </table>
      </div>
    </section>
  );
}
