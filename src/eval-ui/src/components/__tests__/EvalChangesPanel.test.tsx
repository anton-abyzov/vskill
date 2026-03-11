import { describe, it, expect, vi } from "vitest";

// Mock React hooks for all child components
vi.mock("react", () => ({
  useState: (init: unknown) => [init, () => {}],
  useCallback: (fn: unknown) => fn,
}));

import { EvalChangesPanel } from "../EvalChangesPanel.js";
import type { EvalChange, EvalCase } from "../../types";

type ReactEl = { type: unknown; props: Record<string, unknown> };

function collectText(node: unknown): string {
  if (node == null) return "";
  if (typeof node === "string" || typeof node === "number") return String(node);
  if (Array.isArray(node)) return node.map(collectText).join("");
  const el = node as ReactEl;
  if (el.props?.children != null) return collectText(el.props.children);
  return "";
}

function collectElements(node: unknown, match: (el: ReactEl) => boolean): ReactEl[] {
  if (!node || typeof node !== "object") return [];
  if (Array.isArray(node)) return node.flatMap((c) => collectElements(c, match));
  const el = node as ReactEl;
  const results: ReactEl[] = [];
  if (el.type != null && match(el)) results.push(el);
  if (el.props?.children != null) {
    results.push(...collectElements(el.props.children, match));
  }
  return results;
}

function collectByType(node: unknown, type: string): ReactEl[] {
  return collectElements(node, (el) => el.type === type);
}

function makeEval(id: number, name = `eval-${id}`): EvalCase {
  return {
    id,
    name,
    prompt: `prompt-${id}`,
    expected_output: `expected-${id}`,
    files: [],
    assertions: [{ id: `a-${id}`, text: `assertion-${id}`, type: "boolean" as const }],
  };
}

const noop = () => {};

describe("EvalChangesPanel", () => {
  it("returns null when changes array is empty", () => {
    const result = EvalChangesPanel({
      changes: [],
      selections: new Map(),
      currentEvals: [],
      onToggle: noop,
      onSelectAll: noop,
      onDeselectAll: noop,
    });
    expect(result).toBeNull();
  });

  it("renders when changes exist", () => {
    const changes: EvalChange[] = [
      { action: "add", reason: "new", eval: makeEval(0, "new-test") },
    ];
    const selections = new Map<number, boolean>([[0, true]]);
    const result = EvalChangesPanel({
      changes,
      selections,
      currentEvals: [],
      onToggle: noop,
      onSelectAll: noop,
      onDeselectAll: noop,
    });
    expect(result).not.toBeNull();
  });

  it("shows selection count in header", () => {
    const changes: EvalChange[] = [
      { action: "add", reason: "a", eval: makeEval(0) },
      { action: "remove", reason: "b", evalId: 1 },
    ];
    const selections = new Map<number, boolean>([[0, true], [1, false]]);
    const result = EvalChangesPanel({
      changes,
      selections,
      currentEvals: [makeEval(1)],
      onToggle: noop,
      onSelectAll: noop,
      onDeselectAll: noop,
    });
    const text = collectText(result);
    expect(text).toContain("1/2 selected");
  });

  it("shows 'Test Case Changes' header", () => {
    const changes: EvalChange[] = [
      { action: "add", reason: "a", eval: makeEval(0) },
    ];
    const result = EvalChangesPanel({
      changes,
      selections: new Map([[0, true]]),
      currentEvals: [],
      onToggle: noop,
      onSelectAll: noop,
      onDeselectAll: noop,
    });
    const text = collectText(result);
    expect(text).toContain("Test Case Changes");
  });

  it("renders Select All and Deselect All buttons", () => {
    const changes: EvalChange[] = [
      { action: "add", reason: "a", eval: makeEval(0) },
    ];
    const result = EvalChangesPanel({
      changes,
      selections: new Map([[0, true]]),
      currentEvals: [],
      onToggle: noop,
      onSelectAll: noop,
      onDeselectAll: noop,
    });
    const buttons = collectByType(result, "button");
    const buttonTexts = buttons.map((b) => collectText(b));
    expect(buttonTexts).toContain("Select All");
    expect(buttonTexts).toContain("Deselect All");
  });

  it("Select All button calls onSelectAll", () => {
    const onSelectAll = vi.fn();
    const changes: EvalChange[] = [
      { action: "add", reason: "a", eval: makeEval(0) },
    ];
    const result = EvalChangesPanel({
      changes,
      selections: new Map([[0, true]]),
      currentEvals: [],
      onToggle: noop,
      onSelectAll,
      onDeselectAll: noop,
    });
    const buttons = collectByType(result, "button");
    const selectAllBtn = buttons.find((b) => collectText(b) === "Select All");
    expect(selectAllBtn).toBeDefined();
    (selectAllBtn!.props.onClick as () => void)();
    expect(onSelectAll).toHaveBeenCalled();
  });

  it("Deselect All button calls onDeselectAll", () => {
    const onDeselectAll = vi.fn();
    const changes: EvalChange[] = [
      { action: "add", reason: "a", eval: makeEval(0) },
    ];
    const result = EvalChangesPanel({
      changes,
      selections: new Map([[0, true]]),
      currentEvals: [],
      onToggle: noop,
      onSelectAll: noop,
      onDeselectAll,
    });
    const buttons = collectByType(result, "button");
    const deselectBtn = buttons.find((b) => collectText(b) === "Deselect All");
    (deselectBtn!.props.onClick as () => void)();
    expect(onDeselectAll).toHaveBeenCalled();
  });

  it("sorts cards: remove first, then modify, then add", () => {
    const changes: EvalChange[] = [
      { action: "add", reason: "add-first-in-array", eval: makeEval(0, "added") },
      { action: "remove", reason: "remove-second", evalId: 1 },
      { action: "modify", reason: "modify-third", evalId: 2, eval: makeEval(2, "modified") },
    ];
    const selections = new Map<number, boolean>([[0, true], [1, true], [2, true]]);
    const result = EvalChangesPanel({
      changes,
      selections,
      currentEvals: [makeEval(1), makeEval(2)],
      onToggle: noop,
      onSelectAll: noop,
      onDeselectAll: noop,
    });

    // Find the EvalChangeCard elements rendered via the indexed.map
    // They are rendered as function components - collect their change props
    const cards = collectElements(result, (el) => typeof el.type === "function" && (el.type as { name?: string }).name === "EvalChangeCard");
    expect(cards).toHaveLength(3);

    // Check order via change.action prop
    const actions = cards.map((c) => (c.props.change as EvalChange).action);
    expect(actions).toEqual(["remove", "modify", "add"]);
  });

  it("passes originalEval from currentEvals for remove/modify", () => {
    const eval1 = makeEval(1, "original-1");
    const changes: EvalChange[] = [
      { action: "remove", reason: "gone", evalId: 1 },
    ];
    const result = EvalChangesPanel({
      changes,
      selections: new Map([[0, true]]),
      currentEvals: [eval1],
      onToggle: noop,
      onSelectAll: noop,
      onDeselectAll: noop,
    });

    const cards = collectElements(result, (el) => typeof el.type === "function" && (el.type as { name?: string }).name === "EvalChangeCard");
    expect(cards).toHaveLength(1);
    expect((cards[0].props.originalEval as EvalCase)?.name).toBe("original-1");
  });
});
