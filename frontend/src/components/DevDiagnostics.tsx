/**
 * Development-only diagnostics panel.
 * Remove after verification. Never shows tokens, credentials, or personal data.
 */
import { useEffect, useState } from "react";
import { API_MODE } from "../api";
import { AUTH_ENABLED, COGNITO_USER_POOL_ID, COGNITO_CLIENT_ID } from "../auth";
import type { ScenarioDefinition } from "../types";

interface Props {
  scenarios: ScenarioDefinition[];
  isLoading: boolean;
  loadError: string;
}

export function DevDiagnostics({ scenarios, isLoading, loadError }: Props) {
  const [apiCheck, setApiCheck] = useState<string>("checking…");
  const [dismissed, setDismissed] = useState(false);

  useEffect(() => {
    const base = (import.meta.env.VITE_API_BASE_URL as string | undefined) ?? "";
    fetch(`${base}/api/scenarios`, { cache: "no-store" })
      .then((r) => r.json())
      .then((d: { scenarios?: unknown[] }) => {
        const count = Array.isArray(d.scenarios) ? d.scenarios.length : "?";
        setApiCheck(`✓ ${count} scenarios from ${base}/api/scenarios`);
      })
      .catch((e: unknown) => setApiCheck(`✗ ${e instanceof Error ? e.message : String(e)}`));
  }, []);

  if (dismissed) return null;

  const missingMeta = scenarios.filter((s) => s.metadataValid === false).map((s) => s.key);

  return (
    <div
      style={{
        position: "fixed", bottom: 0, left: 0, right: 0, zIndex: 9999,
        background: "#1a1a2e", color: "#e0e0e0", fontSize: "12px",
        fontFamily: "monospace", padding: "8px 12px", borderTop: "2px solid #4a9eff",
        maxHeight: "180px", overflowY: "auto",
      }}
      role="status"
      aria-label="Development diagnostics"
    >
      <button
        type="button"
        onClick={() => setDismissed(true)}
        style={{ float: "right", background: "none", border: "none", color: "#aaa", cursor: "pointer", fontSize: "14px" }}
        aria-label="Dismiss diagnostics"
      >✕</button>
      <strong style={{ color: "#4a9eff" }}>DEV DIAGNOSTICS</strong>
      <table style={{ borderCollapse: "collapse", marginTop: "4px", width: "100%" }}>
        <tbody>
          <tr><td style={{ paddingRight: "16px", color: "#aaa" }}>Build mode</td><td>{import.meta.env.MODE}</td></tr>
          <tr><td style={{ paddingRight: "16px", color: "#aaa" }}>API mode</td><td>{API_MODE}</td></tr>
          <tr><td style={{ paddingRight: "16px", color: "#aaa" }}>API base URL</td><td>{(import.meta.env.VITE_API_BASE_URL as string | undefined) ?? "(empty)"}</td></tr>
          <tr><td style={{ paddingRight: "16px", color: "#aaa" }}>Auth enabled</td><td>{AUTH_ENABLED ? `✓ yes (pool: ${COGNITO_USER_POOL_ID?.slice(0, 12)}… client: ${COGNITO_CLIENT_ID?.slice(0, 8)}…)` : "✗ no (Cognito vars not set)"}</td></tr>
          <tr><td style={{ paddingRight: "16px", color: "#aaa" }}>Scenarios loaded</td><td>{isLoading ? "loading…" : loadError ? `✗ ${loadError}` : `${scenarios.length} scenarios`}</td></tr>
          <tr><td style={{ paddingRight: "16px", color: "#aaa" }}>Missing metadata</td><td>{missingMeta.length === 0 ? "none" : missingMeta.join(", ")}</td></tr>
          <tr><td style={{ paddingRight: "16px", color: "#aaa" }}>Direct API check</td><td>{apiCheck}</td></tr>
          <tr><td style={{ paddingRight: "16px", color: "#aaa" }}>Browser URL</td><td>{window.location.href}</td></tr>
        </tbody>
      </table>
    </div>
  );
}
