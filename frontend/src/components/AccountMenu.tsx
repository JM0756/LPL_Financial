import { useCallback, useEffect, useRef, useState } from "react";
import type { StoredSession } from "../auth";
import {
  applyTheme,
  getStoredTheme,
  setStoredTheme,
  type ThemePreference,
} from "../theme";

interface AccountMenuProps {
  session: StoredSession;
  onSignOut: () => void;
}

export function AccountMenu({ session, onSignOut }: AccountMenuProps) {
  const [isOpen, setIsOpen] = useState(false);
  const [showProfile, setShowProfile] = useState(false);
  const [theme, setTheme] = useState<ThemePreference>(() => getStoredTheme());
  const menuRef = useRef<HTMLDivElement>(null);
  const triggerRef = useRef<HTMLButtonElement>(null);

  const displayName = session.email.split("@")[0];
  const roleLabel = session.role === "advisor" ? "Advisor" : "Investor";

  // Handle theme changes
  const handleThemeChange = useCallback((newTheme: ThemePreference) => {
    setTheme(newTheme);
    setStoredTheme(newTheme);
    applyTheme(newTheme);
  }, []);

  // Listen for system theme changes
  useEffect(() => {
    const mq = window.matchMedia("(prefers-color-scheme: dark)");
    const handler = () => {
      if (theme === "system") {
        applyTheme("system");
      }
    };
    mq.addEventListener("change", handler);
    return () => mq.removeEventListener("change", handler);
  }, [theme]);

  // Close on outside click
  useEffect(() => {
    if (!isOpen) return;
    function handleClick(e: MouseEvent) {
      if (menuRef.current && !menuRef.current.contains(e.target as Node)) {
        setIsOpen(false);
      }
    }
    document.addEventListener("mousedown", handleClick);
    return () => document.removeEventListener("mousedown", handleClick);
  }, [isOpen]);

  // Close on Escape and handle keyboard navigation
  useEffect(() => {
    if (!isOpen) return;
    function handleKeyDown(e: KeyboardEvent) {
      if (e.key === "Escape") {
        setIsOpen(false);
        triggerRef.current?.focus();
      }
    }
    document.addEventListener("keydown", handleKeyDown);
    return () => document.removeEventListener("keydown", handleKeyDown);
  }, [isOpen]);

  // Close profile dialog on Escape
  useEffect(() => {
    if (!showProfile) return;
    function handleKeyDown(e: KeyboardEvent) {
      if (e.key === "Escape") {
        setShowProfile(false);
        triggerRef.current?.focus();
      }
    }
    document.addEventListener("keydown", handleKeyDown);
    return () => document.removeEventListener("keydown", handleKeyDown);
  }, [showProfile]);

  return (
    <>
      <div className="account-menu" ref={menuRef}>
        <button
          ref={triggerRef}
          className={`account-menu-trigger ${session.role === "advisor" ? "account-menu-trigger-advisor" : ""}`}
          type="button"
          onClick={() => setIsOpen(!isOpen)}
          aria-expanded={isOpen}
          aria-haspopup="menu"
          aria-label={`Account menu for ${displayName}`}
        >
          <span className="account-menu-avatar" aria-hidden="true">
            {displayName.charAt(0).toUpperCase()}
          </span>
          <span className="account-menu-identity">
            <span className="account-menu-role">{roleLabel}</span>
            <span className="account-menu-email">{session.email}</span>
          </span>
          <span className="account-menu-chevron" aria-hidden="true">
            {isOpen ? "▲" : "▼"}
          </span>
        </button>

        {isOpen && (
          <div className="account-menu-dropdown" role="menu">
            <div className="account-menu-header">
              <span className="account-menu-header-name">{displayName}</span>
              <span className="account-menu-header-email">{session.email}</span>
              <span className={`account-menu-header-role ${session.role === "advisor" ? "account-menu-header-role-advisor" : ""}`}>
                {roleLabel}
              </span>
            </div>

            <div className="account-menu-section">
              <button
                className="account-menu-item"
                type="button"
                role="menuitem"
                onClick={() => {
                  setShowProfile(true);
                  setIsOpen(false);
                }}
              >
                Profile information
              </button>
            </div>

            <div className="account-menu-section">
              <span className="account-menu-section-label">Appearance</span>
              <div className="account-menu-theme-options" role="radiogroup" aria-label="Theme preference">
                {(["system", "light", "dark"] as ThemePreference[]).map((opt) => (
                  <button
                    key={opt}
                    className={`account-menu-theme-btn ${theme === opt ? "account-menu-theme-btn-active" : ""}`}
                    type="button"
                    role="radio"
                    aria-checked={theme === opt}
                    onClick={() => handleThemeChange(opt)}
                  >
                    {opt === "system" ? "System" : opt === "light" ? "Light" : "Dark"}
                  </button>
                ))}
              </div>
            </div>

            <div className="account-menu-divider" />

            <button
              className="account-menu-item account-menu-item-signout"
              type="button"
              role="menuitem"
              onClick={() => {
                setIsOpen(false);
                onSignOut();
              }}
            >
              Sign out
            </button>
          </div>
        )}
      </div>

      {showProfile && (
        <div
          className="profile-dialog-overlay"
          role="dialog"
          aria-modal="true"
          aria-labelledby="profile-dialog-title"
          onClick={(e) => {
            if (e.target === e.currentTarget) {
              setShowProfile(false);
              triggerRef.current?.focus();
            }
          }}
        >
          <div className="profile-dialog">
            <div className="profile-dialog-header">
              <h2 id="profile-dialog-title">Profile information</h2>
              <button
                className="profile-dialog-close"
                type="button"
                onClick={() => {
                  setShowProfile(false);
                  triggerRef.current?.focus();
                }}
                aria-label="Close profile dialog"
              >
                ×
              </button>
            </div>
            <div className="profile-dialog-content">
              <div className="profile-dialog-field">
                <span className="profile-dialog-label">Display name</span>
                <span className="profile-dialog-value">{displayName}</span>
              </div>
              <div className="profile-dialog-field">
                <span className="profile-dialog-label">Email</span>
                <span className="profile-dialog-value">{session.email}</span>
              </div>
              <div className="profile-dialog-field">
                <span className="profile-dialog-label">Role</span>
                <span className={`profile-dialog-role-badge ${session.role === "advisor" ? "profile-dialog-role-badge-advisor" : ""}`}>
                  {roleLabel}
                </span>
              </div>
            </div>
          </div>
        </div>
      )}
    </>
  );
}
