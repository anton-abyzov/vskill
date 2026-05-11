// 0845 T-005 — GET /api/studio/supported-agents
//
// Returns every agent the Studio knows how to install to — Tier 1/2
// (filesystem) and Tier 3 (clipboard) — regardless of binary detection.
// Drives the Cross-tool Install Targets modal (US-001, US-002).
//
// Design decisions (see plan.md §1 D1 + ADR-0845-01):
//   - Distinct from /api/studio/install-state's detectedAgentTools list,
//     which only surfaces detected binaries. This new endpoint includes
//     undetected agents so users can install to tools whose CLI isn't on
//     $PATH (e.g. Codex on a machine where the binary is at a non-standard
//     path, or Antigravity which has no CLI binary).
//   - Detection probes run in parallel (Promise.allSettled inside
//     getSupportedAgents) so latency is bounded by the slowest probe, not
//     the sum (AC-US6-02).
//   - Localhost-only — mirrors install-state-routes.ts:54-58 / install-jobs.ts:51.
//   - No SAFE_NAME guard needed: this endpoint takes no user input.

import * as http from "node:http";

import type { Router } from "./router.js";
import { sendJson } from "./router.js";
import { getSupportedAgents, type SupportedAgent } from "../agents/agents-registry.js";

export interface SupportedAgentsResponse {
  agents: SupportedAgent[];
}

function isLocalhost(req: http.IncomingMessage): boolean {
  const addr = req.socket.remoteAddress ?? "";
  return addr === "127.0.0.1" || addr === "::1" || addr === "::ffff:127.0.0.1";
}

export function registerSupportedAgentsRoutes(router: Router): void {
  router.get(
    "/api/studio/supported-agents",
    async (req: http.IncomingMessage, res: http.ServerResponse) => {
      if (!isLocalhost(req)) {
        sendJson(res, { error: "localhost-only endpoint" }, 403, req);
        return;
      }

      try {
        const agents = await getSupportedAgents();
        const body: SupportedAgentsResponse = { agents };
        sendJson(res, body, 200, req);
      } catch (err) {
        const message = err instanceof Error ? err.message : String(err);
        sendJson(
          res,
          { error: "supported-agents-probe-failed", detail: message },
          500,
          req,
        );
      }
    },
  );
}
