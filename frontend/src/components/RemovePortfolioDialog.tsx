import { useEffect, useRef } from "react";
import type { DemoAccount } from "../demo-storage";

interface RemovePortfolioDialogProps {
  account: DemoAccount;
  hasUnsavedEdits: boolean;
  onConfirm: () => void;
  onCancel: () => void;
}

export function RemovePortfolioDialog({
  account,
  hasUnsavedEdits,
  onConfirm,
  onCancel,
}: RemovePortfolioDialogProps) {
  const cancelRef = useRef<HTMLButtonElement>(null);

  useEffect(() => {
    cancelRef.current?.focus();
    const handleEscape = (e: KeyboardEvent) => {
      if (e.key === "Escape") onCancel();
    };
    document.addEventListener("keydown", handleEscape);
    return () => document.removeEventListener("keydown", handleEscape);
  }, [onCancel]);

  return (
    <div
      className="remove-portfolio-overlay"
      role="dialog"
      aria-modal="true"
      aria-labelledby="remove-dialog-title"
      aria-describedby="remove-dialog-desc"
    >
      <div className="remove-portfolio-card">
        <h2 id="remove-dialog-title" className="remove-portfolio-title">
          Remove "{account.name}"?
        </h2>
        <p id="remove-dialog-desc" className="remove-portfolio-body">
          This will permanently remove the saved holdings for this portfolio.
          {hasUnsavedEdits && (
            <strong className="remove-portfolio-unsaved-warning">
              {" "}You have unsaved edits that will also be discarded.
            </strong>
          )}
        </p>
        <p className="remove-portfolio-note">
          This action cannot be undone. Your other portfolios, advisor discussions, and analysis snapshots will not be affected.
        </p>
        <div className="remove-portfolio-actions">
          <button
            ref={cancelRef}
            className="secondary-button"
            type="button"
            onClick={onCancel}
          >
            Cancel
          </button>
          <button
            className="primary-button remove-portfolio-confirm-btn"
            type="button"
            onClick={onConfirm}
          >
            Remove portfolio
          </button>
        </div>
      </div>
    </div>
  );
}
