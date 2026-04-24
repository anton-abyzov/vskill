// ---------------------------------------------------------------------------
// T-005 (0707): BenchmarkInfoPopover tests
// ---------------------------------------------------------------------------
import { describe, it, expect, vi } from "vitest";

vi.mock("react", () => ({
  useState: (init: unknown) => [init, () => {}],
  useEffect: () => {},
  useRef: (init: unknown) => ({ current: init }),
  useCallback: <T,>(fn: T) => fn,
  useMemo: <T,>(fn: () => T) => fn(),
}));

import { BenchmarkInfoPopover, BENCHMARK_EXPLANATION } from "../BenchmarkInfoPopover";

type ReactEl = { type: unknown; props: Record<string, unknown> };

function collectText(node: unknown): string {
  if (node == null) return "";
  if (typeof node === "string" || typeof node === "number") return String(node);
  if (Array.isArray(node)) return node.map(collectText).join("");
  const el = node as ReactEl;
  if (el.props?.children != null) return collectText(el.props.children);
  return "";
}

function findByTestId(node: unknown, id: string): ReactEl | null {
  if (!node || typeof node !== "object") return null;
  if (Array.isArray(node)) {
    for (const c of node) {
      const found = findByTestId(c, id);
      if (found) return found;
    }
    return null;
  }
  const el = node as ReactEl;
  if (el.props?.["data-testid"] === id) return el;
  if (el.props?.children != null) return findByTestId(el.props.children, id);
  return null;
}

describe("BenchmarkInfoPopover — T-005", () => {
  it("renders a trigger ℹ button when closed", () => {
    const tree = BenchmarkInfoPopover({});
    const trigger = findByTestId(tree, "benchmark-info-trigger");
    expect(trigger).not.toBeNull();
    expect(collectText(trigger)).toBe("ℹ");
    // Popover not open yet
    expect(findByTestId(tree, "benchmark-info-popover")).toBeNull();
  });

  it("exposes the canonical explanation text when open", () => {
    const tree = BenchmarkInfoPopover({ open: true });
    const popover = findByTestId(tree, "benchmark-info-popover");
    expect(popover).not.toBeNull();
    const text = collectText(popover);
    expect(text).toContain(BENCHMARK_EXPLANATION);
    expect(text).toContain("Tests");
    expect(text).toContain("Run");
  });

  it("calls onNavigate('tests') and onNavigate('run') from the inline links", () => {
    const onNavigate = vi.fn();
    const tree = BenchmarkInfoPopover({ open: true, onNavigate });
    const testsBtn = findByTestId(tree, "benchmark-info-link-tests")!;
    const runBtn = findByTestId(tree, "benchmark-info-link-run")!;
    (testsBtn.props.onClick as () => void)();
    (runBtn.props.onClick as () => void)();
    expect(onNavigate).toHaveBeenNthCalledWith(1, "tests");
    expect(onNavigate).toHaveBeenNthCalledWith(2, "run");
  });

  it("exports the explanation string used in the AC so callers can cross-reference", () => {
    expect(BENCHMARK_EXPLANATION.startsWith("Benchmarks are")).toBe(true);
    expect(BENCHMARK_EXPLANATION).toContain("mean pass rate");
  });
});
