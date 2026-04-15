// ---------------------------------------------------------------------------
// AgentSelector — Checkbox group with feature indicators for target agents
// ---------------------------------------------------------------------------

export interface InstalledAgentEntry {
  id: string;
  displayName: string;
  featureSupport: {
    slashCommands: boolean;
    hooks: boolean;
    mcp: boolean;
    customSystemPrompt: boolean;
  };
  isUniversal: boolean;
  installed: boolean;
}

export interface AgentSelectorProps {
  agents: InstalledAgentEntry[];
  selectedIds: string[];
  onChange: (selectedIds: string[]) => void;
}

// ---------------------------------------------------------------------------
// Feature indicator badge
// ---------------------------------------------------------------------------

const featureLabels: { key: keyof InstalledAgentEntry["featureSupport"]; label: string }[] = [
  { key: "slashCommands", label: "Slash" },
  { key: "hooks", label: "Hooks" },
  { key: "mcp", label: "MCP" },
  { key: "customSystemPrompt", label: "Prompt" },
];

function FeatureBadge({ supported, label }: { supported: boolean; label: string }) {
  return (
    <span
      style={{
        display: "inline-block",
        fontSize: 10,
        padding: "1px 5px",
        borderRadius: 3,
        marginRight: 3,
        background: supported ? "var(--color-success-bg, #d4edda)" : "var(--surface-3, #2a2a2a)",
        color: supported ? "var(--color-success, #28a745)" : "var(--text-tertiary, #666)",
        border: `1px solid ${supported ? "var(--color-success, #28a745)" : "var(--border-subtle, #333)"}`,
      }}
    >
      {label}
    </span>
  );
}

// ---------------------------------------------------------------------------
// Agent row
// ---------------------------------------------------------------------------

function AgentRow({
  agent,
  checked,
  onToggle,
}: {
  agent: InstalledAgentEntry;
  checked: boolean;
  onToggle: () => void;
}) {
  return (
    <label
      style={{
        display: "flex",
        alignItems: "center",
        gap: 8,
        padding: "6px 8px",
        borderRadius: 6,
        cursor: "pointer",
        border: agent.installed
          ? "1px solid var(--color-primary, #6366f1)"
          : "1px solid var(--border-subtle, #333)",
        background: checked ? "var(--surface-2, #1e1e1e)" : "transparent",
      }}
    >
      <input
        type="checkbox"
        checked={checked}
        onChange={onToggle}
        style={{ accentColor: "var(--color-primary, #6366f1)" }}
      />
      <div style={{ flex: 1 }}>
        <div style={{ display: "flex", alignItems: "center", gap: 6 }}>
          <span style={{ fontWeight: 500, fontSize: 13, color: "var(--text-primary, #fff)" }}>
            {agent.displayName}
          </span>
          {agent.installed && (
            <span
              style={{
                fontSize: 10,
                padding: "1px 5px",
                borderRadius: 3,
                background: "var(--color-primary-bg, #312e81)",
                color: "var(--color-primary, #6366f1)",
              }}
            >
              installed
            </span>
          )}
        </div>
        <div style={{ marginTop: 3 }}>
          {featureLabels.map((f) => (
            <FeatureBadge
              key={f.key}
              supported={agent.featureSupport[f.key]}
              label={f.label}
            />
          ))}
        </div>
      </div>
    </label>
  );
}

// ---------------------------------------------------------------------------
// Main component
// ---------------------------------------------------------------------------

export function AgentSelector({ agents, selectedIds, onChange }: AgentSelectorProps) {
  const selectedSet = new Set(selectedIds);

  const universalAgents = agents.filter((a) => a.isUniversal);
  const otherAgents = agents.filter((a) => !a.isUniversal);

  const handleToggle = (agentId: string) => {
    const next = selectedSet.has(agentId)
      ? selectedIds.filter((id) => id !== agentId)
      : [...selectedIds, agentId];
    onChange(next);
  };

  return (
    <div style={{ display: "flex", flexDirection: "column", gap: 12 }}>
      {universalAgents.length > 0 && (
        <div>
          <div
            style={{
              fontSize: 11,
              fontWeight: 600,
              textTransform: "uppercase",
              letterSpacing: "0.05em",
              color: "var(--text-tertiary, #999)",
              marginBottom: 6,
            }}
          >
            Universal Agents
          </div>
          <div style={{ display: "flex", flexDirection: "column", gap: 4 }}>
            {universalAgents.map((agent) => (
              <AgentRow
                key={agent.id}
                agent={agent}
                checked={selectedSet.has(agent.id)}
                onToggle={() => handleToggle(agent.id)}
              />
            ))}
          </div>
        </div>
      )}
      {otherAgents.length > 0 && (
        <div>
          <div
            style={{
              fontSize: 11,
              fontWeight: 600,
              textTransform: "uppercase",
              letterSpacing: "0.05em",
              color: "var(--text-tertiary, #999)",
              marginBottom: 6,
            }}
          >
            Other Agents
          </div>
          <div style={{ display: "flex", flexDirection: "column", gap: 4 }}>
            {otherAgents.map((agent) => (
              <AgentRow
                key={agent.id}
                agent={agent}
                checked={selectedSet.has(agent.id)}
                onToggle={() => handleToggle(agent.id)}
              />
            ))}
          </div>
        </div>
      )}
    </div>
  );
}
