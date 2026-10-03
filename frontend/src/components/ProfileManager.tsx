import { useState } from "react";
import {
  createProfile,
  getProfiles,
  signOut,
  switchProfile,
  type DemoProfile,
} from "../demo-storage";

interface ProfileManagerProps {
  activeProfile: DemoProfile | null;
  onProfileChange: () => void;
  onAdvisorMode?: () => void;
  isAdvisorMode?: boolean;
}

export function ProfileManager({ activeProfile, onProfileChange, onAdvisorMode, isAdvisorMode }: ProfileManagerProps) {
  const [mode, setMode] = useState<"idle" | "create" | "switch">("idle");
  const [name, setName] = useState("");
  const [error, setError] = useState("");

  function handleCreate() {
    const trimmed = name.trim();
    if (!trimmed) { setError("Enter a name for your demo profile."); return; }
    if (trimmed.length > 60) { setError("Name must be 60 characters or fewer."); return; }
    createProfile(trimmed);
    setName("");
    setMode("idle");
    setError("");
    onProfileChange();
  }

  function handleSwitch(id: string) {
    switchProfile(id);
    setMode("idle");
    onProfileChange();
  }

  function handleSignOut() {
    signOut();
    setMode("idle");
    onProfileChange();
  }

  const profiles = getProfiles();

  if (!activeProfile) {
    return (
      <div className="profile-gate">
        <div className="profile-gate-card">
          <div className="profile-gate-logo" aria-hidden="true">
            <svg viewBox="0 0 56 56" fill="none" xmlns="http://www.w3.org/2000/svg" width="72" height="72">
              <circle cx="28" cy="28" r="26" fill="#102B46"/>
              <circle cx="28" cy="28" r="17" fill="#1a4a6b"/>
              <circle cx="28" cy="28" r="10" fill="#1a7972"/>
              <circle cx="28" cy="28" r="5" fill="#2da89e"/>
              <ellipse cx="23" cy="23" rx="3.5" ry="2.2" fill="white" opacity="0.25" transform="rotate(-20 23 23)"/>
              <circle cx="33" cy="22" r="1.5" fill="white" opacity="0.35"/>
            </svg>
          </div>
          <h1 className="profile-gate-title">WealthLens</h1>
          <p className="profile-gate-tagline">See what change could mean for your portfolio.</p>

          <div className="profile-gate-notice">
            <strong>Demo profiles only.</strong> These are not real accounts. No passwords are
            collected. Data is stored locally in your browser and is not private or secure.
          </div>

          {profiles.length > 0 && (
            <div className="profile-gate-section">
              <p className="profile-gate-section-label">Return to an existing profile</p>
              <ul className="profile-list">
                {profiles.map((p) => (
                  <li key={p.id}>
                    <button className="profile-list-btn" type="button" onClick={() => handleSwitch(p.id)}>
                      <span className="profile-avatar" aria-hidden="true">{p.name.charAt(0).toUpperCase()}</span>
                      <span>{p.name}</span>
                    </button>
                  </li>
                ))}
              </ul>
            </div>
          )}

          <div className="profile-gate-section">
            <p className="profile-gate-section-label">Create a new demo profile</p>
            <div className="profile-create-row">
              <input
                type="text"
                className="profile-name-input"
                placeholder="Your name (e.g. Alex)"
                value={name}
                maxLength={60}
                onChange={(e) => { setName(e.target.value); setError(""); }}
                onKeyDown={(e) => e.key === "Enter" && handleCreate()}
              />
              <button className="primary-button" type="button" onClick={handleCreate}>
                Get started
              </button>
            </div>
            {error && <p className="field-message" role="alert">{error}</p>}
          </div>
        </div>
      </div>
    );
  }

  return (
    <div className="profile-bar">
      <button
        className="profile-bar-btn"
        type="button"
        onClick={() => setMode(mode === "switch" ? "idle" : "switch")}
        aria-expanded={mode === "switch"}
      >
        <span className="profile-avatar-sm" aria-hidden="true">{activeProfile.name.charAt(0).toUpperCase()}</span>
        <span>{activeProfile.name}</span>
        <span aria-hidden="true" className="profile-bar-caret">{mode === "switch" ? "▲" : "▼"}</span>
      </button>

      {mode === "switch" && (
        <div className="profile-dropdown">
          <p className="profile-dropdown-label">Demo profiles (browser-local)</p>
          <ul className="profile-list profile-list-sm">
            {profiles.map((p) => (
              <li key={p.id}>
                <button
                  className={`profile-list-btn ${p.id === activeProfile.id ? "profile-list-btn-active" : ""}`}
                  type="button"
                  onClick={() => handleSwitch(p.id)}
                >
                  <span className="profile-avatar-sm" aria-hidden="true">{p.name.charAt(0).toUpperCase()}</span>
                  <span>{p.name}</span>
                  {p.id === activeProfile.id && <span className="profile-active-mark">✓</span>}
                </button>
              </li>
            ))}
          </ul>
          <div className="profile-dropdown-actions">
            <button className="text-button" type="button" onClick={() => { setMode("create"); }}>
              + New profile
            </button>
            <button className="text-button text-button-danger" type="button" onClick={handleSignOut}>
              Sign out
            </button>
          </div>
          {onAdvisorMode && (
            <div className="profile-dropdown-advisor">
              <button
                className="text-button profile-advisor-switch-btn"
                type="button"
                onClick={() => { setMode("idle"); onAdvisorMode(); }}
              >
                {isAdvisorMode ? "↩ Return to investor view" : "Switch to advisor demo →"}
              </button>
            </div>
          )}
        </div>
      )}

      {mode === "create" && (
        <div className="profile-dropdown">
          <p className="profile-dropdown-label">New demo profile</p>
          <div className="profile-create-row">
            <input
              type="text"
              className="profile-name-input"
              placeholder="Name"
              value={name}
              maxLength={60}
              autoFocus
              onChange={(e) => { setName(e.target.value); setError(""); }}
              onKeyDown={(e) => e.key === "Enter" && handleCreate()}
            />
            <button className="secondary-button" type="button" onClick={handleCreate}>Create</button>
          </div>
          {error && <p className="field-message" role="alert">{error}</p>}
          <button className="text-button" type="button" onClick={() => setMode("idle")}>Cancel</button>
        </div>
      )}
    </div>
  );
}
