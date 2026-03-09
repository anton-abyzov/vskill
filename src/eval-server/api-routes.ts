// ---------------------------------------------------------------------------
// api-routes.ts -- REST API route handlers for the eval UI
// ---------------------------------------------------------------------------

import { readFileSync, writeFileSync, mkdirSync, existsSync } from "node:fs";
import { join } from "node:path";
import type { Router } from "./router.js";
import { sendJson, readBody } from "./router.js";
import { initSSE, sendSSE, sendSSEDone } from "./sse-helpers.js";
import { scanSkills } from "../eval/skill-scanner.js";
import { loadAndValidateEvals, EvalValidationError } from "../eval/schema.js";
import type { EvalsFile } from "../eval/schema.js";
import { readBenchmark } from "../eval/benchmark.js";
import type { BenchmarkResult, BenchmarkCase, BenchmarkAssertionResult } from "../eval/benchmark.js";
import { writeHistoryEntry, listHistory, readHistoryEntry, computeRegressions } from "../eval/benchmark-history.js";
import { judgeAssertion } from "../eval/judge.js";
import { createLlmClient } from "../eval/llm.js";
import type { ProviderName, LlmOverrides } from "../eval/llm.js";
import { runComparison } from "../eval/comparator.js";
import { computeVerdict } from "../eval/verdict.js";
import { testActivation } from "../eval/activation-tester.js";
import type { ActivationPrompt } from "../eval/activation-tester.js";

function resolveSkillDir(root: string, plugin: string, skill: string): string {
  // Try direct layout: {root}/{plugin}/skills/{skill}/
  const directPath = join(root, plugin, "skills", skill);
  if (existsSync(directPath)) return directPath;

  // Try nested plugins/ layout: {root}/plugins/{plugin}/skills/{skill}/
  const nestedPath = join(root, "plugins", plugin, "skills", skill);
  if (existsSync(nestedPath)) return nestedPath;

  // Try root layout: {root}/skills/{skill}/
  const rootPath = join(root, "skills", skill);
  if (existsSync(rootPath)) return rootPath;

  return directPath;
}

// ---------------------------------------------------------------------------
// In-memory config state — UI can change provider/model at runtime.
//
// Default: claude-cli (Sonnet). The eval server is always run from a separate
// terminal, so claude-cli is always safe — even if CLAUDECODE env is set
// (which only matters for the `vskill eval run` CLI command).
// ---------------------------------------------------------------------------
let currentOverrides: LlmOverrides = { provider: "claude-cli" };

function getClient(): ReturnType<typeof createLlmClient> {
  return createLlmClient(currentOverrides);
}

interface ModelOption {
  id: string;       // raw model id passed to the provider
  label: string;    // human-readable display name
}

const PROVIDER_MODELS: Record<ProviderName, ModelOption[]> = {
  "claude-cli": [
    { id: "sonnet", label: "Claude Sonnet" },
    { id: "opus", label: "Claude Opus" },
    { id: "haiku", label: "Claude Haiku" },
  ],
  "anthropic": [
    { id: "claude-sonnet-4-20250514", label: "Claude Sonnet 4 (API)" },
    { id: "claude-opus-4-20250514", label: "Claude Opus 4 (API)" },
    { id: "claude-haiku-4-20250414", label: "Claude Haiku 4 (API)" },
  ],
  "ollama": [
    { id: "llama3.1:8b", label: "Llama 3.1 8B" },
    { id: "qwen2.5:32b", label: "Qwen 2.5 32B" },
    { id: "gemma2:9b", label: "Gemma 2 9B" },
    { id: "mistral:7b", label: "Mistral 7B" },
  ],
};

async function detectAvailableProviders(): Promise<Array<{
  id: ProviderName;
  label: string;
  available: boolean;
  models: ModelOption[];
}>> {
  const providers: Array<{
    id: ProviderName;
    label: string;
    available: boolean;
    models: ModelOption[];
  }> = [];

  // Claude CLI — always available for the eval server (runs in a separate terminal)
  providers.push({
    id: "claude-cli",
    label: "Claude (Max/Pro subscription)",
    available: true,
    models: PROVIDER_MODELS["claude-cli"],
  });

  // Anthropic API — available if ANTHROPIC_API_KEY is set
  providers.push({
    id: "anthropic",
    label: "Anthropic API (requires key)",
    available: !!process.env.ANTHROPIC_API_KEY,
    models: PROVIDER_MODELS["anthropic"],
  });

  // Ollama — probe the server for actually installed models
  let ollamaModels = PROVIDER_MODELS["ollama"];
  let ollamaAvailable = false;
  try {
    const baseUrl = process.env.OLLAMA_BASE_URL || "http://localhost:11434";
    const resp = await fetch(`${baseUrl}/api/tags`, { signal: AbortSignal.timeout(2000) });
    if (resp.ok) {
      ollamaAvailable = true;
      const data = await resp.json() as { models?: Array<{ name: string }> };
      if (data.models?.length) {
        ollamaModels = data.models.map((m) => ({ id: m.name, label: m.name }));
      }
    }
  } catch { /* ollama not running */ }
  providers.push({
    id: "ollama",
    label: "Ollama (local, free)",
    available: ollamaAvailable,
    models: ollamaModels,
  });

  return providers;
}

export function registerRoutes(router: Router, root: string, projectName?: string): void {
  // Health check
  router.get("/api/health", (_req, res) => {
    sendJson(res, { ok: true });
  });

  // Config — expose current provider/model + available providers + project
  router.get("/api/config", async (_req, res) => {
    try {
      const client = getClient();
      const providers = await detectAvailableProviders();
      sendJson(res, {
        provider: currentOverrides.provider || null,
        model: client.model,
        providers,
        projectName: projectName || null,
        root,
      });
    } catch (err) {
      const providers = await detectAvailableProviders();
      sendJson(res, { provider: null, model: "unknown", error: (err as Error).message, providers, projectName: projectName || null, root });
    }
  });

  // Update config — change provider/model at runtime
  router.post("/api/config", async (req, res) => {
    const body = (await readBody(req)) as { provider?: ProviderName; model?: string };
    if (body.provider) currentOverrides.provider = body.provider;
    if (body.model) currentOverrides.model = body.model;
    // If provider changed but no model, clear model override so it uses the provider default
    if (body.provider && !body.model) delete currentOverrides.model;

    try {
      const client = getClient();
      const providers = await detectAvailableProviders();
      sendJson(res, { provider: currentOverrides.provider || null, model: client.model, providers });
    } catch (err) {
      // Revert to safe default (not empty — empty triggers auto-detection which
      // picks ollama inside Claude Code sessions instead of claude-cli)
      currentOverrides = { provider: "claude-cli" };
      sendJson(res, { error: (err as Error).message }, 400, req);
    }
  });

  // List all skills
  router.get("/api/skills", async (req, res) => {
    const skills = await scanSkills(root);
    const enriched = await Promise.all(
      skills.map(async (s) => {
        let evalCount = 0;
        let assertionCount = 0;
        try {
          const evals = loadAndValidateEvals(s.dir);
          evalCount = evals.evals.length;
          assertionCount = evals.evals.reduce((sum, e) => sum + e.assertions.length, 0);
        } catch { /* no evals */ }
        const benchmark = await readBenchmark(s.dir);
        return {
          ...s,
          evalCount,
          assertionCount,
          benchmarkStatus: benchmark
            ? benchmark.cases.every((c) => c.status === "pass")
              ? "pass"
              : "fail"
            : s.hasEvals
              ? "pending"
              : "missing",
          lastBenchmark: benchmark?.timestamp ?? null,
        };
      }),
    );
    sendJson(res, enriched, 200, req);
  });

  // Get skill detail
  router.get("/api/skills/:plugin/:skill", async (req, res, params) => {
    const skillDir = resolveSkillDir(root, params.plugin, params.skill);
    const skillMdPath = join(skillDir, "SKILL.md");
    let skillContent = "";
    try {
      skillContent = readFileSync(skillMdPath, "utf-8");
    } catch { /* no SKILL.md */ }
    sendJson(res, { plugin: params.plugin, skill: params.skill, skillContent }, 200, req);
  });

  // Get skill description (for activation testing preview)
  router.get("/api/skills/:plugin/:skill/description", async (req, res, params) => {
    const skillDir = resolveSkillDir(root, params.plugin, params.skill);
    const skillMdPath = join(skillDir, "SKILL.md");
    let skillContent = "";
    try {
      skillContent = readFileSync(skillMdPath, "utf-8");
    } catch { /* no SKILL.md */ }
    const descMatch = skillContent.match(/^---[\s\S]*?description:\s*"([^"]+)"[\s\S]*?---/);
    const description = descMatch ? descMatch[1] : skillContent.slice(0, 500);
    sendJson(res, { description }, 200, req);
  });

  // Get evals.json
  router.get("/api/skills/:plugin/:skill/evals", async (req, res, params) => {
    const skillDir = resolveSkillDir(root, params.plugin, params.skill);
    try {
      const evals = loadAndValidateEvals(skillDir);
      sendJson(res, evals, 200, req);
    } catch (err) {
      if (err instanceof EvalValidationError) {
        sendJson(res, { error: err.message, errors: err.errors }, 400, req);
      } else {
        sendJson(res, { error: "No evals.json found" }, 404, req);
      }
    }
  });

  // Save evals.json
  router.put("/api/skills/:plugin/:skill/evals", async (req, res, params) => {
    const skillDir = resolveSkillDir(root, params.plugin, params.skill);
    const body = (await readBody(req)) as EvalsFile;

    // Validate before writing
    const errors = validateEvalsBody(body);
    if (errors.length > 0) {
      sendJson(res, { error: "Validation failed", errors }, 400, req);
      return;
    }

    const evalsDir = join(skillDir, "evals");
    mkdirSync(evalsDir, { recursive: true });
    const filePath = join(evalsDir, "evals.json");
    writeFileSync(filePath, JSON.stringify(body, null, 2), "utf-8");
    sendJson(res, body, 200, req);
  });

  // Run benchmark (SSE) — optionally accepts { eval_ids: number[] } to run specific cases
  router.post("/api/skills/:plugin/:skill/benchmark", async (req, res, params) => {
    const skillDir = resolveSkillDir(root, params.plugin, params.skill);
    let aborted = false;
    res.on("close", () => { aborted = true; });

    // Read body before switching to SSE mode
    const body = await readBody(req).catch(() => ({})) as { eval_ids?: number[] };
    const filterIds = Array.isArray(body?.eval_ids) ? new Set(body.eval_ids) : null;

    initSSE(res, req);

    try {
      const evals = loadAndValidateEvals(skillDir);
      const skillMdPath = join(skillDir, "SKILL.md");
      const skillContent = existsSync(skillMdPath) ? readFileSync(skillMdPath, "utf-8") : "";
      const client = getClient();
      const systemPrompt = skillContent
        ? `You are an AI assistant enhanced with the following skill:\n\n${skillContent}`
        : "You are a helpful AI assistant.";

      // Filter to specific eval cases if requested
      const evalCases = filterIds
        ? evals.evals.filter((e) => filterIds.has(e.id))
        : evals.evals;

      const cases: BenchmarkCase[] = [];

      for (const evalCase of evalCases) {
        if (aborted) break;

        sendSSE(res, "case_start", {
          eval_id: evalCase.id,
          eval_name: evalCase.name,
          total: evalCases.length,
        });

        try {
          const genResult = await client.generate(systemPrompt, evalCase.prompt);
          const totalTokens = genResult.inputTokens != null && genResult.outputTokens != null
            ? genResult.inputTokens + genResult.outputTokens
            : null;

          // Stream the actual LLM output so the UI can display it as proof
          sendSSE(res, "output_ready", {
            eval_id: evalCase.id,
            output: genResult.text,
            durationMs: genResult.durationMs,
            tokens: totalTokens,
          });

          const assertionResults: BenchmarkAssertionResult[] = [];

          for (const assertion of evalCase.assertions) {
            if (aborted) break;
            const result = await judgeAssertion(genResult.text, assertion, client);
            assertionResults.push(result);
            sendSSE(res, "assertion_result", {
              eval_id: evalCase.id,
              assertion_id: result.id,
              text: result.text,
              pass: result.pass,
              reasoning: result.reasoning,
            });
          }

          const passRate =
            assertionResults.length > 0
              ? assertionResults.filter((a) => a.pass).length / assertionResults.length
              : 0;
          const status = assertionResults.every((a) => a.pass) ? "pass" : "fail";

          const benchCase: BenchmarkCase = {
            eval_id: evalCase.id,
            eval_name: evalCase.name,
            status: status as "pass" | "fail",
            error_message: null,
            pass_rate: passRate,
            durationMs: genResult.durationMs,
            tokens: totalTokens,
            assertions: assertionResults,
          };
          cases.push(benchCase);

          sendSSE(res, "case_complete", {
            eval_id: evalCase.id,
            status,
            pass_rate: passRate,
            durationMs: genResult.durationMs,
            tokens: totalTokens,
          });
        } catch (err) {
          const errorMsg = err instanceof Error ? err.message : String(err);
          cases.push({
            eval_id: evalCase.id,
            eval_name: evalCase.name,
            status: "error",
            error_message: errorMsg,
            pass_rate: 0,
            assertions: [],
          });
          sendSSE(res, "case_complete", {
            eval_id: evalCase.id,
            status: "error",
            error_message: errorMsg,
          });
        }
      }

      const totalAssertions = cases.reduce((s, c) => s + c.assertions.length, 0);
      const passedAssertions = cases.reduce(
        (s, c) => s + c.assertions.filter((a) => a.pass).length,
        0,
      );
      const result: BenchmarkResult = {
        timestamp: new Date().toISOString(),
        model: client.model,
        skill_name: evals.skill_name,
        cases,
        overall_pass_rate: totalAssertions > 0 ? passedAssertions / totalAssertions : 0,
      };

      if (!aborted) {
        // Only save to history for full benchmark runs (not single-case)
        if (!filterIds) {
          await writeHistoryEntry(skillDir, result);
        }
        sendSSEDone(res, result);
      }
    } catch (err) {
      const errorMsg = err instanceof Error ? err.message : String(err);
      sendSSEDone(res, { error: errorMsg });
    }
  });

  // Run comparison (SSE)
  router.post("/api/skills/:plugin/:skill/compare", async (req, res, params) => {
    const skillDir = resolveSkillDir(root, params.plugin, params.skill);
    let aborted = false;
    res.on("close", () => { aborted = true; });

    initSSE(res, req);

    try {
      const evals = loadAndValidateEvals(skillDir);
      const skillMdPath = join(skillDir, "SKILL.md");
      const skillContent = existsSync(skillMdPath) ? readFileSync(skillMdPath, "utf-8") : "";
      const client = getClient();

      const comparisonResults: Array<{
        eval_id: number;
        eval_name: string;
        comparison: Awaited<ReturnType<typeof runComparison>>;
        assertionResults: BenchmarkAssertionResult[];
      }> = [];

      for (const evalCase of evals.evals) {
        if (aborted) break;

        sendSSE(res, "case_start", {
          eval_id: evalCase.id,
          eval_name: evalCase.name,
        });

        try {
          const comparison = await runComparison(evalCase.prompt, skillContent, client);
          sendSSE(res, "outputs_ready", {
            eval_id: evalCase.id,
            eval_name: evalCase.name,
            prompt: evalCase.prompt,
            skillOutput: comparison.skillOutput,
            skillDurationMs: comparison.skillDurationMs,
            skillTokens: comparison.skillTokens,
            baselineOutput: comparison.baselineOutput,
            baselineDurationMs: comparison.baselineDurationMs,
            baselineTokens: comparison.baselineTokens,
            skillContentScore: comparison.skillContentScore,
            skillStructureScore: comparison.skillStructureScore,
            baselineContentScore: comparison.baselineContentScore,
            baselineStructureScore: comparison.baselineStructureScore,
            winner: comparison.winner,
          });

          // Also grade assertions against skill output
          const assertionResults: BenchmarkAssertionResult[] = [];
          for (const assertion of evalCase.assertions) {
            if (aborted) break;
            const result = await judgeAssertion(comparison.skillOutput, assertion, client);
            assertionResults.push(result);
          }

          comparisonResults.push({
            eval_id: evalCase.id,
            eval_name: evalCase.name,
            comparison,
            assertionResults,
          });

          sendSSE(res, "comparison_scored", {
            eval_id: evalCase.id,
            winner: comparison.winner,
            skillContentScore: comparison.skillContentScore,
            skillStructureScore: comparison.skillStructureScore,
            baselineContentScore: comparison.baselineContentScore,
            baselineStructureScore: comparison.baselineStructureScore,
          });
        } catch (err) {
          sendSSE(res, "case_error", {
            eval_id: evalCase.id,
            error: err instanceof Error ? err.message : String(err),
          });
        }
      }

      if (!aborted) {
        // Compute verdict
        const totalAssertions = comparisonResults.reduce(
          (s, r) => s + r.assertionResults.length,
          0,
        );
        const passedAssertions = comparisonResults.reduce(
          (s, r) => s + r.assertionResults.filter((a) => a.pass).length,
          0,
        );
        const passRate = totalAssertions > 0 ? passedAssertions / totalAssertions : 0;
        const skillRubricAvg =
          comparisonResults.length > 0
            ? comparisonResults.reduce(
                (s, r) =>
                  s +
                  (r.comparison.skillContentScore + r.comparison.skillStructureScore) / 2,
                0,
              ) / comparisonResults.length
            : 0;
        const baselineRubricAvg =
          comparisonResults.length > 0
            ? comparisonResults.reduce(
                (s, r) =>
                  s +
                  (r.comparison.baselineContentScore + r.comparison.baselineStructureScore) / 2,
                0,
              ) / comparisonResults.length
            : 0;

        const verdict = computeVerdict(passRate, skillRubricAvg, baselineRubricAvg);

        // Build benchmark-compatible result for history
        const cases: BenchmarkCase[] = comparisonResults.map((r) => ({
          eval_id: r.eval_id,
          eval_name: r.eval_name,
          status: r.assertionResults.every((a) => a.pass) ? "pass" as const : "fail" as const,
          error_message: null,
          pass_rate:
            r.assertionResults.length > 0
              ? r.assertionResults.filter((a) => a.pass).length / r.assertionResults.length
              : 0,
          assertions: r.assertionResults,
        }));

        const historyResult = {
          timestamp: new Date().toISOString(),
          model: client.model,
          skill_name: evals.skill_name,
          cases,
          overall_pass_rate: passRate,
          type: "comparison" as const,
          verdict,
          comparison: {
            skillPassRate: passRate,
            baselinePassRate: 0,
            skillRubricAvg,
            baselineRubricAvg,
            delta: skillRubricAvg - baselineRubricAvg,
          },
        };

        await writeHistoryEntry(skillDir, historyResult);
        sendSSEDone(res, historyResult);
      }
    } catch (err) {
      sendSSEDone(res, { error: err instanceof Error ? err.message : String(err) });
    }
  });

  // List benchmark history
  router.get("/api/skills/:plugin/:skill/history", async (req, res, params) => {
    const skillDir = resolveSkillDir(root, params.plugin, params.skill);
    const history = await listHistory(skillDir);
    sendJson(res, history, 200, req);
  });

  // Get specific history entry
  router.get("/api/skills/:plugin/:skill/history/:timestamp", async (req, res, params) => {
    const skillDir = resolveSkillDir(root, params.plugin, params.skill);
    const entry = await readHistoryEntry(skillDir, params.timestamp);
    if (!entry) {
      sendJson(res, { error: "History entry not found" }, 404, req);
      return;
    }
    sendJson(res, entry, 200, req);
  });

  // Get latest benchmark
  router.get("/api/skills/:plugin/:skill/benchmark/latest", async (req, res, params) => {
    const skillDir = resolveSkillDir(root, params.plugin, params.skill);
    const benchmark = await readBenchmark(skillDir);
    if (!benchmark) {
      sendJson(res, { error: "No benchmark found" }, 404, req);
      return;
    }
    sendJson(res, benchmark, 200, req);
  });

  // Run activation test (SSE)
  router.post("/api/skills/:plugin/:skill/activation-test", async (req, res, params) => {
    const skillDir = resolveSkillDir(root, params.plugin, params.skill);
    let aborted = false;
    res.on("close", () => { aborted = true; });

    initSSE(res, req);

    try {
      const body = (await readBody(req)) as { prompts: ActivationPrompt[] };
      const skillMdPath = join(skillDir, "SKILL.md");
      const skillContent = existsSync(skillMdPath) ? readFileSync(skillMdPath, "utf-8") : "";

      // Extract description from frontmatter
      const descMatch = skillContent.match(/^---[\s\S]*?description:\s*"([^"]+)"[\s\S]*?---/);
      const description = descMatch ? descMatch[1] : skillContent.slice(0, 500);

      const client = getClient();
      const summary = await testActivation(description, body.prompts, client, (result) => {
        if (!aborted) {
          sendSSE(res, "prompt_result", result);
        }
      });

      if (!aborted) {
        sendSSEDone(res, { ...summary, description });
      }
    } catch (err) {
      sendSSEDone(res, { error: err instanceof Error ? err.message : String(err) });
    }
  });

  // Handle CORS preflight
  router.options = (req: import("node:http").IncomingMessage, res: import("node:http").ServerResponse): void => {
    const origin = req.headers.origin;
    if (origin && /^https?:\/\/(localhost|127\.0\.0\.1)(:\d+)?$/.test(origin)) {
      res.writeHead(204, {
        "Access-Control-Allow-Origin": origin,
        "Access-Control-Allow-Methods": "GET, POST, PUT, DELETE, OPTIONS",
        "Access-Control-Allow-Headers": "Content-Type",
        "Access-Control-Max-Age": "3600",
      });
    } else {
      res.writeHead(204);
    }
    res.end();
  };
}

function validateEvalsBody(body: any): Array<{ path: string; message: string }> {
  const errors: Array<{ path: string; message: string }> = [];

  if (!body || typeof body !== "object") {
    errors.push({ path: "body", message: "must be an object" });
    return errors;
  }
  if (typeof body.skill_name !== "string" || !body.skill_name) {
    errors.push({ path: "skill_name", message: "required string field" });
  }
  if (!Array.isArray(body.evals)) {
    errors.push({ path: "evals", message: "required array field" });
    return errors;
  }
  for (let i = 0; i < body.evals.length; i++) {
    const e = body.evals[i];
    const p = `evals[${i}]`;
    if (typeof e.id !== "number") errors.push({ path: `${p}.id`, message: "required number" });
    if (typeof e.name !== "string" || !e.name) errors.push({ path: `${p}.name`, message: "required string" });
    if (typeof e.prompt !== "string" || !e.prompt) errors.push({ path: `${p}.prompt`, message: "required string" });
    if (typeof e.expected_output !== "string") errors.push({ path: `${p}.expected_output`, message: "required string" });
    if (!Array.isArray(e.assertions) || e.assertions.length === 0) {
      errors.push({ path: `${p}.assertions`, message: "must have at least 1 assertion" });
    }
  }
  return errors;
}
