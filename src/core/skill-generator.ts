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
  type GenerateSkillRequest,
  type GenerateSkillResult,
} from "../eval-server/skill-create-routes.js";
import { createLlmClient } from "../eval/llm.js";
import type { ProviderName } from "../eval/llm.js";

export type { GenerateSkillRequest, GenerateSkillResult };

export interface GenerateSkillProgressEvent {
  phase:
    | "preparing"
    | "generating-body"
    | "generating-evals"
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
