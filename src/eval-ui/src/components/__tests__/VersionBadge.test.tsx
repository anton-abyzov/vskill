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

  it("returns null when the version is missing or empty", () => {
    expect(VersionBadge({ version: null })).toBeNull();
    expect(VersionBadge({ version: undefined })).toBeNull();
    expect(VersionBadge({ version: "" })).toBeNull();
    expect(VersionBadge({ version: "   " })).toBeNull();
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
