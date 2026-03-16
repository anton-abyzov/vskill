// ---------------------------------------------------------------------------
// integration-routes.ts -- API routes for integration tests and credentials
// ---------------------------------------------------------------------------

import { existsSync, readFileSync } from "node:fs";
import type { Router } from "./router.js";
import { sendJson, readBody } from "./router.js";
import { initSSE, sendSSE, sendSSEDone } from "./sse-helpers.js";
import { resolveSkillDir } from "./skill-resolver.js";
import { loadAndValidateEvals } from "../eval/schema.js";
import { resolveAllCredentials } from "../eval/credential-resolver.js";
import { runIntegrationCase, isFirstRun, recordRun, promptConfirmation } from "../eval/integration-runner.js";
import type { IntegrationEvalCase } from "../eval/integration-types.js";

export function registerIntegrationRoutes(router: Router, root: string): void {
  // -------------------------------------------------------------------------
  // POST /api/skills/:plugin/:skill/integration-run -- SSE integration test
  // -------------------------------------------------------------------------
  router.post("/api/skills/:plugin/:skill/integration-run", async (req, res, params) => {
    const skillDir = resolveSkillDir(root, params.plugin, params.skill);
    const body = (await readBody(req)) as {
      eval_ids?: number[];
      dryRun?: boolean;
      confirm?: boolean;
    };

    initSSE(res, req);

    try {
      // Load evals and filter for integration tests
      const evalsFile = loadAndValidateEvals(skillDir);
      let integrationCases = evalsFile.evals.filter((e) => e.testType === "integration");

      // Filter by eval_ids if provided
      if (body.eval_ids?.length) {
        const ids = new Set(body.eval_ids);
        integrationCases = integrationCases.filter((e) => ids.has(e.id));
      }

      if (integrationCases.length === 0) {
        sendSSEDone(res, { status: "no_cases", message: "No integration test cases found" });
        return;
      }

      for (const evalCase of integrationCases) {
        const integrationCase: IntegrationEvalCase = {
          ...evalCase,
          testType: "integration",
          cleanup: evalCase.cleanup?.map((c) => ({
            type: c.action,
            description: c.description ?? c.action,
          })),
        };

        sendSSE(res, "preflight_start", { evalId: evalCase.id, name: evalCase.name });

        const result = await runIntegrationCase(integrationCase, {
          skillDir,
          dryRun: body.dryRun,
          confirm: body.confirm,
        });

        // Emit phase events
        for (const phase of result.phases) {
          sendSSE(res, phase.phase, {
            evalId: evalCase.id,
            phase: phase.phase,
            status: phase.status,
            durationMs: phase.durationMs,
            error: phase.errorMessage,
          });
        }

        // Record run
        recordRun(skillDir, result);
      }

      sendSSEDone(res, { status: "complete" });
    } catch (err) {
      sendSSE(res, "error", { error: (err as Error).message });
      sendSSEDone(res, { status: "error", error: (err as Error).message });
    }
  });

  // -------------------------------------------------------------------------
  // GET /api/credentials/:plugin/:skill -- credential status
  // -------------------------------------------------------------------------
  router.get("/api/credentials/:plugin/:skill", async (req, res, params) => {
    const skillDir = resolveSkillDir(root, params.plugin, params.skill);

    try {
      // Load evals and collect all requiredCredentials from integration tests
      const evalsFile = loadAndValidateEvals(skillDir);
      const allCreds = new Set<string>();
      for (const evalCase of evalsFile.evals) {
        if (evalCase.testType === "integration" && evalCase.requiredCredentials) {
          for (const cred of evalCase.requiredCredentials) {
            allCreds.add(cred);
          }
        }
      }

      const names = [...allCreds].sort();
      if (names.length === 0) {
        sendJson(res, { credentials: [] }, 200, req);
        return;
      }

      const statuses = resolveAllCredentials(names, skillDir);
      const credentials = statuses.map((s) => ({
        name: s.name,
        status: s.status,
        ...(s.source ? { source: s.source } : {}),
      }));

      sendJson(res, { credentials }, 200, req);
    } catch (err) {
      sendJson(res, { error: (err as Error).message, credentials: [] }, 400, req);
    }
  });
}
