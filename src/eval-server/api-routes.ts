// ---------------------------------------------------------------------------
// api-routes.ts -- REST API route handlers for the eval UI
// ---------------------------------------------------------------------------

import { readFileSync, writeFileSync, mkdirSync, existsSync, rmSync, readdirSync, statSync } from "node:fs";
import { join, resolve, dirname } from "node:path";
import type { Router } from "./router.js";
import { sendJson, readBody } from "./router.js";
import { initSSE, sendSSE, sendSSEDone, withHeartbeat, startDynamicHeartbeat } from "./sse-helpers.js";
import { classifyError } from "./error-classifier.js";
import { runBenchmarkSSE, runSingleCaseSSE, assembleBulkResult } from "./benchmark-runner.js";
import { getSkillSemaphore } from "./concurrency.js";
import { resolveSkillDir } from "./skill-resolver.js";
import { scanSkills, classifyOrigin } from "../eval/skill-scanner.js";
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
import { generateActionItems } from "../eval/action-items.js";
import { buildEvalInitPrompt, parseGeneratedEvals, buildIntegrationEvalPrompt, parseGeneratedIntegrationEvals, detectBrowserRequirements, detectPlatformTargets } from "../eval/prompt-builder.js";
import { testActivation } from "../eval/activation-tester.js";
import type { ActivationPrompt, SkillMeta } from "../eval/activation-tester.js";
import { detectMcpDependencies, detectSkillDependencies } from "../eval/mcp-detector.js";
import { writeActivationRun, listActivationRuns, getActivationRun } from "../eval/activation-history.js";
import type { ActivationHistoryRun } from "../eval/activation-history.js";

// ---------------------------------------------------------------------------
// Shared helpers
// ---------------------------------------------------------------------------

export function extractDescription(skillContent: string): string {
  const fmMatch = skillContent.match(/^---[\s\S]*?description:\s*"([^"]+)"[\s\S]*?---/);
  if (fmMatch) return fmMatch[1];
  const body = skillContent.replace(/^---[\s\S]*?---\s*/, "").trim();
  return body.slice(0, 500);
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

/** Derive sidebar badge status from benchmark + current eval IDs. */
function computeBenchmarkStatus(
  benchmark: BenchmarkResult | null,
  evalIds: Set<number>,
  hasEvals: boolean,
): "pass" | "fail" | "pending" | "stale" | "missing" {
  if (!benchmark) return hasEvals ? "pending" : "missing";
  if (benchmark.cases.length === 0) return "pending";
  // Stale: benchmark references case IDs that no longer exist in evals
  const isStale = evalIds.size > 0 && !benchmark.cases.every((c) => evalIds.has(c.eval_id));
  if (isStale) return "stale";
  // Use overall_pass_rate as single source of truth
  return (benchmark.overall_pass_rate ?? 0) >= 1 ? "pass" : "fail";
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
  "gemini-cli": [
    { id: "gemini-2.5-pro", label: "Gemini 2.5 Pro" },
    { id: "gemini-2.5-flash", label: "Gemini 2.5 Flash" },
  ],
  "codex-cli": [
    { id: "o3", label: "OpenAI o3" },
    { id: "o4-mini", label: "OpenAI o4-mini" },
  ],
  "openrouter": [
    { id: "anthropic/claude-sonnet-4", label: "Claude Sonnet 4 (via OpenRouter)" },
    { id: "meta-llama/llama-3.1-70b-instruct", label: "Llama 3.1 70B" },
    { id: "google/gemini-2.5-pro", label: "Gemini 2.5 Pro (via OpenRouter)" },
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

  // OpenRouter — available if OPENROUTER_API_KEY is set
  providers.push({
    id: "openrouter",
    label: "OpenRouter (100+ models, requires key)",
    available: !!process.env.OPENROUTER_API_KEY,
    models: PROVIDER_MODELS["openrouter"],
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

  // OpenRouter model search proxy
  router.get("/api/openrouter/models", async (_req, res) => {
    const apiKey = process.env.OPENROUTER_API_KEY;
    if (!apiKey) {
      sendJson(res, { error: "OPENROUTER_API_KEY not configured" }, 400);
      return;
    }
    try {
      const resp = await fetch("https://openrouter.ai/api/v1/models", {
        headers: { "Authorization": `Bearer ${apiKey}` },
        signal: AbortSignal.timeout(10_000),
      });
      if (!resp.ok) {
        sendJson(res, { error: `OpenRouter API returned ${resp.status}` }, 502);
        return;
      }
      const data = (await resp.json()) as {
        data?: Array<{
          id: string;
          name?: string;
          pricing?: { prompt?: string; completion?: string };
        }>;
      };
      const models = (data.data || []).map((m) => ({
        id: m.id,
        name: m.name || m.id,
        pricing: {
          prompt: parseFloat(m.pricing?.prompt || "0"),
          completion: parseFloat(m.pricing?.completion || "0"),
        },
      }));
      sendJson(res, { models });
    } catch (err) {
      sendJson(res, { error: (err as Error).message }, 500);
    }
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
        let evalIds: Set<number> = new Set();
        try {
          const evals = loadAndValidateEvals(s.dir);
          evalCount = evals.evals.length;
          assertionCount = evals.evals.reduce((sum, e) => sum + e.assertions.length, 0);
          evalIds = new Set(evals.evals.map((e) => e.id));
        } catch { /* no evals */ }
        const benchmark = await readBenchmark(s.dir);
        return {
          ...s,
          evalCount,
          assertionCount,
          benchmarkStatus: computeBenchmarkStatus(benchmark, evalIds, s.hasEvals),
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

  // List all files in a skill directory (recursive, flat list)
  router.get("/api/skills/:plugin/:skill/files", async (req, res, params) => {
    const skillDir = resolveSkillDir(root, params.plugin, params.skill);
    if (!resolve(skillDir).startsWith(resolve(root))) {
      sendJson(res, { error: "Invalid skill path" }, 400, req);
      return;
    }
    if (!existsSync(skillDir)) {
      sendJson(res, { error: "Skill directory not found" }, 404, req);
      return;
    }

    const EXCLUDE = new Set([".git", "node_modules", ".DS_Store"]);
    const MAX_ENTRIES = 200;
    const MAX_DEPTH = 5;
    const entries: Array<{ path: string; size: number; type: "file" | "dir" }> = [];

    function walk(dir: string, prefix: string, depth: number): void {
      if (depth > MAX_DEPTH || entries.length >= MAX_ENTRIES) return;
      let items: import("node:fs").Dirent<string>[];
      try {
        items = readdirSync(dir, { withFileTypes: true, encoding: "utf-8" });
      } catch { return; }
      for (const item of items) {
        if (EXCLUDE.has(item.name)) continue;
        if (entries.length >= MAX_ENTRIES) break;
        const relPath = prefix ? `${prefix}/${item.name}` : item.name;
        if (item.isDirectory()) {
          entries.push({ path: relPath, size: 0, type: "dir" });
          walk(join(dir, item.name), relPath, depth + 1);
        } else {
          let size = 0;
          try { size = statSync(join(dir, item.name)).size; } catch { /* ignore */ }
          entries.push({ path: relPath, size, type: "file" });
        }
      }
    }

    walk(skillDir, "", 0);

    // Sort: SKILL.md first, then dirs before files, then alphabetical
    entries.sort((a, b) => {
      if (a.path === "SKILL.md") return -1;
      if (b.path === "SKILL.md") return 1;
      if (a.type !== b.type) return a.type === "dir" ? -1 : 1;
      return a.path.localeCompare(b.path);
    });

    sendJson(res, { files: entries }, 200, req);
  });

  // Read any file in a skill directory (with path traversal protection)
  router.get("/api/skills/:plugin/:skill/file", async (req, res, params) => {
    const skillDir = resolveSkillDir(root, params.plugin, params.skill);
    if (!resolve(skillDir).startsWith(resolve(root))) {
      sendJson(res, { error: "Invalid skill path" }, 400, req);
      return;
    }

    const url = new URL(req.url ?? "", "http://localhost");
    const filePath = url.searchParams.get("path") ?? "";
    if (!filePath) {
      sendJson(res, { error: "Missing path query parameter" }, 400, req);
      return;
    }

    const fullPath = resolve(join(skillDir, filePath));
    if (!fullPath.startsWith(resolve(skillDir))) {
      sendJson(res, { error: "Access denied" }, 403, req);
      return;
    }

    if (!existsSync(fullPath)) {
      sendJson(res, { error: "File not found" }, 404, req);
      return;
    }

    let size = 0;
    try { size = statSync(fullPath).size; } catch { /* ignore */ }

    const MAX_SIZE = 1024 * 1024; // 1MB hard limit
    const TRUNCATE_AT = 512 * 1024; // 500KB soft truncation

    if (size > MAX_SIZE) {
      sendJson(res, { error: "File too large", path: filePath, size }, 413, req);
      return;
    }

    // Binary detection: check first 8KB for null bytes
    let buf: Buffer;
    try {
      buf = readFileSync(fullPath);
    } catch (err) {
      sendJson(res, { error: `Unable to read file: ${(err as Error).message}` }, 500, req);
      return;
    }

    const probe = buf.subarray(0, Math.min(8192, buf.length));
    for (let i = 0; i < probe.length; i++) {
      if (probe[i] === 0) {
        sendJson(res, { path: filePath, binary: true, size }, 200, req);
        return;
      }
    }

    const truncated = buf.length > TRUNCATE_AT;
    const content = (truncated ? buf.subarray(0, TRUNCATE_AT) : buf).toString("utf-8");
    sendJson(res, { path: filePath, content, size, truncated: truncated || undefined }, 200, req);
  });

  // Save (create/overwrite) a file inside a skill directory
  router.put("/api/skills/:plugin/:skill/file", async (req, res, params) => {
    const skillDir = resolveSkillDir(root, params.plugin, params.skill);
    if (!resolve(skillDir).startsWith(resolve(root))) {
      sendJson(res, { error: "Invalid skill path" }, 400, req);
      return;
    }

    const body = (await readBody(req)) as { path?: string; content?: string };
    const filePath = body.path ?? "";
    if (!filePath) {
      sendJson(res, { error: "Missing path field" }, 400, req);
      return;
    }
    if (typeof body.content !== "string") {
      sendJson(res, { error: "Missing content field" }, 400, req);
      return;
    }

    const fullPath = resolve(join(skillDir, filePath));
    if (!fullPath.startsWith(resolve(skillDir))) {
      sendJson(res, { error: "Path traversal denied" }, 403, req);
      return;
    }

    mkdirSync(dirname(fullPath), { recursive: true });
    writeFileSync(fullPath, body.content, "utf-8");
    const size = Buffer.byteLength(body.content, "utf-8");
    sendJson(res, { ok: true, path: filePath, size }, 200, req);
  });

  // Delete a source skill (recursively removes its directory)
  router.delete("/api/skills/:plugin/:skill", async (req, res, params) => {
    const skillDir = resolveSkillDir(root, params.plugin, params.skill);
    // Path containment guard — prevent path traversal via ".." in params
    if (!resolve(skillDir).startsWith(resolve(root))) {
      sendJson(res, { error: "Invalid skill path" }, 400, req);
      return;
    }
    if (resolve(skillDir) === resolve(root)) {
      sendJson(res, { error: "Cannot delete the root skill directory" }, 403, req);
      return;
    }
    if (!existsSync(skillDir)) {
      sendJson(res, { error: "Skill directory not found" }, 404, req);
      return;
    }
    const origin = classifyOrigin(skillDir, root);
    if (origin === "installed") {
      sendJson(res, { error: "Cannot delete installed (read-only) skill" }, 403, req);
      return;
    }
    try {
      rmSync(skillDir, { recursive: true, force: true });
      sendJson(res, { ok: true, deleted: `${params.plugin}/${params.skill}` }, 200, req);
    } catch (err) {
      sendJson(res, { error: `Failed to delete skill: ${(err as Error).message}` }, 500, req);
    }
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
    const evalsPath = join(skillDir, "evals", "evals.json");
    if (!existsSync(evalsPath)) {
      sendJson(res, { error: "No evals.json found" }, 404, req);
      return;
    }
    try {
      const evals = loadAndValidateEvals(skillDir);
      sendJson(res, evals, 200, req);
    } catch (err) {
      if (err instanceof EvalValidationError) {
        sendJson(res, { error: err.message, errors: err.errors }, 400, req);
      } else {
        sendJson(res, { error: String((err as Error).message) }, 500, req);
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
  // Accepts optional { provider, model, testType } in request body
  router.post("/api/skills/:plugin/:skill/generate-evals", async (req, res, params) => {
    const skillDir = resolveSkillDir(root, params.plugin, params.skill);
    const skillMdPath = join(skillDir, "SKILL.md");

    if (!existsSync(skillMdPath)) {
      sendJson(res, { error: "SKILL.md not found — cannot generate evals without skill content" }, 400, req);
      return;
    }

    const wantsSSE = req.headers.accept?.includes("text/event-stream") ||
      (req.url ? new URL(req.url, "http://localhost").searchParams.has("sse") : false);

    let aborted = false;
    res.on("close", () => { aborted = true; });

    if (wantsSSE) initSSE(res, req);

    // Read optional body params for model selection + test type
    const body = await readBody(req).catch(() => ({})) as {
      provider?: ProviderName;
      model?: string;
      testType?: "unit" | "integration";
    };

    // Build per-request client: use body overrides if provided, else global
    const overrides: LlmOverrides = { ...currentOverrides };
    if (body.provider) overrides.provider = body.provider;
    if (body.model) overrides.model = body.model;

    const isIntegration = body.testType === "integration";

    try {
      if (wantsSSE && !aborted) sendSSE(res, "progress", { phase: "preparing", message: "Reading skill content..." });

      const skillContent = readFileSync(skillMdPath, "utf-8");

      // Build prompt based on test type
      let prompt: string;
      if (isIntegration) {
        const mcpDeps = detectMcpDependencies(skillContent);
        const browserReqs = detectBrowserRequirements(skillContent);
        const platforms = detectPlatformTargets(skillContent);
        prompt = buildIntegrationEvalPrompt(skillContent, mcpDeps, browserReqs, platforms);
      } else {
        prompt = buildEvalInitPrompt(skillContent);
      }

      const client = createLlmClient(overrides);

      if (wantsSSE && !aborted) sendSSE(res, "progress", {
        phase: "generating",
        message: `Generating ${isIntegration ? "integration" : "unit"} test cases...`,
      });

      const genResult = wantsSSE
        ? await withHeartbeat(res, undefined, "generating",
            `Generating ${isIntegration ? "integration" : "unit"} test cases`, () =>
            client.generate("You generate eval test cases for AI skills. Output only valid JSON in a code fence.", prompt))
        : await client.generate("You generate eval test cases for AI skills. Output only valid JSON in a code fence.", prompt);

      if (aborted) return;

      if (wantsSSE && !aborted) sendSSE(res, "progress", { phase: "parsing", message: "Parsing generated evals..." });

      // Parse based on test type
      if (isIntegration) {
        const integrationCases = parseGeneratedIntegrationEvals(genResult.text);

        // Load existing evals to merge and avoid ID collisions
        let existingEvals: EvalsFile | null = null;
        try { existingEvals = loadAndValidateEvals(skillDir); } catch (e) {
          if ((e as NodeJS.ErrnoException).code !== "ENOENT" &&
              !(e instanceof Error && e.message.includes("ENOENT"))) {
            throw e;
          }
          // File doesn't exist — no existing evals, proceed with empty
        }

        const existingIds = existingEvals?.evals.map((e) => e.id) ?? [];
        const maxId = existingIds.length > 0 ? Math.max(...existingIds) : 0;

        // Re-number integration cases to avoid collisions
        const reNumbered = integrationCases.map((c, i) => ({ ...c, id: maxId + 1 + i }));

        const mergedEvals: EvalsFile = {
          skill_name: existingEvals?.skill_name || params.skill,
          evals: [...(existingEvals?.evals || []), ...reNumbered],
        };

        // Record history
        try {
          await writeHistoryEntry(skillDir, {
            timestamp: new Date().toISOString(),
            model: client.model,
            skill_name: mergedEvals.skill_name,
            cases: [],
            overall_pass_rate: undefined,
            type: "eval-generate",
            provider: overrides.provider || "claude-cli",
            generate: { prompt, result: JSON.stringify(mergedEvals) },
          });
        } catch { /* history write failure should not break the main response */ }

        if (wantsSSE && !aborted) {
          sendSSEDone(res, mergedEvals);
        } else {
          sendJson(res, mergedEvals, 200, req);
        }
      } else {
        const evalsFile = parseGeneratedEvals(genResult.text);

        // Record history entry for eval generation
        try {
          await writeHistoryEntry(skillDir, {
            timestamp: new Date().toISOString(),
            model: client.model,
            skill_name: evalsFile.skill_name || params.skill,
            cases: [],
            overall_pass_rate: undefined,
            type: "eval-generate",
            provider: overrides.provider || "claude-cli",
            generate: { prompt, result: JSON.stringify(evalsFile) },
          });
        } catch { /* history write failure should not break the main response */ }

        if (wantsSSE && !aborted) {
          sendSSEDone(res, evalsFile);
        } else {
          sendJson(res, evalsFile, 200, req);
        }
      }
    } catch (err) {
      if (wantsSSE && !aborted) {
        sendSSE(res, "error", classifyError(err, overrides.provider || "claude-cli"));
        res.end();
      } else {
        sendJson(res, { error: `Eval generation failed: ${(err as Error).message}` }, 500, req);
      }
    }
  });

  // Run benchmark (SSE) — optionally accepts { eval_ids, concurrency, judgeModel, noCache }
  router.post("/api/skills/:plugin/:skill/benchmark", async (req, res, params) => {
    const skillDir = resolveSkillDir(root, params.plugin, params.skill);
    let aborted = false;
    res.on("close", () => { aborted = true; });

    const body = await readBody(req).catch(() => ({})) as {
      eval_ids?: number[];
      concurrency?: number;
      judgeModel?: string;
      noCache?: boolean;
    };
    const filterIds = Array.isArray(body?.eval_ids) ? new Set(body.eval_ids) : null;

    // Validate concurrency
    const concurrency = typeof body?.concurrency === "number" ? body.concurrency : undefined;
    if (concurrency !== undefined && (concurrency < 1 || !Number.isInteger(concurrency))) {
      sendJson(res, { error: "concurrency must be a positive integer" }, 400, req);
      return;
    }

    initSSE(res, req);

    try {
      const evals = loadAndValidateEvals(skillDir);
      const skillMdPath = join(skillDir, "SKILL.md");
      const skillContent = existsSync(skillMdPath) ? readFileSync(skillMdPath, "utf-8") : "";
      const client = getClient();
      const systemPrompt = buildEvalSystemPrompt(skillContent);

      // Create separate judge client if judgeModel is specified
      let judgeClient: import("../eval/llm.js").LlmClient | undefined;
      if (body?.judgeModel && typeof body.judgeModel === "string") {
        const slashIdx = body.judgeModel.indexOf("/");
        if (slashIdx > 0) {
          judgeClient = createLlmClient({
            provider: body.judgeModel.slice(0, slashIdx) as ProviderName,
            model: body.judgeModel.slice(slashIdx + 1),
          });
        }
      }

      // Create judge cache unless noCache
      let judgeCache: import("../eval/judge-cache.js").JudgeCache | undefined;
      if (!body?.noCache) {
        const { JudgeCache } = await import("../eval/judge-cache.js");
        judgeCache = new JudgeCache(skillDir);
      }

      await runBenchmarkSSE({
        res, skillDir, skillName: evals.skill_name, systemPrompt,
        runType: "benchmark", provider: currentOverrides.provider || "claude-cli",
        evalCases: evals.evals, filterIds, client, judgeClient, judgeCache,
        isAborted: () => aborted, concurrency,
      });

      // Flush cache after run
      judgeCache?.flush();
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
        provider: currentOverrides.provider || "claude-cli",
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

        const heartbeat = startDynamicHeartbeat(
          res, evalCase.id, "generating_skill",
          `Generating skill output for "${evalCase.name}"...`,
        );

        try {
          const comparison = await runComparison(
            evalCase.prompt, skillContent, client,
            (phase, msg) => heartbeat.update(phase, msg),
          );
          heartbeat.stop();
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
            sendSSE(res, "assertion_result", {
              eval_id: evalCase.id,
              assertion_id: result.id,
              text: result.text,
              pass: result.pass,
              reasoning: result.reasoning,
            });
          }

          const casePassRate = assertionResults.length > 0
            ? assertionResults.filter((a) => a.pass).length / assertionResults.length
            : 0;
          const caseStatus = assertionResults.length > 0 && assertionResults.every((a) => a.pass) ? "pass" : "fail";
          sendSSE(res, "case_complete", {
            eval_id: evalCase.id,
            status: caseStatus,
            pass_rate: casePassRate,
            durationMs: comparison.skillDurationMs,
            tokens: comparison.skillTokens,
          });

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
          heartbeat.stop();
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

        // Generate action items (one LLM call with comparison context)
        let actionItems;
        try {
          const actionCases = comparisonResults.map((r) => ({
            eval_id: r.eval_id,
            eval_name: r.eval_name,
            winner: r.comparison.winner,
            skillContentScore: r.comparison.skillContentScore,
            skillStructureScore: r.comparison.skillStructureScore,
            baselineContentScore: r.comparison.baselineContentScore,
            baselineStructureScore: r.comparison.baselineStructureScore,
            assertionResults: r.assertionResults,
          }));
          actionItems = await withHeartbeat(
            res, undefined, "action_items", "Generating recommendations",
            () => generateActionItems(
              client, verdict,
              { passRate, skillRubricAvg, baselineRubricAvg, delta: skillRubricAvg - baselineRubricAvg },
              actionCases, skillContent,
            ),
          );
        } catch {
          // Non-fatal — comparison still valid without action items
          actionItems = undefined;
        }

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
          ...(actionItems ? { actionItems } : {}),
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
    if (typeParam && ["benchmark", "comparison", "baseline", "model-compare", "improve", "instruct", "ai-generate", "eval-generate"].includes(typeParam)) {
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
      const body = (await readBody(req)) as {
        prompts: ActivationPrompt[];
        provider?: ProviderName;
        model?: string;
      };
      const skillMdPath = join(skillDir, "SKILL.md");
      const skillContent = existsSync(skillMdPath) ? readFileSync(skillMdPath, "utf-8") : "";

      // Extract description, name, and tags from frontmatter
      const description = extractDescription(skillContent);
      const nameMatch = skillContent.match(/^---[\s\S]*?name:\s*(\S+)[\s\S]*?---/);
      const tagsMatch = skillContent.match(/^---[\s\S]*?tags:\s*(.+)[\s\S]*?---/m);
      const meta: SkillMeta = {
        name: nameMatch ? nameMatch[1] : params.skill,
        tags: tagsMatch ? tagsMatch[1].split(",").map((t: string) => t.trim()).filter(Boolean) : [],
      };

      // Use per-request model overrides if provided, fall back to global config
      const client = body.provider || body.model
        ? createLlmClient({ provider: body.provider, model: body.model })
        : getClient();

      const summary = await testActivation(description, body.prompts, client, (result) => {
        if (!aborted) {
          sendSSE(res, "prompt_result", result);
        }
      }, meta, (phase, index, total) => {
        if (!aborted) sendSSE(res, phase, { index, total });
      });

      if (!aborted) {
        // Write activation history entry
        const usedProvider = body.provider || currentOverrides.provider || "unknown";
        const usedModel = body.model || currentOverrides.model || "unknown";
        const run: ActivationHistoryRun = {
          id: `run-${Date.now()}`,
          timestamp: new Date().toISOString(),
          model: usedModel,
          provider: usedProvider,
          promptCount: summary.total,
          summary: {
            precision: summary.precision,
            recall: summary.recall,
            reliability: summary.reliability,
            tp: summary.tp,
            tn: summary.tn,
            fp: summary.fp,
            fn: summary.fn,
          },
          results: summary.results,
        };
        try { await writeActivationRun(skillDir, run); } catch { /* non-blocking */ }

        sendSSEDone(res, { ...summary, description });
      }
    } catch (err) {
      sendSSEDone(res, { error: err instanceof Error ? err.message : String(err) });
    }
  });

  // AI-generate activation test prompts (SSE)
  router.post("/api/skills/:plugin/:skill/activation-prompts", async (req, res, params) => {
    const skillDir = resolveSkillDir(root, params.plugin, params.skill);
    let aborted = false;
    res.on("close", () => { aborted = true; });

    try {
      const body = (await readBody(req)) as {
        count?: number;
        provider?: ProviderName;
        model?: string;
      };

      const skillMdPath = join(skillDir, "SKILL.md");
      if (!existsSync(skillMdPath)) {
        sendJson(res, { error: "SKILL.md not found" }, 404, req);
        return;
      }
      const skillContent = readFileSync(skillMdPath, "utf-8");
      const description = extractDescription(skillContent);

      initSSE(res, req);

      const count = body.count || 8;
      const half = Math.ceil(count / 2);

      const client = body.provider || body.model
        ? createLlmClient({ provider: body.provider, model: body.model })
        : getClient();

      const systemPrompt = `Given this skill description, generate test prompts to evaluate activation quality.
Generate ${count} prompts: ${half} that SHOULD activate this skill, ${count - half} that should NOT.
For "should not" prompts, make them plausible but clearly outside this skill's domain.
Return one JSON object per line: {"prompt": "...", "expected": "should_activate"|"should_not_activate"}
Return ONLY the JSON lines, no other text.`;

      const userPrompt = `Skill description: ${description}`;

      const { text } = await client.generate(systemPrompt, userPrompt);
      if (aborted) return;

      const allPrompts: Array<{ prompt: string; expected: string }> = [];
      const lines = text.split("\n").filter((l) => l.trim());
      for (const line of lines) {
        try {
          const cleaned = line.replace(/^```(?:json)?\s*/i, "").replace(/```\s*$/i, "").trim();
          if (!cleaned.startsWith("{")) continue;
          const parsed = JSON.parse(cleaned);
          if (parsed.prompt && parsed.expected) {
            allPrompts.push({ prompt: parsed.prompt, expected: parsed.expected });
            if (!aborted) sendSSE(res, "prompt_generated", parsed);
          }
        } catch { /* skip malformed lines */ }
      }

      if (!aborted) sendSSEDone(res, { prompts: allPrompts });
    } catch (err) {
      if (!aborted) {
        sendSSEDone(res, { error: err instanceof Error ? err.message : String(err) });
      }
    }
  });

  // List activation test history (summaries only)
  router.get("/api/skills/:plugin/:skill/activation-history", async (req, res, params) => {
    const skillDir = resolveSkillDir(root, params.plugin, params.skill);
    const runs = await listActivationRuns(skillDir);
    sendJson(res, { runs }, 200, req);
  });

  // Get full activation test run by ID
  router.get("/api/skills/:plugin/:skill/activation-history/:runId", async (req, res, params) => {
    const skillDir = resolveSkillDir(root, params.plugin, params.skill);
    const run = await getActivationRun(skillDir, params.runId);
    if (!run) {
      sendJson(res, { error: "Run not found" }, 404, req);
      return;
    }
    sendJson(res, run, 200, req);
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
