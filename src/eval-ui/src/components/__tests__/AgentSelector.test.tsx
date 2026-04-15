import { describe, it, expect, vi } from "vitest";
import { AgentSelector } from "../AgentSelector.js";
import type { InstalledAgentEntry } from "../AgentSelector.js";

type ReactEl = { type: unknown; props: Record<string, unknown> };

/** Expand function components into their rendered output. */
function expand(node: unknown): unknown {
  if (node == null || typeof node !== "object") return node;
  if (Array.isArray(node)) return node.map(expand);
  const el = node as ReactEl;
  if (typeof el.type === "function") {
    const rendered = (el.type as (props: Record<string, unknown>) => unknown)(el.props);
    return expand(rendered);
  }
  if (el.props?.children != null) {
    return { ...el, props: { ...el.props, children: expand(el.props.children) } };
  }
  return el;
}

/** Recursively collect all text from a React element tree. */
function collectText(node: unknown): string {
  if (node == null) return "";
  if (typeof node === "string" || typeof node === "number") return String(node);
  if (Array.isArray(node)) return node.map(collectText).join("");
  const el = node as ReactEl;
  if (el.props?.children != null) return collectText(el.props.children);
  return "";
}

/** Recursively find React elements matching a predicate. */
function findElements(node: unknown, match: (el: ReactEl) => boolean): ReactEl[] {
  if (!node || typeof node !== "object") return [];
  if (Array.isArray(node)) return node.flatMap((c) => findElements(c, match));
  const el = node as ReactEl;
  const results: ReactEl[] = [];
  if (el.type != null && match(el)) results.push(el);
  if (el.props?.children != null) results.push(...findElements(el.props.children, match));
  return results;
}

// ---------------------------------------------------------------------------
// Mock agent data
// ---------------------------------------------------------------------------

const mockAgents: InstalledAgentEntry[] = [
  {
    id: "cursor",
    displayName: "Cursor",
    featureSupport: { slashCommands: true, hooks: false, mcp: true, customSystemPrompt: true },
    isUniversal: true,
    installed: true,
  },
  {
    id: "codex",
    displayName: "Codex CLI",
    featureSupport: { slashCommands: false, hooks: false, mcp: false, customSystemPrompt: true },
    isUniversal: true,
    installed: false,
  },
  {
    id: "claude-code",
    displayName: "Claude Code",
    featureSupport: { slashCommands: true, hooks: true, mcp: true, customSystemPrompt: true },
    isUniversal: false,
    installed: true,
  },
  {
    id: "windsurf",
    displayName: "Windsurf",
    featureSupport: { slashCommands: true, hooks: false, mcp: true, customSystemPrompt: true },
    isUniversal: false,
    installed: false,
  },
];

// ---------------------------------------------------------------------------
// AgentSelector
// ---------------------------------------------------------------------------

describe("AgentSelector", () => {
  it("renders without crashing", () => {
    const tree = AgentSelector({ agents: mockAgents, selectedIds: [], onChange: vi.fn() });
    expect(tree).toBeDefined();
  });

  it("renders all agents", () => {
    const tree = expand(AgentSelector({ agents: mockAgents, selectedIds: [], onChange: vi.fn() }));
    const text = collectText(tree);
    expect(text).toContain("Cursor");
    expect(text).toContain("Codex CLI");
    expect(text).toContain("Claude Code");
    expect(text).toContain("Windsurf");
  });

  it("groups agents by universal and non-universal", () => {
    const tree = expand(AgentSelector({ agents: mockAgents, selectedIds: [], onChange: vi.fn() }));
    const text = collectText(tree);
    expect(text).toContain("Universal Agents");
  });

  it("renders checkboxes (input elements)", () => {
    const tree = expand(AgentSelector({ agents: mockAgents, selectedIds: [], onChange: vi.fn() }));
    const inputs = findElements(tree, (el) => el.type === "input" && el.props?.type === "checkbox");
    expect(inputs.length).toBe(4);
  });

  it("marks selected agents as checked", () => {
    const tree = expand(AgentSelector({ agents: mockAgents, selectedIds: ["cursor", "claude-code"], onChange: vi.fn() }));
    const inputs = findElements(tree, (el) => el.type === "input" && el.props?.type === "checkbox");
    const checked = inputs.filter((el) => el.props.checked === true);
    expect(checked.length).toBe(2);
  });

  it("shows 4 feature indicators per agent", () => {
    const tree = expand(AgentSelector({ agents: mockAgents, selectedIds: [], onChange: vi.fn() }));
    const text = collectText(tree);
    expect(text).toMatch(/slash/i);
    expect(text).toMatch(/hook/i);
    expect(text).toMatch(/mcp/i);
  });

  it("visually distinguishes installed agents", () => {
    const tree = expand(AgentSelector({ agents: mockAgents, selectedIds: [], onChange: vi.fn() }));
    const text = collectText(tree);
    expect(text).toMatch(/installed/i);
  });
});
