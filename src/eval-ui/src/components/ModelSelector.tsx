import { useState, useEffect, useRef } from "react";
import { api } from "../api";
import type { ConfigResponse, ProviderInfo } from "../api";

interface Props {
  onConfigChange?: (config: ConfigResponse) => void;
}

export function ModelSelector({ onConfigChange }: Props) {
  const [config, setConfig] = useState<ConfigResponse | null>(null);
  const [open, setOpen] = useState(false);
  const [saving, setSaving] = useState(false);
  const ref = useRef<HTMLDivElement>(null);

  useEffect(() => {
    api.getConfig().then(setConfig).catch(() => {});
  }, []);

  // Close on outside click
  useEffect(() => {
    function handleClick(e: MouseEvent) {
      if (ref.current && !ref.current.contains(e.target as Node)) {
        setOpen(false);
      }
    }
    if (open) document.addEventListener("mousedown", handleClick);
    return () => document.removeEventListener("mousedown", handleClick);
  }, [open]);

  async function selectProvider(provider: ProviderInfo, model?: string) {
    setSaving(true);
    try {
      const result = await api.setConfig(provider.id, model);
      setConfig(result);
      onConfigChange?.(result);
      setOpen(false);
    } catch {
      // Revert — re-fetch current config
      const current = await api.getConfig();
      setConfig(current);
    } finally {
      setSaving(false);
    }
  }

  if (!config) return null;

  const currentProvider = config.providers.find(
    (p) => p.id === config.provider,
  ) || config.providers.find((p) => p.available);

  return (
    <div ref={ref} className="relative">
      {/* Trigger button */}
      <button
        onClick={() => setOpen(!open)}
        className="flex items-center gap-2 px-3 py-1.5 rounded-lg text-[12px] font-mono transition-all duration-150"
        style={{
          background: "var(--surface-3)",
          color: "var(--accent)",
          border: "1px solid var(--border-subtle)",
        }}
        onMouseEnter={(e) => { e.currentTarget.style.borderColor = "var(--accent)"; }}
        onMouseLeave={(e) => { e.currentTarget.style.borderColor = "var(--border-subtle)"; }}
      >
        <svg width="12" height="12" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
          <circle cx="12" cy="12" r="3" />
          <path d="M12 1v2M12 21v2M4.22 4.22l1.42 1.42M18.36 18.36l1.42 1.42M1 12h2M21 12h2M4.22 19.78l1.42-1.42M18.36 5.64l1.42-1.42" />
        </svg>
        {config.model}
        <svg width="10" height="10" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.5"
          style={{ transform: open ? "rotate(180deg)" : "rotate(0)", transition: "transform 0.15s ease" }}>
          <polyline points="6 9 12 15 18 9" />
        </svg>
      </button>

      {/* Dropdown */}
      {open && (
        <div
          className="absolute top-full mt-1 right-0 w-72 rounded-xl shadow-xl z-50 overflow-hidden animate-fade-in"
          style={{
            background: "var(--surface-2)",
            border: "1px solid var(--border-subtle)",
          }}
        >
          <div className="px-4 py-3" style={{ borderBottom: "1px solid var(--border-subtle)" }}>
            <div className="text-[11px] font-semibold uppercase tracking-widest" style={{ color: "var(--text-tertiary)" }}>
              Select Model
            </div>
          </div>

          <div className="py-1.5 max-h-80 overflow-y-auto">
            {config.providers.map((provider) => (
              <div key={provider.id}>
                {/* Provider header */}
                <div className="px-4 py-2 flex items-center justify-between">
                  <span className="text-[11px] font-semibold" style={{ color: provider.available ? "var(--text-secondary)" : "var(--text-tertiary)" }}>
                    {provider.label}
                  </span>
                  {!provider.available && (
                    <span className="text-[10px] px-1.5 py-0.5 rounded" style={{ background: "var(--surface-3)", color: "var(--text-tertiary)" }}>
                      unavailable
                    </span>
                  )}
                </div>

                {/* Model options */}
                {provider.models.map((model) => {
                  const isActive = currentProvider?.id === provider.id && config.model === model;
                  const isDisabled = !provider.available || saving;

                  return (
                    <button
                      key={`${provider.id}-${model}`}
                      onClick={() => !isDisabled && selectProvider(provider, model)}
                      disabled={isDisabled}
                      className="w-full px-4 py-2 flex items-center gap-3 text-left transition-all duration-100"
                      style={{
                        background: isActive ? "var(--accent-muted)" : "transparent",
                        color: isDisabled ? "var(--text-tertiary)" : "var(--text-primary)",
                        opacity: isDisabled ? 0.5 : 1,
                        cursor: isDisabled ? "not-allowed" : "pointer",
                      }}
                      onMouseEnter={(e) => { if (!isDisabled && !isActive) e.currentTarget.style.background = "var(--surface-3)"; }}
                      onMouseLeave={(e) => { if (!isActive) e.currentTarget.style.background = "transparent"; }}
                    >
                      {/* Radio indicator */}
                      <div
                        className="w-3.5 h-3.5 rounded-full flex-shrink-0 flex items-center justify-center"
                        style={{
                          border: `2px solid ${isActive ? "var(--accent)" : "var(--border-subtle)"}`,
                        }}
                      >
                        {isActive && (
                          <div className="w-1.5 h-1.5 rounded-full" style={{ background: "var(--accent)" }} />
                        )}
                      </div>
                      <span className="text-[12px] font-mono">{model}</span>
                    </button>
                  );
                })}
              </div>
            ))}
          </div>
        </div>
      )}
    </div>
  );
}
