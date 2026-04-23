import { useState, useEffect, useCallback } from "react";
import { api } from "../../api";
import type { CredentialStatus } from "../../types";

interface Props {
  plugin: string;
  skill: string;
}

interface MergedCredential {
  name: string;
  status: string;
  source?: string;
  maskedValue?: string;
  revealedValue?: string;
}

export function CredentialManager({ plugin, skill }: Props) {
  const [credentials, setCredentials] = useState<MergedCredential[]>([]);
  const [loading, setLoading] = useState(true);
  const [editingKey, setEditingKey] = useState<string | null>(null);
  const [editValue, setEditValue] = useState("");
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [newKey, setNewKey] = useState("");
  const [newValue, setNewValue] = useState("");
  const [showAddForm, setShowAddForm] = useState(false);
  const [revealedKeys, setRevealedKeys] = useState<Set<string>>(new Set());

  const fetchCredentials = useCallback(async () => {
    setLoading(true);
    try {
      const [credRes, paramRes] = await Promise.all([
        api.getCredentials(plugin, skill).catch(() => ({ credentials: [] as CredentialStatus[] })),
        api.getParams(plugin, skill).catch(() => ({ params: [] as Array<{ name: string; maskedValue: string; status: string }> })),
      ]);

      const paramMap = new Map(paramRes.params.map((p) => [p.name, p]));
      const seen = new Set<string>();

      // Merge: credentials (from integration test declarations) + params (from .env.local)
      const merged: MergedCredential[] = [];

      for (const cred of credRes.credentials) {
        seen.add(cred.name);
        const param = paramMap.get(cred.name);
        merged.push({
          name: cred.name,
          status: cred.status === "ready" || cred.status === "resolved" ? "ready" : "missing",
          source: cred.source,
          maskedValue: param?.maskedValue,
        });
      }

      // Add params not already in credentials (custom parameters)
      for (const param of paramRes.params) {
        if (!seen.has(param.name)) {
          merged.push({
            name: param.name,
            status: param.status,
            maskedValue: param.maskedValue,
          });
        }
      }

      setCredentials(merged);
    } finally {
      setLoading(false);
    }
  }, [plugin, skill]);

  useEffect(() => { fetchCredentials(); }, [fetchCredentials]);

  const toggleReveal = useCallback(async (name: string) => {
    if (revealedKeys.has(name)) {
      // Hide
      setRevealedKeys((prev) => { const next = new Set(prev); next.delete(name); return next; });
      setCredentials((prev) => prev.map((c) => c.name === name ? { ...c, revealedValue: undefined } : c));
      return;
    }
    // Reveal — fetch only the requested key's value
    try {
      const res = await api.getParamsRevealed(plugin, skill, name);
      const param = res.params.find((p) => p.name === name);
      if (param) {
        setCredentials((prev) => prev.map((c) => c.name === name ? { ...c, revealedValue: param.value } : c));
        setRevealedKeys((prev) => new Set(prev).add(name));
      }
    } catch {
      // Silently fail — reveal is convenience, not critical
    }
  }, [plugin, skill, revealedKeys]);

  const handleSave = async (name: string, value: string) => {
    if (!name.trim() || !value.trim()) return;
    setSaving(true);
    setError(null);
    try {
      await api.setCredential(plugin, skill, name, value);
      setEditingKey(null);
      setEditValue("");
      setRevealedKeys(new Set()); // Clear reveals after edit
      fetchCredentials();
    } catch (e) {
      setError((e as Error).message);
    } finally {
      setSaving(false);
    }
  };

  const handleAddNew = async () => {
    if (!newKey.trim() || !newValue.trim()) return;
    setSaving(true);
    setError(null);
    try {
      await api.setCredential(plugin, skill, newKey.trim().toUpperCase(), newValue);
      setNewKey("");
      setNewValue("");
      setShowAddForm(false);
      fetchCredentials();
    } catch (e) {
      setError((e as Error).message);
    } finally {
      setSaving(false);
    }
  };

  if (loading) {
    return (
      <div className="mt-6">
        <div className="text-[11px] font-semibold uppercase tracking-wider mb-2" style={{ color: "var(--text-tertiary)" }}>
          Parameters & Secrets
        </div>
        <div className="skeleton h-20 rounded-xl" />
      </div>
    );
  }

  return (
    <div className="mt-6">
      <div className="flex items-center justify-between mb-2">
        <span className="text-[11px] font-semibold uppercase tracking-wider" style={{ color: "var(--text-tertiary)" }}>
          Parameters & Secrets
        </span>
        <button
          onClick={() => setShowAddForm(!showAddForm)}
          className="text-[11px] transition-colors duration-150"
          style={{ color: "var(--accent)", background: "none", border: "none", cursor: "pointer" }}
        >
          + Add Parameter
        </button>
      </div>

      {error && (
        <div className="mb-2 px-3 py-2 rounded-lg text-[11px]" style={{ background: "var(--red-muted)", color: "var(--red)" }}>
          {error}
        </div>
      )}

      {credentials.length === 0 && !showAddForm ? (
        <div className="text-[12px] text-center py-6 rounded-xl" style={{ color: "var(--text-tertiary)", background: "var(--surface-2)" }}>
          No credentials configured for this skill
        </div>
      ) : (
        <div className="rounded-xl overflow-hidden" style={{ border: "1px solid var(--border-subtle)" }}>
          {credentials.map((cred) => (
            <div
              key={cred.name}
              className="flex items-center gap-3 px-3 py-2.5"
              style={{ borderBottom: "1px solid var(--border-subtle)", background: "var(--surface-1)" }}
            >
              <span className="text-[11px] font-mono font-medium truncate" style={{ color: "var(--text-primary)", minWidth: 80 }}>
                {cred.name}
              </span>

              {/* Masked/revealed value */}
              {cred.maskedValue && (
                <span className="text-[10px] font-mono truncate" style={{ color: "var(--text-tertiary)", maxWidth: 120 }}>
                  {revealedKeys.has(cred.name) && cred.revealedValue != null
                    ? cred.revealedValue
                    : cred.maskedValue}
                </span>
              )}

              {/* Reveal toggle */}
              {cred.maskedValue && (
                <button
                  onClick={() => toggleReveal(cred.name)}
                  className="btn btn-ghost px-1"
                  title={revealedKeys.has(cred.name) ? "Hide value" : "Reveal value"}
                  style={{ color: "var(--text-tertiary)", lineHeight: 1 }}
                >
                  {revealedKeys.has(cred.name) ? (
                    <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2">
                      <path d="M17.94 17.94A10.07 10.07 0 0 1 12 20c-7 0-11-8-11-8a18.45 18.45 0 0 1 5.06-5.94" />
                      <path d="M9.9 4.24A9.12 9.12 0 0 1 12 4c7 0 11 8 11 8a18.5 18.5 0 0 1-2.16 3.19" />
                      <line x1="1" y1="1" x2="23" y2="23" />
                    </svg>
                  ) : (
                    <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2">
                      <path d="M1 12s4-8 11-8 11 8 11 8-4 8-11 8-11-8-11-8z" />
                      <circle cx="12" cy="12" r="3" />
                    </svg>
                  )}
                </button>
              )}

              <span
                className="text-[10px] font-semibold px-2 py-0.5 rounded-full"
                style={{
                  background: cred.status === "ready" ? "var(--green-muted)" : "var(--orange-muted)",
                  color: cred.status === "ready" ? "var(--green)" : "var(--orange)",
                }}
              >
                {cred.status === "ready" ? "ready" : "missing"}
              </span>
              {cred.source && (
                <span className="text-[9px]" style={{ color: "var(--text-tertiary)" }}>{cred.source}</span>
              )}
              {editingKey === cred.name ? (
                <div className="flex items-center gap-1.5">
                  <input
                    value={editValue}
                    onChange={(e) => setEditValue(e.target.value)}
                    onKeyDown={(e) => { if (e.key === "Enter") handleSave(cred.name, editValue); }}
                    className="input-field text-[11px] font-mono"
                    style={{ width: 160 }}
                    placeholder="Value..."
                    autoFocus
                  />
                  <button
                    onClick={() => handleSave(cred.name, editValue)}
                    disabled={saving || !editValue.trim()}
                    className="btn btn-primary text-[10px] px-2 py-0.5"
                  >
                    {saving ? "..." : "Save"}
                  </button>
                  <button
                    onClick={() => { setEditingKey(null); setEditValue(""); }}
                    className="btn btn-ghost text-[10px] px-1"
                  >
                    <svg width="12" height="12" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2"><line x1="18" y1="6" x2="6" y2="18" /><line x1="6" y1="6" x2="18" y2="18" /></svg>
                  </button>
                </div>
              ) : (
                <button
                  onClick={() => { setEditingKey(cred.name); setEditValue(""); }}
                  className="btn btn-ghost text-[10px] px-2 py-0.5"
                  style={{ color: "var(--accent)" }}
                >
                  Edit
                </button>
              )}
            </div>
          ))}
        </div>
      )}

      {/* Add new parameter form */}
      {showAddForm && (
        <div className="mt-2 p-3 rounded-lg" style={{ background: "var(--surface-2)", border: "1px solid var(--border-subtle)" }}>
          <div className="flex gap-2 mb-2">
            <input
              value={newKey}
              onChange={(e) => setNewKey(e.target.value)}
              className="input-field flex-1 text-[11px] font-mono"
              placeholder="KEY_NAME"
              autoFocus
            />
            <input
              value={newValue}
              onChange={(e) => setNewValue(e.target.value)}
              onKeyDown={(e) => { if (e.key === "Enter") handleAddNew(); }}
              className="input-field flex-1 text-[11px] font-mono"
              placeholder="Value"
              type="password"
            />
          </div>
          <div className="flex justify-end gap-1.5">
            <button onClick={() => { setShowAddForm(false); setNewKey(""); setNewValue(""); }} className="btn btn-ghost text-[10px]">Cancel</button>
            <button onClick={handleAddNew} disabled={saving || !newKey.trim() || !newValue.trim()} className="btn btn-primary text-[10px]">
              {saving ? "Saving..." : "Save"}
            </button>
          </div>
        </div>
      )}
    </div>
  );
}
