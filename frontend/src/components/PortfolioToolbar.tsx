import { useState } from "react";
import {
  createAccount,
  getPortfolioCount,
  renameAccount,
  selectAccount,
  type DemoAccount,
  type DemoProfile,
} from "../demo-storage";
import {
  createAuthPortfolio,
  getAuthPortfolioCount,
  renameAuthPortfolio,
  selectAuthPortfolio,
} from "../auth-storage";

interface PortfolioToolbarProps {
  profile: DemoProfile;
  onAccountChange: () => void;
  onRemoveRequest: (account: DemoAccount) => void;
  disabled?: boolean;
  userEmail?: string; // For authenticated users
}

export function PortfolioToolbar({
  profile,
  onAccountChange,
  onRemoveRequest,
  disabled,
  userEmail,
}: PortfolioToolbarProps) {
  const [creating, setCreating] = useState(false);
  const [newName, setNewName] = useState("");
  const [renamingId, setRenamingId] = useState<string | null>(null);
  const [renameValue, setRenameValue] = useState("");
  const [error, setError] = useState("");

  const activeAccount =
    profile.accounts.find((a) => a.id === profile.activeAccountId) ?? profile.accounts[0];
  const { current, max } = userEmail ? getAuthPortfolioCount(userEmail) : getPortfolioCount();
  const atLimit = current >= max;
  const canRemove = profile.accounts.length > 1;

  function handleCreate() {
    const trimmed = newName.trim();
    if (!trimmed) {
      setError("Enter a portfolio name.");
      return;
    }
    const result = userEmail
      ? createAuthPortfolio(userEmail, trimmed)
      : createAccount(trimmed);
    if (result.error) {
      setError(result.error);
      return;
    }
    setNewName("");
    setCreating(false);
    setError("");
    onAccountChange();
  }

  function handleRename(id: string) {
    const trimmed = renameValue.trim();
    if (!trimmed) {
      setError("Enter a name.");
      return;
    }
    if (userEmail) {
      renameAuthPortfolio(userEmail, id, trimmed);
    } else {
      renameAccount(id, trimmed);
    }
    setRenamingId(null);
    setRenameValue("");
    setError("");
    onAccountChange();
  }

  function handleSelect(id: string) {
    if (disabled) return;
    if (userEmail) {
      selectAuthPortfolio(userEmail, id);
    } else {
      selectAccount(id);
    }
    onAccountChange();
  }

  return (
    <div className="portfolio-toolbar">
      <div className="portfolio-toolbar-inner">
        <span className="portfolio-toolbar-label">Portfolios:</span>
        <div className="portfolio-toolbar-tabs">
          {profile.accounts.map((a: DemoAccount) => (
            <button
              key={a.id}
              type="button"
              className={`portfolio-toolbar-tab ${a.id === activeAccount?.id ? "portfolio-toolbar-tab-active" : ""}`}
              onClick={() => handleSelect(a.id)}
              disabled={disabled}
              aria-current={a.id === activeAccount?.id ? "true" : undefined}
            >
              {renamingId === a.id ? (
                <span className="portfolio-toolbar-rename-inline" onClick={(e) => e.stopPropagation()}>
                  <input
                    type="text"
                    value={renameValue}
                    maxLength={60}
                    autoFocus
                    onClick={(e) => e.stopPropagation()}
                    onChange={(e) => {
                      setRenameValue(e.target.value);
                      setError("");
                    }}
                    onKeyDown={(e) => {
                      if (e.key === "Enter") {
                        e.stopPropagation();
                        handleRename(a.id);
                      }
                      if (e.key === "Escape") setRenamingId(null);
                    }}
                  />
                  <button
                    type="button"
                    className="text-button"
                    onClick={(e) => {
                      e.stopPropagation();
                      handleRename(a.id);
                    }}
                  >
                    Save
                  </button>
                </span>
              ) : (
                <>
                  {a.name}
                  {a.id === activeAccount?.id && (
                    <button
                      type="button"
                      className="portfolio-toolbar-rename-btn"
                      title="Rename portfolio"
                      onClick={(e) => {
                        e.stopPropagation();
                        setRenamingId(a.id);
                        setRenameValue(a.name);
                        setError("");
                      }}
                    >
                      ✎
                    </button>
                  )}
                </>
              )}
            </button>
          ))}

          {creating ? (
            <span className="portfolio-toolbar-create-inline">
              <input
                type="text"
                className="portfolio-toolbar-new-input"
                placeholder="Portfolio name"
                value={newName}
                maxLength={60}
                autoFocus
                onChange={(e) => {
                  setNewName(e.target.value);
                  setError("");
                }}
                onKeyDown={(e) => {
                  if (e.key === "Enter") handleCreate();
                  if (e.key === "Escape") setCreating(false);
                }}
              />
              <button type="button" className="text-button" onClick={handleCreate}>
                Add
              </button>
              <button type="button" className="text-button" onClick={() => setCreating(false)}>
                ✕
              </button>
            </span>
          ) : (
            <button
              type="button"
              className="portfolio-toolbar-tab portfolio-toolbar-tab-add"
              onClick={() => {
                setCreating(true);
                setError("");
              }}
              disabled={atLimit || disabled}
              title={atLimit ? `You can have up to ${max} portfolios. Remove one to create another.` : "Create new portfolio"}
            >
              + New portfolio
            </button>
          )}
        </div>

        <div className="portfolio-toolbar-right">
          <span className="portfolio-toolbar-count">{current} of {max} portfolios</span>
          <button
            type="button"
            className="text-button portfolio-toolbar-remove-btn"
            onClick={() => activeAccount && onRemoveRequest(activeAccount)}
            disabled={!canRemove || disabled}
            title={!canRemove ? "Cannot remove your only portfolio" : `Remove "${activeAccount?.name}"`}
          >
            Remove portfolio
          </button>
        </div>
      </div>
      {error && (
        <p className="portfolio-toolbar-error" role="alert">
          {error}
        </p>
      )}
    </div>
  );
}
