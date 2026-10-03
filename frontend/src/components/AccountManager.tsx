import { useState } from "react";
import {
  createAccount,
  renameAccount,
  selectAccount,
  type DemoAccount,
  type DemoProfile,
} from "../demo-storage";

interface AccountManagerProps {
  profile: DemoProfile;
  onAccountChange: () => void;
}

export function AccountManager({ profile, onAccountChange }: AccountManagerProps) {
  const [creating, setCreating] = useState(false);
  const [newName, setNewName] = useState("");
  const [renamingId, setRenamingId] = useState<string | null>(null);
  const [renameValue, setRenameValue] = useState("");
  const [error, setError] = useState("");

  const activeAccount =
    profile.accounts.find((a) => a.id === profile.activeAccountId) ??
    profile.accounts[0];

  function handleCreate() {
    const trimmed = newName.trim();
    if (!trimmed) { setError("Enter a portfolio name."); return; }
    createAccount(trimmed);
    setNewName("");
    setCreating(false);
    setError("");
    onAccountChange();
  }

  function handleRename(id: string) {
    const trimmed = renameValue.trim();
    if (!trimmed) { setError("Enter a name."); return; }
    renameAccount(id, trimmed);
    setRenamingId(null);
    setRenameValue("");
    setError("");
    onAccountChange();
  }

  function handleSelect(id: string) {
    selectAccount(id);
    onAccountChange();
  }

  return (
    <div className="account-manager">
      <div className="account-manager-header">
        <span className="account-manager-label">Portfolios:</span>
        <div className="account-tabs">
          {profile.accounts.map((a: DemoAccount) => (
            <button
              key={a.id}
              type="button"
              className={`account-tab ${a.id === activeAccount?.id ? "account-tab-active" : ""}`}
              onClick={() => handleSelect(a.id)}
            >
              {renamingId === a.id ? (
                <span className="account-rename-inline">
                  <input
                    type="text"
                    value={renameValue}
                    maxLength={60}
                    autoFocus
                    onClick={(e) => e.stopPropagation()}
                    onChange={(e) => { setRenameValue(e.target.value); setError(""); }}
                    onKeyDown={(e) => {
                      if (e.key === "Enter") { e.stopPropagation(); handleRename(a.id); }
                      if (e.key === "Escape") { setRenamingId(null); }
                    }}
                  />
                  <button
                    type="button"
                    className="text-button"
                    onClick={(e) => { e.stopPropagation(); handleRename(a.id); }}
                  >Save</button>
                </span>
              ) : (
                <>
                  {a.name}
                  {a.id === activeAccount?.id && (
                    <button
                      type="button"
                      className="account-rename-btn"
                      title="Rename portfolio"
                      onClick={(e) => {
                        e.stopPropagation();
                        setRenamingId(a.id);
                        setRenameValue(a.name);
                        setError("");
                      }}
                    >✎</button>
                  )}
                </>
              )}
            </button>
          ))}

          {creating ? (
            <span className="account-create-inline">
              <input
                type="text"
                className="account-new-input"
                placeholder="Portfolio name"
                value={newName}
                maxLength={60}
                autoFocus
                onChange={(e) => { setNewName(e.target.value); setError(""); }}
                onKeyDown={(e) => {
                  if (e.key === "Enter") handleCreate();
                  if (e.key === "Escape") setCreating(false);
                }}
              />
              <button type="button" className="text-button" onClick={handleCreate}>Add</button>
              <button type="button" className="text-button" onClick={() => setCreating(false)}>✕</button>
            </span>
          ) : (
            <button
              type="button"
              className="account-tab account-tab-add"
              onClick={() => { setCreating(true); setError(""); }}
            >+ New portfolio</button>
          )}
        </div>
      </div>
      {error && <p className="field-message" role="alert">{error}</p>}
    </div>
  );
}
