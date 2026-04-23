// ---------------------------------------------------------------------------
// T-027 / T-028 / T-029 / T-030: MetadataTab
// ---------------------------------------------------------------------------
// Covers:
//   T-027 — frontmatter scalar/array rows + filesystem + benchmark groups
//   T-028 — MCP dependencies section (list of chips + empty state)
//   T-029 — skill dependency chips (clickable; tooltip when not installed)
//   T-030 — source agent row rendered only for installed skills
// ---------------------------------------------------------------------------
import { describe, it, expect, vi } from "vitest";

vi.mock("react", () => ({
  useState: (init: unknown) => [init, () => {}],
  useEffect: () => {},
  useRef: (init: unknown) => ({ current: init }),
  useCallback: <T,>(fn: T) => fn,
  useMemo: <T,>(fn: () => T) => fn(),
}));

import { MetadataTab } from "../MetadataTab";
import type { SkillInfo } from "../../types";

type ReactEl = { type: unknown; props: Record<string, unknown> };

function collectText(node: unknown): string {
  if (node == null) return "";
  if (typeof node === "string" || typeof node === "number") return String(node);
  if (Array.isArray(node)) return node.map(collectText).join("");
  const el = node as ReactEl;
  if (el.props?.children != null) return collectText(el.props.children);
  return "";
}

function findAll(node: unknown, match: (el: ReactEl) => boolean): ReactEl[] {
  if (!node || typeof node !== "object") return [];
  if (Array.isArray(node)) return node.flatMap((c) => findAll(c, match));
  const el = node as ReactEl;
  const out: ReactEl[] = [];
  if (el.type != null && match(el)) out.push(el);
  if (el.props?.children != null) out.push(...findAll(el.props.children, match));
  return out;
}

function makeSkill(over: Partial<SkillInfo> = {}): SkillInfo {
  return {
    plugin: "obsidian",
    skill: "obsidian-brain",
    dir: "/Users/test/skills/obsidian-brain",
    hasEvals: true,
    hasBenchmark: true,
    evalCount: 5,
    assertionCount: 20,
    benchmarkStatus: "pass",
    lastBenchmark: "2026-04-01T12:00:00Z",
    origin: "source",
    description: "Autonomous Obsidian vault management.",
    version: "1.3.0",
    category: "productivity",
    author: "Anton",
    license: "MIT",
    homepage: "https://example.com/obsidian-brain",
    tags: ["obsidian", "para", "wiki"],
    deps: ["slack-messaging", "unknown-skill"],
    mcpDeps: ["slack", "notion"],
    entryPoint: "SKILL.md",
    lastModified: "2026-04-20T00:00:00Z",
    sizeBytes: 4096,
    sourceAgent: null,
    ...over,
  };
}

// ---------------------------------------------------------------------------
// T-027 — frontmatter + filesystem + benchmark
// ---------------------------------------------------------------------------
describe("T-027 MetadataTab — frontmatter + filesystem + benchmark", () => {
  it("renders each frontmatter scalar field as a row with its value", () => {
    const skill = makeSkill();
    const tree = MetadataTab({ skill });
    const text = collectText(tree);
    expect(text).toContain("Description");
    expect(text).toContain("Autonomous Obsidian vault management.");
    expect(text).toContain("Version");
    expect(text).toContain("1.3.0");
    expect(text).toContain("Category");
    expect(text).toContain("productivity");
    expect(text).toContain("Author");
    expect(text).toContain("Anton");
    expect(text).toContain("License");
    expect(text).toContain("MIT");
    expect(text).toContain("Homepage");
  });

  it("renders null scalar fields as em-dash in text-secondary color", () => {
    const skill = makeSkill({ version: null, author: null, license: null });
    const tree = MetadataTab({ skill });
    const muted = findAll(tree, (el) => {
      const style = el.props?.style as Record<string, string> | undefined;
      const txt = typeof el.props?.children === "string" ? el.props.children : "";
      return !!style && style.color?.includes("--text-secondary") && txt === "—";
    });
    // At least one em-dash row rendered for the three null fields.
    expect(muted.length).toBeGreaterThanOrEqual(3);
  });

  it("renders tags as chips", () => {
    const skill = makeSkill();
    const tree = MetadataTab({ skill });
    const tagChips = findAll(tree, (el) => {
      const attrs = el.props as Record<string, unknown>;
      return attrs["data-chip"] === "tag";
    });
    expect(tagChips.length).toBe(3);
    const text = tagChips.map(collectText).join(" ");
    expect(text).toContain("obsidian");
    expect(text).toContain("para");
    expect(text).toContain("wiki");
  });

  it("renders filesystem group with dir, entry point, size, lastModified", () => {
    const skill = makeSkill();
    const tree = MetadataTab({ skill });
    const text = collectText(tree);
    expect(text).toContain("Filesystem");
    expect(text).toContain("/Users/test/skills/obsidian-brain");
    expect(text).toContain("SKILL.md");
    // Size formatted as "4 KB" or "4.0 KB" or similar
    expect(text).toMatch(/4(\.0)?\s*KB/);
    expect(text).toContain("Last modified");
  });

  it("renders a benchmark group with evalCount, assertionCount, status, lastBenchmark", () => {
    const skill = makeSkill();
    const tree = MetadataTab({ skill });
    const text = collectText(tree);
    expect(text).toContain("Benchmark");
    expect(text).toContain("5"); // evalCount
    expect(text).toContain("20"); // assertionCount
    expect(text).toContain("pass");
  });

  it("uses Source Serif 4 for section headings", () => {
    const skill = makeSkill();
    const tree = MetadataTab({ skill });
    const serifHeadings = findAll(tree, (el) => {
      const style = el.props?.style as Record<string, string> | undefined;
      return !!style && typeof style.fontFamily === "string" && style.fontFamily.includes("--font-serif");
    });
    // Expect several: Frontmatter, Filesystem, Benchmark
    expect(serifHeadings.length).toBeGreaterThanOrEqual(3);
  });

  it("uses tabular-nums for version, size, and timestamp values", () => {
    const skill = makeSkill();
    const tree = MetadataTab({ skill });
    const tabs = findAll(tree, (el) => {
      const style = el.props?.style as Record<string, string> | undefined;
      return !!style && style.fontVariantNumeric === "tabular-nums";
    });
    // version + sizeBytes + lastModified + lastBenchmark at minimum
    expect(tabs.length).toBeGreaterThanOrEqual(4);
  });
});

// ---------------------------------------------------------------------------
// T-028 — MCP dependencies section
// ---------------------------------------------------------------------------
describe("T-028 MetadataTab — MCP dependencies section", () => {
  it("renders an MCP deps entry with icon + name for each mcpDep", () => {
    const skill = makeSkill({ mcpDeps: ["slack", "notion"] });
    const tree = MetadataTab({ skill });
    const entries = findAll(tree, (el) => {
      const attrs = el.props as Record<string, unknown>;
      return attrs["data-mcp-dep"] != null;
    });
    expect(entries.length).toBe(2);
    const names = entries.map((e) => e.props["data-mcp-dep"]);
    expect(names).toContain("slack");
    expect(names).toContain("notion");
  });

  it("renders empty-state copy when skill has no MCP deps", () => {
    const skill = makeSkill({ mcpDeps: null });
    const tree = MetadataTab({ skill });
    const text = collectText(tree);
    expect(text).toContain("MCP dependencies");
    expect(text).toContain("No MCP dependencies");
  });
});

// ---------------------------------------------------------------------------
// T-029 — skill dependency chips
// ---------------------------------------------------------------------------
describe("T-029 MetadataTab — skill dependency chips", () => {
  it("renders a chip for each skill dependency", () => {
    const skill = makeSkill({ deps: ["slack-messaging", "unknown-skill"] });
    const tree = MetadataTab({
      skill,
      allSkills: [
        makeSkill({ plugin: "slack", skill: "slack-messaging" }),
      ],
    });
    const chips = findAll(tree, (el) => {
      const attrs = el.props as Record<string, unknown>;
      return attrs["data-chip"] === "skill-dep";
    });
    expect(chips.length).toBe(2);
  });

  it("clickable chip triggers onSelectSkill when dep exists", () => {
    const skill = makeSkill({ deps: ["slack-messaging"] });
    const target = makeSkill({ plugin: "slack", skill: "slack-messaging" });
    const calls: Array<{ plugin: string; skill: string; origin: string }> = [];
    const tree = MetadataTab({
      skill,
      allSkills: [target],
      onSelectSkill: (s) => calls.push(s),
    });
    const chips = findAll(tree, (el) => {
      const attrs = el.props as Record<string, unknown>;
      return attrs["data-chip"] === "skill-dep" && attrs["data-present"] === "true";
    });
    expect(chips.length).toBe(1);
    const onClick = chips[0].props.onClick as () => void;
    onClick();
    expect(calls).toEqual([{ plugin: "slack", skill: "slack-messaging", origin: "source" }]);
  });

  it("marks chip as 'Not installed' tooltip when dep absent from sidebar", () => {
    const skill = makeSkill({ deps: ["unknown-skill"] });
    const tree = MetadataTab({ skill, allSkills: [] });
    const chips = findAll(tree, (el) => {
      const attrs = el.props as Record<string, unknown>;
      return attrs["data-chip"] === "skill-dep" && attrs["data-present"] === "false";
    });
    expect(chips.length).toBe(1);
    expect(chips[0].props.title).toBe("Not installed");
  });

  it("chip uses text + border styling (no pill fill)", () => {
    const skill = makeSkill({ deps: ["a"] });
    const tree = MetadataTab({ skill, allSkills: [] });
    const chips = findAll(tree, (el) => {
      const attrs = el.props as Record<string, unknown>;
      return attrs["data-chip"] === "skill-dep";
    });
    const style = chips[0].props.style as Record<string, string>;
    expect(style.border).toContain("--border-default");
    expect(style.background).toBe("transparent");
  });
});

// ---------------------------------------------------------------------------
// T-030 — source agent row for installed skills only
// ---------------------------------------------------------------------------
describe("T-030 MetadataTab — source agent row", () => {
  it("renders Source agent row for installed skills with known agent id", () => {
    const skill = makeSkill({ origin: "installed", sourceAgent: "claude-code" });
    const tree = MetadataTab({ skill });
    const text = collectText(tree);
    expect(text).toContain("Source agent");
    // AGENTS_REGISTRY displayName for "claude-code" is "Claude Code"
    expect(text).toContain("Claude Code");
  });

  it("does not render Source agent row for source-origin skills", () => {
    const skill = makeSkill({ origin: "source", sourceAgent: null });
    const tree = MetadataTab({ skill });
    const text = collectText(tree);
    expect(text).not.toContain("Source agent");
  });

  it("falls back to raw agent id when not in registry", () => {
    const skill = makeSkill({ origin: "installed", sourceAgent: "mystery-agent" });
    const tree = MetadataTab({ skill });
    const text = collectText(tree);
    expect(text).toContain("Source agent");
    expect(text).toContain("mystery-agent");
  });
});
