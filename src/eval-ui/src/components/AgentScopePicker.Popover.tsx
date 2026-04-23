import { useEffect, useMemo, useRef } from "react";
import { createPortal } from "react-dom";
import { strings } from "../strings";
import type { PickerAgentEntry } from "./AgentScopePicker";

// ---------------------------------------------------------------------------
// 0686 T-002 (US-002): Two-pane popover for AgentScopePicker.
//
// Shape intentionally mirrors the AgentModelPicker's `PopoverShell` (see
// `AgentModelPicker.tsx`) — 600px wide, top-center, fade-in 120ms, Esc
// closes, click-outside closes. Duplication is kept minimal: we import the
// geometry constants here but render a dedicated shell so the two pickers
// can evolve independently (one chooses LLM model, one chooses scope).
//
// Left pane: AgentList (scroll, detected agents first, then a dim
// "Not detected" group).
// Right pane: AgentScopeStatsPane — installed/global counts, last-sync,
// health, and the "Switch for this studio session" CTA.
// ---------------------------------------------------------------------------

export interface AgentScopePickerPopoverProps {
  agents: PickerAgentEntry[];
  activeAgentId: string | null;
  focusedAgentId: string | null;
  onFocusAgent: (agentId: string) => void;
  onSwitch: (agentId: string) => void;
  onOpenSetup: (agentId: string) => void;
  onClose: () => void;
}

interface AggregateRow {
  kind: "aggregate";
  key: string;
  consumers: PickerAgentEntry[];
  sharedFolderPath: string;
  combinedCount: number;
}

interface IndividualRow {
  kind: "individual";
  key: string;
  agent: PickerAgentEntry;
}

type RenderedRow = AggregateRow | IndividualRow;

function groupForDisplay(agents: PickerAgentEntry[]): {
  detected: RenderedRow[];
  notDetected: IndividualRow[];
} {
  const detected: RenderedRow[] = [];
  const notDetected: IndividualRow[] = [];
  const seenGroupKeys = new Set<string>();

  for (const agent of agents) {
    if (agent.presence === "absent" || agent.health === "missing") {
      notDetected.push({ kind: "individual", key: agent.id, agent });
      continue;
    }
    // Shared-folder de-dup — group consumers once, skip individual rows.
    if (agent.sharedFolderGroup && agent.sharedFolderGroup.length > 1) {
      const groupKey = [...agent.sharedFolderGroup].sort().join("+");
      if (seenGroupKeys.has(groupKey)) continue;
      seenGroupKeys.add(groupKey);
      const consumers = agents.filter((a) =>
        agent.sharedFolderGroup!.includes(a.id),
      );
      detected.push({
        kind: "aggregate",
        key: `shared:${groupKey}`,
        consumers,
        sharedFolderPath: agent.sharedFolderPath ?? "~/.config/agents/skills",
        combinedCount: consumers.reduce((acc, c) => acc + c.globalCount, 0),
      });
      continue;
    }
    detected.push({ kind: "individual", key: agent.id, agent });
  }
  return { detected, notDetected };
}

export function AgentScopePickerPopover({
  agents,
  activeAgentId,
  focusedAgentId,
  onFocusAgent,
  onSwitch,
  onOpenSetup,
  onClose,
}: AgentScopePickerPopoverProps) {
  const shellRef = useRef<HTMLDivElement>(null);

  useEffect(() => {
    const handler = (e: KeyboardEvent) => {
      if (e.key === "Escape") {
        e.preventDefault();
        onClose();
      }
    };
    document.addEventListener("keydown", handler);
    return () => document.removeEventListener("keydown", handler);
  }, [onClose]);

  useEffect(() => {
    const handler = (e: MouseEvent) => {
      if (shellRef.current && !shellRef.current.contains(e.target as Node)) {
        onClose();
      }
    };
    // Register on next tick so the click that opened the popover doesn't
    // immediately close it.
    const id = setTimeout(() => {
      document.addEventListener("mousedown", handler);
    }, 0);
    return () => {
      clearTimeout(id);
      document.removeEventListener("mousedown", handler);
    };
  }, [onClose]);

  const rows = useMemo(() => groupForDisplay(agents), [agents]);
  const focusedAgent =
    agents.find((a) => a.id === focusedAgentId) ??
    agents.find((a) => a.id === activeAgentId) ??
    agents[0];

  if (typeof document === "undefined") return null;

  return createPortal(
    <div
      ref={shellRef}
      data-testid="agent-scope-picker-popover"
      role="dialog"
      aria-label={strings.scopePicker.popoverTitle}
      style={{
        position: "fixed",
        top: 96,
        left: "50%",
        transform: "translateX(-50%)",
        width: 600,
        maxWidth: "calc(100vw - 32px)",
        background: "var(--bg-surface, var(--surface-1))",
        border: "1px solid var(--border-default, var(--border-subtle))",
        borderRadius: 8,
        boxShadow: "0 18px 40px rgba(0,0,0,0.25)",
        overflow: "hidden",
        zIndex: 90,
        animation: "scopePickerFadeIn 120ms cubic-bezier(0.2, 0, 0, 1)",
      }}
    >
      <div style={{ display: "flex", height: 360, maxHeight: "60vh" }}>
        <section
          data-testid="agent-scope-picker-agents"
          style={{
            width: 260,
            borderRight: "1px solid var(--border-default, var(--border-subtle))",
            overflowY: "auto",
            padding: "6px 0",
          }}
        >
          {rows.detected.length === 0 && rows.notDetected.length === 0 && (
            <EmptyHint />
          )}
          {rows.detected.map((row) =>
            row.kind === "aggregate" ? (
              <SharedFolderRow
                key={row.key}
                row={row}
                onFocus={() =>
                  onFocusAgent(row.consumers[0]?.id ?? activeAgentId ?? "")
                }
              />
            ) : (
              <AgentRow
                key={row.key}
                agent={row.agent}
                focused={row.agent.id === focusedAgentId}
                active={row.agent.id === activeAgentId}
                onClick={() => onFocusAgent(row.agent.id)}
              />
            ),
          )}
          {rows.notDetected.length > 0 && (
            <>
              <div
                data-testid="agent-scope-not-detected-subheading"
                style={{
                  padding: "10px 14px 4px",
                  fontSize: 10,
                  fontWeight: 600,
                  letterSpacing: "0.08em",
                  textTransform: "uppercase",
                  color: "var(--text-tertiary)",
                }}
              >
                {strings.scopePicker.notDetectedSubheading}
              </div>
              {rows.notDetected.map((row) => (
                <NotDetectedRow
                  key={row.key}
                  agent={row.agent}
                  onSetUp={() => onOpenSetup(row.agent.id)}
                />
              ))}
            </>
          )}
        </section>
        <section
          data-testid="agent-scope-picker-stats"
          style={{ flex: 1, overflowY: "auto", padding: "14px 16px" }}
        >
          {focusedAgent ? (
            <StatsPane
              agent={focusedAgent}
              activeAgentId={activeAgentId}
              onSwitch={() => onSwitch(focusedAgent.id)}
            />
          ) : (
            <EmptyHint />
          )}
        </section>
      </div>
      <style>
        {`@keyframes scopePickerFadeIn {
          from { opacity: 0; transform: translateX(-50%) translateY(2px); }
          to { opacity: 1; transform: translateX(-50%) translateY(0); }
        }`}
      </style>
    </div>,
    document.body,
  );
}

function AgentRow({
  agent,
  focused,
  active,
  onClick,
}: {
  agent: PickerAgentEntry;
  focused: boolean;
  active: boolean;
  onClick: () => void;
}) {
  const dotColor =
    agent.health === "ok"
      ? "var(--color-ok, #22c55e)"
      : agent.health === "stale"
        ? "var(--color-own, #f59e0b)"
        : "var(--text-tertiary)";
  return (
    <button
      type="button"
      data-testid="agent-scope-row"
      data-agent-id={agent.id}
      data-active={active ? "true" : "false"}
      onClick={onClick}
      style={{
        display: "flex",
        alignItems: "center",
        gap: 10,
        width: "100%",
        padding: "8px 14px",
        background: focused
          ? "color-mix(in srgb, var(--accent-surface) 10%, transparent)"
          : "transparent",
        border: "none",
        cursor: "pointer",
        textAlign: "left",
        fontFamily: "var(--font-sans)",
        color: "var(--text-primary)",
      }}
    >
      <span
        aria-hidden="true"
        style={{
          width: 6,
          height: 6,
          borderRadius: "50%",
          background: dotColor,
          flexShrink: 0,
        }}
      />
      <span style={{ flex: 1, fontSize: 13 }}>{agent.displayName}</span>
      <span
        style={{
          fontFamily: "var(--font-mono)",
          fontSize: 10,
          color: "var(--text-secondary)",
          fontVariantNumeric: "tabular-nums",
        }}
      >
        {agent.installedCount}·{agent.globalCount}
      </span>
    </button>
  );
}

function SharedFolderRow({
  row,
  onFocus,
}: {
  row: AggregateRow;
  onFocus: () => void;
}) {
  return (
    <button
      type="button"
      data-testid="agent-scope-shared-folder-row"
      onClick={onFocus}
      style={{
        display: "flex",
        flexDirection: "column",
        alignItems: "flex-start",
        gap: 4,
        width: "100%",
        padding: "8px 14px",
        background: "transparent",
        border: "none",
        borderTop: "1px dashed var(--border-subtle)",
        borderBottom: "1px dashed var(--border-subtle)",
        cursor: "pointer",
        textAlign: "left",
        fontFamily: "var(--font-sans)",
        color: "var(--text-primary)",
      }}
    >
      <span
        style={{
          fontFamily: "var(--font-mono)",
          fontSize: 11,
          color: "var(--text-secondary)",
        }}
      >
        {row.sharedFolderPath}
      </span>
      <span style={{ display: "flex", gap: 6, flexWrap: "wrap" }}>
        {row.consumers.map((c) => (
          <span
            key={c.id}
            style={{
              fontSize: 10,
              padding: "1px 6px",
              borderRadius: 10,
              background:
                "color-mix(in srgb, var(--color-global) 20%, transparent)",
              color: "var(--text-primary)",
            }}
          >
            {c.id}
          </span>
        ))}
        <span
          style={{
            fontSize: 10,
            color: "var(--text-secondary)",
            fontFamily: "var(--font-mono)",
          }}
        >
          · {row.combinedCount} skills
        </span>
      </span>
    </button>
  );
}

function NotDetectedRow({
  agent,
  onSetUp,
}: {
  agent: PickerAgentEntry;
  onSetUp: () => void;
}) {
  return (
    <div
      style={{
        display: "flex",
        alignItems: "center",
        gap: 10,
        padding: "6px 14px",
        color: "var(--text-secondary)",
        fontFamily: "var(--font-sans)",
        fontSize: 12,
      }}
    >
      <span
        aria-hidden="true"
        style={{
          width: 6,
          height: 6,
          borderRadius: "50%",
          background: "var(--text-tertiary)",
          flexShrink: 0,
        }}
      />
      <span style={{ flex: 1 }}>{agent.displayName}</span>
      <button
        type="button"
        data-testid={`agent-scope-set-up-${agent.id}`}
        onClick={onSetUp}
        style={{
          background: "transparent",
          border: "1px solid var(--border-default, var(--border-subtle))",
          borderRadius: 4,
          padding: "2px 8px",
          color: "var(--text-primary)",
          fontSize: 11,
          cursor: "pointer",
        }}
      >
        {strings.scopePicker.setUpCta(agent.displayName)}
      </button>
    </div>
  );
}

function StatsPane({
  agent,
  activeAgentId,
  onSwitch,
}: {
  agent: PickerAgentEntry;
  activeAgentId: string | null;
  onSwitch: () => void;
}) {
  const isActive = agent.id === activeAgentId;
  return (
    <div style={{ display: "flex", flexDirection: "column", gap: 14 }}>
      <div>
        <div
          style={{
            fontFamily: "var(--font-serif)",
            fontSize: 16,
            fontWeight: 500,
            color: "var(--text-primary)",
          }}
        >
          {agent.displayName}
        </div>
        <div
          style={{
            fontSize: 11,
            color: "var(--text-secondary)",
            marginTop: 2,
          }}
        >
          {healthLabel(agent.health)}
        </div>
      </div>
      <dl
        style={{
          display: "grid",
          gridTemplateColumns: "auto 1fr",
          gap: "4px 12px",
          margin: 0,
          fontSize: 12,
        }}
      >
        <Row label={strings.scopePicker.statsInstalled} value={String(agent.installedCount)} />
        <Row label={strings.scopePicker.statsGlobal} value={String(agent.globalCount)} />
        <Row
          label={strings.scopePicker.statsLastSync}
          value={agent.lastSync ? formatRelative(agent.lastSync) : "—"}
        />
      </dl>
      <button
        type="button"
        data-testid="agent-scope-switch"
        onClick={onSwitch}
        disabled={isActive}
        style={{
          alignSelf: "flex-start",
          padding: "8px 14px",
          borderRadius: 6,
          border: "1px solid var(--border-default, var(--border-subtle))",
          background: isActive
            ? "transparent"
            : "color-mix(in srgb, var(--accent-surface) 20%, transparent)",
          color: "var(--text-primary)",
          fontSize: 12,
          fontWeight: 500,
          fontFamily: "var(--font-sans)",
          cursor: isActive ? "default" : "pointer",
          opacity: isActive ? 0.5 : 1,
        }}
      >
        {isActive ? "Active" : strings.scopePicker.switchCta}
      </button>
    </div>
  );
}

function Row({ label, value }: { label: string; value: string }) {
  return (
    <>
      <dt style={{ color: "var(--text-secondary)", margin: 0 }}>{label}</dt>
      <dd
        style={{
          color: "var(--text-primary)",
          margin: 0,
          fontFamily: "var(--font-mono)",
          fontVariantNumeric: "tabular-nums",
        }}
      >
        {value}
      </dd>
    </>
  );
}

function EmptyHint() {
  return (
    <div
      style={{
        padding: "16px 18px",
        fontSize: 12,
        color: "var(--text-secondary)",
      }}
    >
      No agents detected yet.
    </div>
  );
}

function formatRelative(iso: string): string {
  try {
    const t = new Date(iso).getTime();
    const ageMs = Date.now() - t;
    if (Number.isNaN(t)) return "—";
    const m = Math.round(ageMs / 60_000);
    if (m < 1) return "just now";
    if (m < 60) return `${m}m ago`;
    const h = Math.round(m / 60);
    if (h < 24) return `${h}h ago`;
    const d = Math.round(h / 24);
    return `${d}d ago`;
  } catch {
    return "—";
  }
}

function healthLabel(health: PickerAgentEntry["health"]): string {
  switch (health) {
    case "ok":
      return strings.scopePicker.statsHealthOk;
    case "stale":
      return strings.scopePicker.statsHealthStale;
    case "missing":
      return strings.scopePicker.statsHealthMissing;
  }
}
