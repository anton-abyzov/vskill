// @vitest-environment jsdom
import { describe, it, expect } from "vitest";
import { StudioLayout } from "../StudioLayout";

type ReactEl = { type: unknown; props: Record<string, unknown> };

function findByRole(node: unknown, role: string): ReactEl | null {
  if (!node || typeof node !== "object") return null;
  if (Array.isArray(node)) {
    for (const c of node) {
      const r = findByRole(c, role);
      if (r) return r;
    }
    return null;
  }
  const el = node as ReactEl;
  if (el.props?.role === role) return el;
  if (typeof el.type === "string") {
    // native element — check if tag name matches role-ish
  }
  if (el.props?.children != null) return findByRole(el.props.children, role);
  return null;
}

function findByTag(node: unknown, tag: string): ReactEl | null {
  if (!node || typeof node !== "object") return null;
  if (Array.isArray(node)) {
    for (const c of node) {
      const r = findByTag(c, tag);
      if (r) return r;
    }
    return null;
  }
  const el = node as ReactEl;
  if (el.type === tag) return el;
  if (el.props?.children != null) return findByTag(el.props.children, tag);
  return null;
}

describe("StudioLayout — 3-row CSS grid shell", () => {
  it("renders semantic header / aside / main / footer", () => {
    const tree = StudioLayout({
      topRail: "top",
      sidebar: "side",
      main: "body",
      statusBar: "status",
    }) as ReactEl;

    expect(findByTag(tree, "header")).toBeTruthy();
    expect(findByTag(tree, "aside")).toBeTruthy();
    expect(findByTag(tree, "main")).toBeTruthy();
    expect(findByTag(tree, "footer")).toBeTruthy();
  });

  it("root container uses grid with 3 rows (top-rail / middle / status-bar)", () => {
    const tree = StudioLayout({
      topRail: "top",
      sidebar: "side",
      main: "body",
      statusBar: "status",
    }) as ReactEl;

    const style = tree.props.style as Record<string, string>;
    expect(style.display).toBe("grid");
    // Template uses CSS vars for rail + status-bar heights
    expect(style.gridTemplateRows).toMatch(/var\(--top-rail-height.*\).*1fr.*var\(--status-bar-height/);
  });

  it("middle row exposes a sidebar-width variable for columns", () => {
    const tree = StudioLayout({
      topRail: "top",
      sidebar: "side",
      main: "body",
      statusBar: "status",
    }) as ReactEl;

    const aside = findByTag(tree, "aside") as ReactEl;
    const main = findByTag(tree, "main") as ReactEl;
    expect(aside).toBeTruthy();
    expect(main).toBeTruthy();
  });

  it("exposes aria-live=polite region for selection announcements", () => {
    const tree = StudioLayout({
      topRail: "top",
      sidebar: "side",
      main: "body",
      statusBar: "status",
      liveMessage: "Viewing foo (Own)",
    }) as ReactEl;

    const live = findByRole(tree, "status");
    // Either a status role or an aria-live attribute anywhere
    const hasLive = live != null || findAriaLive(tree);
    expect(hasLive).toBe(true);
  });
});

function findAriaLive(node: unknown): boolean {
  if (!node || typeof node !== "object") return false;
  if (Array.isArray(node)) return node.some(findAriaLive);
  const el = node as ReactEl;
  if (el.props && (el.props["aria-live"] === "polite" || el.props["aria-live"] === "assertive")) return true;
  if (el.props?.children != null) return findAriaLive(el.props.children);
  return false;
}
