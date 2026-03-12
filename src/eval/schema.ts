// ---------------------------------------------------------------------------
// evals.json schema validation
// ---------------------------------------------------------------------------

import { readFileSync, existsSync } from "node:fs";
import { join } from "node:path";

// ---------------------------------------------------------------------------
// Types
// ---------------------------------------------------------------------------

export interface Assertion {
  id: string;
  text: string;
  type: "boolean";
}

export interface EvalCase {
  id: number;
  name: string;
  prompt: string;
  expected_output: string;
  files: string[];
  assertions: Assertion[];
}

export interface EvalsFile {
  skill_name: string;
  evals: EvalCase[];
}

export interface ValidationError {
  path: string;
  message: string;
}

export class EvalValidationError extends Error {
  errors: ValidationError[];

  constructor(errors: ValidationError[]) {
    const msg = errors.map((e) => `${e.path}: ${e.message}`).join("; ");
    super(`Eval validation failed: ${msg}`);
    this.name = "EvalValidationError";
    this.errors = errors;
  }
}

// ---------------------------------------------------------------------------
// Validator
// ---------------------------------------------------------------------------

export function loadAndValidateEvals(skillDir: string): EvalsFile {
  const filePath = join(skillDir, "evals", "evals.json");

  if (!existsSync(filePath)) {
    throw new EvalValidationError([
      { path: filePath, message: "No evals.json found" },
    ]);
  }

  const raw = readFileSync(filePath, "utf-8");

  let parsed: any;
  try {
    parsed = JSON.parse(raw);
  } catch (err) {
    const syntaxErr = err as SyntaxError;
    throw new EvalValidationError([
      {
        path: filePath,
        message: `JSON parse error: ${syntaxErr.message}`,
      },
    ]);
  }

  const errors: ValidationError[] = [];

  if (typeof parsed.skill_name !== "string" || !parsed.skill_name) {
    errors.push({ path: "skill_name", message: "required string field" });
  }

  if (!Array.isArray(parsed.evals)) {
    errors.push({ path: "evals", message: "required array field" });
    throw new EvalValidationError(errors);
  }

  for (let i = 0; i < parsed.evals.length; i++) {
    const evalCase = parsed.evals[i];
    const prefix = `evals[${i}]`;

    if (typeof evalCase.id !== "number") {
      errors.push({ path: `${prefix}.id`, message: "required number field" });
    }
    if (typeof evalCase.name !== "string" || !evalCase.name) {
      errors.push({
        path: `${prefix}.name`,
        message: "required string field",
      });
    }
    if (typeof evalCase.prompt !== "string" || !evalCase.prompt) {
      errors.push({
        path: `${prefix}.prompt`,
        message: "required string field",
      });
    }
    if (
      typeof evalCase.expected_output !== "string" ||
      !evalCase.expected_output
    ) {
      errors.push({
        path: `${prefix}.expected_output`,
        message: "required string field",
      });
    }

    // Migration: accept legacy "expectations" (string[]) as a fallback for "assertions"
    if (!Array.isArray(evalCase.assertions) && Array.isArray(evalCase.expectations)) {
      evalCase.assertions = (evalCase.expectations as string[]).map((text: string, i: number) => ({
        id: `assert-${i + 1}`,
        text,
        type: "boolean",
      }));
    }

    if (!Array.isArray(evalCase.assertions)) {
      errors.push({
        path: `${prefix}.assertions`,
        message: "required array field",
      });
      continue;
    }

    if (evalCase.assertions.length === 0) {
      errors.push({
        path: `${prefix}.assertions`,
        message: "must have at least 1 assertion",
      });
      continue;
    }

    // Check for duplicate assertion IDs
    const seenIds = new Set<string>();
    for (const assertion of evalCase.assertions) {
      if (typeof assertion.id !== "string" || !assertion.id) {
        errors.push({
          path: `${prefix}.assertions[].id`,
          message: "required string field",
        });
      }
      if (typeof assertion.text !== "string" || !assertion.text) {
        errors.push({
          path: `${prefix}.assertions[].text`,
          message: "required string field",
        });
      }
      if (assertion.id && seenIds.has(assertion.id)) {
        errors.push({
          path: `${prefix}.assertions`,
          message: `duplicate assertion ID: ${assertion.id}`,
        });
      }
      seenIds.add(assertion.id);
    }
  }

  if (errors.length > 0) {
    throw new EvalValidationError(errors);
  }

  // Normalize: default files to []
  const evals: EvalCase[] = parsed.evals.map((e: any) => ({
    id: e.id,
    name: e.name,
    prompt: e.prompt,
    expected_output: e.expected_output,
    files: Array.isArray(e.files) ? e.files : [],
    assertions: e.assertions.map((a: any) => ({
      id: a.id,
      text: a.text,
      type: a.type || "boolean",
    })),
  }));

  return { skill_name: parsed.skill_name, evals };
}
