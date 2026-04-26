// ---------------------------------------------------------------------------
// T-002 (0707): VersionBadge unit tests
// ---------------------------------------------------------------------------
import { describe, it, expect } from "vitest";

import { VersionBadge } from "../VersionBadge";

type ReactEl = { type: unknown; props: Record<string, unknown> };

function collectText(node: unknown): string {
  if (node == null) return "";
  if (typeof node === "string" || typeof node === "number") return String(node);
  if (Array.isArray(node)) return node.map(collectText).join("");
  const el = node as ReactEl;
  if (el.props?.children != null) return collectText(el.props.children);
  return "";
}

describe("VersionBadge — T-002", () => {
  it("renders v{version} by default", () => {
    const tree = VersionBadge({ version: "1.2.3" });
    expect(collectText(tree)).toBe("v1.2.3");
  });

  it("does not double-prefix when the version already starts with v", () => {
    const tree = VersionBadge({ version: "v2.0.0" });
    expect(collectText(tree)).toBe("v2.0.0");
  });

  // Increment 0750: VersionBadge no longer returns null. Callers (SkillRow,
  // DetailHeader, etc.) feed it the resolver's already-non-empty `version`,
  // so the component just renders it. When fed an explicitly empty value the
  // badge falls back to "0.0.0" so we never crash and never render an empty
  // chip.
  it("0750: renders '1.0.0' fallback when version is empty/missing instead of returning null", () => {
    expect(collectText(VersionBadge({ version: null }))).toBe("v1.0.0");
    expect(collectText(VersionBadge({ version: undefined }))).toBe("v1.0.0");
    expect(collectText(VersionBadge({ version: "" }))).toBe("v1.0.0");
    expect(collectText(VersionBadge({ version: "   " }))).toBe("v1.0.0");
  });

  // Increment 0750 — source-aware styling (US-003).
  it("0750: source='frontmatter' renders normal weight, no title tooltip", () => {
    const tree = VersionBadge({ version: "1.4.0", source: "frontmatter" }) as unknown as ReactEl;
    const style = tree.props.style as Record<string, string | number>;
    expect(style.fontStyle).not.toBe("italic");
    expect(tree.props.title).toBeUndefined();
  });

  it("0750: source='plugin' renders italic with 'Inherited from … plugin v…' tooltip", () => {
    const tree = VersionBadge({ version: "2.3.0", source: "plugin" }) as unknown as ReactEl;
    const style = tree.props.style as Record<string, string | number>;
    expect(style.fontStyle).toBe("italic");
    expect(String(tree.props.title)).toMatch(/Inherited from .* plugin v2\.3\.0/);
  });

  it("0750: source='plugin' with pluginName names the plugin in the tooltip", () => {
    const tree = VersionBadge({ version: "2.3.0", source: "plugin", pluginName: "specweave" }) as unknown as ReactEl;
    expect(String(tree.props.title)).toBe("Inherited from specweave plugin v2.3.0");
  });

  it("0750: source='registry' renders italic with 'Inherited from registry' tooltip", () => {
    const tree = VersionBadge({ version: "1.0.0", source: "registry" }) as unknown as ReactEl;
    const style = tree.props.style as Record<string, string | number>;
    expect(style.fontStyle).toBe("italic");
    expect(tree.props.title).toBe("Inherited from registry");
  });

  // 0759 Phase 7 (supersedes 0750 italic-on-default): the implicit 1.0.0
  // default no longer renders italic. Authors found the italic confusing —
  // it looked like a data bug rather than a provenance hint. Tooltip stays
  // for hover discoverability. Italics remain only for "registry"/"plugin".
  it("0759 Phase 7: source='default' renders normal (NOT italic) with 'No version declared' tooltip", () => {
    const tree = VersionBadge({ version: "1.0.0", source: "default" }) as unknown as ReactEl;
    const style = tree.props.style as Record<string, string | number>;
    expect(style.fontStyle).not.toBe("italic");
    expect(tree.props.title).toBe("No version declared");
  });

  it("0750: omitting source defaults to non-italic, no tooltip (back-compat)", () => {
    const tree = VersionBadge({ version: "1.0.0" }) as unknown as ReactEl;
    const style = tree.props.style as Record<string, string | number>;
    expect(style.fontStyle).not.toBe("italic");
    expect(tree.props.title).toBeUndefined();
  });

  it("uses tabular-nums + 1px border token so rows align consistently", () => {
    const tree = VersionBadge({ version: "1.2.3" }) as unknown as ReactEl;
    const style = tree.props.style as Record<string, string | number>;
    expect(style.fontVariantNumeric).toBe("tabular-nums");
    expect(style.border).toContain("1px solid var(--border");
    expect(style.fontSize).toBe(12);
  });

  it("respects size=sm for dense rows (sidebar, activation log)", () => {
    const tree = VersionBadge({ version: "1.2.3", size: "sm" }) as unknown as ReactEl;
    const style = tree.props.style as Record<string, string | number>;
    expect(style.fontSize).toBe(10);
  });

  it("omits the v prefix when showPrefix=false", () => {
    const tree = VersionBadge({ version: "1.2.3", showPrefix: false });
    expect(collectText(tree)).toBe("1.2.3");
  });

  it("exposes data-version and custom data-testid for e2e selection", () => {
    const tree = VersionBadge({ version: "1.2.3", "data-testid": "row-version" }) as unknown as ReactEl;
    expect(tree.props["data-testid"]).toBe("row-version");
    expect(tree.props["data-version"]).toBe("1.2.3");
  });
});
