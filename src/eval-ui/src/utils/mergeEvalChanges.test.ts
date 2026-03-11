import { describe, it, expect } from "vitest";
import { mergeEvalChanges } from "./mergeEvalChanges.js";
import type { EvalsFile, EvalChange, EvalCase } from "../types";

function makeEval(id: number, name = `eval-${id}`): EvalCase {
  return {
    id,
    name,
    prompt: `prompt for ${name}`,
    expected_output: `expected for ${name}`,
    files: [],
    assertions: [{ id: `a-${id}`, text: `assertion ${id}`, type: "boolean" as const }],
  };
}

function makeEvalsFile(evals: EvalCase[]): EvalsFile {
  return { skill_name: "test-skill", evals };
}

function allSelected(count: number): Map<number, boolean> {
  const m = new Map<number, boolean>();
  for (let i = 0; i < count; i++) m.set(i, true);
  return m;
}

describe("mergeEvalChanges", () => {
  it("returns original when no changes are selected", () => {
    const current = makeEvalsFile([makeEval(1), makeEval(2)]);
    const changes: EvalChange[] = [
      { action: "remove", reason: "no longer needed", evalId: 1 },
    ];
    const selections = new Map<number, boolean>([[0, false]]);
    const result = mergeEvalChanges(current, changes, selections);
    expect(result.evals).toHaveLength(2);
    expect(result.evals.map((e) => e.id)).toEqual([1, 2]);
  });

  it("returns original when selections map is empty", () => {
    const current = makeEvalsFile([makeEval(1)]);
    const changes: EvalChange[] = [
      { action: "remove", reason: "test", evalId: 1 },
    ];
    const result = mergeEvalChanges(current, changes, new Map());
    expect(result.evals).toHaveLength(1);
  });

  it("removes eval by id", () => {
    const current = makeEvalsFile([makeEval(1), makeEval(2), makeEval(3)]);
    const changes: EvalChange[] = [
      { action: "remove", reason: "obsolete", evalId: 2 },
    ];
    const result = mergeEvalChanges(current, changes, allSelected(1));
    expect(result.evals).toHaveLength(2);
    expect(result.evals.map((e) => e.id)).toEqual([1, 3]);
  });

  it("modifies eval by id, preserving original id", () => {
    const current = makeEvalsFile([makeEval(1), makeEval(2)]);
    const modified = makeEval(999, "updated-name");
    const changes: EvalChange[] = [
      { action: "modify", reason: "updated prompt", evalId: 2, eval: modified },
    ];
    const result = mergeEvalChanges(current, changes, allSelected(1));
    expect(result.evals).toHaveLength(2);
    const e2 = result.evals.find((e) => e.id === 2)!;
    expect(e2.name).toBe("updated-name");
    expect(e2.prompt).toBe("prompt for updated-name");
  });

  it("adds eval with next available id", () => {
    const current = makeEvalsFile([makeEval(1), makeEval(5)]);
    const newEval = makeEval(0, "brand-new");
    const changes: EvalChange[] = [
      { action: "add", reason: "new coverage", eval: newEval },
    ];
    const result = mergeEvalChanges(current, changes, allSelected(1));
    expect(result.evals).toHaveLength(3);
    const added = result.evals[2];
    expect(added.id).toBe(6); // max(1,5) + 1
    expect(added.name).toBe("brand-new");
  });

  it("adds multiple evals with sequential ids", () => {
    const current = makeEvalsFile([makeEval(3)]);
    const changes: EvalChange[] = [
      { action: "add", reason: "first add", eval: makeEval(0, "add-1") },
      { action: "add", reason: "second add", eval: makeEval(0, "add-2") },
    ];
    const result = mergeEvalChanges(current, changes, allSelected(2));
    expect(result.evals).toHaveLength(3);
    expect(result.evals[1].id).toBe(4);
    expect(result.evals[2].id).toBe(5);
  });

  it("processes removes before modifies before adds", () => {
    const current = makeEvalsFile([makeEval(1), makeEval(2), makeEval(3)]);
    const changes: EvalChange[] = [
      { action: "add", reason: "new", eval: makeEval(0, "added") },
      { action: "remove", reason: "gone", evalId: 1 },
      { action: "modify", reason: "updated", evalId: 3, eval: makeEval(0, "modified-3") },
    ];
    const result = mergeEvalChanges(current, changes, allSelected(3));
    // Remove id=1 -> [2, 3]. Modify id=3. Add with id=4
    expect(result.evals).toHaveLength(3);
    expect(result.evals.map((e) => e.id)).toEqual([2, 3, 4]);
    expect(result.evals[1].name).toBe("modified-3");
    expect(result.evals[2].name).toBe("added");
  });

  it("does not reuse deleted eval IDs for new adds", () => {
    // Scenario: eval ID 3 is the max. Remove it, then add.
    // New ID should be 4 (based on pre-remove max), NOT 3 (post-remove max of 2).
    const current = makeEvalsFile([makeEval(1), makeEval(2), makeEval(3)]);
    const changes: EvalChange[] = [
      { action: "remove", reason: "delete max", evalId: 3 },
      { action: "add", reason: "new one", eval: makeEval(0, "fresh") },
    ];
    const result = mergeEvalChanges(current, changes, allSelected(2));
    expect(result.evals).toHaveLength(3);
    const addedEval = result.evals.find((e) => e.name === "fresh")!;
    expect(addedEval.id).toBe(4); // NOT 3
  });

  it("skips modify when evalId not found", () => {
    const current = makeEvalsFile([makeEval(1)]);
    const changes: EvalChange[] = [
      { action: "modify", reason: "ghost", evalId: 999, eval: makeEval(0, "phantom") },
    ];
    const result = mergeEvalChanges(current, changes, allSelected(1));
    expect(result.evals).toHaveLength(1);
    expect(result.evals[0].name).toBe("eval-1");
  });

  it("skips modify when eval object is missing", () => {
    const current = makeEvalsFile([makeEval(1)]);
    const changes: EvalChange[] = [
      { action: "modify", reason: "no data", evalId: 1 } as EvalChange,
    ];
    const result = mergeEvalChanges(current, changes, allSelected(1));
    expect(result.evals[0].name).toBe("eval-1");
  });

  it("skips add when eval object is missing", () => {
    const current = makeEvalsFile([makeEval(1)]);
    const changes: EvalChange[] = [
      { action: "add", reason: "no data" } as EvalChange,
    ];
    const result = mergeEvalChanges(current, changes, allSelected(1));
    expect(result.evals).toHaveLength(1);
  });

  it("only applies checked changes, ignoring unchecked", () => {
    const current = makeEvalsFile([makeEval(1), makeEval(2)]);
    const changes: EvalChange[] = [
      { action: "remove", reason: "checked", evalId: 1 },
      { action: "remove", reason: "unchecked", evalId: 2 },
    ];
    const selections = new Map<number, boolean>([[0, true], [1, false]]);
    const result = mergeEvalChanges(current, changes, selections);
    expect(result.evals).toHaveLength(1);
    expect(result.evals[0].id).toBe(2);
  });

  it("does not mutate the input EvalsFile", () => {
    const current = makeEvalsFile([makeEval(1), makeEval(2)]);
    const originalEvals = [...current.evals];
    const changes: EvalChange[] = [
      { action: "remove", reason: "remove one", evalId: 1 },
    ];
    mergeEvalChanges(current, changes, allSelected(1));
    expect(current.evals).toEqual(originalEvals);
  });

  it("normalizes missing fields on added eval", () => {
    const current = makeEvalsFile([makeEval(1)]);
    const incomplete = { id: 0, name: "sparse", prompt: "p" } as unknown as EvalCase;
    const changes: EvalChange[] = [
      { action: "add", reason: "sparse data", eval: incomplete },
    ];
    const result = mergeEvalChanges(current, changes, allSelected(1));
    const added = result.evals[1];
    expect(added.expected_output).toBe("");
    expect(Array.isArray(added.files)).toBe(true);
    expect(Array.isArray(added.assertions)).toBe(true);
  });

  it("preserves skill_name in returned EvalsFile", () => {
    const current = makeEvalsFile([makeEval(1)]);
    current.skill_name = "my-special-skill";
    const changes: EvalChange[] = [
      { action: "add", reason: "new", eval: makeEval(0, "new-one") },
    ];
    const result = mergeEvalChanges(current, changes, allSelected(1));
    expect(result.skill_name).toBe("my-special-skill");
  });

  it("handles empty current evals with adds", () => {
    const current = makeEvalsFile([]);
    const changes: EvalChange[] = [
      { action: "add", reason: "first eval", eval: makeEval(0, "first") },
    ];
    const result = mergeEvalChanges(current, changes, allSelected(1));
    expect(result.evals).toHaveLength(1);
    expect(result.evals[0].id).toBe(1);
  });
});
