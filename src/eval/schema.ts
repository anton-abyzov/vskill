// ---------------------------------------------------------------------------
// evals.json schema validation
// ---------------------------------------------------------------------------

import { readFileSync, existsSync } from "node:fs";
import { join } from "node:path";
import { VALID_CLEANUP_ACTIONS } from "./integration-types.js";
import type { EvalCleanupSchema, EvalRequirementsSchema } from "./integration-types.js";

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
  testType?: "unit" | "integration";
  requiredCredentials?: string[];
  requirements?: EvalRequirementsSchema;
  cleanup?: EvalCleanupSchema[];
}

export interface EvalsFile {
  skill_name: string;
  evals: EvalCase[];
}

export interface ValidationError {
  path: string;
  message: string;
}

export interface ValidationWarning {
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

export interface ValidatedEvalsResult {
  evalsFile: EvalsFile;
  warnings: ValidationWarning[];
}

export function loadAndValidateEvals(skillDir: string): EvalsFile;
export function loadAndValidateEvals(skillDir: string, opts: { returnWarnings: true }): ValidatedEvalsResult;
export function loadAndValidateEvals(skillDir: string, opts?: { returnWarnings?: boolean }): EvalsFile | ValidatedEvalsResult {
  const result = _loadAndValidateEvalsInternal(skillDir);
  if (opts?.returnWarnings) return result;
  return result.evalsFile;
}

function _loadAndValidateEvalsInternal(skillDir: string): ValidatedEvalsResult {
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

    // Migration: Anthropic standard format omits "name" — derive from id
    if ((typeof evalCase.name !== "string" || !evalCase.name) && typeof evalCase.id === "number") {
      evalCase.name = `case-${evalCase.id}`;
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

    // Migration: accept Anthropic standard "expectations" (string[]) as a fallback for "assertions".
    // IDs are scoped to the eval case: "{evalId}_{assertionIndex}" (e.g. "1_1", "1_2", "2_1").
    if (!Array.isArray(evalCase.assertions) && Array.isArray(evalCase.expectations)) {
      const caseId = typeof evalCase.id === "number" ? evalCase.id : i + 1;
      evalCase.assertions = (evalCase.expectations as string[]).map((text: string, j: number) => ({
        id: `${caseId}_${j + 1}`,
        text,
        type: "boolean",
      }));
    }

    if (!Array.isArray(evalCase.assertions)) {
      errors.push({
        path: `${prefix}.assertions`,
        message: 'required array field — use "expectations": ["..."] (Anthropic format) or "assertions": [{"id":"...","text":"...","type":"boolean"}]',
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

  // Integration-specific validation (warnings + cleanup action errors)
  const warnings: ValidationWarning[] = [];
  const integrationErrors: ValidationError[] = [];

  for (let i = 0; i < parsed.evals.length; i++) {
    const evalCase = parsed.evals[i];
    const prefix = `evals[${i}]`;

    if (evalCase.testType !== "integration") continue;

    // AC-US4-01: Missing requiredCredentials → warning (not error)
    if (!Array.isArray(evalCase.requiredCredentials) || evalCase.requiredCredentials.length === 0) {
      warnings.push({
        path: `${prefix}.requiredCredentials`,
        message: "integration test case has no requiredCredentials — some integration tests may not need credentials, but verify this is intentional",
      });
    }

    // AC-US4-02: Invalid cleanup actions → error
    if (Array.isArray(evalCase.cleanup)) {
      for (let j = 0; j < evalCase.cleanup.length; j++) {
        const cleanup = evalCase.cleanup[j];
        if (cleanup.action && !(VALID_CLEANUP_ACTIONS as readonly string[]).includes(cleanup.action)) {
          integrationErrors.push({
            path: `${prefix}.cleanup[${j}].action`,
            message: `invalid cleanup action "${cleanup.action}" — allowed values: ${VALID_CLEANUP_ACTIONS.join(", ")}`,
          });
        }
      }
    }

    // AC-US4-03: Prose assertions heuristic → warning
    if (Array.isArray(evalCase.assertions)) {
      const outcomeVerbs = /\b(returns|contains|exists|equals|includes|matches|starts|ends|has|is|shows|displays|produces|emits|creates|deletes|responds|status)\b/i;
      for (let j = 0; j < evalCase.assertions.length; j++) {
        const assertion = evalCase.assertions[j];
        if (typeof assertion.text === "string" && assertion.text.length > 100 && !outcomeVerbs.test(assertion.text)) {
          warnings.push({
            path: `${prefix}.assertions[${j}].text`,
            message: "assertion looks like LLM-judged prose — consider using API status codes or resource existence assertions for integration tests",
          });
        }
      }
    }
  }

  if (integrationErrors.length > 0) {
    throw new EvalValidationError(integrationErrors);
  }

  // Normalize: default files to [], testType to "unit"
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
    testType: e.testType === "integration" ? "integration" : "unit",
    ...(Array.isArray(e.requiredCredentials) ? { requiredCredentials: e.requiredCredentials } : {}),
    ...(e.requirements ? { requirements: e.requirements } : {}),
    ...(Array.isArray(e.cleanup) ? { cleanup: e.cleanup } : {}),
  }));

  return { evalsFile: { skill_name: parsed.skill_name, evals }, warnings };
}
