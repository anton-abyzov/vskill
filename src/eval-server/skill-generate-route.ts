import { AuthoringValidationError } from "../shared/skill-authoring-document.js";
import type { Router } from "./router.js";
import { sendJson, readBody } from "./router.js";
import { initSSE, sendSSE, sendSSEDone } from "./sse-helpers.js";
import { detectAvailableProviders } from "./api-routes.js";
import { classifyError } from "./error-classifier.js";
import type { ProviderName } from "../eval/llm.js";
import { generateSkill } from "../core/skill-generator.js";
import { isSkillCreatorInstalled } from "../utils/skill-creator-detection.js";
import { generateWithSkillCreator } from "./skill-authoring-engine.js";
import { matchExistingPlugin, type GenerateSkillRequest, type GenerateSkillResult } from "./skill-create-routes.js";

interface ResolvedProviderModel {
  ok: true;
  provider: string;
  model: string;
}
interface ProviderModelError {
  ok: false;
  error: "unknown_provider" | "unknown_model";
  validProviders?: string[];
  validModels?: string[];
}

/**
 * Merge generator output with a `suggestedPlugin` computed from the existing
 * plugins on disk. Kept out of src/core/skill-generator.ts so the generator
 * stays pure (no filesystem access for plugin suggestion).
 */
function attachSuggestedPlugin(parsed: GenerateSkillResult, root: string) {
  const tags = parsed.description
    ? parsed.description.toLowerCase().split(/[,;]+/).map((s) => s.trim()).filter(Boolean)
    : [];
  const suggestedPlugin = matchExistingPlugin(parsed.name, parsed.description, tags, root);
  return { ...parsed, suggestedPlugin };
}

async function resolveProviderModel(
  requestedProvider: string | undefined,
  requestedModel: string | undefined,
): Promise<ResolvedProviderModel | ProviderModelError> {
  // Both absent → legacy default (no probe).
  if (!requestedProvider && !requestedModel) {
    return { ok: true, provider: "claude-cli", model: "sonnet" };
  }

  const detected = await detectAvailableProviders();
  const requested = requestedProvider || "claude-cli";
  const match = detected.find((p) => p.id === requested);
  if (!match) {
    return {
      ok: false,
      error: "unknown_provider",
      validProviders: detected.map((p) => p.id),
    };
  }

  const validModelIds = match.models.map((m) => m.id);
  if (requestedModel !== undefined) {
    if (!validModelIds.includes(requestedModel)) {
      return { ok: false, error: "unknown_model", validModels: validModelIds };
    }
    return { ok: true, provider: requested, model: requestedModel };
  }
  // Provider given, model omitted — pick the first model id for that provider.
  return { ok: true, provider: requested, model: validModelIds[0] ?? "sonnet" };
}


export function registerSkillGenerateRoute(router: Router, getRoot: () => string): void {
  // POST /api/skills/generate — AI-assisted skill generation (parallel body + evals)
  // 0670 T-002: thin wrapper over src/core/skill-generator.ts:generateSkill.
  router.post("/api/skills/generate", async (req, res) => {
    const root = getRoot();
    const body = (await readBody(req)) as GenerateSkillRequest;
    if (!body || typeof body !== "object" || typeof body.prompt !== "string" || !body.prompt.trim())
      return sendJson(res, { error: "Describe what your skill should do" }, 400, req);
    if (body.prompt.length > 50000)
      return sendJson(res, { error: "Prompt is too long (max 50,000 characters)" }, 400, req);
    for (const key of ["provider", "model", "body"] as const)
      if (body[key] !== undefined && typeof body[key] !== "string") return sendJson(res, { error: `${key} must be a string` }, 400, req);
    const engine = body.engine ?? "vskill";
    if (!["vskill", "anthropic-skill-creator", "none"].includes(engine))
      return sendJson(res, { error: "Invalid authoring engine" }, 400, req);
    if (engine === "none")
      return sendJson(res, { error: "No engine selected — author the skill in Manual mode" }, 400, req);
    if (engine === "anthropic-skill-creator" && !isSkillCreatorInstalled(root))
      return sendJson(res, { error: "skill-creator-not-installed", remediation: "claude plugin install skill-creator" }, 400, req);
    if (engine === "anthropic-skill-creator" && body.provider && body.provider !== "claude-cli")
      return sendJson(res, { error: "skill-creator requires the Claude Code provider" }, 400, req);
    const resolved = await resolveProviderModel(body.provider, body.model);
    if (!resolved.ok) {
      const payload: Record<string, unknown> = { error: resolved.error };
      if (resolved.validProviders) payload.validProviders = resolved.validProviders;
      if (resolved.validModels) payload.validModels = resolved.validModels;
      return sendJson(res, payload, 400, req);
    }
    const wantsSSE = req.headers.accept?.includes("text/event-stream") ||
      (req.url ? new URL(req.url, "http://localhost").searchParams.has("sse") : false);
    const ac = new AbortController();
    res.on("close", () => ac.abort());
    if (wantsSSE) initSSE(res, req);
    try {
      const generator = engine === "anthropic-skill-creator" ? generateWithSkillCreator : generateSkill;
      const parsed = await generator(
        { ...body, provider: resolved.provider as ProviderName, model: resolved.model },
        {
          root,
          abortSignal: ac.signal,
          onProgress: wantsSSE ? (e) => { if (!ac.signal.aborted) sendSSE(res, "progress", e); } : undefined,
        },
      );
      if (ac.signal.aborted) return;
      const result = attachSuggestedPlugin(parsed, root);
      // 0711: emit provenance as a SEPARATE SSE event before `done` so the
      // GenerateSkillResult schema stays clean (parity tests assert on the
      // legacy shape). The UI's useCreateSkill listens for the `provenance`
      // event and stamps aiMeta. Best-effort — never blocks generation.
      if (wantsSSE && (resolved.provider === "anthropic" || resolved.provider === "claude-cli")) {
        try {
          const { resolveAnthropicModel } = await import("../eval/model-resolver.js");
          const r = resolveAnthropicModel(resolved.model);
          sendSSE(res, "provenance", {
            resolvedModelId: r.resolvedId || null,
            snapshotDate: r.snapshotDate,
            source: r.source,
          });
        } catch {
          /* provenance is best-effort; never block generation */
        }
      }
      if (wantsSSE) sendSSEDone(res, result); else sendJson(res, result, 200, req);
    } catch (err) {
      if (wantsSSE && !ac.signal.aborted) {
        sendSSE(res, "error", classifyError(err, resolved.provider));
        res.end();
      } else {
        const msg = (err as Error).message;
        sendJson(res, { error: msg }, err instanceof AuthoringValidationError || msg.includes("not valid JSON") ? 422 : 500, req);
      }
    }
  });
}
