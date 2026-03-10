// ---------------------------------------------------------------------------
// api-routes.ts -- REST API route handlers for the eval UI
// ---------------------------------------------------------------------------

import { readFileSync, writeFileSync, mkdirSync, existsSync } from "node:fs";
import { join } from "node:path";
import type { Router } from "./router.js";
import { sendJson, readBody } from "./router.js";
import { initSSE, sendSSE, sendSSEDone, withHeartbeat } from "./sse-helpers.js";
import { runBenchmarkSSE, runSingleCaseSSE, assembleBulkResult } from "./benchmark-runner.js";
import { getSkillSemaphore } from "./concurrency.js";
import { resolveSkillDir } from "./skill-resolver.js";
import { scanSkills } from "../eval/skill-scanner.js";
import { loadAndValidateEvals, EvalValidationError } from "../eval/schema.js";
import type { EvalsFile } from "../eval/schema.js";
import { readBenchmark } from "../eval/benchmark.js";
import type { BenchmarkResult, BenchmarkCase, BenchmarkAssertionResult } from "../eval/benchmark.js";
import { writeHistoryEntry, listHistory, readHistoryEntry, computeRegressions, deleteHistoryEntry, getCaseHistory, computeStats } from "../eval/benchmark-history.js";
import type { HistoryFilter } from "../eval/benchmark-history.js";
import { judgeAssertion } from "../eval/judge.js";
import { buildEvalSystemPrompt, buildBaselineSystemPrompt } from "../eval/prompt-builder.js";
import { createLlmClient } from "../eval/llm.js";
import type { ProviderName, LlmOverrides } from "../eval/llm.js";
import { runComparison } from "../eval/comparator.js";
import { computeVerdict } from "../eval/verdict.js";
import { buildEvalInitPrompt, parseGeneratedEvals } from "../eval/prompt-builder.js";
import { testActivation } from "../eval/activation-tester.js";
import type { ActivationPrompt } from "../eval/activation-tester.js";
import { detectMcpDependencies, detectSkillDependencies } from "../eval/mcp-detector.js";

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
    { id: "claude-sonnet-4-6", label: "Claude Sonnet 4.6 (API)" },
    { id: "claude-opus-4-6", label: "Claude Opus 4.6 (API)" },
    { id: "claude-haiku-4-5-20251001", label: "Claude Haiku 4.5 (API)" },
  ],
  "ollama": [
    { id: "llama3.1:8b", label: "Llama 3.1 8B" },
    { id: "qwen2.5:32b", label: "Qwen 2.5 32B" },
    { id: "gemma2:9b", label: "Gemma 2 9B" },
    { id: "mistral:7b", label: "Mistral 7B" },
  ],
};

// ---------------------------------------------------------------------------
// Ollama detection cache — avoids 500ms+ probe on every /api/config request.
// Without this, page load blocks on a 2s timeout when Ollama is not running.
// ---------------------------------------------------------------------------
let ollamaCache: { available: boolean; models: ModelOption[]; ts: number } | null = null;
const OLLAMA_CACHE_TTL = 30_000; // re-probe every 30s

async function probeOllama(): Promise<{ available: boolean; models: ModelOption[] }> {
  const now = Date.now();
  if (ollamaCache && now - ollamaCache.ts < OLLAMA_CACHE_TTL) {
    return ollamaCache;
  }
  let models = PROVIDER_MODELS["ollama"];
  let available = false;
  try {
    const baseUrl = process.env.OLLAMA_BASE_URL || "http://localhost:11434";
    const resp = await fetch(`${baseUrl}/api/tags`, { signal: AbortSignal.timeout(500) });
    if (resp.ok) {
      available = true;
      const data = await resp.json() as { models?: Array<{ name: string }> };
      if (data.models?.length) {
        models = data.models.map((m) => ({ id: m.name, label: m.name }));
      }
    }
  } catch { /* ollama not running */ }
  ollamaCache = { available, models, ts: now };
  return ollamaCache;
}

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

  // Ollama — cached probe (500ms timeout, refreshes every 30s)
  const ollama = await probeOllama();
  providers.push({
    id: "ollama",
    label: "Ollama (local, free)",
    available: ollama.available,
    models: ollama.models,
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
      const providers = await detectAvailableProviders().catch(() => []);
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
    sendJson(res, { description, rawContent: skillContent }, 200, req);
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

  // Generate evals using AI — reads SKILL.md and returns generated EvalsFile
  router.post("/api/skills/:plugin/:skill/generate-evals", async (req, res, params) => {
    const skillDir = resolveSkillDir(root, params.plugin, params.skill);
    const skillMdPath = join(skillDir, "SKILL.md");

    if (!existsSync(skillMdPath)) {
      sendJson(res, { error: "SKILL.md not found — cannot generate evals without skill content" }, 400, req);
      return;
    }

    try {
      const skillContent = readFileSync(skillMdPath, "utf-8");
      const prompt = buildEvalInitPrompt(skillContent);
      const client = getClient();
      const genResult = await client.generate(
        "You generate eval test cases for AI skills. Output only valid JSON in a code fence.",
        prompt,
      );
      const evalsFile = parseGeneratedEvals(genResult.text);
      sendJson(res, evalsFile, 200, req);
    } catch (err) {
      sendJson(res, { error: `Eval generation failed: ${(err as Error).message}` }, 500, req);
    }
  });

  // Run benchmark (SSE) — optionally accepts { eval_ids: number[] } to run specific cases
  router.post("/api/skills/:plugin/:skill/benchmark", async (req, res, params) => {
    const skillDir = resolveSkillDir(root, params.plugin, params.skill);
    let aborted = false;
    res.on("close", () => { aborted = true; });

    const body = await readBody(req).catch(() => ({})) as { eval_ids?: number[] };
    const filterIds = Array.isArray(body?.eval_ids) ? new Set(body.eval_ids) : null;

    initSSE(res, req);

    try {
      const evals = loadAndValidateEvals(skillDir);
      const skillMdPath = join(skillDir, "SKILL.md");
      const skillContent = existsSync(skillMdPath) ? readFileSync(skillMdPath, "utf-8") : "";
      const client = getClient();
      const systemPrompt = buildEvalSystemPrompt(skillContent);

      await runBenchmarkSSE({
        res, skillDir, skillName: evals.skill_name, systemPrompt,
        runType: "benchmark", provider: currentOverrides.provider || "claude-cli",
        evalCases: evals.evals, filterIds, client, isAborted: () => aborted,
      });
    } catch (err) {
      const errorMsg = err instanceof Error ? err.message : String(err);
      sendSSEDone(res, { error: errorMsg });
    }
  });

  // Run baseline (SSE) — same as benchmark but without skill content
  router.post("/api/skills/:plugin/:skill/baseline", async (req, res, params) => {
    const skillDir = resolveSkillDir(root, params.plugin, params.skill);
    let aborted = false;
    res.on("close", () => { aborted = true; });

    const body = await readBody(req).catch(() => ({})) as { eval_ids?: number[] };
    const filterIds = Array.isArray(body?.eval_ids) ? new Set(body.eval_ids) : null;

    initSSE(res, req);

    try {
      const evals = loadAndValidateEvals(skillDir);
      const client = getClient();

      await runBenchmarkSSE({
        res, skillDir, skillName: evals.skill_name,
        systemPrompt: "You are a helpful AI assistant.",
        runType: "baseline", provider: currentOverrides.provider || "claude-cli",
        evalCases: evals.evals, filterIds, client, isAborted: () => aborted,
      });
    } catch (err) {
      const errorMsg = err instanceof Error ? err.message : String(err);
      sendSSEDone(res, { error: errorMsg });
    }
  });

  // Run single case (SSE) — per-case endpoint with semaphore
  router.post("/api/skills/:plugin/:skill/benchmark/case/:evalId", async (req, res, params) => {
    const skillDir = resolveSkillDir(root, params.plugin, params.skill);
    const evalId = parseInt(params.evalId, 10);
    if (isNaN(evalId)) { sendJson(res, { error: "Invalid evalId" }, 400, req); return; }

    const body = await readBody(req).catch(() => ({})) as { mode?: string; bulk?: boolean };
    const isBaseline = body?.mode === "baseline";
    const isBulkChild = body?.bulk === true;

    let aborted = false;
    let released = false;
    res.on("close", () => {
      aborted = true;
      if (!released) { released = true; sem.release(); }
    });

    const sem = getSkillSemaphore(`${params.plugin}/${params.skill}`);
    initSSE(res, req);

    try {
      const evals = loadAndValidateEvals(skillDir);
      const evalCase = evals.evals.find((e) => e.id === evalId);
      if (!evalCase) { sendSSEDone(res, { error: `Case ${evalId} not found` }); return; }

      const skillMdPath = join(skillDir, "SKILL.md");
      const skillContent = existsSync(skillMdPath) ? readFileSync(skillMdPath, "utf-8") : "";
      const client = getClient();
      const systemPrompt = isBaseline
        ? buildBaselineSystemPrompt()
        : buildEvalSystemPrompt(skillContent);

      await sem.acquire();

      const benchCase = await runSingleCaseSSE({
        res, evalCase, systemPrompt, client, isAborted: () => aborted,
      });

      if (!released) { released = true; sem.release(); }

      if (!aborted) {
        // Write per-case history unless this is part of a bulk run (bulk-save handles it)
        if (!isBulkChild) {
          const result: BenchmarkResult = {
            timestamp: new Date().toISOString(),
            model: client.model,
            skill_name: evals.skill_name,
            cases: [benchCase],
            overall_pass_rate: benchCase.pass_rate,
            type: isBaseline ? "baseline" : "benchmark",
            provider: currentOverrides.provider || "claude-cli",
            totalDurationMs: benchCase.durationMs ?? 0,
            totalInputTokens: benchCase.inputTokens ?? null,
            totalOutputTokens: benchCase.outputTokens ?? null,
            scope: "single",
          };
          await writeHistoryEntry(skillDir, result);
        }
        sendSSEDone(res, benchCase);
      }
    } catch (err) {
      if (!released) { released = true; sem.release(); }
      const errorMsg = err instanceof Error ? err.message : String(err);
      sendSSEDone(res, { error: errorMsg });
    }
  });

  // Bulk save — client assembles result from per-case runs and saves as one history entry
  router.post("/api/skills/:plugin/:skill/benchmark/bulk-save", async (req, res, params) => {
    const skillDir = resolveSkillDir(root, params.plugin, params.skill);
    try {
      const body = await readBody(req) as { result: BenchmarkResult };
      if (!body?.result) { sendJson(res, { error: "Missing result" }, 400, req); return; }
      const result = { ...body.result, scope: "bulk" as const };
      await writeHistoryEntry(skillDir, result);
      sendJson(res, { ok: true }, 200, req);
    } catch (err) {
      sendJson(res, { error: (err as Error).message }, 500, req);
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
      const body = await readBody(req).catch(() => ({})) as { eval_ids?: number[] };
      const filterIds = Array.isArray(body?.eval_ids) ? new Set(body.eval_ids) : null;
      const skillMdPath = join(skillDir, "SKILL.md");
      const skillContent = existsSync(skillMdPath) ? readFileSync(skillMdPath, "utf-8") : "";
      const client = getClient();

      const casesToRun = filterIds
        ? evals.evals.filter((e) => filterIds.has(e.id))
        : evals.evals;

      const comparisonResults: Array<{
        eval_id: number;
        eval_name: string;
        comparison: Awaited<ReturnType<typeof runComparison>>;
        assertionResults: BenchmarkAssertionResult[];
      }> = [];

      for (const evalCase of casesToRun) {
        if (aborted) break;

        sendSSE(res, "case_start", {
          eval_id: evalCase.id,
          eval_name: evalCase.name,
        });

        sendSSE(res, "progress", {
          eval_id: evalCase.id,
          phase: "comparing",
          message: `Running skill vs baseline comparison for "${evalCase.name}"...`,
        });

        try {
          const comparison = await withHeartbeat(
            res, evalCase.id, "comparing",
            `Running skill vs baseline comparison for "${evalCase.name}"...`,
            () => runComparison(evalCase.prompt, skillContent, client),
          );
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
          sendSSE(res, "progress", {
            eval_id: evalCase.id,
            phase: "judging",
            message: `Evaluating ${evalCase.assertions.length} assertion${evalCase.assertions.length !== 1 ? "s" : ""}...`,
            total: evalCase.assertions.length,
          });

          const assertionResults: BenchmarkAssertionResult[] = [];
          for (let ai = 0; ai < evalCase.assertions.length; ai++) {
            const assertion = evalCase.assertions[ai];
            if (aborted) break;
            sendSSE(res, "progress", {
              eval_id: evalCase.id,
              phase: "judging_assertion",
              message: `Evaluating assertion ${ai + 1}/${evalCase.assertions.length}...`,
              current: ai + 1,
              total: evalCase.assertions.length,
            });
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
          durationMs: r.comparison.skillDurationMs,
          tokens: r.comparison.skillTokens,
          assertions: r.assertionResults,
          comparisonDetail: {
            skillDurationMs: r.comparison.skillDurationMs,
            skillTokens: r.comparison.skillTokens,
            baselineDurationMs: r.comparison.baselineDurationMs,
            baselineTokens: r.comparison.baselineTokens,
            skillContentScore: r.comparison.skillContentScore,
            skillStructureScore: r.comparison.skillStructureScore,
            baselineContentScore: r.comparison.baselineContentScore,
            baselineStructureScore: r.comparison.baselineStructureScore,
            winner: r.comparison.winner,
          },
        }));

        const historyResult = {
          timestamp: new Date().toISOString(),
          model: client.model,
          skill_name: evals.skill_name,
          cases,
          overall_pass_rate: passRate,
          type: "comparison" as const,
          provider: currentOverrides.provider || "claude-cli",
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

  // List benchmark history (with optional filters)
  router.get("/api/skills/:plugin/:skill/history", async (req, res, params) => {
    const skillDir = resolveSkillDir(root, params.plugin, params.skill);
    const url = new URL(req.url!, `http://localhost`);
    const filter: HistoryFilter = {};
    const modelParam = url.searchParams.get("model");
    const typeParam = url.searchParams.get("type");
    const fromParam = url.searchParams.get("from");
    const toParam = url.searchParams.get("to");
    if (modelParam) filter.model = modelParam;
    if (typeParam && ["benchmark", "comparison", "baseline"].includes(typeParam)) {
      filter.type = typeParam as HistoryFilter["type"];
    }
    if (fromParam) filter.from = fromParam;
    if (toParam) filter.to = toParam;
    const hasFilter = Object.keys(filter).length > 0;
    const history = await listHistory(skillDir, hasFilter ? filter : undefined);
    sendJson(res, history, 200, req);
  });

  // Compare two history runs
  router.get("/api/skills/:plugin/:skill/history-compare", async (req, res, params) => {
    const skillDir = resolveSkillDir(root, params.plugin, params.skill);
    const url = new URL(req.url!, `http://localhost`);
    const tsA = url.searchParams.get("a");
    const tsB = url.searchParams.get("b");
    if (!tsA || !tsB) {
      sendJson(res, { error: "Both 'a' and 'b' timestamps are required" }, 400, req);
      return;
    }

    const [runA, runB] = await Promise.all([
      readHistoryEntry(skillDir, tsA),
      readHistoryEntry(skillDir, tsB),
    ]);
    if (!runA || !runB) {
      sendJson(res, { error: "One or both history entries not found" }, 404, req);
      return;
    }

    const regressions = computeRegressions(runB, runA);

    // Build case diffs
    const allEvalIds = new Set([
      ...runA.cases.map((c) => c.eval_id),
      ...runB.cases.map((c) => c.eval_id),
    ]);
    const caseDiffs = Array.from(allEvalIds).map((evalId) => {
      const caseA = runA.cases.find((c) => c.eval_id === evalId);
      const caseB = runB.cases.find((c) => c.eval_id === evalId);
      return {
        eval_id: evalId,
        eval_name: caseA?.eval_name || caseB?.eval_name || `Eval #${evalId}`,
        statusA: caseA?.status ?? "missing" as const,
        statusB: caseB?.status ?? "missing" as const,
        passRateA: caseA?.pass_rate ?? null,
        passRateB: caseB?.pass_rate ?? null,
        durationMsA: caseA?.durationMs ?? null,
        durationMsB: caseB?.durationMs ?? null,
        tokensA: caseA?.tokens ?? null,
        tokensB: caseB?.tokens ?? null,
      };
    });

    const totalA = runA.cases.reduce((s, c) => s + c.assertions.length, 0);
    const passedA = runA.cases.reduce((s, c) => s + c.assertions.filter((a) => a.pass).length, 0);
    const totalB = runB.cases.reduce((s, c) => s + c.assertions.length, 0);
    const passedB = runB.cases.reduce((s, c) => s + c.assertions.filter((a) => a.pass).length, 0);

    sendJson(res, {
      runA: {
        timestamp: runA.timestamp, model: runA.model,
        passRate: totalA > 0 ? passedA / totalA : 0,
        type: runA.type || "benchmark",
      },
      runB: {
        timestamp: runB.timestamp, model: runB.model,
        passRate: totalB > 0 ? passedB / totalB : 0,
        type: runB.type || "benchmark",
      },
      regressions,
      caseDiffs,
    }, 200, req);
  });

  // Per-case history
  router.get("/api/skills/:plugin/:skill/history/case/:evalId", async (req, res, params) => {
    const skillDir = resolveSkillDir(root, params.plugin, params.skill);
    const evalId = parseInt(params.evalId, 10);
    if (isNaN(evalId)) {
      sendJson(res, { error: "Invalid eval ID" }, 400, req);
      return;
    }
    const url = new URL(req.url!, `http://localhost`);
    const modelParam = url.searchParams.get("model") || undefined;
    const entries = await getCaseHistory(skillDir, evalId, modelParam ? { model: modelParam } : undefined);
    sendJson(res, entries, 200, req);
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

  // Delete history entry
  router.delete("/api/skills/:plugin/:skill/history/:timestamp", async (req, res, params) => {
    const skillDir = resolveSkillDir(root, params.plugin, params.skill);
    const deleted = await deleteHistoryEntry(skillDir, params.timestamp);
    if (!deleted) {
      sendJson(res, { error: "History entry not found" }, 404, req);
      return;
    }
    sendJson(res, { ok: true }, 200, req);
  });

  // Get aggregated stats
  router.get("/api/skills/:plugin/:skill/stats", async (req, res, params) => {
    const skillDir = resolveSkillDir(root, params.plugin, params.skill);
    const stats = await computeStats(skillDir);
    sendJson(res, stats, 200, req);
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

  // Get skill dependencies (MCP + skill-to-skill)
  router.get("/api/skills/:plugin/:skill/dependencies", async (req, res, params) => {
    const skillDir = resolveSkillDir(root, params.plugin, params.skill);
    const skillMdPath = join(skillDir, "SKILL.md");
    if (!existsSync(skillMdPath)) {
      sendJson(res, { error: "SKILL.md not found" }, 404, req);
      return;
    }
    const content = readFileSync(skillMdPath, "utf-8");
    const mcpDependencies = detectMcpDependencies(content);
    const skillDependencies = detectSkillDependencies(content);
    sendJson(res, { mcpDependencies, skillDependencies }, 200, req);
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
