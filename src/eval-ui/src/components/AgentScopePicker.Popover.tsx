import { useEffect, useMemo, useRef, useState } from "react";
import { createPortal } from "react-dom";
import { strings } from "../strings";
import type { PickerAgentEntry } from "./AgentScopePicker";
import type { SupportedAgent } from "../types";
import {
  fetchSupportedAgents,
  groupSupportedAgentsBySection,
} from "../api/install";

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
//
// 0845 T-018 (AC-US1-03..06, AC-US6-01): when `groupBy="installMode"` is
// passed, the popover renders THREE sections driven by /api/studio/supported-agents:
//   - "Detected on this machine"       (filesystem + detected)
//   - "Available to install"           (filesystem + undetected — with + Install here CTA)
//   - "Cloud only (paste required)"    (clipboard tier)
// The legacy `groupBy="presence"` view (default) is preserved verbatim so
// the existing AgentScopePicker.test.tsx snapshots still pass.
// ---------------------------------------------------------------------------

export type AgentScopePickerGroupMode = "presence" | "installMode";

export interface AgentScopePickerPopoverProps {
  agents: PickerAgentEntry[];
  activeAgentId: string | null;
  focusedAgentId: string | null;
  onFocusAgent: (agentId: string) => void;
  onSwitch: (agentId: string) => void;
  onOpenSetup: (agentId: string) => void;
  onClose: () => void;
  /**
   * 0845 T-018: opt-in to the three-section installMode view that pulls
   * supported agents from GET /api/studio/supported-agents. Defaults to
   * "presence" so existing callers and snapshot tests continue to work
   * unchanged (plan.md §8 R12).
   */
  groupBy?: AgentScopePickerGroupMode;
  /**
   * 0845 T-018 (AC-US1-05): clicking `+ Install here` on an "Available to
   * install" row opens the InstallTargetsModal with the chosen tool
   * pre-checked. Provided by the parent (App.tsx) so the popover itself
   * stays modal-agnostic. Only consulted when `groupBy="installMode"`.
   */
  onRequestInstall?: (agentId: string) => void;
  /**
   * Optional override for the supported-agents fetcher — used by tests
   * to inject a fake. Defaults to the real network helper.
   */
  fetchSupportedAgentsImpl?: typeof fetchSupportedAgents;
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
  // onOpenSetup is retained on the prop type for API stability with App.tsx
  // even though the "Not detected" row no longer renders a Set-Up button.
  // The setup drawer is still reachable via the `studio:open-setup-drawer`
  // event listener in App.tsx.
  onOpenSetup: _onOpenSetup,
  onClose,
  groupBy = "presence",
  onRequestInstall,
  fetchSupportedAgentsImpl,
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

  // 0845 T-018 — fetch supported agents only when groupBy="installMode".
  // Fetches once on mount (per popover open). The endpoint is bounded
  // server-side so the wait is short; we render a lightweight loading
  // hint while in flight.
  const [supported, setSupported] = useState<SupportedAgent[] | null>(null);
  const [supportedError, setSupportedError] = useState<string | null>(null);
  useEffect(() => {
    if (groupBy !== "installMode") return;
    let cancelled = false;
    const fetcher = fetchSupportedAgentsImpl ?? fetchSupportedAgents;
    fetcher()
      .then((list) => {
        if (!cancelled) setSupported(list);
      })
      .catch((err: unknown) => {
        if (cancelled) return;
        setSupportedError(err instanceof Error ? err.message : String(err));
      });
    return () => {
      cancelled = true;
    };
  }, [groupBy, fetchSupportedAgentsImpl]);

  const focusedAgent =
    agents.find((a) => a.id === focusedAgentId) ??
    agents.find((a) => a.id === activeAgentId) ??
    agents[0];

  if (typeof document === "undefined") return null;

  return createPortal(
    <div
      ref={shellRef}
      data-testid="agent-scope-picker-popover"
      data-group-by={groupBy}
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
          {groupBy === "installMode" ? (
            <InstallModeSections
              supported={supported}
              error={supportedError}
              focusedAgentId={focusedAgentId}
              activeAgentId={activeAgentId}
              onFocus={onFocusAgent}
              onRequestInstall={onRequestInstall}
            />
          ) : (
            <PresenceSections
              rows={rows}
              activeAgentId={activeAgentId}
              focusedAgentId={focusedAgentId}
              onFocus={onFocusAgent}
            />
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

// ---------------------------------------------------------------------------
// Legacy presence-grouped sections (default rendering — unchanged behavior).
// ---------------------------------------------------------------------------

function PresenceSections({
  rows,
  activeAgentId,
  focusedAgentId,
  onFocus,
}: {
  rows: { detected: RenderedRow[]; notDetected: IndividualRow[] };
  activeAgentId: string | null;
  focusedAgentId: string | null;
  onFocus: (agentId: string) => void;
}) {
  if (rows.detected.length === 0 && rows.notDetected.length === 0) {
    return <EmptyHint />;
  }
  return (
    <>
      {rows.detected.map((row) =>
        row.kind === "aggregate" ? (
          <SharedFolderRow
            key={row.key}
            row={row}
            onFocus={() =>
              onFocus(row.consumers[0]?.id ?? activeAgentId ?? "")
            }
          />
        ) : (
          <AgentRow
            key={row.key}
            agent={row.agent}
            focused={row.agent.id === focusedAgentId}
            active={row.agent.id === activeAgentId}
            onClick={() => onFocus(row.agent.id)}
          />
        ),
      )}
      {rows.notDetected.length > 0 && (
        <>
          <div
            data-testid="agent-scope-not-detected-subheading"
            title="These agents were not found on this machine. Hover a row to see which folder detection looked for."
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
            <NotDetectedRow key={row.key} agent={row.agent} />
          ))}
        </>
      )}
    </>
  );
}

// ---------------------------------------------------------------------------
// 0845 T-018 — three-section install-mode view.
// ---------------------------------------------------------------------------

function InstallModeSections({
  supported,
  error,
  focusedAgentId,
  activeAgentId,
  onFocus,
  onRequestInstall,
}: {
  supported: SupportedAgent[] | null;
  error: string | null;
  focusedAgentId: string | null;
  activeAgentId: string | null;
  onFocus: (agentId: string) => void;
  onRequestInstall?: (agentId: string) => void;
}) {
  if (error) {
    return (
      <div
        data-testid="agent-scope-supported-error"
        style={{
          padding: "16px 18px",
          fontSize: 12,
          color: "var(--color-error, #dc2626)",
        }}
      >
        Failed to load supported agents: {error}
      </div>
    );
  }
  if (supported === null) {
    return (
      <div
        data-testid="agent-scope-supported-loading"
        style={{
          padding: "16px 18px",
          fontSize: 12,
          color: "var(--text-secondary)",
        }}
      >
        Loading agents…
      </div>
    );
  }
  const groups = groupSupportedAgentsBySection(supported);
  return (
    <>
      <SupportedSection
        testId="agent-scope-section-detected"
        title="Detected on this machine"
        agents={groups.detected}
        emptyHint="No agents detected on this machine yet."
        renderRow={(a) => (
          <SupportedAgentRow
            key={a.id}
            agent={a}
            focused={a.id === focusedAgentId}
            active={a.id === activeAgentId}
            onClick={() => onFocus(a.id)}
            kind="detected"
          />
        )}
      />
      <SupportedSection
        testId="agent-scope-section-available"
        title="Available to install"
        agents={groups.available}
        emptyHint="All supported agents are detected — nothing left to install here."
        renderRow={(a) => (
          <SupportedAgentRow
            key={a.id}
            agent={a}
            focused={a.id === focusedAgentId}
            active={false}
            onClick={() => onFocus(a.id)}
            kind="available"
            onRequestInstall={onRequestInstall}
          />
        )}
      />
      <SupportedSection
        testId="agent-scope-section-cloud"
        title="Cloud only (paste required)"
        agents={groups.cloud}
        emptyHint="No cloud-only tools available."
        renderRow={(a) => (
          <SupportedAgentRow
            key={a.id}
            agent={a}
            focused={a.id === focusedAgentId}
            active={false}
            onClick={() => onFocus(a.id)}
            kind="cloud"
            onRequestInstall={onRequestInstall}
          />
        )}
      />
    </>
  );
}

function SupportedSection({
  testId,
  title,
  agents,
  emptyHint,
  renderRow,
}: {
  testId: string;
  title: string;
  agents: SupportedAgent[];
  emptyHint: string;
  renderRow: (agent: SupportedAgent) => React.ReactNode;
}) {
  return (
    <div data-testid={testId}>
      <div
        style={{
          padding: "10px 14px 4px",
          fontSize: 10,
          fontWeight: 600,
          letterSpacing: "0.08em",
          textTransform: "uppercase",
          color: "var(--text-tertiary)",
        }}
      >
        {title}
      </div>
      {agents.length === 0 ? (
        <div
          style={{
            padding: "4px 14px 8px",
            fontSize: 11,
            color: "var(--text-tertiary)",
            fontStyle: "italic",
          }}
        >
          {emptyHint}
        </div>
      ) : (
        agents.map(renderRow)
      )}
    </div>
  );
}

function SupportedAgentRow({
  agent,
  focused,
  active,
  onClick,
  kind,
  onRequestInstall,
}: {
  agent: SupportedAgent;
  focused: boolean;
  active: boolean;
  onClick: () => void;
  kind: "detected" | "available" | "cloud";
  onRequestInstall?: (agentId: string) => void;
}) {
  const dotColor =
    kind === "detected"
      ? "var(--color-ok, #22c55e)"
      : kind === "available"
        ? "var(--color-own, #f59e0b)"
        : "var(--text-tertiary)";
  const pathDisplay =
    kind === "cloud" ? "Copy to clipboard" : agent.resolvedGlobalDir;
  return (
    <div
      data-testid={`agent-scope-supported-row-${agent.id}`}
      data-kind={kind}
      data-detected={agent.detected ? "true" : "false"}
      style={{
        display: "flex",
        flexDirection: "column",
        gap: 2,
        padding: "6px 14px",
        background: focused
          ? "color-mix(in srgb, var(--accent-surface) 10%, transparent)"
          : "transparent",
      }}
    >
      <button
        type="button"
        onClick={onClick}
        data-testid={`agent-scope-supported-row-button-${agent.id}`}
        data-active={active ? "true" : "false"}
        style={{
          display: "flex",
          alignItems: "center",
          gap: 10,
          width: "100%",
          background: "transparent",
          border: "none",
          cursor: "pointer",
          textAlign: "left",
          padding: 0,
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
          title="Install tier"
          style={{
            fontFamily: "var(--font-mono)",
            fontSize: 9,
            color: "var(--text-secondary)",
            letterSpacing: "0.04em",
            textTransform: "uppercase",
          }}
        >
          T{agent.tier}
        </span>
      </button>
      <div
        title={pathDisplay}
        style={{
          fontFamily: "var(--font-mono)",
          fontSize: 10,
          color: "var(--text-tertiary)",
          paddingLeft: 16,
          overflow: "hidden",
          textOverflow: "ellipsis",
          whiteSpace: "nowrap",
        }}
      >
        {pathDisplay}
      </div>
      {kind === "available" && onRequestInstall && (
        <button
          type="button"
          data-testid={`agent-scope-install-cta-${agent.id}`}
          onClick={(e) => {
            e.stopPropagation();
            onRequestInstall(agent.id);
          }}
          style={{
            alignSelf: "flex-start",
            marginLeft: 16,
            marginTop: 2,
            padding: "2px 8px",
            border: "1px solid var(--border-default, var(--border-subtle))",
            borderRadius: 4,
            background: "transparent",
            color: "var(--accent-text, var(--text-primary))",
            cursor: "pointer",
            fontSize: 11,
            fontFamily: "var(--font-sans)",
          }}
        >
          + Install here
        </button>
      )}
    </div>
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
        title="project · personal · plugins"
        style={{
          fontFamily: "var(--font-mono)",
          fontSize: 10,
          color: "var(--text-secondary)",
          fontVariantNumeric: "tabular-nums",
        }}
      >
        {agent.installedCount}·{agent.globalCount}·{agent.pluginCount ?? 0}
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

function NotDetectedRow({ agent }: { agent: PickerAgentEntry }) {
  // Passive row — no install affordance. The row's `title` tooltip explains
  // which folder detection looked for so users can see why the agent is
  // "Not detected" (e.g. `~/.bolt/skills` for bolt.new) without opening a
  // setup drawer. Remote-only agents get a distinct explanation because no
  // local folder exists to look for.
  const rowTitle = agent.isRemoteOnly
    ? `${agent.displayName} is a web-only product — no local CLI or folder to detect.`
    : agent.resolvedGlobalDir
      ? `Looked for ${agent.resolvedGlobalDir} — not found.`
      : `${agent.displayName} was not found on this machine.`;
  return (
    <div
      data-testid={`agent-scope-not-detected-row-${agent.id}`}
      title={rowTitle}
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
      {agent.isRemoteOnly && (
        // 0694 (AC-US4-04): web-only agents have no local install path —
        // render a "Remote" badge with an explanatory tooltip so users see
        // why no install affordance is offered.
        <span
          data-testid={`agent-scope-remote-badge-${agent.id}`}
          aria-label="Remote-only agent"
          title="Web-only agent — no local CLI to install skills into. Use the agent's web UI to load skills."
          style={{
            background: "color-mix(in srgb, var(--text-tertiary) 18%, transparent)",
            border: "1px solid var(--border-default, var(--border-subtle))",
            borderRadius: 10,
            padding: "1px 8px",
            color: "var(--text-secondary)",
            fontSize: 10,
            letterSpacing: "0.04em",
            textTransform: "uppercase",
          }}
        >
          Remote
        </span>
      )}
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
  // 0694 (AC-US4-04 / F-005): web-only agents have no local install path,
  // so switching to one would put downstream install flows in a broken
  // state. Disable the Switch button and surface the reason inline.
  const isRemoteOnly = agent.isRemoteOnly === true;
  const switchDisabled = isActive || isRemoteOnly;
  const switchLabel = isActive
    ? "Active"
    : isRemoteOnly
      ? "Remote-only"
      : strings.scopePicker.switchCta;
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
          {isRemoteOnly ? "Remote service — no local install" : healthLabel(agent.health)}
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
        <Row label={strings.scopePicker.statsPlugins} value={String(agent.pluginCount ?? 0)} />
        <Row
          label={strings.scopePicker.statsLastSync}
          value={agent.lastSync ? formatRelative(agent.lastSync) : "—"}
        />
      </dl>
      <button
        type="button"
        data-testid="agent-scope-switch"
        onClick={onSwitch}
        disabled={switchDisabled}
        title={isRemoteOnly ? "This agent has no local CLI to switch to" : undefined}
        style={{
          alignSelf: "flex-start",
          padding: "8px 14px",
          borderRadius: 6,
          border: "1px solid var(--border-default, var(--border-subtle))",
          background: switchDisabled
            ? "transparent"
            : "color-mix(in srgb, var(--accent-surface) 20%, transparent)",
          color: "var(--text-primary)",
          fontSize: 12,
          fontWeight: 500,
          fontFamily: "var(--font-sans)",
          cursor: switchDisabled ? "default" : "pointer",
          opacity: switchDisabled ? 0.5 : 1,
        }}
      >
        {switchLabel}
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
