import { useState, useEffect, useRef } from "react";
import { api } from "../api";
import type { ConfigResponse, ProviderInfo, ModelOption } from "../api";

export function ModelSelector() {
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

  async function selectModel(provider: ProviderInfo, model: ModelOption) {
    setSaving(true);
    try {
      const result = await api.setConfig(provider.id, model.id);
      setConfig(result);
      setOpen(false);
    } catch {
      const current = await api.getConfig();
      setConfig(current);
    } finally {
      setSaving(false);
    }
  }

  if (!config) return null;

  // Find human-readable label for current model
  const currentLabel = findCurrentLabel(config);

  return (
    <div ref={ref} className="relative">
      {/* Trigger button */}
      <button
        onClick={() => setOpen(!open)}
        className="w-full flex items-center gap-2 px-3 py-2 rounded-lg text-[12px] transition-all duration-150"
        style={{
          background: "var(--surface-3)",
          color: "var(--text-primary)",
          border: "1px solid var(--border-subtle)",
        }}
        onMouseEnter={(e) => { e.currentTarget.style.borderColor = "var(--accent)"; }}
        onMouseLeave={(e) => { e.currentTarget.style.borderColor = "var(--border-subtle)"; }}
      >
        <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="var(--accent)" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
          <circle cx="12" cy="12" r="3" />
          <path d="M12 1v2M12 21v2M4.22 4.22l1.42 1.42M18.36 18.36l1.42 1.42M1 12h2M21 12h2M4.22 19.78l1.42-1.42M18.36 5.64l1.42-1.42" />
        </svg>
        <span className="flex-1 text-left font-medium truncate">{currentLabel}</span>
        <svg width="10" height="10" viewBox="0 0 24 24" fill="none" stroke="var(--text-tertiary)" strokeWidth="2.5"
          style={{ transform: open ? "rotate(180deg)" : "rotate(0)", transition: "transform 0.15s ease" }}>
          <polyline points="6 9 12 15 18 9" />
        </svg>
      </button>

      {/* Dropdown */}
      {open && (
        <div
          className="absolute bottom-full mb-1 left-0 w-64 rounded-xl shadow-xl z-50 overflow-hidden animate-fade-in"
          style={{
            background: "var(--surface-2)",
            border: "1px solid var(--border-subtle)",
          }}
        >
          <div className="px-4 py-2.5" style={{ borderBottom: "1px solid var(--border-subtle)" }}>
            <div className="text-[11px] font-semibold uppercase tracking-widest" style={{ color: "var(--text-tertiary)" }}>
              Select Model
            </div>
          </div>

          <div className="py-1 max-h-80 overflow-y-auto">
            {config.providers.map((provider) => (
              <div key={provider.id}>
                {/* Provider header */}
                <div className="px-4 py-1.5 flex items-center gap-2">
                  <span
                    className="w-1.5 h-1.5 rounded-full flex-shrink-0"
                    style={{ background: provider.available ? "var(--green)" : "var(--text-tertiary)", opacity: provider.available ? 1 : 0.3 }}
                  />
                  <span className="text-[10px] font-semibold uppercase tracking-wider" style={{
                    color: "var(--text-tertiary)",
                    opacity: provider.available ? 1 : 0.5,
                  }}>
                    {provider.label}
                  </span>
                </div>

                {/* Model options */}
                {provider.models.map((model) => {
                  const isActive = isModelActive(config, provider.id, model.id);
                  const isDisabled = !provider.available || saving;

                  return (
                    <button
                      key={`${provider.id}-${model.id}`}
                      onClick={() => !isDisabled && selectModel(provider, model)}
                      disabled={isDisabled}
                      className="w-full px-4 py-2 flex items-center gap-2.5 text-left transition-all duration-100"
                      style={{
                        background: isActive ? "var(--accent-muted)" : "transparent",
                        color: isDisabled ? "var(--text-tertiary)" : "var(--text-primary)",
                        opacity: isDisabled ? 0.4 : 1,
                        cursor: isDisabled ? "not-allowed" : "pointer",
                      }}
                      onMouseEnter={(e) => { if (!isDisabled && !isActive) e.currentTarget.style.background = "var(--surface-3)"; }}
                      onMouseLeave={(e) => { if (!isActive) e.currentTarget.style.background = "transparent"; }}
                    >
                      <div
                        className="w-3 h-3 rounded-full flex-shrink-0 flex items-center justify-center"
                        style={{ border: `2px solid ${isActive ? "var(--accent)" : "var(--border-subtle)"}` }}
                      >
                        {isActive && <div className="w-1.5 h-1.5 rounded-full" style={{ background: "var(--accent)" }} />}
                      </div>
                      <span className="text-[12px]" style={{ fontWeight: isActive ? 600 : 400 }} title={model.id}>{model.label}</span>
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

/** Determine if a model option is the currently active one. */
function isModelActive(config: ConfigResponse, providerId: string, modelId: string): boolean {
  // Match by provider + check if model string contains the model id
  if (config.provider !== providerId) return false;
  // claude-cli model is "claude-{id}" (e.g. "claude-sonnet"), others are the raw id
  if (providerId === "claude-cli") {
    return config.model === `claude-${modelId}`;
  }
  return config.model === modelId;
}

/** Find a human-readable label for the currently active model. */
function findCurrentLabel(config: ConfigResponse): string {
  for (const provider of config.providers) {
    for (const model of provider.models) {
      if (isModelActive(config, provider.id, model.id)) {
        return model.label;
      }
    }
  }
  // Fallback to raw model string
  return config.model;
}
