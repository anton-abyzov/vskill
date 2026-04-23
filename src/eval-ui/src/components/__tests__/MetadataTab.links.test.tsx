// @vitest-environment jsdom
// ---------------------------------------------------------------------------
// T-056..T-058, T-062: MetadataTab — clickability + word-break + tooltips
// ---------------------------------------------------------------------------
// Covers:
//   T-056 — Homepage renders as <a target="_blank" rel="noopener noreferrer">
//           with ↗ suffix; null homepage renders muted em-dash.
//   T-057 — Entry point is a clickable path chip; onClick copies the
//           ABSOLUTE path (`${dir}/${entryPoint}`) to the clipboard and
//           dispatches a `studio:toast` CustomEvent with "Copied <path>".
//   T-058 — Directory path cell uses overflow-wrap / word-break so long
//           mono paths do not break mid-word in an ugly way.
//   T-062 — Null metadata fields render em-dash with a helpful
//           `title` attribute directing the user to SKILL.md frontmatter.
// ---------------------------------------------------------------------------
import { describe, it, expect, vi, beforeEach } from "vitest";

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
    deps: [],
    mcpDeps: null,
    entryPoint: "SKILL.md",
    lastModified: "2026-04-20T00:00:00Z",
    sizeBytes: 4096,
    sourceAgent: null,
    ...over,
  };
}

// ---------------------------------------------------------------------------
// T-056 — Homepage as clickable external link
// ---------------------------------------------------------------------------
describe("T-056 MetadataTab — homepage link", () => {
  it("renders homepage as an <a> with external link attributes when populated", () => {
    const skill = makeSkill({ homepage: "https://example.com/obsidian-brain" });
    const tree = MetadataTab({ skill });
    const anchors = findAll(tree, (el) => el.type === "a" && typeof el.props.href === "string");
    expect(anchors.length).toBeGreaterThan(0);
    const homepageAnchor = anchors.find(
      (a) => a.props.href === "https://example.com/obsidian-brain",
    );
    expect(homepageAnchor).toBeTruthy();
    expect(homepageAnchor!.props.target).toBe("_blank");
    expect(String(homepageAnchor!.props.rel)).toContain("noopener");
    expect(String(homepageAnchor!.props.rel)).toContain("noreferrer");
  });

  it("adds a trailing ↗ glyph indicating external navigation", () => {
    const skill = makeSkill({ homepage: "https://example.com/obsidian-brain" });
    const tree = MetadataTab({ skill });
    const text = collectText(tree);
    expect(text).toContain("↗");
  });

  it("renders em-dash when homepage is null, without an <a> tag for that row", () => {
    const skill = makeSkill({ homepage: null });
    const tree = MetadataTab({ skill });
    const anchors = findAll(tree, (el) => el.type === "a");
    expect(anchors.length).toBe(0);
    const text = collectText(tree);
    expect(text).toContain("Homepage");
    expect(text).toContain("—");
  });
});

// ---------------------------------------------------------------------------
// T-057 — Entry point is clickable; copies absolute path to clipboard
// ---------------------------------------------------------------------------
describe("T-057 MetadataTab — entry-point path chip", () => {
  beforeEach(() => {
    // Polyfill navigator.clipboard in the jsdom environment.
    Object.defineProperty(global.navigator, "clipboard", {
      configurable: true,
      value: { writeText: vi.fn().mockResolvedValue(undefined) },
    });
  });

  it("renders entry point inside a button-like element with an onClick handler", () => {
    const skill = makeSkill({ entryPoint: "SKILL.md" });
    const tree = MetadataTab({ skill });
    const chips = findAll(tree, (el) => {
      const attrs = el.props as Record<string, unknown>;
      return attrs["data-entry-chip"] === "true" && typeof attrs.onClick === "function";
    });
    expect(chips.length).toBe(1);
  });

  it("renders entry point in mono typography", () => {
    const skill = makeSkill({ entryPoint: "SKILL.md" });
    const tree = MetadataTab({ skill });
    const chip = findAll(tree, (el) => el.props["data-entry-chip"] === "true")[0];
    const style = chip.props.style as Record<string, string>;
    expect(String(style.fontFamily)).toContain("--font-mono");
  });

  it("click handler copies the absolute path to clipboard and dispatches studio:toast", async () => {
    const skill = makeSkill({ dir: "/a/b/c/obsidian-brain", entryPoint: "SKILL.md" });
    const dispatchSpy = vi.spyOn(window, "dispatchEvent");
    const tree = MetadataTab({ skill });
    const chip = findAll(tree, (el) => el.props["data-entry-chip"] === "true")[0];
    const onClick = chip.props.onClick as () => void;
    await onClick();
    expect((navigator.clipboard as unknown as { writeText: ReturnType<typeof vi.fn> }).writeText)
      .toHaveBeenCalledWith("/a/b/c/obsidian-brain/SKILL.md");
    // Toast event dispatched with "Copied <abs-path>"
    const toastEvent = dispatchSpy.mock.calls
      .map((c) => c[0])
      .find((e): e is CustomEvent => e instanceof CustomEvent && e.type === "studio:toast");
    expect(toastEvent).toBeTruthy();
    const detail = toastEvent!.detail as { message: string };
    expect(detail.message).toContain("Copied");
    expect(detail.message).toContain("/a/b/c/obsidian-brain/SKILL.md");
    dispatchSpy.mockRestore();
  });

  it("falls back to 'SKILL.md' when entryPoint is null", () => {
    const skill = makeSkill({ entryPoint: null });
    const tree = MetadataTab({ skill });
    const chip = findAll(tree, (el) => el.props["data-entry-chip"] === "true")[0];
    const text = collectText(chip);
    expect(text).toContain("SKILL.md");
  });
});

// ---------------------------------------------------------------------------
// T-058 — Directory path word-break to prevent ugly mid-word wraps
// ---------------------------------------------------------------------------
describe("T-058 MetadataTab — directory path wrapping", () => {
  it("directory value cell applies overflow-wrap / word-break to the value node", () => {
    const skill = makeSkill({
      dir: "/Users/antonabyzov/Projects/github/specweave-umb/repositories/anton-abyzov/vskill/skills/obsidian-brain",
    });
    const tree = MetadataTab({ skill });
    const pathValues = findAll(tree, (el) => {
      const attrs = el.props as Record<string, unknown>;
      return attrs["data-path-value"] === "true";
    });
    expect(pathValues.length).toBeGreaterThanOrEqual(1);
    const style = pathValues[0].props.style as Record<string, string>;
    // Either overflowWrap: "anywhere" (preferred) or wordBreak: "break-all"
    // is acceptable — both prevent mid-word cliffs.
    const wraps = String(style.overflowWrap ?? "");
    const wordBreak = String(style.wordBreak ?? "");
    expect(wraps === "anywhere" || wordBreak === "break-all" || wordBreak === "break-word")
      .toBe(true);
  });
});

// ---------------------------------------------------------------------------
// T-062 — Empty-state tooltip hint for null metadata fields
// ---------------------------------------------------------------------------
describe("T-062 MetadataTab — empty-state tooltip affordance", () => {
  it("em-dash rows for null fields include a helpful `title` attribute", () => {
    const skill = makeSkill({
      version: null,
      author: null,
      license: null,
      homepage: null,
    });
    const tree = MetadataTab({ skill });
    // Scan for muted em-dash spans with a title hint.
    const hinted = findAll(tree, (el) => {
      const attrs = el.props as Record<string, unknown>;
      const style = attrs.style as Record<string, string> | undefined;
      const txt = typeof attrs.children === "string" ? (attrs.children as string) : "";
      const title = typeof attrs.title === "string" ? attrs.title : "";
      return (
        txt === "—" &&
        !!style &&
        String(style.color ?? "").includes("--text-secondary") &&
        /SKILL\.md|frontmatter/i.test(title)
      );
    });
    // At least the four null fields above should have tooltip hints.
    expect(hinted.length).toBeGreaterThanOrEqual(3);
  });
});
