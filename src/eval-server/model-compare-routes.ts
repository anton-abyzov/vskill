// ---------------------------------------------------------------------------
// model-compare-routes.ts -- per-test-case model A/B comparison (SSE)
// ---------------------------------------------------------------------------

import { readFileSync, existsSync } from "node:fs";
import { join } from "node:path";
import type { Router } from "./router.js";
import { readBody } from "./router.js";
import { resolveSkillDir } from "./skill-resolver.js";
import { initSSE, sendSSE, sendSSEDone } from "./sse-helpers.js";
import { loadAndValidateEvals } from "../eval/schema.js";
import { createLlmClient } from "../eval/llm.js";
import type { ProviderName } from "../eval/llm.js";
import { judgeAssertion } from "../eval/judge.js";
import { buildEvalSystemPrompt } from "../eval/prompt-builder.js";
import { writeHistoryEntry } from "../eval/benchmark-history.js";
import type { BenchmarkResult } from "../eval/benchmark.js";

interface ModelSpec {
  provider: ProviderName;
  model: string;
}

export function registerModelCompareRoutes(router: Router, root: string): void {
  router.post("/api/skills/:plugin/:skill/compare-models", async (req, res, params) => {
    const skillDir = resolveSkillDir(root, params.plugin, params.skill);
    let aborted = false;
    res.on("close", () => { aborted = true; });

    const body = (await readBody(req)) as {
      eval_id: number;
      modelA: ModelSpec;
      modelB: ModelSpec;
    };

    initSSE(res, req);

    try {
      // Load eval case
      const evals = loadAndValidateEvals(skillDir);
      const evalCase = evals.evals.find((e) => e.id === body.eval_id);
      if (!evalCase) {
        sendSSE(res, "error", { error: `Eval case #${body.eval_id} not found` });
        sendSSEDone(res, { error: `Eval case #${body.eval_id} not found` });
        return;
      }

      // Read SKILL.md for system prompt
      const skillMdPath = join(skillDir, "SKILL.md");
      const skillContent = existsSync(skillMdPath) ? readFileSync(skillMdPath, "utf-8") : "";
      const systemPrompt = buildEvalSystemPrompt(skillContent);

      // Run Model A
      if (aborted) return;
      sendSSE(res, "model_a_start", { model: body.modelA });

      const clientA = createLlmClient(body.modelA);
      const resultA = await clientA.generate(systemPrompt, evalCase.prompt);
      const totalTokensA = resultA.inputTokens != null && resultA.outputTokens != null
        ? resultA.inputTokens + resultA.outputTokens
        : null;

      // Judge assertions for Model A
      const assertionsA = [];
      for (const assertion of evalCase.assertions) {
        if (aborted) return;
        const judged = await judgeAssertion(resultA.text, assertion, clientA);
        assertionsA.push(judged);
      }

      if (aborted) return;
      sendSSE(res, "model_a_result", {
        model: clientA.model,
        output: resultA.text,
        durationMs: resultA.durationMs,
        tokens: totalTokensA,
        assertions: assertionsA,
        passRate: assertionsA.length > 0
          ? assertionsA.filter((a) => a.pass).length / assertionsA.length
          : 0,
      });

      // Run Model B
      if (aborted) return;
      sendSSE(res, "model_b_start", { model: body.modelB });

      const clientB = createLlmClient(body.modelB);
      const resultB = await clientB.generate(systemPrompt, evalCase.prompt);
      const totalTokensB = resultB.inputTokens != null && resultB.outputTokens != null
        ? resultB.inputTokens + resultB.outputTokens
        : null;

      // Judge assertions for Model B
      const assertionsB = [];
      for (const assertion of evalCase.assertions) {
        if (aborted) return;
        const judged = await judgeAssertion(resultB.text, assertion, clientB);
        assertionsB.push(judged);
      }

      if (aborted) return;
      sendSSE(res, "model_b_result", {
        model: clientB.model,
        output: resultB.text,
        durationMs: resultB.durationMs,
        tokens: totalTokensB,
        assertions: assertionsB,
        passRate: assertionsB.length > 0
          ? assertionsB.filter((a) => a.pass).length / assertionsB.length
          : 0,
      });

      // Save to history as model-compare entry
      const historyResult: BenchmarkResult = {
        timestamp: new Date().toISOString(),
        model: `${clientA.model} vs ${clientB.model}`,
        skill_name: evals.skill_name,
        cases: [
          {
            eval_id: evalCase.id,
            eval_name: `${evalCase.name} (${clientA.model})`,
            output: resultA.text,
            status: assertionsA.every((a) => a.pass) ? "pass" : "fail",
            error_message: null,
            pass_rate: assertionsA.length > 0
              ? assertionsA.filter((a) => a.pass).length / assertionsA.length
              : 0,
            assertions: assertionsA,
            durationMs: resultA.durationMs,
            tokens: totalTokensA,
            inputTokens: resultA.inputTokens ?? null,
            outputTokens: resultA.outputTokens ?? null,
          },
          {
            eval_id: evalCase.id,
            eval_name: `${evalCase.name} (${clientB.model})`,
            output: resultB.text,
            status: assertionsB.every((a) => a.pass) ? "pass" : "fail",
            error_message: null,
            pass_rate: assertionsB.length > 0
              ? assertionsB.filter((a) => a.pass).length / assertionsB.length
              : 0,
            assertions: assertionsB,
            durationMs: resultB.durationMs,
            tokens: totalTokensB,
            inputTokens: resultB.inputTokens ?? null,
            outputTokens: resultB.outputTokens ?? null,
          },
        ],
        overall_pass_rate: (() => {
          const all = [...assertionsA, ...assertionsB];
          return all.length > 0 ? all.filter((a) => a.pass).length / all.length : 0;
        })(),
        type: "model-compare",
        provider: body.modelA.provider,
        scope: "single",
      };
      await writeHistoryEntry(skillDir, historyResult);

      sendSSEDone(res, {
        eval_id: body.eval_id,
        eval_name: evalCase.name,
        modelA: {
          model: clientA.model,
          output: resultA.text,
          durationMs: resultA.durationMs,
          tokens: totalTokensA,
          assertions: assertionsA,
        },
        modelB: {
          model: clientB.model,
          output: resultB.text,
          durationMs: resultB.durationMs,
          tokens: totalTokensB,
          assertions: assertionsB,
        },
      });
    } catch (err) {
      if (!aborted) {
        sendSSEDone(res, { error: err instanceof Error ? err.message : String(err) });
      }
    }
  });
}
