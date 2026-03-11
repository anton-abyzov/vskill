// ---------------------------------------------------------------------------
// mergeEvalChanges -- apply selected eval change suggestions to an EvalsFile
// ---------------------------------------------------------------------------

import type { EvalsFile, EvalChange, EvalCase } from "../types";

/** Ensure LLM-generated eval has all required fields with safe defaults */
function normalizeEval(e: EvalCase): EvalCase {
  return {
    ...e,
    expected_output: e.expected_output ?? "",
    files: Array.isArray(e.files) ? e.files : [],
    assertions: Array.isArray(e.assertions) ? e.assertions : [],
  };
}

/**
 * Apply selected eval changes (add/modify/remove) to produce a new EvalsFile.
 * Processing order: removes first, then modifies, then adds.
 * Does not mutate inputs.
 */
export function mergeEvalChanges(
  current: EvalsFile,
  changes: EvalChange[],
  selections: Map<number, boolean>,
): EvalsFile {
  // Filter to only selected changes
  const selected = changes.filter((_, i) => selections.get(i) === true);
  if (selected.length === 0) return current;

  // Partition by action
  const removes = selected.filter((c) => c.action === "remove");
  const modifies = selected.filter((c) => c.action === "modify");
  const adds = selected.filter((c) => c.action === "add");

  let evals = [...current.evals];

  // 1. Removes
  const removeIds = new Set(removes.map((c) => c.evalId).filter((id): id is number => id != null));
  if (removeIds.size > 0) {
    evals = evals.filter((e) => !removeIds.has(e.id));
  }

  // 2. Modifies
  for (const change of modifies) {
    if (change.evalId == null || !change.eval) continue;
    const idx = evals.findIndex((e) => e.id === change.evalId);
    if (idx < 0) continue; // skip if target not found
    evals[idx] = normalizeEval({ ...change.eval, id: change.evalId });
  }

  // 3. Adds
  let nextId = evals.length > 0 ? Math.max(...evals.map((e) => e.id)) + 1 : 1;
  for (const change of adds) {
    if (!change.eval) continue;
    evals.push(normalizeEval({ ...change.eval, id: nextId++ }));
  }

  return { ...current, evals };
}
