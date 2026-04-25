// T-053: OpenRouter model search dropdown
import { useState, useEffect, useRef, useCallback, useMemo } from "react";
import { api } from "../api";
import type { OpenRouterModel } from "../types";

interface Props {
  value: string;
  onChange: (modelId: string) => void;
}

export function ModelSearchDropdown({ value, onChange }: Props) {
  const [models, setModels] = useState<OpenRouterModel[]>([]);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [search, setSearch] = useState(value);
  const [open, setOpen] = useState(false);
  const containerRef = useRef<HTMLDivElement>(null);
  const debounceRef = useRef<ReturnType<typeof setTimeout>>(undefined);

  // Fetch models on mount
  useEffect(() => {
    setLoading(true);
    api.searchModels()
      .then((res) => setModels(res.models))
      .catch((err) => setError(err instanceof Error ? err.message : String(err)))
      .finally(() => setLoading(false));
  }, []);

  // Debounced search update
  const handleSearchChange = useCallback((val: string) => {
    setSearch(val);
    if (debounceRef.current) clearTimeout(debounceRef.current);
    debounceRef.current = setTimeout(() => setOpen(true), 300);
  }, []);

  // Filter models by search
  const filtered = useMemo(() => {
    if (!search.trim()) return models.slice(0, 50);
    const q = search.toLowerCase();
    return models.filter((m) =>
      m.id.toLowerCase().includes(q) || m.name.toLowerCase().includes(q)
    ).slice(0, 50);
  }, [models, search]);

  // Close on outside click
  useEffect(() => {
    function handler(e: MouseEvent) {
      if (containerRef.current && !containerRef.current.contains(e.target as Node)) {
        setOpen(false);
      }
    }
    document.addEventListener("mousedown", handler);
    return () => document.removeEventListener("mousedown", handler);
  }, []);

  function formatPricing(model: OpenRouterModel): string {
    const prompt = model.pricing?.prompt;
    if (prompt == null || prompt === 0) return "Free";
    return `$${prompt.toFixed(2)}/1M`; // unit per OpenRouterModel.pricing JSDoc
  }

  return (
    <div ref={containerRef} style={{ position: "relative" }}>
      <input
        type="text"
        value={search}
        onChange={(e) => handleSearchChange(e.target.value)}
        onFocus={() => setOpen(true)}
        placeholder={loading ? "Loading models..." : "Search OpenRouter models..."}
        className="input-field w-full"
        style={{ fontSize: 12 }}
      />

      {open && !loading && (
        <div
          style={{
            position: "absolute",
            top: "100%",
            left: 0,
            right: 0,
            maxHeight: 280,
            overflowY: "auto",
            background: "var(--surface-2)",
            border: "1px solid var(--border-default)",
            borderRadius: 8,
            marginTop: 4,
            zIndex: 20,
            boxShadow: "0 8px 24px rgba(0,0,0,0.4)",
          }}
        >
          {error && (
            <div className="px-3 py-2 text-[11px]" style={{ color: "var(--red)" }}>
              Failed to load models: {error}
            </div>
          )}
          {filtered.length === 0 && !error && (
            <div className="px-3 py-3 text-[11px]" style={{ color: "var(--text-tertiary)" }}>
              No models found
            </div>
          )}
          {filtered.map((m) => (
            <button
              key={m.id}
              onClick={() => {
                onChange(m.id);
                setSearch(m.id);
                setOpen(false);
              }}
              className="w-full text-left px-3 py-2 flex items-center justify-between transition-colors duration-100"
              style={{
                background: m.id === value ? "var(--accent-muted)" : "transparent",
                border: "none",
                cursor: "pointer",
                borderBottom: "1px solid var(--border-subtle)",
              }}
              onMouseEnter={(e) => { e.currentTarget.style.background = "var(--surface-3)"; }}
              onMouseLeave={(e) => { e.currentTarget.style.background = m.id === value ? "var(--accent-muted)" : "transparent"; }}
            >
              <div>
                <div className="text-[12px] font-medium" style={{ color: "var(--text-primary)" }}>
                  {m.name}
                </div>
                <div className="text-[10px]" style={{ color: "var(--text-tertiary)" }}>
                  {m.id}
                </div>
              </div>
              <span className="text-[10px] font-mono" style={{ color: "var(--text-tertiary)", whiteSpace: "nowrap" }}>
                {formatPricing(m)}
              </span>
            </button>
          ))}
        </div>
      )}
    </div>
  );
}
