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

  const currentLabel = findCurrentLabel(config);
  const currentProvider = findCurrentProvider(config);

  return (
    <div ref={ref} className="relative">
      {/* Compact trigger */}
      <button
        onClick={() => setOpen(!open)}
        className="w-full flex items-center gap-2 px-2.5 py-1.5 rounded-lg text-[11px] transition-all duration-150"
        style={{
          background: open ? "var(--surface-3)" : "var(--surface-2)",
          border: `1px solid ${open ? "var(--accent)" : "var(--border-subtle)"}`,
          cursor: "pointer",
        }}
        onMouseEnter={(e) => {
          if (!open) e.currentTarget.style.borderColor = "var(--accent)";
        }}
        onMouseLeave={(e) => {
          if (!open) e.currentTarget.style.borderColor = "var(--border-subtle)";
        }}
      >
        {/* Provider dot */}
        <span
          className="w-1.5 h-1.5 rounded-full flex-shrink-0"
          style={{ background: currentProvider?.available ? "var(--green)" : "var(--text-tertiary)" }}
        />
        <span className="flex-1 text-left font-medium truncate" style={{ color: "var(--text-primary)" }}>
          {currentLabel}
        </span>
        <svg
          width="10" height="10" viewBox="0 0 24 24" fill="none"
          stroke="var(--text-tertiary)" strokeWidth="2.5"
          style={{ transform: open ? "rotate(180deg)" : "rotate(0)", transition: "transform 0.15s ease", flexShrink: 0 }}
        >
          <polyline points="6 9 12 15 18 9" />
        </svg>
      </button>

      {/* Dropdown — opens downward */}
      {open && (
        <div
          className="absolute top-full mt-1 left-0 right-0 rounded-xl shadow-xl z-50 overflow-hidden animate-fade-in"
          style={{
            background: "var(--surface-2)",
            border: "1px solid var(--border-subtle)",
            minWidth: "240px",
          }}
        >
          <div className="px-3 py-2" style={{ borderBottom: "1px solid var(--border-subtle)" }}>
            <div className="text-[10px] font-semibold uppercase tracking-widest" style={{ color: "var(--text-tertiary)" }}>
              Select Model
            </div>
          </div>

          <div className="py-1 max-h-72 overflow-y-auto">
            {config.providers.map((provider) => (
              <div key={provider.id}>
                {/* Provider header */}
                <div className="px-3 py-1.5 flex items-center gap-2">
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
                      className="w-full px-3 py-1.5 flex items-center gap-2.5 text-left transition-all duration-100"
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
  if (config.provider !== providerId) return false;
  if (providerId === "claude-cli") {
    return config.model === `claude-${modelId}`;
  }
  return config.model === modelId;
}

/** Find the provider info for the currently active model. */
function findCurrentProvider(config: ConfigResponse): ProviderInfo | undefined {
  return config.providers.find((p) => p.id === config.provider);
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
  return config.model;
}
