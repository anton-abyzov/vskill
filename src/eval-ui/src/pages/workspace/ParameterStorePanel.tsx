// ---------------------------------------------------------------------------
// ParameterStorePanel — credential & config parameter management (US-002 / 0563)
// ---------------------------------------------------------------------------

import { useState, useEffect, useCallback } from "react";
import { useWorkspace } from "./WorkspaceContext";
import { api } from "../../api";
import type { CredentialStatus } from "../../types";

interface ParamEntry {
  name: string;
  maskedValue: string;
  status: string;
}

export function ParameterStorePanel() {
  const { state } = useWorkspace();
  const { plugin, skill } = state;

  const [credentials, setCredentials] = useState<CredentialStatus[]>([]);
  const [params, setParams] = useState<ParamEntry[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [revealed, setRevealed] = useState<Set<string>>(new Set());
  const [editingKey, setEditingKey] = useState<string | null>(null);
  const [editValue, setEditValue] = useState("");
  const [saving, setSaving] = useState(false);

  // New custom param inputs
  const [newKey, setNewKey] = useState("");
  const [newValue, setNewValue] = useState("");

  const refresh = useCallback(async () => {
    setLoading(true);
    setError(null);
    try {
      const [credsRes, paramsRes] = await Promise.all([
        api.getCredentials(plugin, skill),
        api.getParams(plugin, skill),
      ]);
      setCredentials(credsRes.credentials);
      setParams(paramsRes.params);
    } catch (e) {
      setError(e instanceof Error ? e.message : "Failed to load parameters");
      setCredentials([]);
      setParams([]);
    } finally {
      setLoading(false);
    }
  }, [plugin, skill]);

  useEffect(() => { refresh(); }, [refresh]);

  const handleSave = useCallback(async (key: string, value: string) => {
    setSaving(true);
    setError(null);
    try {
      await api.setCredential(plugin, skill, key, value);
      setEditingKey(null);
      setEditValue("");
      await refresh();
    } catch (e) {
      setError(e instanceof Error ? e.message : `Failed to save ${key}`);
    } finally {
      setSaving(false);
    }
  }, [plugin, skill, refresh]);

  const handleAddParam = useCallback(async () => {
    const key = newKey.trim().toUpperCase();
    const val = newValue.trim();
    if (!key || !val) return;
    setSaving(true);
    setError(null);
    try {
      await api.setCredential(plugin, skill, key, val);
      setNewKey("");
      setNewValue("");
      await refresh();
    } catch (e) {
      setError(e instanceof Error ? e.message : `Failed to add ${key}`);
    } finally {
      setSaving(false);
    }
  }, [plugin, skill, newKey, newValue, refresh]);

  const toggleReveal = (name: string) => {
    setRevealed((prev) => {
      const next = new Set(prev);
      if (next.has(name)) next.delete(name);
      else next.add(name);
      return next;
    });
  };

  // Merge credentials and params: credentials first (with status), then extra params
  const credNames = new Set(credentials.map((c) => c.name));
  const allEntries = [
    ...credentials.map((c) => {
      const p = params.find((p) => p.name === c.name);
      return { name: c.name, status: c.status, maskedValue: p?.maskedValue ?? "" };
    }),
    ...params.filter((p) => !credNames.has(p.name)).map((p) => ({
      name: p.name, status: p.status as "ready" | "missing", maskedValue: p.maskedValue,
    })),
  ];

  return (
    <div className="py-2 px-3">
      <div className="text-[11px] font-semibold uppercase tracking-wider mb-2" style={{ color: "var(--text-tertiary)" }}>
        Parameters
      </div>

      {/* Error banner */}
      {error && (
        <div
          className="text-[10px] px-2 py-1.5 rounded mb-2"
          style={{ background: "rgba(239,68,68,0.1)", color: "#ef4444", border: "1px solid rgba(239,68,68,0.2)" }}
          role="alert"
        >
          {error}
        </div>
      )}

      {/* Loading state */}
      {loading && allEntries.length === 0 && (
        <div className="text-[11px] py-2" style={{ color: "var(--text-tertiary)" }}>
          Loading...
        </div>
      )}

      {/* Empty state (only after loading completes) */}
      {!loading && allEntries.length === 0 && !error && (
        <div className="text-[11px] py-2" style={{ color: "var(--text-tertiary)" }}>
          No parameters configured
        </div>
      )}

      {allEntries.map((entry) => (
        <div key={entry.name} className="flex items-center gap-2 py-1.5" style={{ borderBottom: "1px solid var(--border-subtle)" }}>
          <span className="text-[10px] font-mono flex-1 truncate" style={{ color: "var(--text-primary)" }}>
            {entry.name}
          </span>

          {/* Status badge */}
          <span
            className="text-[9px] font-semibold px-1.5 py-0.5 rounded-full"
            style={{
              background: entry.status === "ready" ? "rgba(34,197,94,0.15)" : "rgba(239,68,68,0.15)",
              color: entry.status === "ready" ? "#22c55e" : "#ef4444",
            }}
          >
            {entry.status}
          </span>

          {/* Masked value with partial reveal */}
          {entry.maskedValue && (
            <span className="text-[10px] font-mono" style={{ color: "var(--text-secondary)" }}>
              {revealed.has(entry.name) ? entry.maskedValue : "***"}
              <button
                onClick={() => toggleReveal(entry.name)}
                className="text-[9px] ml-1"
                style={{ color: "var(--accent)", cursor: "pointer", background: "none", border: "none" }}
                aria-label={`${revealed.has(entry.name) ? "Hide" : "Show"} masked value for ${entry.name}`}
              >
                {revealed.has(entry.name) ? "hide" : "show"}
              </button>
            </span>
          )}

          {/* Edit button */}
          {editingKey === entry.name ? (
            <div className="flex gap-1">
              <input
                value={editValue}
                onChange={(e) => setEditValue(e.target.value)}
                onKeyDown={(e) => { if (e.key === "Enter" && editValue.trim()) handleSave(entry.name, editValue); }}
                className="input-field text-[10px] font-mono"
                style={{ width: 120 }}
                placeholder="New value..."
                aria-label={`New value for ${entry.name}`}
                autoFocus
              />
              <button
                onClick={() => handleSave(entry.name, editValue)}
                disabled={saving || !editValue.trim()}
                className="text-[10px] font-medium"
                style={{ color: "#22c55e", background: "none", border: "none", cursor: "pointer" }}
              >
                Save
              </button>
              <button
                onClick={() => { setEditingKey(null); setEditValue(""); }}
                className="text-[10px]"
                style={{ color: "var(--text-tertiary)", background: "none", border: "none", cursor: "pointer" }}
              >
                Cancel
              </button>
            </div>
          ) : (
            <button
              onClick={() => { setEditingKey(entry.name); setEditValue(""); }}
              className="text-[10px]"
              style={{ color: "var(--accent)", background: "none", border: "none", cursor: "pointer" }}
            >
              Edit
            </button>
          )}
        </div>
      ))}

      {/* Add new parameter */}
      <div className="mt-3 pt-2" style={{ borderTop: "1px solid var(--border-subtle)" }}>
        <div className="text-[10px] font-medium mb-1.5" style={{ color: "var(--text-secondary)" }}>
          Add New Parameter
        </div>
        <div className="flex gap-1.5">
          <input
            value={newKey}
            onChange={(e) => setNewKey(e.target.value)}
            className="input-field text-[10px] font-mono flex-1"
            placeholder="KEY_NAME"
            aria-label="Parameter key name"
          />
          <input
            value={newValue}
            onChange={(e) => setNewValue(e.target.value)}
            onKeyDown={(e) => { if (e.key === "Enter" && newKey.trim() && newValue.trim()) handleAddParam(); }}
            className="input-field text-[10px] font-mono flex-1"
            placeholder="value"
            type="password"
            aria-label="Parameter value"
          />
          <button
            onClick={handleAddParam}
            disabled={saving || !newKey.trim() || !newValue.trim()}
            className="text-[10px] font-medium px-2 py-1 rounded"
            style={{
              background: "var(--accent-muted)",
              color: "var(--accent)",
              border: "none",
              cursor: saving ? "not-allowed" : "pointer",
            }}
          >
            Add
          </button>
        </div>
      </div>
    </div>
  );
}
