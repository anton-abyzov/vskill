// ---------------------------------------------------------------------------
// ModelList — right pane of the AgentModelPicker.
//
// 360px-wide. 44px two-line rows. Search input + virtualisation at 80+ rows.
// Empty-state CTA card (no models yet, e.g. OpenRouter without a key).
// ---------------------------------------------------------------------------

import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import type { AgentEntry, ModelEntry } from "../hooks/useAgentCatalog";
import { useVirtualList } from "../hooks/useVirtualList";
import { strings } from "../strings";
import { LockedProviderRow } from "./LockedProviderRow";

const ROW_HEIGHT = 44;
const VIEWPORT_HEIGHT = 352; // 8 rows
const DEBOUNCE_MS = 60;

export interface ModelListProps {
  agent: AgentEntry;
  activeModelId: string | null;
  onSelect: (modelId: string) => void;
  onOpenSettings: (providerTab?: string) => void;
}

function formatMetadata(model: ModelEntry): string {
  const ctx = model.contextWindow
    ? model.contextWindow >= 1_000_000
      ? `${Math.round(model.contextWindow / 1_000_000)}M`
      : model.contextWindow >= 1_000
        ? `${Math.round(model.contextWindow / 1_000)}k`
        : String(model.contextWindow)
    : null;

  if (model.billingMode === "subscription") {
    return ctx ? `${ctx} ctx ${strings.models.subscriptionBilling}` : strings.models.subscriptionBilling.trim();
  }
  if (model.billingMode === "free") {
    return ctx ? `local · ${ctx} ctx · free` : "local · free";
  }
  // per-token
  const p = model.pricing?.prompt ?? 0;
  const c = model.pricing?.completion ?? 0;
  const price = `$${p.toFixed(2)} / $${c.toFixed(2)} per 1M tokens`;
  return ctx ? `${ctx} ctx · ${price}` : price;
}

function rankFiltered(models: ModelEntry[], q: string): ModelEntry[] {
  if (!q) return models;
  const query = q.toLowerCase();
  const matches = models.filter((m) => m.displayName.toLowerCase().includes(query));
  return matches.sort((a, b) => {
    const ai = a.displayName.toLowerCase().indexOf(query);
    const bi = b.displayName.toLowerCase().indexOf(query);
    if (ai !== bi) return ai - bi;
    return a.displayName.length - b.displayName.length;
  });
}

export function ModelList({ agent, activeModelId, onSelect, onOpenSettings }: ModelListProps) {
  const [rawQuery, setRawQuery] = useState("");
  const [debouncedQuery, setDebouncedQuery] = useState("");
  const searchRef = useRef<HTMLInputElement>(null);

  // Debounce query for filter.
  useEffect(() => {
    const t = setTimeout(() => setDebouncedQuery(rawQuery), DEBOUNCE_MS);
    return () => clearTimeout(t);
  }, [rawQuery]);

  // Auto-focus search when OpenRouter is the agent.
  useEffect(() => {
    if (agent.id === "openrouter" && agent.available && searchRef.current) {
      searchRef.current.focus();
    }
  }, [agent.id, agent.available]);

  // Empty-state CTA for OpenRouter without a key.
  if (agent.id === "openrouter" && !agent.available) {
    return (
      <div
        data-testid="openrouter-empty-card"
        style={{
          width: 360,
          padding: 20,
          display: "flex",
          flexDirection: "column",
          gap: 12,
        }}
      >
        <p style={{ margin: 0, color: "var(--text-primary)", fontSize: 13, lineHeight: 1.5 }}>
          {strings.providers.openrouter.emptyCardBody}
        </p>
        <button
          type="button"
          onClick={() => onOpenSettings("openrouter")}
          style={{
            alignSelf: "flex-start",
            padding: "6px 10px",
            borderRadius: 6,
            background: "var(--accent, var(--color-accent))",
            color: "var(--bg-surface, white)",
            border: "none",
            fontSize: 12,
            fontWeight: 500,
            cursor: "pointer",
          }}
        >
          {strings.providers.openrouter.addKeyCta}
        </button>
      </div>
    );
  }

  const filtered = useMemo(
    () => rankFiltered(agent.models, debouncedQuery),
    [agent.models, debouncedQuery],
  );

  const v = useVirtualList(filtered.length, ROW_HEIGHT, VIEWPORT_HEIGHT);

  return (
    <div
      role="listbox"
      aria-label="Model"
      data-testid="model-list"
      style={{ width: 360, display: "flex", flexDirection: "column" }}
    >
      {agent.id === "openrouter" && (
        <div style={{ padding: 8, borderBottom: "1px solid var(--border-default, var(--border-subtle))" }}>
          <input
            ref={searchRef}
            type="text"
            placeholder={strings.picker.searchPlaceholder}
            value={rawQuery}
            onChange={(e) => setRawQuery(e.target.value)}
            data-testid="model-search-input"
            aria-label={strings.picker.searchPlaceholder}
            style={{
              width: "100%",
              padding: "6px 8px",
              background: "var(--surface-2, var(--bg-surface))",
              border: "1px solid var(--border-subtle)",
              borderRadius: 4,
              color: "var(--text-primary)",
              fontSize: 12,
              fontFamily: "'Inter Tight Variable', 'Inter Tight', system-ui, sans-serif",
            }}
          />
        </div>
      )}

      {filtered.length === 0 && debouncedQuery ? (
        <div style={{ padding: 16 }} data-testid="no-matches">
          <div style={{ color: "var(--text-muted, var(--text-tertiary))", fontSize: 12, marginBottom: 8 }}>
            {strings.picker.noMatches(debouncedQuery)}
          </div>
          <button
            type="button"
            onClick={() => setRawQuery("")}
            style={{
              padding: "4px 8px",
              background: "transparent",
              border: "1px solid var(--border-subtle)",
              borderRadius: 4,
              color: "var(--text-primary)",
              fontSize: 12,
              cursor: "pointer",
            }}
          >
            {strings.picker.clearSearch}
          </button>
        </div>
      ) : filtered.length === 0 ? (
        <div style={{ padding: 16, color: "var(--text-muted, var(--text-tertiary))", fontSize: 12 }}>
          {strings.picker.noModelsYet}
        </div>
      ) : (
        <div {...v.containerProps}>
          <div style={{ height: v.virtualised ? v.totalHeight : "auto", position: "relative" }}>
            <div style={{ transform: v.virtualised ? `translateY(${v.offsetTop}px)` : undefined }}>
              {filtered.slice(v.visibleStart, v.visibleEnd).map((model) => (
                <ModelRow
                  key={model.id}
                  model={model}
                  isActive={model.id === activeModelId}
                  onSelect={() => onSelect(model.id)}
                />
              ))}
            </div>
          </div>
        </div>
      )}
    </div>
  );
}

interface ModelRowProps {
  model: ModelEntry;
  isActive: boolean;
  onSelect: () => void;
}

function ModelRow({ model, isActive, onSelect }: ModelRowProps) {
  const metadata = formatMetadata(model);
  return (
    <button
      type="button"
      role="option"
      aria-selected={isActive}
      data-testid={`model-row-${model.id}`}
      onClick={onSelect}
      title={model.id}
      style={{
        width: "100%",
        height: ROW_HEIGHT,
        padding: "4px 12px",
        display: "flex",
        flexDirection: "column",
        alignItems: "flex-start",
        justifyContent: "center",
        gap: 2,
        background: isActive
          ? "color-mix(in srgb, var(--accent, var(--color-accent)) 10%, transparent)"
          : "transparent",
        borderLeft: isActive
          ? "1px solid var(--accent, var(--color-accent))"
          : "1px solid transparent",
        cursor: "pointer",
        fontFamily: "'Inter Tight Variable', 'Inter Tight', system-ui, sans-serif",
        textAlign: "left",
      }}
    >
      <span style={{ fontSize: 14, fontWeight: 500, color: "var(--text-primary)" }}>
        {model.displayName}
      </span>
      <span
        style={{
          fontSize: 12,
          fontFamily: "'JetBrains Mono Variable', 'JetBrains Mono', monospace",
          fontVariantNumeric: "tabular-nums",
          color: "var(--text-muted, var(--text-tertiary))",
        }}
      >
        {metadata}
      </span>
    </button>
  );
}
