import { useEffect, useRef, useState } from "react";
import {
  DEFAULT_HOLDINGS,
  HOLDING_ASSET_CLASS,
  HOLDING_LABELS,
  MAX_HOLDING_VALUE,
  SUPPORTED_HOLDING_IDS,
  resetAccountToDefault,
  updateAccountHoldings,
  validateHoldings,
  type CustomHolding,
  type DemoAccount,
  type HoldingId,
} from "../demo-storage";

type AssetClass = "Equity" | "Fixed Income" | "Cash";
const ASSET_CLASS_COLORS: Record<AssetClass, string> = {
  Equity: "#2dd4bf",      // Teal - works in both themes
  "Fixed Income": "#fbbf24", // Amber - works in both themes  
  Cash: "#94a3b8",        // Slate - works in both themes
};

interface PortfolioPageProps {
  account: DemoAccount;
  onSave: () => void;
  onDirtyChange?: (dirty: boolean) => void;
  saveRequested?: boolean;
  onExplore?: () => void;
}

interface AllocationData {
  assetClass: AssetClass;
  amount: number;
  percent: number;
}

interface DonutChartProps {
  allocations: AllocationData[];
  total: number;
}

function DonutChart({ allocations, total }: DonutChartProps) {
  const size = 140;
  const strokeWidth = 28;
  const radius = (size - strokeWidth) / 2;
  const circumference = 2 * Math.PI * radius;
  const center = size / 2;

  if (total <= 0) {
    return (
      <svg width={size} height={size} viewBox={`0 0 ${size} ${size}`} role="img" aria-label="Empty portfolio chart">
        <circle cx={center} cy={center} r={radius} fill="none" stroke="currentColor" strokeWidth={strokeWidth} style={{ color: 'var(--color-border)' }} />
      </svg>
    );
  }

  const validAllocations = allocations.filter(a => a.amount > 0);
  // Pre-compute cumulative percentages
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
      aria-label={`Portfolio allocation: ${segments.map(s => `${s.assetClass} ${s.percent.toFixed(1)}%`).join(", ")}`}
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

const currencyFormatter = new Intl.NumberFormat("en-US", {
  style: "currency",
  currency: "USD",
  maximumFractionDigits: 0,
});

/** Parse a user-typed or pasted string into a dollar amount.
 *  Accepts: "35000", "35,000", "$35,000", "$35,000.50", "1250.50"
 *  Returns NaN for anything that doesn't parse cleanly. */
function parseDollarInput(raw: string): number {
  // Strip leading $ and all commas, then trim
  const cleaned = raw.replace(/^\$/, "").replace(/,/g, "").trim();
  if (cleaned === "" || cleaned === ".") return NaN;
  const n = Number(cleaned);
  if (!Number.isFinite(n)) return NaN;
  if (n < 0) return NaN;
  // Round to nearest cent (backend uses dollar integers, but allow .50 etc.)
  return Math.round(n * 100) / 100;
}

/** Validate a single draft string. Returns error string or null. */
function validateDraft(draft: string, label: string): string | null {
  if (draft.trim() === "") return `${label}: enter a value (use 0 to exclude).`;
  const n = parseDollarInput(draft);
  if (isNaN(n)) return `${label}: not a valid dollar amount.`;
  if (n < 0) return `${label}: must be 0 or more.`;
  if (n > MAX_HOLDING_VALUE)
    return `${label}: cannot exceed ${currencyFormatter.format(MAX_HOLDING_VALUE)}.`;
  return null;
}

function savedValuesToDrafts(account: DemoAccount): Record<HoldingId, string> {
  const source = account.customHoldings
    ? Object.fromEntries(account.customHoldings.map((h) => [h.holdingId, h.value]))
    : DEFAULT_HOLDINGS;
  return Object.fromEntries(
    SUPPORTED_HOLDING_IDS.map((id) => [
      id,
      String((source as Record<string, number>)[id] ?? 0),
    ]),
  ) as Record<HoldingId, string>;
}

export function PortfolioPage({ account, onSave, onDirtyChange, saveRequested, onExplore }: PortfolioPageProps) {
  // drafts: local string state while editing — never auto-formatted while typing
  const [drafts, setDrafts] = useState<Record<HoldingId, string>>(() =>
    savedValuesToDrafts(account),
  );
  // fieldErrors: per-field validation messages
  const [fieldErrors, setFieldErrors] = useState<Partial<Record<HoldingId, string>>>({});
  // formError: overall save error
  const [formError, setFormError] = useState("");
  const [saved, setSaved] = useState(false);
  const [isDirty, setIsDirty] = useState(false);
  // Quick scale input
  const [scaleTarget, setScaleTarget] = useState("");
  const [scaleError, setScaleError] = useState("");

  // Track which field is focused so we don't select-all on re-renders
  const focusedId = useRef<HoldingId | null>(null);

  // When the account prop changes (e.g. switching portfolios), reset drafts
  useEffect(() => {
    setDrafts(savedValuesToDrafts(account));
    setFieldErrors({});
    setFormError("");
    setSaved(false);
    setIsDirty(false);
    setScaleTarget("");
    setScaleError("");
    onDirtyChange?.(false);
  }, [account.id]);

  // When parent requests a save (e.g. from unsaved guard), trigger save
  useEffect(() => {
    if (saveRequested) handleSave();
  // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [saveRequested]);

  const isCustom = account.customHoldings !== null;

  function handleChange(id: HoldingId, raw: string) {
    const cleaned = raw.replace(/[^0-9.,$ ]/g, "");
    setDrafts((prev) => ({ ...prev, [id]: cleaned }));
    setFieldErrors((prev) => ({ ...prev, [id]: undefined }));
    setFormError("");
    setSaved(false);
    setIsDirty(true);
    onDirtyChange?.(true);
  }

  function handleFocus(id: HoldingId, e: React.FocusEvent<HTMLInputElement>) {
    focusedId.current = id;
    // Select all on first focus so typing replaces the value
    e.currentTarget.select();
  }

  function handleBlur(id: HoldingId) {
    focusedId.current = null;
    // On blur, validate and show field error if needed
    const err = validateDraft(drafts[id] ?? "", HOLDING_LABELS[id]);
    if (err) {
      setFieldErrors((prev) => ({ ...prev, [id]: err }));
    }
  }

  function handleSave() {
    // Validate all fields
    const errors: Partial<Record<HoldingId, string>> = {};
    let hasError = false;
    for (const id of SUPPORTED_HOLDING_IDS) {
      const err = validateDraft(drafts[id] ?? "", HOLDING_LABELS[id]);
      if (err) {
        errors[id] = err;
        hasError = true;
      }
    }
    if (hasError) {
      setFieldErrors(errors);
      setFormError("Fix the errors above before saving.");
      return;
    }

    const holdings: CustomHolding[] = SUPPORTED_HOLDING_IDS.map((id) => ({
      holdingId: id,
      value: parseDollarInput(drafts[id] ?? "0"),
    })).filter((h) => h.value > 0);

    const err = validateHoldings(holdings);
    if (err) {
      setFormError(err);
      return;
    }

    updateAccountHoldings(account.id, holdings);
    setSaved(true);
    setIsDirty(false);
    setFormError("");
    setFieldErrors({});
    onDirtyChange?.(false);
    onSave();
  }

  function handleCancel() {
    setDrafts(savedValuesToDrafts(account));
    setFieldErrors({});
    setFormError("");
    setSaved(false);
    setIsDirty(false);
    onDirtyChange?.(false);
  }

  function handleReset() {
    resetAccountToDefault(account.id);
    const resetDrafts = savedValuesToDrafts({ ...account, customHoldings: null });
    setDrafts(resetDrafts);
    setFieldErrors({});
    setFormError("");
    setSaved(false);
    setIsDirty(false);
    setScaleTarget("");
    setScaleError("");
    onSave();
  }

  function handleQuickScale() {
    const targetTotal = parseDollarInput(scaleTarget);
    if (isNaN(targetTotal) || targetTotal <= 0) {
      setScaleError("Enter a valid dollar amount greater than $0.");
      return;
    }
    if (targetTotal > 50_000_000) {
      setScaleError("Maximum portfolio value is $50,000,000.");
      return;
    }
    
    // Get current values (from drafts or defaults)
    const currentValues: Record<HoldingId, number> = {} as Record<HoldingId, number>;
    let currentTotal = 0;
    for (const id of SUPPORTED_HOLDING_IDS) {
      const val = parseDollarInput(drafts[id] ?? "0");
      currentValues[id] = isNaN(val) ? 0 : val;
      currentTotal += currentValues[id];
    }
    
    if (currentTotal <= 0) {
      // Use default allocations if current is zero
      currentTotal = Object.values(DEFAULT_HOLDINGS).reduce((a, b) => a + b, 0);
      for (const id of SUPPORTED_HOLDING_IDS) {
        currentValues[id] = DEFAULT_HOLDINGS[id];
      }
    }
    
    // Scale proportionally
    const scaleFactor = targetTotal / currentTotal;
    const newDrafts: Record<HoldingId, string> = {} as Record<HoldingId, string>;
    for (const id of SUPPORTED_HOLDING_IDS) {
      const scaled = Math.round(currentValues[id] * scaleFactor);
      newDrafts[id] = String(scaled);
    }
    
    setDrafts(newDrafts);
    setFieldErrors({});
    setFormError("");
    setScaleError("");
    setSaved(false);
    setIsDirty(true);
    onDirtyChange?.(true);
  }

  // Compute display total from parsed drafts (best-effort; NaN treated as 0)
  const parsedTotal = SUPPORTED_HOLDING_IDS.reduce((sum, id) => {
    const n = parseDollarInput(drafts[id] ?? "0");
    return sum + (isNaN(n) ? 0 : n);
  }, 0);

  // Check if all drafts are valid
  const allDraftsValid = SUPPORTED_HOLDING_IDS.every((id) => {
    const err = validateDraft(drafts[id] ?? "", HOLDING_LABELS[id]);
    return err === null;
  });

  // Compute allocation by asset class
  const allocationByClass: AllocationData[] = (["Equity", "Fixed Income", "Cash"] as AssetClass[]).map((ac) => {
    const amount = SUPPORTED_HOLDING_IDS.reduce((sum, id) => {
      if (HOLDING_ASSET_CLASS[id] !== ac) return sum;
      const n = parseDollarInput(drafts[id] ?? "0");
      return sum + (isNaN(n) ? 0 : n);
    }, 0);
    return {
      assetClass: ac,
      amount,
      percent: parsedTotal > 0 ? (amount / parsedTotal) * 100 : 0,
    };
  });

  // Find largest holding(s)
  const holdingValues = SUPPORTED_HOLDING_IDS.map((id) => {
    const n = parseDollarInput(drafts[id] ?? "0");
    return { id, value: isNaN(n) ? 0 : n };
  });
  const maxValue = Math.max(...holdingValues.map((h) => h.value));
  const largestHoldings = holdingValues.filter((h) => h.value === maxValue && h.value > 0);

  function handleSaveAndExplore() {
    // Validate all fields
    const errors: Partial<Record<HoldingId, string>> = {};
    let hasError = false;
    for (const id of SUPPORTED_HOLDING_IDS) {
      const err = validateDraft(drafts[id] ?? "", HOLDING_LABELS[id]);
      if (err) {
        errors[id] = err;
        hasError = true;
      }
    }
    if (hasError) {
      setFieldErrors(errors);
      setFormError("Fix the errors above before saving.");
      return;
    }

    const holdings: CustomHolding[] = SUPPORTED_HOLDING_IDS.map((id) => ({
      holdingId: id,
      value: parseDollarInput(drafts[id] ?? "0"),
    })).filter((h) => h.value > 0);

    const err = validateHoldings(holdings);
    if (err) {
      setFormError(err);
      return;
    }

    updateAccountHoldings(account.id, holdings);
    setSaved(true);
    setIsDirty(false);
    setFormError("");
    setFieldErrors({});
    onDirtyChange?.(false);
    onSave();
    onExplore?.();
  }

  return (
    <div className="portfolio-page-layout">
    <section className="portfolio-page" aria-labelledby="portfolio-page-title">
      <div className="portfolio-page-header">
        <div>
          <p className="section-kicker">Customize Portfolio</p>
          <h2 id="portfolio-page-title">{account.name}</h2>
          <p className="portfolio-page-sub">
            Edit the dollar amount for each asset category. Save to apply changes to scenario analysis.
          </p>
        </div>
        {isCustom && (
          <button className="secondary-button" type="button" onClick={handleReset}>
            Reset to default
          </button>
        )}
      </div>

      {isDirty && (
        <div className="portfolio-unsaved-banner" role="status">
          <strong>Unsaved changes.</strong> Save or cancel before switching portfolios.
        </div>
      )}

      <div className="portfolio-edit-notice">
        <strong>Demo portfolio.</strong> All values are fictional. Changes are saved locally
        in your browser and do not affect real accounts.
      </div>

      <div className="portfolio-quick-scale">
        <label htmlFor="quick-scale-input">Quick scale to total:</label>
        <div className="portfolio-quick-scale-row">
          <span className="portfolio-edit-prefix" aria-hidden="true">$</span>
          <input
            id="quick-scale-input"
            type="text"
            inputMode="decimal"
            className="portfolio-quick-scale-input"
            placeholder="e.g. 250,000"
            value={scaleTarget}
            onChange={(e) => {
              setScaleTarget(e.target.value.replace(/[^0-9.,$ ]/g, ""));
              setScaleError("");
            }}
            aria-describedby={scaleError ? "scale-error" : undefined}
          />
          <button
            type="button"
            className="secondary-button"
            onClick={handleQuickScale}
          >
            Scale
          </button>
        </div>
        {scaleError && (
          <p id="scale-error" className="portfolio-field-error" role="alert">
            {scaleError}
          </p>
        )}
        <p className="portfolio-quick-scale-hint">
          Scales all holdings proportionally to reach the target total. Click Save to apply.
        </p>
      </div>

      <div className="portfolio-edit-grid">
        {SUPPORTED_HOLDING_IDS.map((id) => {
          const n = parseDollarInput(drafts[id] ?? "0");
          const pct = parsedTotal > 0 && !isNaN(n) ? (n / parsedTotal) * 100 : 0;
          const fieldErr = fieldErrors[id];
          return (
            <div key={id} className={`portfolio-edit-row${fieldErr ? " portfolio-edit-row-error" : ""}`}>
              <div className="portfolio-edit-label">
                <strong>{HOLDING_LABELS[id]}</strong>
                <span>{HOLDING_ASSET_CLASS[id]}</span>
              </div>
              <div className="portfolio-edit-input-wrap">
                <span className="portfolio-edit-prefix" aria-hidden="true">$</span>
                <input
                  type="text"
                  inputMode="decimal"
                  className="portfolio-edit-input"
                  value={drafts[id]}
                  onChange={(e) => handleChange(id, e.target.value)}
                  onFocus={(e) => handleFocus(id, e)}
                  onBlur={() => handleBlur(id)}
                  aria-label={`${HOLDING_LABELS[id]} value in dollars`}
                  aria-describedby={fieldErr ? `err-${id}` : undefined}
                  aria-invalid={!!fieldErr}
                  autoComplete="off"
                />
              </div>
              <span className="portfolio-edit-pct" aria-label={`${pct.toFixed(1)} percent`}>
                {pct.toFixed(1)}%
              </span>
              {fieldErr && (
                <p id={`err-${id}`} className="portfolio-field-error" role="alert">
                  {fieldErr}
                </p>
              )}
            </div>
          );
        })}
      </div>

      <div className="portfolio-edit-total">
        <span>Total</span>
        <strong>{currencyFormatter.format(parsedTotal)}</strong>
      </div>

      {formError && (
        <div className="error-message" role="alert">
          <strong>Cannot save</strong>
          <span>{formError}</span>
        </div>
      )}

      <div className="portfolio-edit-actions">
        <button className="primary-button" type="button" onClick={handleSave}>
          Save changes
        </button>
        {isDirty && (
          <button className="secondary-button" type="button" onClick={handleCancel}>
            Cancel
          </button>
        )}
        {saved && !isDirty && (
          <span className="portfolio-saved-note" role="status">Saved ✓</span>
        )}
      </div>

      <p className="portfolio-page-note">
        Supported categories: {SUPPORTED_HOLDING_IDS.join(", ")}. The backend calculates
        all totals, weights, and scenario impacts from the submitted holdings.
      </p>

    </section>

    <aside className="portfolio-summary-panel" aria-labelledby="summary-title">
      <div className="portfolio-summary-sticky">
        <h3 id="summary-title" className="portfolio-summary-title">Portfolio at a glance</h3>
        
        {isDirty && (
          <p className="portfolio-summary-status portfolio-summary-status-unsaved">
            Preview · Unsaved changes
          </p>
        )}
        {!isDirty && saved && (
          <p className="portfolio-summary-status portfolio-summary-status-saved">
            Saved ✓
          </p>
        )}
        {!isDirty && !saved && (
          <p className="portfolio-summary-status">
            Current saved values
          </p>
        )}

        {!allDraftsValid ? (
          <div className="portfolio-summary-invalid">
            <p>Complete valid amounts to update the summary.</p>
          </div>
        ) : parsedTotal <= 0 ? (
          <div className="portfolio-summary-invalid">
            <p>Portfolio total must be greater than zero.</p>
          </div>
        ) : (
          <>
            <div className="portfolio-summary-total">
              <span>Total value</span>
              <strong>{currencyFormatter.format(parsedTotal)}</strong>
            </div>

            <div className="portfolio-summary-chart">
              <DonutChart allocations={allocationByClass} total={parsedTotal} />
              <ul className="portfolio-summary-legend" aria-label="Asset allocation">
                {allocationByClass.map((alloc) => (
                  <li key={alloc.assetClass}>
                    <span
                      className="portfolio-legend-dot"
                      style={{ background: ASSET_CLASS_COLORS[alloc.assetClass] }}
                      aria-hidden="true"
                    />
                    <span className="portfolio-legend-label">{alloc.assetClass}</span>
                    <span className="portfolio-legend-values">
                      <strong>{currencyFormatter.format(alloc.amount)}</strong>
                      <span>{alloc.percent.toFixed(1)}%</span>
                    </span>
                  </li>
                ))}
              </ul>
            </div>

            <div className="portfolio-summary-largest">
              <span className="portfolio-summary-largest-label">Largest holding</span>
              {largestHoldings.length === 1 ? (
                <div className="portfolio-summary-largest-value">
                  <strong>{HOLDING_LABELS[largestHoldings[0].id]}</strong>
                  <span>
                    {currencyFormatter.format(largestHoldings[0].value)} · {((largestHoldings[0].value / parsedTotal) * 100).toFixed(1)}%
                  </span>
                </div>
              ) : largestHoldings.length > 1 ? (
                <div className="portfolio-summary-largest-value">
                  <strong>{largestHoldings.length} holdings tied</strong>
                  <span>
                    {currencyFormatter.format(maxValue)} each · {((maxValue / parsedTotal) * 100).toFixed(1)}% each
                  </span>
                </div>
              ) : (
                <div className="portfolio-summary-largest-value">
                  <span>No holdings</span>
                </div>
              )}
            </div>
          </>
        )}

        {onExplore && (
          <div className="portfolio-summary-actions">
            {isDirty ? (
              <button
                className="primary-button portfolio-summary-btn"
                type="button"
                onClick={handleSaveAndExplore}
                disabled={!allDraftsValid || parsedTotal <= 0}
              >
                Save & explore scenarios
              </button>
            ) : (
              <button
                className="primary-button portfolio-summary-btn"
                type="button"
                onClick={onExplore}
              >
                Explore scenarios
              </button>
            )}
          </div>
        )}
      </div>
    </aside>
    </div>
  );
}
