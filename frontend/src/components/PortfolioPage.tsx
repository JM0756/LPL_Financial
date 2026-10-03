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

interface PortfolioPageProps {
  account: DemoAccount;
  onSave: () => void;
  onDirtyChange?: (dirty: boolean) => void;
  saveRequested?: boolean;
  onExplore?: () => void;
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

  // Track which field is focused so we don't select-all on re-renders
  const focusedId = useRef<HoldingId | null>(null);

  // When the account prop changes (e.g. switching portfolios), reset drafts
  useEffect(() => {
    setDrafts(savedValuesToDrafts(account));
    setFieldErrors({});
    setFormError("");
    setSaved(false);
    setIsDirty(false);
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
    onSave();
  }

  // Compute display total from parsed drafts (best-effort; NaN treated as 0)
  const parsedTotal = SUPPORTED_HOLDING_IDS.reduce((sum, id) => {
    const n = parseDollarInput(drafts[id] ?? "0");
    return sum + (isNaN(n) ? 0 : n);
  }, 0);

  return (
    <section className="portfolio-page" aria-labelledby="portfolio-page-title">
      <div className="portfolio-page-header">
        <div>
          <p className="section-kicker">Holdings</p>
          <h2 id="portfolio-page-title">{account.name}</h2>
          <p className="portfolio-page-sub">
            Edit the dollar amount for each asset category. Only the seven modelled
            categories are supported. Save to apply changes to scenario analysis.
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

      {onExplore && (
        <div className="portfolio-explore-cta">
          <button
            className="primary-button"
            type="button"
            onClick={onExplore}
            disabled={isDirty}
          >
            Explore scenarios →
          </button>
          {isDirty && (
            <p className="portfolio-explore-hint">Save your changes first to use them in analysis.</p>
          )}
        </div>
      )}
    </section>
  );
}
