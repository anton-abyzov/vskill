import { describe, it, expect, vi } from "vitest";

// Mock React hooks — return [initialState, noop] for useState, identity for useCallback
vi.mock("react", () => ({
  useState: (init: unknown) => [init, () => {}],
  useCallback: (fn: unknown) => fn,
}));

import { EvalChangeCard } from "../EvalChangeCard.js";
import type { EvalChange, EvalCase } from "../../types";

type ReactEl = { type: unknown; props: Record<string, unknown> };

function collectElements(node: unknown, match: (el: ReactEl) => boolean): ReactEl[] {
  if (!node || typeof node !== "object") return [];
  if (Array.isArray(node)) {
    return node.flatMap((c) => collectElements(c, match));
  }
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

function collectText(node: unknown): string {
  if (node == null) return "";
  if (typeof node === "string" || typeof node === "number") return String(node);
  if (Array.isArray(node)) return node.map(collectText).join("");
  const el = node as ReactEl;
  if (el.props?.children != null) return collectText(el.props.children);
  return "";
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

describe("EvalChangeCard", () => {
  const noop = () => {};

  it("renders checkbox that is checked when selected=true", () => {
    const change: EvalChange = { action: "add", reason: "new test", eval: makeEval(1, "my-test") };
    const tree = EvalChangeCard({ change, index: 0, selected: true, onToggle: noop });
    const inputs = collectByType(tree, "input");
    expect(inputs.length).toBeGreaterThan(0);
    expect(inputs[0].props.checked).toBe(true);
  });

  it("renders unchecked checkbox when selected=false", () => {
    const change: EvalChange = { action: "add", reason: "test", eval: makeEval(1) };
    const tree = EvalChangeCard({ change, index: 0, selected: false, onToggle: noop });
    const inputs = collectByType(tree, "input");
    expect(inputs[0].props.checked).toBe(false);
  });

  it("shows ADD badge for add action", () => {
    const change: EvalChange = { action: "add", reason: "new", eval: makeEval(1) };
    const tree = EvalChangeCard({ change, index: 0, selected: true, onToggle: noop });
    const text = collectText(tree);
    expect(text).toContain("ADD");
  });

  it("shows MODIFY badge for modify action", () => {
    const change: EvalChange = { action: "modify", reason: "updated", evalId: 1, eval: makeEval(1) };
    const tree = EvalChangeCard({ change, index: 0, selected: true, onToggle: noop, originalEval: makeEval(1) });
    const text = collectText(tree);
    expect(text).toContain("MODIFY");
  });

  it("shows REMOVE badge for remove action", () => {
    const change: EvalChange = { action: "remove", reason: "obsolete", evalId: 1 };
    const tree = EvalChangeCard({ change, index: 0, selected: true, onToggle: noop, originalEval: makeEval(1) });
    const text = collectText(tree);
    expect(text).toContain("REMOVE");
  });

  it("shows eval name for add/modify actions", () => {
    const change: EvalChange = { action: "add", reason: "test", eval: makeEval(1, "test-name") };
    const tree = EvalChangeCard({ change, index: 0, selected: true, onToggle: noop });
    const text = collectText(tree);
    expect(text).toContain("test-name");
  });

  it("shows original eval name for remove action", () => {
    const change: EvalChange = { action: "remove", reason: "gone", evalId: 5 };
    const tree = EvalChangeCard({ change, index: 0, selected: true, onToggle: noop, originalEval: makeEval(5, "original-name") });
    const text = collectText(tree);
    expect(text).toContain("original-name");
  });

  it("shows fallback name when remove has no originalEval", () => {
    const change: EvalChange = { action: "remove", reason: "gone", evalId: 42 };
    const tree = EvalChangeCard({ change, index: 0, selected: true, onToggle: noop });
    const text = collectText(tree);
    expect(text).toContain("Eval #42");
  });

  it("shows reason text", () => {
    const change: EvalChange = { action: "add", reason: "covers edge case", eval: makeEval(1) };
    const tree = EvalChangeCard({ change, index: 0, selected: true, onToggle: noop });
    const text = collectText(tree);
    expect(text).toContain("covers edge case");
  });

  it("has lower opacity when not selected", () => {
    const change: EvalChange = { action: "add", reason: "test", eval: makeEval(1) };
    const tree = EvalChangeCard({ change, index: 0, selected: false, onToggle: noop }) as ReactEl;
    expect((tree.props.style as Record<string, unknown>)?.opacity).toBe(0.5);
  });

  it("has full opacity when selected", () => {
    const change: EvalChange = { action: "add", reason: "test", eval: makeEval(1) };
    const tree = EvalChangeCard({ change, index: 0, selected: true, onToggle: noop }) as ReactEl;
    expect((tree.props.style as Record<string, unknown>)?.opacity).toBe(1);
  });

  it("checkbox onChange calls onToggle with index", () => {
    const onToggle = vi.fn();
    const change: EvalChange = { action: "add", reason: "test", eval: makeEval(1) };
    const tree = EvalChangeCard({ change, index: 7, selected: true, onToggle });
    const inputs = collectByType(tree, "input");
    // The onChange is the handleToggle callback which calls onToggle(index)
    const handler = inputs[0].props.onChange as () => void;
    handler();
    expect(onToggle).toHaveBeenCalledWith(7);
  });

  // Expanded state is always false (useState mocked to return initial),
  // so expanded details are NOT rendered. This verifies collapsed state.
  it("does not show expanded detail when collapsed", () => {
    const change: EvalChange = {
      action: "modify",
      reason: "updated",
      evalId: 1,
      eval: makeEval(1, "new-name"),
    };
    const original = makeEval(1, "old-name");
    const tree = EvalChangeCard({ change, index: 0, selected: true, onToggle: noop, originalEval: original });
    const text = collectText(tree);
    // ModifyDetail renders old/new diffs — should NOT be present when collapsed
    expect(text).not.toContain("old-name");
  });
});
