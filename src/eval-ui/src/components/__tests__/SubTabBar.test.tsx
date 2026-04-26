// ---------------------------------------------------------------------------
// 0774 T-002: SubTabBar element-tree tests using the existing pure-function
// call pattern (no @testing-library/react required).
// ---------------------------------------------------------------------------

import { describe, it, expect, vi } from "vitest";
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
  { id: "run", label: "Run" },
  { id: "history", label: "History" },
  { id: "models", label: "Models" },
];

const TRIGGER_TABS = [
  { id: "run", label: "Run" },
  { id: "history", label: "History" },
];

describe("SubTabBar (0774 T-001/T-002)", () => {
  it("renders one button per descriptor inside a tablist", () => {
    const tree = SubTabBar({
      tabs: RUN_TABS,
      active: "history",
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
      "detail-subtab-run-run",
      "detail-subtab-run-history",
      "detail-subtab-run-models",
    ]);
  });

  it("marks the active sub-tab with aria-selected=true and others false", () => {
    const tree = SubTabBar({
      tabs: RUN_TABS,
      active: "history",
      onChange: () => {},
      parentTabId: "run",
    });
    const tabs = findAll(tree, (el) => el.props?.role === "tab");
    const selectedFlags = tabs.map((t) => t.props["aria-selected"]);
    expect(selectedFlags).toEqual([false, true, false]);
  });

  it("invokes onChange with the descriptor id when a tab is clicked", () => {
    const onChange = vi.fn();
    const tree = SubTabBar({
      tabs: TRIGGER_TABS,
      active: "run",
      onChange,
      parentTabId: "activation",
    });
    const tabs = findAll(tree, (el) => el.props?.role === "tab");
    const historyClick = tabs[1].props.onClick as () => void;
    historyClick();
    expect(onChange).toHaveBeenCalledWith("history");
  });

  it("scopes data-testid by parentTabId so multiple SubTabBars co-exist uniquely", () => {
    const runTree = SubTabBar({ tabs: RUN_TABS, active: "run", onChange: () => {}, parentTabId: "run" });
    const triggerTree = SubTabBar({ tabs: TRIGGER_TABS, active: "run", onChange: () => {}, parentTabId: "activation" });

    const runTabs = findAll(runTree, (el) => el.props?.role === "tab");
    const triggerTabs = findAll(triggerTree, (el) => el.props?.role === "tab");

    expect(runTabs.map((t) => t.props["data-testid"])).not.toEqual(
      triggerTabs.map((t) => t.props["data-testid"]),
    );
  });

  it("uses 2px border-bottom on the active tab and transparent on others", () => {
    const tree = SubTabBar({ tabs: TRIGGER_TABS, active: "history", onChange: () => {}, parentTabId: "activation" });
    const tabs = findAll(tree, (el) => el.props?.role === "tab");
    const styles = tabs.map((t) => (t.props.style as Record<string, string>).borderBottom);
    expect(styles[1]).toContain("2px solid");
    expect(styles[0]).toContain("2px solid transparent");
  });
});
