// ---------------------------------------------------------------------------
// 0774 T-002 / 0792 T-015/T-016: SubTabBar element-tree tests.
//
// Tests the function-call render pattern (no @testing-library/react required)
// and the new visibility/safety behavior introduced in 0792:
// - inactive tabs use a non-transparent border + 13px font
// - missing onChange handler logs a console.warn in dev
// ---------------------------------------------------------------------------

import { describe, it, expect, vi, afterEach } from "vitest";
import { SubTabBar } from "../SubTabBar";

type ReactEl = { type: unknown; props: Record<string, unknown> };

function findAll(node: unknown, predicate: (el: ReactEl) => boolean): ReactEl[] {
  const out: ReactEl[] = [];
  const visit = (n: unknown): void => {
    if (n == null || typeof n !== "object") return;
    const el = n as ReactEl;
    if ("props" in el && predicate(el)) out.push(el);
    const props = (el as { props?: Record<string, unknown> }).props;
    if (!props) return;
    const children = props.children;
    if (Array.isArray(children)) children.forEach(visit);
    else if (children) visit(children);
  };
  visit(node);
  return out;
}

const RUN_TABS = [
  { id: "benchmark", label: "Benchmark" },
  { id: "activation", label: "Activation" },
  { id: "ab", label: "A/B" },
];

const HISTORY_TABS = [
  { id: "timeline", label: "Timeline" },
  { id: "models", label: "Models" },
  { id: "versions", label: "Versions" },
];

// React.useState mock — simulates a stateless render so the function-call
// pattern reaches the rendered output without going through React's
// reconciler.
vi.mock("react", async (importOriginal) => {
  const actual = await importOriginal<typeof import("react")>();
  return {
    ...actual,
    useState: (init: unknown) => [init, () => {}],
  };
});

describe("SubTabBar — render tree (0774 T-002)", () => {
  it("renders one button per descriptor inside a tablist", () => {
    const tree = SubTabBar({
      tabs: RUN_TABS,
      active: "activation",
      onChange: () => {},
      parentTabId: "run",
    });

    const tablist = findAll(tree, (el) => el.props?.role === "tablist");
    expect(tablist).toHaveLength(1);
    expect(tablist[0].props["data-testid"]).toBe("detail-subtab-bar-run");

    const tabs = findAll(tree, (el) => el.props?.role === "tab");
    expect(tabs).toHaveLength(3);
    const ids = tabs.map((t) => t.props["data-testid"] as string);
    expect(ids).toEqual([
      "detail-subtab-run-benchmark",
      "detail-subtab-run-activation",
      "detail-subtab-run-ab",
    ]);
  });

  it("marks the active sub-tab with aria-selected=true and others false", () => {
    const tree = SubTabBar({
      tabs: HISTORY_TABS,
      active: "models",
      onChange: () => {},
      parentTabId: "history",
    });
    const tabs = findAll(tree, (el) => el.props?.role === "tab");
    const selectedFlags = tabs.map((t) => t.props["aria-selected"]);
    expect(selectedFlags).toEqual([false, true, false]);
  });

  it("invokes onChange with the descriptor id when a tab is clicked", () => {
    const onChange = vi.fn();
    const tree = SubTabBar({
      tabs: HISTORY_TABS,
      active: "timeline",
      onChange,
      parentTabId: "history",
    });
    const tabs = findAll(tree, (el) => el.props?.role === "tab");
    const versionsClick = tabs[2].props.onClick as () => void;
    versionsClick();
    expect(onChange).toHaveBeenCalledWith("versions");
  });

  it("scopes data-testid by parentTabId so multiple SubTabBars co-exist uniquely", () => {
    const runTree = SubTabBar({ tabs: RUN_TABS, active: "benchmark", onChange: () => {}, parentTabId: "run" });
    const historyTree = SubTabBar({ tabs: HISTORY_TABS, active: "timeline", onChange: () => {}, parentTabId: "history" });

    const runTabs = findAll(runTree, (el) => el.props?.role === "tab");
    const historyTabs = findAll(historyTree, (el) => el.props?.role === "tab");

    expect(runTabs.map((t) => t.props["data-testid"])).not.toEqual(
      historyTabs.map((t) => t.props["data-testid"]),
    );
  });

  it("uses 2px solid border-bottom on the active tab", () => {
    const tree = SubTabBar({ tabs: HISTORY_TABS, active: "models", onChange: () => {}, parentTabId: "history" });
    const tabs = findAll(tree, (el) => el.props?.role === "tab");
    const activeStyle = tabs[1].props.style as Record<string, string>;
    expect(activeStyle.borderBottom).toContain("2px solid");
    expect(activeStyle.borderBottom).not.toContain("transparent");
  });
});

describe("SubTabBar — visibility (0792 T-015)", () => {
  it("inactive tabs use font-size >= 13px so the bar reads as clickable", () => {
    const tree = SubTabBar({ tabs: RUN_TABS, active: "benchmark", onChange: () => {}, parentTabId: "run" });
    const tabs = findAll(tree, (el) => el.props?.role === "tab");
    const inactiveStyle = tabs[1].props.style as Record<string, number | string>;
    expect(typeof inactiveStyle.fontSize === "number" ? inactiveStyle.fontSize : Number.NaN).toBeGreaterThanOrEqual(13);
  });

  it("inactive tabs have a non-transparent bottom border", () => {
    const tree = SubTabBar({ tabs: RUN_TABS, active: "benchmark", onChange: () => {}, parentTabId: "run" });
    const tabs = findAll(tree, (el) => el.props?.role === "tab");
    const inactiveStyle = tabs[1].props.style as Record<string, string>;
    // Active uses var(--text-primary); inactive uses var(--border-subtle, transparent).
    // The literal string "transparent" alone (without a CSS variable fallback)
    // would be the regression we're guarding against.
    expect(inactiveStyle.borderBottom).toBeDefined();
    expect(inactiveStyle.borderBottom).toContain("var(--border-subtle");
    // Sanity: not the legacy `2px solid transparent` form.
    expect(inactiveStyle.borderBottom.trim()).not.toBe("2px solid transparent");
  });

  it("every tab has cursor:pointer (so the affordance is visible to users)", () => {
    const tree = SubTabBar({ tabs: HISTORY_TABS, active: "timeline", onChange: () => {}, parentTabId: "history" });
    const tabs = findAll(tree, (el) => el.props?.role === "tab");
    for (const t of tabs) {
      const style = t.props.style as Record<string, string>;
      expect(style.cursor).toBe("pointer");
    }
  });
});

describe("SubTabBar — missing onChange default (0792 T-016)", () => {
  const originalNodeEnv = process.env.NODE_ENV;

  afterEach(() => {
    process.env.NODE_ENV = originalNodeEnv;
  });

  it("logs a console.warn when no onChange is wired in dev", () => {
    process.env.NODE_ENV = "development";
    const warn = vi.spyOn(console, "warn").mockImplementation(() => {});
    const tree = SubTabBar({
      tabs: RUN_TABS,
      active: "benchmark",
      parentTabId: "run",
    });
    const tabs = findAll(tree, (el) => el.props?.role === "tab");
    const activationClick = tabs[1].props.onClick as () => void;
    activationClick();
    expect(warn).toHaveBeenCalledTimes(1);
    expect(warn.mock.calls[0][0]).toMatch(/SubTabBar.*activation.*run.*no onChange/);
    warn.mockRestore();
  });

  it("does NOT log in production builds (avoids console pollution)", () => {
    process.env.NODE_ENV = "production";
    const warn = vi.spyOn(console, "warn").mockImplementation(() => {});
    const tree = SubTabBar({
      tabs: RUN_TABS,
      active: "benchmark",
      parentTabId: "run",
    });
    const tabs = findAll(tree, (el) => el.props?.role === "tab");
    const activationClick = tabs[1].props.onClick as () => void;
    activationClick();
    expect(warn).not.toHaveBeenCalled();
    warn.mockRestore();
  });
});
