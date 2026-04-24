import { useCallback, useMemo, useRef, useState } from "react";
import type { AgentsResponse, AgentScopeEntry as ServerAgentScopeEntry } from "../types";
import { AgentScopePickerPopover } from "./AgentScopePicker.Popover";

// ---------------------------------------------------------------------------
// 0686 T-002 (US-002): AgentScopePicker — sticky 40px trigger row above the
// sidebar scroll pane. Clicking opens a two-pane popover (see
// AgentScopePicker.Popover.tsx) that reuses AgentModelPicker primitives.
//
// Scope pattern:
//   - The picker is OBLIVIOUS to how `agents` are fetched. App.tsx provides
//     the merged list (local detection + `/api/agents/scopes` when
//     available). Until the server CONTRACT_READY signal, the picker can
//     render from `useAgentCatalog` + placeholder counts.
//   - `activeAgentId` + `onActiveAgentChange` are the persistence seam —
//     App.tsx binds them to `useStudioPreferences.activeAgent` (0686 T-002
//     UI) and to the server `saveStudioSelection` once wired.
//   - `onOpenSetup(agentId)` fires for "Not detected" rows and routes the
//     SetupDrawer (see `useSetupDrawer`).
// ---------------------------------------------------------------------------

export interface PickerAgentEntry {
  id: string;
  displayName: string;
  /** "detected": binary OR wrapper folder OR global dir present.
   *  "absent":   zero presence — rendered under "Not detected". */
  presence: "detected" | "absent";
  installedCount: number;
  globalCount: number;
  lastSync: string | null;
  health: "ok" | "stale" | "missing";
  /** Populated for agents that share a globalSkillsDir (kimi+qwen, etc).
   *  All consumer IDs including the current one. */
  sharedFolderGroup?: string[];
  sharedFolderPath?: string;
  /** 0694 (AC-US4-04): When true, render a "Remote" badge instead of any
   *  install affordance (Set up button suppressed). Web-only agents like
   *  Devin / bolt.new / v0 / Replit. */
  isRemoteOnly?: boolean;
}

export interface AgentScopePickerProps {
  agents: PickerAgentEntry[];
  activeAgentId: string | null;
  onActiveAgentChange: (agentId: string) => void;
  onOpenSetup: (agentId: string) => void;
}

/**
 * 0686 adapter: server's `AgentsResponse` → picker-internal
 * `PickerAgentEntry[]`. Keeps the picker decoupled from the exact server
 * shape so we can evolve either end without cascading churn. Per-agent
 * `sharedFolderGroup` + `sharedFolderPath` are derived by cross-referencing
 * the response's top-level `sharedFolders` array.
 */
export function agentsResponseToPickerEntries(
  response: AgentsResponse,
): PickerAgentEntry[] {
  const folderByConsumer = new Map<string, { path: string; consumers: string[] }>();
  for (const folder of response.sharedFolders ?? []) {
    for (const consumerId of folder.consumers) {
      folderByConsumer.set(consumerId, folder);
    }
  }
  return response.agents.map((a: ServerAgentScopeEntry): PickerAgentEntry => {
    const folder = folderByConsumer.get(a.id);
    return {
      id: a.id,
      displayName: a.displayName,
      presence: a.detected ? "detected" : "absent",
      installedCount: a.localSkillCount,
      globalCount: a.globalSkillCount,
      lastSync: a.lastSync,
      health: a.health,
      sharedFolderGroup: folder ? folder.consumers : undefined,
      sharedFolderPath: folder ? folder.path : undefined,
      // 0694 (AC-US4-04): preserve the remote-only flag from the server
      // shape so the popover can suppress install affordances. Field is now
      // part of the canonical ServerAgentScopeEntry type.
      isRemoteOnly: a.isRemoteOnly,
    };
  });
}

export function AgentScopePicker({
  agents,
  activeAgentId,
  onActiveAgentChange,
  onOpenSetup,
}: AgentScopePickerProps) {
  const [open, setOpen] = useState(false);
  const [focusedAgentId, setFocusedAgentId] = useState<string | null>(null);
  const triggerRef = useRef<HTMLButtonElement>(null);

  const activeAgent = useMemo(
    () => agents.find((a) => a.id === activeAgentId) ?? agents[0] ?? null,
    [agents, activeAgentId],
  );

  const triggerDot = useMemo(() => {
    if (!activeAgent) return "var(--text-tertiary)";
    if (activeAgent.health === "ok") return "var(--color-ok, #22c55e)";
    if (activeAgent.health === "stale") return "var(--color-own, #f59e0b)";
    return "var(--text-tertiary)";
  }, [activeAgent]);

  const closePopover = useCallback(() => {
    setOpen(false);
    triggerRef.current?.focus();
  }, []);

  const handleSwitch = useCallback(
    (agentId: string) => {
      onActiveAgentChange(agentId);
      setOpen(false);
    },
    [onActiveAgentChange],
  );

  return (
    <>
      <button
        ref={triggerRef}
        type="button"
        data-testid="agent-scope-picker-trigger"
        aria-haspopup="dialog"
        aria-expanded={open}
        onClick={() => setOpen((v) => !v)}
        onKeyDown={(e) => {
          if (e.key === "Enter" || e.key === " ") {
            e.preventDefault();
            setOpen(true);
          }
        }}
        style={{
          display: "flex",
          alignItems: "center",
          gap: 10,
          height: "40px",
          width: "100%",
          padding: "0 14px",
          background: "var(--bg-surface, var(--surface-1))",
          border: "none",
          borderBottom: "1px solid var(--border-default, var(--border-subtle))",
          cursor: "pointer",
          color: "var(--text-primary)",
          fontFamily: "var(--font-sans)",
          fontSize: 13,
          fontWeight: 500,
          textAlign: "left",
          // Sticky at top of the left-pane scroll container (AC-US2-01).
          position: "sticky",
          top: 0,
          zIndex: 2,
        }}
      >
        <span
          aria-hidden="true"
          style={{
            width: 6,
            height: 6,
            borderRadius: "50%",
            background: triggerDot,
            flexShrink: 0,
          }}
        />
        <span style={{ flex: 1, minWidth: 0, overflow: "hidden", textOverflow: "ellipsis", whiteSpace: "nowrap" }}>
          {activeAgent?.displayName ?? "Select agent"}
        </span>
        <span
          style={{
            fontFamily: "var(--font-mono)",
            fontSize: 11,
            color: "var(--text-secondary)",
            fontVariantNumeric: "tabular-nums",
          }}
        >
          ({activeAgent?.installedCount ?? 0} · {activeAgent?.globalCount ?? 0})
        </span>
        <span aria-hidden="true" style={{ fontSize: 10, color: "var(--text-secondary)" }}>
          ▾
        </span>
      </button>
      {open && (
        <AgentScopePickerPopover
          agents={agents}
          activeAgentId={activeAgentId}
          focusedAgentId={focusedAgentId ?? activeAgentId}
          onFocusAgent={setFocusedAgentId}
          onSwitch={handleSwitch}
          onOpenSetup={(id) => {
            onOpenSetup(id);
            closePopover();
          }}
          onClose={closePopover}
        />
      )}
    </>
  );
}
