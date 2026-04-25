// ---------------------------------------------------------------------------
// AgentModelPicker — brand-defining two-pane agent + model picker.
//
// Replaces the retired ModelSelector. Rendered in the top rail; opens a
// popover with AgentList (left) + ModelList (right) + footer. Keyboard-first:
// Cmd+K toggle, ↑↓ within pane, → model pane, ← agent pane, Enter select,
// Esc close. Footer Settings button opens SettingsModal.
// ---------------------------------------------------------------------------

import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import { createPortal } from "react-dom";
import { useAgentCatalog } from "../hooks/useAgentCatalog";
import { AgentList } from "./AgentList";
import { ModelList } from "./ModelList";
import { SettingsModal } from "./SettingsModal";
import { LockIcon } from "./LockedProviderRow";
import { strings } from "../strings";
import type { CredentialProvider } from "../hooks/useCredentialStorage";

export interface AgentModelPickerProps {
  onToast?: (message: string) => void;
}

function prefersReducedMotion(): boolean {
  if (typeof window === "undefined" || !window.matchMedia) return false;
  return window.matchMedia("(prefers-reduced-motion: reduce)").matches;
}

export function AgentModelPicker({ onToast }: AgentModelPickerProps) {
  const { status, catalog, focusAgent, setActive } = useAgentCatalog({
    onStaleCatalog: (agentId, ageMs) => {
      const minutes = Math.round(ageMs / 60_000);
      onToast?.(`Using cached ${agentId} catalog (${minutes} min old)`);
    },
  });
  const [open, setOpen] = useState(false);
  const [settingsOpen, setSettingsOpen] = useState(false);
  const [settingsInitial, setSettingsInitial] = useState<CredentialProvider | undefined>();
  const [focusedAgent, setFocusedAgent] = useState<string | null>(null);
  const [pane, setPane] = useState<"agents" | "models">("agents");
  // 0682 F-002 — Focused row in the model pane. Reset to 0 whenever the
  // focused agent changes or the popover (re)opens. Driven by ↑↓ when
  // pane === "models"; consumed by ModelList for aria-selected + visual focus.
  const [focusedModelIndex, setFocusedModelIndex] = useState(0);
  const triggerRef = useRef<HTMLButtonElement>(null);
  const popoverRef = useRef<HTMLDivElement>(null);

  // When the catalog loads, default focused agent = active.
  useEffect(() => {
    if (catalog && !focusedAgent) {
      setFocusedAgent(catalog.activeAgent ?? catalog.agents[0]?.id ?? null);
    }
  }, [catalog, focusedAgent]);

  const agents = catalog?.agents ?? [];
  const focusedEntry = useMemo(
    () => agents.find((a) => a.id === focusedAgent) ?? agents[0],
    [agents, focusedAgent],
  );

  // 0682 F-002 — Reset model focus to 0 when the focused agent changes so
  // ↑↓ navigation in the model pane always starts at the top of the new list.
  useEffect(() => {
    setFocusedModelIndex(0);
  }, [focusedAgent]);

  const openPopover = useCallback(() => {
    setOpen(true);
    setPane("agents");
    setFocusedAgent(catalog?.activeAgent ?? agents[0]?.id ?? null);
    setFocusedModelIndex(0);
  }, [catalog, agents]);

  const closePopover = useCallback(() => {
    setOpen(false);
    triggerRef.current?.focus();
  }, []);

  // Cmd+K toggle — but not when an input owns focus.
  useEffect(() => {
    const handler = (e: KeyboardEvent) => {
      if (!(e.metaKey || e.ctrlKey)) return;
      if (e.key.toLowerCase() !== "k") return;
      const tag = (document.activeElement as HTMLElement | null)?.tagName;
      if (tag === "INPUT" || tag === "TEXTAREA") return;
      e.preventDefault();
      setOpen((prev) => !prev);
    };
    window.addEventListener("keydown", handler);
    return () => window.removeEventListener("keydown", handler);
  }, []);

  // Keyboard within popover.
  useEffect(() => {
    if (!open) return;
    const handler = (e: KeyboardEvent) => {
      if (e.key === "Escape") {
        e.preventDefault();
        closePopover();
        return;
      }
      if (e.key === "ArrowDown") {
        e.preventDefault();
        moveWithin(1);
        return;
      }
      if (e.key === "ArrowUp") {
        e.preventDefault();
        moveWithin(-1);
        return;
      }
      if (e.key === "ArrowRight" && pane === "agents") {
        e.preventDefault();
        setPane("models");
        // 0682 F-002 — Preserve last index when re-entering the models pane;
        // clamp into range in case the focused agent changed (different list
        // length) since the last visit.
        setFocusedModelIndex((prev) => {
          const max = (focusedEntry?.models.length ?? 1) - 1;
          return Math.max(0, Math.min(prev, Math.max(0, max)));
        });
        return;
      }
      if (e.key === "ArrowLeft" && pane === "models") {
        e.preventDefault();
        setPane("agents");
        return;
      }
      if (e.key === "Enter") {
        e.preventDefault();
        if (pane === "agents" && focusedEntry) {
          setPane("models");
          setFocusedModelIndex(0);
        } else if (pane === "models" && focusedEntry) {
          // 0682 F-002 — Pick the row at focusedModelIndex (clamped), not
          // models[0] unconditionally. Pre-fix this always selected the
          // first model regardless of which row the user navigated to.
          const idx = Math.max(0, Math.min(focusedEntry.models.length - 1, focusedModelIndex));
          const model = focusedEntry.models[idx];
          if (model) {
            void setActive(focusedEntry.id, model.id);
            closePopover();
          }
        }
        return;
      }
    };
    function moveWithin(dir: number) {
      if (pane === "agents") {
        const idx = agents.findIndex((a) => a.id === focusedAgent);
        const next = agents[Math.max(0, Math.min(agents.length - 1, idx + dir))];
        if (next) {
          setFocusedAgent(next.id);
          focusAgent(next.id);
        }
        return;
      }
      // 0682 F-002 — Walk the model list when pane === "models". Pre-fix
      // this branch was a no-op and Enter always selected models[0].
      if (pane === "models" && focusedEntry) {
        const len = focusedEntry.models.length;
        if (len === 0) return;
        setFocusedModelIndex((prev) => {
          const next = prev + dir;
          return Math.max(0, Math.min(len - 1, next));
        });
      }
    }
    document.addEventListener("keydown", handler);
    return () => document.removeEventListener("keydown", handler);
  }, [open, pane, agents, focusedAgent, focusedEntry, focusedModelIndex, closePopover, focusAgent, setActive]);

  const handleOpenSettings = useCallback((providerTab?: string) => {
    if (providerTab === "anthropic" || providerTab === "openrouter") {
      setSettingsInitial(providerTab);
    } else {
      setSettingsInitial(undefined);
    }
    setSettingsOpen(true);
    setOpen(false);
  }, []);

  const activeAgentEntry = agents.find((a) => a.id === catalog?.activeAgent);
  const activeModelEntry = activeAgentEntry?.models.find((m) => m.id === catalog?.activeModel);

  const triggerLabel = useMemo(() => {
    if (status !== "ready" || !catalog) return "Loading…";
    const agentName = activeAgentEntry?.displayName ?? "Agent";
    const modelName = activeModelEntry?.displayName ?? catalog.activeModel ?? "Model";
    return `${agentName} · ${modelName}`;
  }, [status, catalog, activeAgentEntry, activeModelEntry]);

  return (
    <>
      <button
        ref={triggerRef}
        type="button"
        data-testid="agent-model-picker-trigger"
        onClick={() => (open ? closePopover() : openPopover())}
        aria-haspopup="listbox"
        aria-expanded={open}
        style={{
          display: "inline-flex",
          alignItems: "center",
          gap: 6,
          padding: "6px 10px",
          background: "var(--surface-2, var(--bg-surface))",
          border: "1px solid var(--border-subtle)",
          borderRadius: 6,
          color: "var(--text-primary)",
          fontSize: 12,
          cursor: "pointer",
          fontFamily: "'Inter Tight Variable', 'Inter Tight', system-ui, sans-serif",
        }}
      >
        <span
          aria-hidden="true"
          style={{
            width: 6,
            height: 6,
            borderRadius: "50%",
            background: activeAgentEntry?.available
              ? "var(--accent, var(--color-accent))"
              : "var(--text-muted, var(--text-tertiary))",
            flexShrink: 0,
          }}
        />
        <span>{triggerLabel}</span>
      </button>

      {open && typeof document !== "undefined" &&
        createPortal(
          <PopoverShell reducedMotion={prefersReducedMotion()} onClickOutside={closePopover}>
            <div style={{ display: "flex", height: 440, maxHeight: "60vh" }}>
              <AgentList
                agents={agents}
                activeAgentId={catalog?.activeAgent ?? null}
                focusedAgentId={focusedAgent}
                onFocus={(id) => {
                  setFocusedAgent(id);
                  focusAgent(id);
                }}
                onSelect={(id) => {
                  setFocusedAgent(id);
                  focusAgent(id);
                  setPane("models");
                }}
                onOpenSettings={handleOpenSettings}
              />
              {focusedEntry && (
                <ModelList
                  agent={focusedEntry}
                  activeModelId={catalog?.activeModel ?? null}
                  focusedIndex={pane === "models" ? focusedModelIndex : -1}
                  onSelect={(modelId) => {
                    void setActive(focusedEntry.id, modelId);
                    closePopover();
                  }}
                  onOpenSettings={handleOpenSettings}
                />
              )}
            </div>
            <div
              style={{
                height: 32,
                borderTop: "1px solid var(--border-default, var(--border-subtle))",
                padding: "0 12px",
                display: "flex",
                alignItems: "center",
                justifyContent: "space-between",
                fontSize: 11,
                color: "var(--text-muted, var(--text-tertiary))",
              }}
            >
              <button
                type="button"
                onClick={() => handleOpenSettings()}
                data-testid="picker-footer-settings"
                style={{
                  background: "transparent",
                  border: "none",
                  color: "var(--text-primary)",
                  fontSize: 11,
                  cursor: "pointer",
                  padding: "0 4px",
                }}
              >
                {strings.picker.settingsButton}
              </button>
              <span style={{ fontFamily: "'JetBrains Mono Variable', 'JetBrains Mono', monospace" }}>
                {strings.picker.footerHint}
              </span>
            </div>
          </PopoverShell>,
          document.body,
        )}

      <SettingsModal
        open={settingsOpen}
        onClose={() => setSettingsOpen(false)}
        initialProvider={settingsInitial}
        onToast={onToast}
      />
    </>
  );
}

interface PopoverShellProps {
  children: React.ReactNode;
  reducedMotion: boolean;
  onClickOutside: () => void;
}

function PopoverShell({ children, reducedMotion, onClickOutside }: PopoverShellProps) {
  const ref = useRef<HTMLDivElement>(null);
  useEffect(() => {
    const handler = (e: MouseEvent) => {
      if (ref.current && !ref.current.contains(e.target as Node)) {
        onClickOutside();
      }
    };
    document.addEventListener("mousedown", handler);
    return () => document.removeEventListener("mousedown", handler);
  }, [onClickOutside]);
  return (
    <div
      ref={ref}
      data-testid="agent-model-picker-popover"
      role="dialog"
      aria-label="Select agent and model"
      style={{
        position: "fixed",
        top: 56,
        left: "50%",
        transform: "translateX(-50%)",
        width: 720,
        background: "var(--bg-surface, var(--surface-1))",
        border: "1px solid var(--border-default, var(--border-subtle))",
        borderRadius: 8,
        overflow: "hidden",
        zIndex: 90,
        animation: reducedMotion ? undefined : "agentPickerFadeIn 120ms cubic-bezier(0.2, 0, 0, 1)",
      }}
    >
      {children}
      <style>
        {`@keyframes agentPickerFadeIn {
          from { opacity: 0; transform: translateX(-50%) translateY(2px); }
          to { opacity: 1; transform: translateX(-50%) translateY(0); }
        }`}
      </style>
    </div>
  );
}
