import { useEffect, useState } from "react";
import { api } from "../api";

const TERMINAL = new Set(["PUBLISHED", "REJECTED", "TIER1_FAILED", "TIER2_FAILED", "BLOCKED", "FAILED"]);

/** Private submissions never join the public queue stream. Poll only their
 * authenticated status route; the platform rechecks tenant membership. */
export function PrivateSubmissionStatus({ id, initialState }: { id: string; initialState: string }) {
  const [state, setState] = useState(initialState);
  const [error, setError] = useState<string | null>(null);
  const [retry, setRetry] = useState(0);
  useEffect(() => {
    let alive = true;
    let timer: ReturnType<typeof setTimeout> | undefined;
    const read = async () => {
      try {
        const result = await api.getSubmission(id);
        if (!alive) return;
        const next = typeof result.state === "string" ? result.state : "RECEIVED";
        setState(next);
        setError(typeof result.error === "string" ? result.error : null);
        if (!TERMINAL.has(next)) timer = setTimeout(() => { void read(); }, 2_000);
      } catch {
        if (alive) setError("Could not read private publishing status. Retry to check the result before submitting again.");
      }
    };
    void read();
    return () => { alive = false; clearTimeout(timer); };
  }, [id, retry]);

  const label = state === "PUBLISHED" ? "Published privately."
    : TERMINAL.has(state) ? "Private publication needs attention."
    : "Private security review in progress.";
  return (
    <div role="status" data-testid="private-submission-status" data-state={state} style={{ marginTop: 12, lineHeight: 1.6 }}>
      <strong>{label}</strong> <span>Visible only to the selected publishing account.</span>
      {error && <p role="alert">{error}</p>}
      {error && <button type="button" className="btn btn-ghost text-[11px]" onClick={() => setRetry((n) => n + 1)}>Refresh status</button>}
    </div>
  );
}
