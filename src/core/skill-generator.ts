// ---------------------------------------------------------------------------
// skill-generator.ts — Pure generator extracted from the in-line body of
// POST /api/skills/generate (see skill-create-routes.ts, pre-0.5.104 it lived
// between roughly lines 919–1025).
//
// Contract (0670 AC-US4-01..05):
//   • No HTTP imports. No req/res/SSE helpers. Progress flows through
//     options.onProgress.
//   • buildAgentAwareSystemPrompt() is invoked when non-Claude targets are
//     present — preserved behavior.
//   • The returned GenerateSkillResult shape matches the pre-extraction
//     HTTP response JSON (minus suggestedPlugin, which is merged in by
//     callers — HTTP handler and CLI).
//
// This module DEPENDS on exported helpers from src/eval-server/skill-create-
// routes.ts (BODY_SYSTEM_PROMPT, EVAL_SYSTEM_PROMPT, parseBodyResponse,
// parseEvalsResponse, mergeGenerateResults, buildAgentAwareSystemPrompt,
// detectProjectLayout, types). Approach (b) from the T-001 instructions:
// re-export-from-routes rather than full-move, to stay inside the diff
// budget. A future increment should relocate the helpers into src/core/
// (see per-symbol TODOs in skill-create-routes.ts). Until then a
// src/core → src/eval-server import line exists here — intentional and
// isolated to this single module.
// ---------------------------------------------------------------------------

// eslint-disable-next-line no-restricted-imports -- see module header TODO
import {
  BODY_SYSTEM_PROMPT,
  EVAL_SYSTEM_PROMPT,
  buildAgentAwareSystemPrompt,
  detectProjectLayout,
  mergeGenerateResults,
  parseBodyResponse,
  parseEvalsResponse,
  type GenerateSkillRequest as BaseGenerateSkillRequest,
  type GenerateSkillResult as BaseGenerateSkillResult,
} from "../eval-server/skill-create-routes.js";
import { createLlmClient } from "../eval/llm.js";
import type { ProviderName } from "../eval/llm.js";
import {
  SCRIPT_SYSTEM_PROMPT,
  GRADER_SYSTEM_PROMPT,
  TEST_SYSTEM_PROMPT,
  REFERENCE_SYSTEM_PROMPT,
  parseScriptResponse,
  parseGraderResponse,
  parseTestResponse,
  parseReferenceResponse,
} from "./agent-prompts.js";

// 0815: extend the request/result types with the optional multiFile contract.
// All new fields are optional so existing callers see no change.
export interface GenerateSkillRequest extends BaseGenerateSkillRequest {
  multiFile?: boolean;
}

export interface GenerateSkillResult extends BaseGenerateSkillResult {
  /** Auxiliary files produced by the multi-file pipeline (relative path → contents). */
  files?: Record<string, string>;
  /** Env-var names declared by the test-agent. */
  secrets?: string[];
  /** Runtime requirements declared by the script-agent. */
  runtime?: { python?: string; pip?: string[]; node?: string };
  /** Integration-test contract declared by the test-agent. */
  integrationTests?: { runner: "vitest" | "pytest" | "none"; file?: string; requires?: string[] };
  /** Per-agent error messages from the parallel fan-out (informational). */
  multiFileWarnings?: string[];
}

export interface GenerateSkillProgressEvent {
  phase:
    | "preparing"
    | "generating-body"
    | "generating-evals"
    | "generating-scripts"
    | "generating-graders"
    | "generating-tests"
    | "generating-references"
    | "parsing"
    | "done";
  message: string;
}

export interface GenerateSkillOptions {
  /** Project root — used by detectProjectLayout() for plugin hints. */
  root: string;
  /** Optional progress callback — phase events for SSE or CLI spinners. */
  onProgress?: (event: GenerateSkillProgressEvent) => void;
  /**
   * Optional AbortSignal. When aborted the generator stops as soon as the
   * in-flight LLM calls settle (LLM clients themselves do not currently
   * honor AbortSignal; this is best-effort cooperative cancellation).
   */
  abortSignal?: AbortSignal;
}

/**
 * Resolve provider + model defaults consistent with the pre-extraction
 * handler behavior: when both are absent we use { claude-cli, sonnet }.
 * Unlike the HTTP handler we do NOT validate against
 * detectAvailableProviders() — validation stays at the transport boundary
 * (HTTP handler performs it before calling generateSkill; CLI callers
 * resolve their own CLI args). This keeps generateSkill() free of
 * eval-server dependencies like detectAvailableProviders.
 */
function resolveProviderModel(request: GenerateSkillRequest): {
  provider: ProviderName;
  model: string;
} {
  const provider = (request.provider ?? "claude-cli") as ProviderName;
  const model = request.model ?? "sonnet";
  return { provider, model };
}

/**
 * Generate a complete skill definition (body + metadata + evals) from a
 * natural-language prompt.
 *
 * Both LLM calls run in parallel (body + evals); the body is required while
 * evals are optional — if eval generation fails the result is returned with
 * `evals: []` and a `warning` field.
 */
export async function generateSkill(
  request: GenerateSkillRequest,
  options: GenerateSkillOptions,
): Promise<GenerateSkillResult> {
  const { root, onProgress, abortSignal } = options;

  const emit = (event: GenerateSkillProgressEvent): void => {
    if (onProgress && !abortSignal?.aborted) onProgress(event);
  };

  emit({ phase: "preparing", message: "Building prompt..." });

  const { provider, model } = resolveProviderModel(request);

  // Body generation: the requested (or default) capable model.
  const bodyClient = createLlmClient({ provider, model });

  // Eval generation: fast/cheap model (configurable via VSKILL_EVAL_GEN_MODEL,
  // default haiku). Eval client stays on the cheap model regardless of the
  // body choice — intentional cost amortization.
  const evalModel = process.env.VSKILL_EVAL_GEN_MODEL || "haiku";
  const evalClient = createLlmClient({ provider, model: evalModel });

  // Detect existing plugins for prompt injection (the HTTP handler uses this
  // for hinting the LLM toward an existing plugin category).
  const layout = detectProjectLayout(root);
  const existingPlugins = [
    ...new Set(layout.detectedLayouts.flatMap((d) => d.existingPlugins)),
  ];
  const pluginContext =
    existingPlugins.length > 0
      ? `\n\nExisting plugins in this project: ${JSON.stringify(existingPlugins)}. Include a "suggestedPlugin" field in your JSON response with the best-matching plugin name from this list, or a new kebab-case name if none fit.`
      : `\n\nInclude a "suggestedPlugin" field in your JSON response with a suggested kebab-case plugin/category name for this skill.`;

  const trimmedPrompt = request.prompt.trim();
  const bodyPrompt = `Generate a skill definition (body and metadata only, NO evals) for:\n\n${trimmedPrompt}\n\nApply Skill Studio best practices. Return the JSON object followed by ---REASONING--- and your explanation.${pluginContext}`;
  const evalPrompt = `Generate eval test cases for this skill:\n\n${trimmedPrompt}\n\nReturn only the JSON object with an "evals" array.`;

  // Agent-aware prompt augmentation: append constraints for non-Claude agents
  const effectiveSystemPrompt = buildAgentAwareSystemPrompt(
    BODY_SYSTEM_PROMPT,
    request.targetAgents,
  );

  if (request.multiFile === true) {
    return await generateMultiFileSkill({
      trimmedPrompt,
      effectiveSystemPrompt,
      provider,
      model,
      evalModel,
      pluginContext,
      abortSignal,
      emit,
    });
  }

  emit({ phase: "generating-body", message: "Generating skill body..." });
  emit({ phase: "generating-evals", message: "Generating evals..." });

  const bodyCall = bodyClient
    .generate(effectiveSystemPrompt, bodyPrompt)
    .then((r) => parseBodyResponse(r.text));
  const evalCall = evalClient
    .generate(EVAL_SYSTEM_PROMPT, evalPrompt)
    .then((r) => parseEvalsResponse(r.text));

  const [bodySettled, evalsSettled] = await Promise.allSettled([bodyCall, evalCall]);

  if (abortSignal?.aborted) {
    // Cooperative cancellation — propagate the caller's reason if set,
    // otherwise a generic AbortError-style failure.
    const reason =
      (abortSignal as AbortSignal & { reason?: unknown }).reason ??
      new Error("Skill generation aborted");
    throw reason instanceof Error ? reason : new Error(String(reason));
  }

  emit({ phase: "parsing", message: "Merging results..." });

  const merged = mergeGenerateResults(bodySettled, evalsSettled);

  emit({ phase: "done", message: "Generation complete" });

  return merged;
}

// ---------------------------------------------------------------------------
// 0815: multiFile branch — 5 parallel agents (script, grader, test, reference,
// eval) via Promise.allSettled, then body-agent runs SEQUENTIALLY LAST with
// the merged filename list as input so SKILL.md links resolve.
//
// Cost mitigation: script/grader/test agents use the capable model (typically
// Sonnet); reference + eval agents use the cheap evalModel (typically Haiku).
//
// Failure handling: a partial failure of any fan-out agent is captured as a
// `multiFileWarnings[]` entry rather than aborting the whole generation, so
// the user still gets a usable skill.
// ---------------------------------------------------------------------------
interface MultiFileContext {
  trimmedPrompt: string;
  effectiveSystemPrompt: string;
  provider: ProviderName;
  model: string;
  evalModel: string;
  pluginContext: string;
  abortSignal?: AbortSignal;
  emit: (event: GenerateSkillProgressEvent) => void;
}

async function generateMultiFileSkill(
  ctx: MultiFileContext,
): Promise<GenerateSkillResult> {
  const {
    trimmedPrompt,
    effectiveSystemPrompt,
    provider,
    model,
    evalModel,
    pluginContext,
    abortSignal,
    emit,
  } = ctx;

  // Capable model for code-producing agents; cheap model for reference + eval.
  const capableClient = createLlmClient({ provider, model });
  const cheapClient = createLlmClient({ provider, model: evalModel });

  // Each agent gets the same skill description; the system prompt does the
  // role-shaping. buildAgentAwareSystemPrompt() is intentionally NOT applied
  // here — the per-role prompts are concrete enough that target-agent
  // constraints are encoded by the body-agent's SKILL.md output, not the
  // auxiliary code files.
  const userPrompt = `Generate the role-specific output for this skill:\n\n${trimmedPrompt}`;

  emit({ phase: "generating-scripts", message: "Generating helper scripts..." });
  emit({ phase: "generating-graders", message: "Generating grader..." });
  emit({ phase: "generating-tests", message: "Generating integration test..." });
  emit({ phase: "generating-references", message: "Generating references..." });
  emit({ phase: "generating-evals", message: "Generating evals..." });

  const scriptCall = capableClient
    .generate(SCRIPT_SYSTEM_PROMPT, userPrompt)
    .then((r) => parseScriptResponse(r.text));
  const graderCall = capableClient
    .generate(GRADER_SYSTEM_PROMPT, userPrompt)
    .then((r) => parseGraderResponse(r.text));
  const testCall = capableClient
    .generate(TEST_SYSTEM_PROMPT, userPrompt)
    .then((r) => parseTestResponse(r.text));
  const referenceCall = cheapClient
    .generate(REFERENCE_SYSTEM_PROMPT, userPrompt)
    .then((r) => parseReferenceResponse(r.text));
  const evalCall = cheapClient
    .generate(
      EVAL_SYSTEM_PROMPT,
      `Generate eval test cases for this skill:\n\n${trimmedPrompt}\n\nReturn only the JSON object with an "evals" array.`,
    )
    .then((r) => parseEvalsResponse(r.text));

  const settled = await Promise.allSettled([
    scriptCall,
    graderCall,
    testCall,
    referenceCall,
    evalCall,
  ]);

  if (abortSignal?.aborted) {
    const reason =
      (abortSignal as AbortSignal & { reason?: unknown }).reason ??
      new Error("Skill generation aborted");
    throw reason instanceof Error ? reason : new Error(String(reason));
  }

  // Collect produced files + warnings.
  const files: Record<string, string> = {};
  const warnings: string[] = [];
  let secrets: string[] | undefined;
  let runtime: GenerateSkillResult["runtime"];
  let integrationTests: GenerateSkillResult["integrationTests"];

  const [scriptR, graderR, testR, referenceR, evalsR] = settled;
  if (scriptR.status === "fulfilled") {
    for (const f of scriptR.value.files) files[f.path] = f.content;
    if (scriptR.value.runtime) runtime = scriptR.value.runtime;
  } else {
    warnings.push(`script-agent failed: ${stringifyReason(scriptR.reason)}`);
  }
  if (graderR.status === "fulfilled") {
    for (const f of graderR.value.files) files[f.path] = f.content;
  } else {
    warnings.push(`grader-agent failed: ${stringifyReason(graderR.reason)}`);
  }
  if (testR.status === "fulfilled") {
    for (const f of testR.value.files) files[f.path] = f.content;
    if (testR.value.secrets) secrets = testR.value.secrets;
    if (testR.value.integrationTests) integrationTests = testR.value.integrationTests;
  } else {
    warnings.push(`test-agent failed: ${stringifyReason(testR.reason)}`);
  }
  if (referenceR.status === "fulfilled") {
    for (const f of referenceR.value.files) files[f.path] = f.content;
  } else {
    warnings.push(`reference-agent failed: ${stringifyReason(referenceR.reason)}`);
  }

  emit({ phase: "generating-body", message: "Generating SKILL.md..." });

  // Body-agent runs LAST with the produced filename list so SKILL.md can
  // reference the actual files. Missing files become generic prose in the
  // SKILL.md body — never broken links.
  const filenameList = Object.keys(files).sort().join("\n  - ");
  const bodyPrompt = `Generate a skill definition (body and metadata only, NO evals) for:\n\n${trimmedPrompt}\n\nThe skill is multi-file. The following auxiliary files have been produced and live in the skill directory:\n  - ${filenameList || "(no auxiliary files produced)"}\n\nReference them in the SKILL.md body using relative paths (e.g. \`scripts/audit.py\`). If a referenced category is missing from the list above, omit references rather than inventing filenames.\n\nApply Skill Studio best practices. Return the JSON object followed by ---REASONING--- and your explanation.${pluginContext}`;

  const bodyClient = createLlmClient({ provider, model });
  const bodySettled = await Promise.allSettled([
    bodyClient.generate(effectiveSystemPrompt, bodyPrompt).then((r) => parseBodyResponse(r.text)),
  ]);

  emit({ phase: "parsing", message: "Merging multi-file results..." });

  const merged = mergeGenerateResults(bodySettled[0], evalsR);

  emit({ phase: "done", message: "Multi-file generation complete" });

  return {
    ...merged,
    files,
    ...(secrets ? { secrets } : {}),
    ...(runtime ? { runtime } : {}),
    ...(integrationTests ? { integrationTests } : {}),
    ...(warnings.length > 0 ? { multiFileWarnings: warnings } : {}),
  };
}

function stringifyReason(reason: unknown): string {
  if (reason instanceof Error) return reason.message;
  if (typeof reason === "string") return reason;
  try {
    return JSON.stringify(reason);
  } catch {
    return String(reason);
  }
}
