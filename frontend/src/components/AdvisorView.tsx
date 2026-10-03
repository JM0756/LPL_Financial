import { useEffect, useRef, useState } from "react";
import { listDiscussions, resetDiscussions } from "../api";
import type { DiscussionRecord } from "../types";

const wholeDollar = new Intl.NumberFormat("en-US", {
  style: "currency", currency: "USD", maximumFractionDigits: 0,
});
const twoCents = new Intl.NumberFormat("en-US", {
  style: "currency", currency: "USD", minimumFractionDigits: 2, maximumFractionDigits: 2,
});

function formatDate(iso: string): string {
  try {
    return new Intl.DateTimeFormat("en-US", {
      month: "short", day: "numeric", year: "numeric",
      hour: "numeric", minute: "2-digit",
    }).format(new Date(iso));
  } catch {
    return iso;
  }
}

function AnalysisResultSummary({ record }: { record: DiscussionRecord }) {
  const r = record.result;
  if (!r) return null;
  const isPP = r.valuation_basis === "real_purchasing_power";

  if (isPP) {
    return (
      <dl className="advisor-result-dl">
        <div><dt>Nominal value</dt><dd>{r.current_value != null ? wholeDollar.format(r.current_value) : "—"}</dd></div>
        <div><dt>Purchasing power</dt><dd>{r.scenario_value != null ? twoCents.format(r.scenario_value) : "—"}</dd></div>
        <div>
          <dt>Purchasing-power change</dt>
          <dd className={r.impact_dollars != null && r.impact_dollars < 0 ? "number-negative" : "number-positive"}>
            {r.impact_dollars != null ? `${r.impact_dollars > 0 ? "+" : "−"}${twoCents.format(Math.abs(r.impact_dollars))}` : "—"}
            {r.impact_percent != null ? ` (${r.impact_percent > 0 ? "+" : "−"}${Math.abs(r.impact_percent).toFixed(2)}%)` : ""}
          </dd>
        </div>
      </dl>
    );
  }

  return (
    <dl className="advisor-result-dl">
      <div><dt>Current value</dt><dd>{r.current_value != null ? wholeDollar.format(r.current_value) : "—"}</dd></div>
      <div><dt>Scenario value</dt><dd>{r.scenario_value != null ? wholeDollar.format(r.scenario_value) : "—"}</dd></div>
      <div>
        <dt>Impact</dt>
        <dd className={r.impact_dollars != null && r.impact_dollars < 0 ? "number-negative" : "number-positive"}>
          {r.impact_dollars != null ? `${r.impact_dollars > 0 ? "+" : "−"}${wholeDollar.format(Math.abs(r.impact_dollars))}` : "—"}
          {r.impact_percent != null ? ` (${r.impact_percent > 0 ? "+" : "−"}${Math.abs(r.impact_percent).toFixed(2)}%)` : ""}
        </dd>
      </div>
    </dl>
  );
}

function DiscussionCard({ record }: { record: DiscussionRecord }) {
  const isUnmodeled = record.requestType === "unmodeled_question";

  return (
    <li className="advisor-discussion-card">
      <div className="advisor-card-header">
        <div>
          <strong className="advisor-scenario-label">
            {isUnmodeled
              ? "Unmodeled question"
              : (record.scenarioLabel ?? record.scenarioKey ?? "Analysis")}
          </strong>
          <span className="advisor-client-name">{record.clientName}</span>
        </div>
        <div className="advisor-card-header-right">
          {isUnmodeled && (
            <span className="advisor-type-badge">No calculation</span>
          )}
          <span className={`advisor-status-badge advisor-status-${record.status}`}>
            {record.status}
          </span>
        </div>
      </div>

      <div className="advisor-card-meta">
        {!isUnmodeled && record.horizon && <span>Horizon: {record.horizon}</span>}
        <span>Requested: {formatDate(record.createdAt)}</span>
      </div>

      {isUnmodeled ? (
        <div className="advisor-unmodeled-body">
          <p className="advisor-unmodeled-question">
            <strong>Question:</strong> <em>"{record.question}"</em>
          </p>
          {record.clientNote && (
            <p className="advisor-unmodeled-note">
              <strong>Note:</strong> {record.clientNote}
            </p>
          )}
          <p className="advisor-no-result">Portfolio impact: Not calculated.</p>
        </div>
      ) : (
        <>
          {record.sourceQuestion && (
            <p className="advisor-source-question"><em>"{record.sourceQuestion}"</em></p>
          )}
          <AnalysisResultSummary record={record} />
          {record.scenarioDetails?.assumption_notes && record.scenarioDetails.assumption_notes.length > 0 && (
            <details className="advisor-assumptions">
              <summary>Assumptions</summary>
              <ul>
                {record.scenarioDetails.assumption_notes.map((note) => (
                  <li key={note}>{note}</li>
                ))}
              </ul>
            </details>
          )}
        </>
      )}
    </li>
  );
}

export function AdvisorView() {
  const [discussions, setDiscussions] = useState<DiscussionRecord[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState("");
  const [storageBackend, setStorageBackend] = useState<string | null>(null);
  // Reset state: idle | confirming | resetting | done
  const [resetState, setResetState] = useState<"idle" | "confirming" | "resetting" | "done">("idle");
  const [resetError, setResetError] = useState("");
  const abortRef = useRef<AbortController | null>(null);

  function load() {
    abortRef.current?.abort();
    const ac = new AbortController();
    abortRef.current = ac;
    setLoading(true);
    setError("");

    listDiscussions(ac.signal)
      .then(({ discussions: d, storageBackend: sb }) => {
        setStorageBackend(sb);
        setDiscussions(d);
      })
      .catch((err: unknown) => {
        if (err instanceof DOMException && err.name === "AbortError") return;
        setError(err instanceof Error ? err.message : "Could not load discussions.");
      })
      .finally(() => setLoading(false));
  }

  async function handleReset() {
    setResetState("resetting");
    setResetError("");
    try {
      await resetDiscussions();
      setDiscussions([]);
      setResetState("done");
    } catch (err) {
      setResetError(err instanceof Error ? err.message : "Reset failed.");
      setResetState("idle");
    }
  }

  useEffect(() => {
    load();
    return () => abortRef.current?.abort();
  }, []);

  const isMemory = storageBackend === "memory" || storageBackend === null;

  return (
    <section className="advisor-view" aria-labelledby="advisor-view-title">
      <div className="advisor-view-header">
        <div>
          <p className="section-kicker">Advisor demo view</p>
          <h2 id="advisor-view-title">Discussion requests</h2>
          <p className="advisor-view-subtitle">
            Requests submitted during this session. Refresh to see the latest.
            All figures are server-calculated snapshots.
          </p>
        </div>
        <div className="advisor-view-actions">
          <button className="secondary-button" type="button" onClick={load} disabled={loading}>
            {loading ? "Loading…" : "Refresh"}
          </button>
          {isMemory && resetState !== "confirming" && resetState !== "resetting" && (
            <button
              className="secondary-button advisor-reset-btn"
              type="button"
              onClick={() => { setResetState("confirming"); setResetError(""); }}
              disabled={loading}
            >
              Reset all
            </button>
          )}
        </div>
      </div>

      {/* Reset confirmation */}
      {resetState === "confirming" && (
        <div className="advisor-reset-confirm" role="alertdialog" aria-labelledby="reset-confirm-label">
          <p id="reset-confirm-label">
            <strong>Clear all requests?</strong> This removes all discussion records and
            analysis snapshots from the session memory. This cannot be undone.
          </p>
          <div className="advisor-reset-confirm-actions">
            <button className="primary-button advisor-reset-confirm-btn" type="button" onClick={handleReset}>
              Yes, clear all
            </button>
            <button className="secondary-button" type="button" onClick={() => setResetState("idle")}>
              Cancel
            </button>
          </div>
        </div>
      )}

      {resetState === "resetting" && (
        <div className="advisor-reset-confirm" role="status">
          <p>Clearing records…</p>
        </div>
      )}

      {resetState === "done" && (
        <div className="advisor-reset-done" role="status">
          All records cleared. Submit new requests from the Explore tab.
          <button className="text-button" type="button" onClick={() => setResetState("idle")}>Dismiss</button>
        </div>
      )}

      {resetError && (
        <div className="error-message" role="alert">
          <strong>Reset failed</strong>
          <span>{resetError}</span>
        </div>
      )}

      <div className="advisor-demo-banner">
        <strong>Demo view</strong>
        <span>
          Storage:{" "}
          <strong>
            {storageBackend === "dynamodb" ? "DynamoDB (durable)" : "Session memory (temporary)"}
          </strong>
          . Records are lost when the backend restarts. No real notifications are sent.
        </span>
      </div>

      {error && (
        <div className="error-message" role="alert">
          <strong>Could not load discussions</strong>
          <span>{error}</span>
          <button className="text-button" type="button" onClick={load}>Retry</button>
        </div>
      )}

      {!loading && !error && discussions.length === 0 && resetState !== "done" && (
        <div className="empty-confirmation">
          <span aria-hidden="true">📋</span>
          No requests yet. Run an analysis or send an unsupported question to your advisor.
        </div>
      )}

      {discussions.length > 0 && (
        <ul className="advisor-discussion-list">
          {discussions.map((d) => <DiscussionCard key={d.discussionId} record={d} />)}
        </ul>
      )}
    </section>
  );
}
