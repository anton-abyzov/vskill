import { useState, useEffect, useCallback } from "react";
import { api } from "../../api";
import type { CredentialStatus } from "../../types";

interface Props {
  plugin: string;
  skill: string;
}

export function CredentialManager({ plugin, skill }: Props) {
  const [credentials, setCredentials] = useState<CredentialStatus[]>([]);
  const [loading, setLoading] = useState(true);
  const [editingKey, setEditingKey] = useState<string | null>(null);
  const [editValue, setEditValue] = useState("");
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [newKey, setNewKey] = useState("");
  const [newValue, setNewValue] = useState("");
  const [showAddForm, setShowAddForm] = useState(false);

  const fetchCredentials = useCallback(() => {
    setLoading(true);
    api.getCredentials(plugin, skill)
      .then((res) => setCredentials(res.credentials))
      .catch(() => setCredentials([]))
      .finally(() => setLoading(false));
  }, [plugin, skill]);

  useEffect(() => { fetchCredentials(); }, [fetchCredentials]);

  const handleSave = async (name: string, value: string) => {
    if (!name.trim() || !value.trim()) return;
    setSaving(true);
    setError(null);
    try {
      await api.setCredential(plugin, skill, name, value);
      setEditingKey(null);
      setEditValue("");
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
        <div className="mb-2 px-3 py-2 rounded-lg text-[11px]" style={{ background: "var(--error-muted, #3f1a1a)", color: "var(--error, #f87171)" }}>
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
              <span className="text-[11px] font-mono font-medium flex-1 truncate" style={{ color: "var(--text-primary)" }}>
                {cred.name}
              </span>
              <span
                className="text-[10px] font-semibold px-2 py-0.5 rounded-full"
                style={{
                  background: cred.status === "ready" || cred.status === "resolved" ? "rgba(52,211,153,0.15)" : "rgba(251,146,60,0.15)",
                  color: cred.status === "ready" || cred.status === "resolved" ? "var(--green)" : "#fb923c",
                }}
              >
                {cred.status === "ready" || cred.status === "resolved" ? "ready" : "missing"}
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
