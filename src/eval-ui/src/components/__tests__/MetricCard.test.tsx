// ---------------------------------------------------------------------------
// T-001 (0707): MetricCard — port from vskill-platform.
//
// Verifies:
//   - renders the heading and value
//   - clickable cards get role="button" + tabIndex=0
//   - onClick is invoked exactly once on click
//   - Enter / Space on a focused clickable card triggers the callback
// ---------------------------------------------------------------------------
import { describe, it, expect, vi } from "vitest";

vi.mock("react", () => ({
  useState: (init: unknown) => [init, () => {}],
  useEffect: () => {},
  useRef: (init: unknown) => ({ current: init }),
  useCallback: <T,>(fn: T) => fn,
  useMemo: <T,>(fn: () => T) => fn(),
}));

import { MetricCard } from "../MetricCard";

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

describe("MetricCard — T-001", () => {
  it("renders heading (title) and value", () => {
    const tree = MetricCard({ title: "Tests", value: "12" });
    const text = collectText(tree);
    expect(text).toContain("Tests");
    expect(text).toContain("12");
  });

  it("accepts label as a portal-compat alias for title", () => {
    const tree = MetricCard({ label: "Benchmark", value: "86%" });
    const text = collectText(tree);
    expect(text).toContain("Benchmark");
    expect(text).toContain("86%");
  });

  it("is non-interactive when no onClick is provided", () => {
    const tree = MetricCard({ title: "Tests", value: 12 });
    const root = tree as unknown as ReactEl;
    expect(root.props.role).toBeUndefined();
    expect(root.props.tabIndex).toBeUndefined();
    expect(root.props.onClick).toBeUndefined();
  });

  it("becomes role=button with tabIndex=0 when onClick is provided and invokes the callback exactly once on click", () => {
    const onClick = vi.fn();
    const tree = MetricCard({ title: "Tests", value: "12", onClick });
    const root = tree as unknown as ReactEl;
    expect(root.props.role).toBe("button");
    expect(root.props.tabIndex).toBe(0);
    (root.props.onClick as () => void)();
    expect(onClick).toHaveBeenCalledTimes(1);
  });

  it("activates the callback on Enter and Space key presses", () => {
    const onClick = vi.fn();
    const tree = MetricCard({ title: "Tests", value: "12", onClick });
    const root = tree as unknown as ReactEl;
    const onKeyDown = root.props.onKeyDown as (e: { key: string; preventDefault: () => void }) => void;
    onKeyDown({ key: "Enter", preventDefault: () => {} });
    onKeyDown({ key: " ", preventDefault: () => {} });
    onKeyDown({ key: "Tab", preventDefault: () => {} });
    expect(onClick).toHaveBeenCalledTimes(2);
  });

  it("shows subtitle, description, and linkLabel when provided", () => {
    const tree = MetricCard({
      title: "Benchmark",
      value: "86%",
      subtitle: "12 tests",
      description: "Mean pass rate across the eval suite",
      linkLabel: "View run ↗",
    });
    const text = collectText(tree);
    expect(text).toContain("12 tests");
    expect(text).toContain("Mean pass rate");
    expect(text).toContain("View run ↗");
  });

  it("applies the --border CSS token so cards blend with the rest of the studio", () => {
    const tree = MetricCard({ title: "Tests", value: "12" });
    const root = tree as unknown as ReactEl;
    const style = root.props.style as Record<string, string>;
    expect(style.border).toContain("var(--border");
    expect(style.padding).toBe("1rem");
    expect(style.wordBreak).toBe("break-word");
    expect(style.overflowWrap).toBe("anywhere");
  });

  it("marks the card as metric-card-link when clickable", () => {
    const tree = MetricCard({ title: "Tests", value: "12", onClick: () => {} });
    const root = tree as unknown as ReactEl;
    expect(root.props.className).toContain("metric-card-link");
  });

  it("exposes data-testid pass-through for deterministic selection", () => {
    const tree = MetricCard({ title: "Tests", value: "12", "data-testid": "metric-tests" });
    const root = tree as unknown as ReactEl;
    expect(root.props["data-testid"]).toBe("metric-tests");
    const valueNode = findAll(tree, (el) => (el.props?.["data-testid"] as string) === "metric-tests-value")[0];
    expect(valueNode).toBeDefined();
  });
});
