// ---------------------------------------------------------------------------
// AgentList — left pane of AgentModelPicker.
//
// 240px-wide. 36px rows. Renders wrapper-folder dot + availability glyph +
// Currently-active kicker. Keyboard nav (↑↓) is owned by AgentModelPicker;
// this component only renders and calls onFocus / onSelect.
// ---------------------------------------------------------------------------

import { LockIcon, LockedProviderRow } from "./LockedProviderRow";
import { strings } from "../strings";
import type { AgentEntry } from "../hooks/useAgentCatalog";

export interface AgentListProps {
  agents: AgentEntry[];
  activeAgentId: string | null;
  focusedAgentId: string | null;
  onFocus: (id: string) => void;
  onSelect: (id: string) => void;
  onOpenSettings: (providerTab?: string) => void;
}

// Providers above the divider (cloud / agentic editors).
// Below-divider: Ollama + LM Studio (locally installed).
const ABOVE_DIVIDER = new Set([
  "claude-cli",
  "anthropic",
  "openai",
  "openrouter",
  "cursor",
  "codex-cli",
  "gemini-cli",
  "copilot",
  "zed",
]);

export function AgentList({
  agents,
  activeAgentId,
  focusedAgentId,
  onFocus,
  onSelect,
  onOpenSettings,
}: AgentListProps) {
  const above = agents.filter((a) => ABOVE_DIVIDER.has(a.id));
  const below = agents.filter((a) => !ABOVE_DIVIDER.has(a.id));

  return (
    <div
      role="listbox"
      aria-label="Agent"
      data-testid="agent-list"
      style={{
        width: 240,
        borderRight: "1px solid var(--border-default, var(--border-subtle))",
        display: "flex",
        flexDirection: "column",
        overflowY: "auto",
      }}
    >
      {above.map((a) => (
        <AgentRow
          key={a.id}
          agent={a}
          isActive={a.id === activeAgentId}
          isFocused={a.id === focusedAgentId}
          onFocus={onFocus}
          onSelect={onSelect}
          onOpenSettings={onOpenSettings}
        />
      ))}
      {below.length > 0 && (
        <div
          style={{
            borderTop: "1px solid var(--border-default, var(--border-subtle))",
            margin: "4px 0",
          }}
          aria-hidden="true"
        />
      )}
      {below.map((a) => (
        <AgentRow
          key={a.id}
          agent={a}
          isActive={a.id === activeAgentId}
          isFocused={a.id === focusedAgentId}
          onFocus={onFocus}
          onSelect={onSelect}
          onOpenSettings={onOpenSettings}
        />
      ))}
    </div>
  );
}

interface AgentRowProps {
  agent: AgentEntry;
  isActive: boolean;
  isFocused: boolean;
  onFocus: (id: string) => void;
  onSelect: (id: string) => void;
  onOpenSettings: (providerTab?: string) => void;
}

function AgentRow({ agent, isActive, isFocused, onFocus, onSelect, onOpenSettings }: AgentRowProps) {
  const { providers } = strings;
  const captionByAgent: Record<string, string | undefined> = {
    "claude-cli": providers.claudeCli.caption,
    "anthropic": providers.anthropic.caption,
    "openrouter": providers.openrouter.caption,
  };
  const installCtaByAgent: Record<string, { label: string; url?: string } | undefined> = {
    "claude-cli": { label: providers.claudeCli.installCta, url: providers.claudeCli.installUrl },
    "cursor": { label: providers.cursor.installCta },
    "codex-cli": { label: providers.codexCli.installCta },
    "gemini-cli": { label: providers.geminiCli.installCta },
    "copilot": { label: providers.copilot.installCta },
    "zed": { label: providers.zed.installCta },
  };

  // 0686 T-012: Claude Code row stacks a billing caption under the agent
  // name, so fixed 36px clips the second line. Other rows keep 36px exactly
  // for visual continuity.
  const isClaudeCode = agent.id === "claude-cli" || agent.id === "claude-code";
  const rowStyle: React.CSSProperties = {
    minHeight: 36,
    height: isClaudeCode ? "auto" : 36,
    padding: isClaudeCode ? "6px 12px" : "0 12px",
    display: "flex",
    alignItems: "center",
    gap: 8,
    cursor: "pointer",
    position: "relative",
    background: isFocused ? "var(--surface-muted, var(--surface-3))" : "transparent",
    borderLeft: isActive
      ? "1px solid var(--accent, var(--color-accent))"
      : "1px solid transparent",
    fontFamily: "'Inter Tight Variable', 'Inter Tight', system-ui, sans-serif",
    fontSize: 13,
    fontWeight: isActive ? 500 : 400,
    color: "var(--text-primary)",
  };
  if (isActive) {
    rowStyle.background = "color-mix(in srgb, var(--accent, var(--color-accent)) 10%, transparent)";
  }

  return (
    <div
      role="option"
      aria-selected={isActive}
      data-testid={`agent-row-${agent.id}`}
      data-focused={isFocused || undefined}
      tabIndex={isFocused ? 0 : -1}
      onMouseEnter={() => onFocus(agent.id)}
      onFocus={() => onFocus(agent.id)}
      onClick={() => onSelect(agent.id)}
      style={rowStyle}
    >
      {/* Wrapper folder presence dot */}
      {agent.wrapperFolder && (
        <span
          data-testid={`wrapper-dot-${agent.id}`}
          aria-hidden="true"
          style={{
            width: 6,
            height: 6,
            borderRadius: "50%",
            flexShrink: 0,
            background: agent.wrapperFolderPresent
              ? "var(--accent, var(--color-accent))"
              : "transparent",
            border: agent.wrapperFolderPresent
              ? "none"
              : "1px solid var(--border-default, var(--border-subtle))",
          }}
        />
      )}
      {!agent.wrapperFolder && <span style={{ width: 6, height: 6, flexShrink: 0 }} aria-hidden="true" />}

      <span
        style={{
          flex: 1,
          minWidth: 0,
          display: "flex",
          flexDirection: "column",
          overflow: "hidden",
        }}
      >
        <span
          style={{
            overflow: "hidden",
            textOverflow: "ellipsis",
            whiteSpace: "nowrap",
          }}
        >
          {agent.displayName}
        </span>
        {/* 0686 T-012 (US-006): compact billing label + tooltip on Claude
            Code row. Label text + tooltip copy are research-verified and
            MUST stay byte-for-byte identical (enforced by
            AgentList.claudeCodeLabel.test.tsx). We support both `claude-cli`
            (runtime id in useAgentCatalog) and `claude-code` (server
            AgentsResponse id) so whichever surface drives the picker, the
            label still fires. */}
        {(agent.id === "claude-cli" || agent.id === "claude-code") && (
          <span
            data-testid="claude-code-billing-label"
            title={strings.claudeCodeLabel.tooltip}
            style={{
              fontSize: 10,
              color: "var(--text-secondary, var(--text-tertiary))",
              whiteSpace: "nowrap",
              overflow: "hidden",
              textOverflow: "ellipsis",
              marginTop: 1,
            }}
          >
            {strings.claudeCodeLabel.compactLabel}
          </span>
        )}
      </span>

      {/* Availability glyph */}
      <span
        aria-label={agent.available ? "available" : "locked"}
        style={{ color: agent.available ? "var(--accent, var(--color-accent))" : "var(--text-muted, var(--text-tertiary))", flexShrink: 0 }}
      >
        {agent.available ? <LockIcon unlocked size={10} /> : <LockIcon size={10} />}
      </span>

      {/* Currently active badge */}
      {isActive && (
        <span
          style={{
            fontSize: 10,
            textTransform: "uppercase",
            letterSpacing: "0.05em",
            fontWeight: 600,
            color: "var(--accent-ink, var(--accent))",
            flexShrink: 0,
          }}
          data-testid={`active-badge-${agent.id}`}
        >
          {strings.picker.currentlyActive}
        </span>
      )}

      {/* Inline locked CTA */}
      {!agent.available && agent.ctaType === "api-key" && (
        <LockedProviderRow
          variant="api-key"
          label={
            agent.id === "anthropic"
              ? providers.anthropic.addKeyCta
              : providers.openrouter.addKeyCta
          }
          onActivate={() => onOpenSettings(agent.id)}
        />
      )}
      {!agent.available && agent.ctaType === "cli-install" && installCtaByAgent[agent.id] && (
        <LockedProviderRow
          variant="cli-install"
          label={installCtaByAgent[agent.id]!.label}
          installUrl={installCtaByAgent[agent.id]!.url}
          onActivate={() => { /* handled via installUrl */ }}
        />
      )}
      {!agent.available && agent.ctaType === "start-service" && (
        <LockedProviderRow
          variant="start-service"
          label={
            agent.id === "ollama"
              ? providers.ollama.startServiceCta
              : providers.lmStudio.startServiceCta
          }
          onActivate={() => onOpenSettings(agent.id)}
        />
      )}

      {/* Caption tooltip (visible on hover via title for now — SR reads row label) */}
      {captionByAgent[agent.id] && (
        <span className="sr-only" data-testid={`caption-${agent.id}`}>
          {captionByAgent[agent.id]}
        </span>
      )}
    </div>
  );
}
