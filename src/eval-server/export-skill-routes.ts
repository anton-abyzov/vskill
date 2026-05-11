// 0845 T-015 — POST /api/studio/export-skill
//
// Returns a paste-ready blob + paste-instructions URL for a Tier-3 agent
// (chatgpt, v0, bolt-new). No disk write. Localhost-only.
//
// Body shape:
//   { skill: ParsedSkill, agentId: string }
//
// Validation:
//   - agentId must match SAFE_NAME and resolve via getAgent().
//   - agent.installMode must equal "clipboard" — anything else → 400.
//   - skill must be a well-formed ParsedSkill object.
//
// ACs covered: AC-US5-03, AC-US5-07, FR-007.

import * as http from "node:http";

import type { Router } from "./router.js";
import { sendJson, readBody } from "./router.js";
import { buildClipboardBlob } from "../installer/clipboard-export.js";
import { getAgent } from "../agents/agents-registry.js";
import type { ParsedSkill } from "../installer/transformers/index.js";

// Agent IDs are slug-shaped: lowercase alphanumeric + hyphens (e.g. "chatgpt",
// "github-copilot-ext", "bolt-new"). Stricter than the SKILL_NAME regex used
// elsewhere — agent IDs never contain `/`, `@`, or `.` so we reject those
// outright to block path-traversal attempts at the validation boundary.
const SAFE_AGENT_ID = /^[a-z0-9][a-z0-9-]*$/;

function isLocalhost(req: http.IncomingMessage): boolean {
  const addr = req.socket.remoteAddress ?? "";
  return addr === "127.0.0.1" || addr === "::1" || addr === "::ffff:127.0.0.1";
}

function isValidSkill(skill: unknown): skill is ParsedSkill {
  if (!skill || typeof skill !== "object") return false;
  const s = skill as Record<string, unknown>;
  return (
    typeof s.name === "string" &&
    typeof s.description === "string" &&
    typeof s.body === "string"
  );
}

export interface ExportSkillResponse {
  skill: string;
  agentId: string;
  blob: string;
  pasteInstructionsUrl: string;
  docsUrl?: string;
}

export function registerExportSkillRoutes(router: Router): void {
  router.post(
    "/api/studio/export-skill",
    async (req: http.IncomingMessage, res: http.ServerResponse) => {
      if (!isLocalhost(req)) {
        sendJson(res, { error: "localhost-only endpoint" }, 403, req);
        return;
      }

      const body = (await readBody(req)) as {
        skill?: unknown;
        agentId?: unknown;
      };

      const agentId = typeof body?.agentId === "string" ? body.agentId.trim() : "";
      if (!agentId || !SAFE_AGENT_ID.test(agentId)) {
        sendJson(res, { error: "invalid agentId" }, 400, req);
        return;
      }

      if (!isValidSkill(body?.skill)) {
        sendJson(res, { error: "invalid skill payload" }, 400, req);
        return;
      }

      const agent = getAgent(agentId);
      if (!agent) {
        sendJson(res, { error: `unknown agent: ${agentId}` }, 404, req);
        return;
      }

      if (agent.installMode !== "clipboard") {
        sendJson(
          res,
          {
            error: `agent "${agentId}" is not a Tier-3 clipboard target`,
            installMode: agent.installMode ?? "filesystem",
          },
          400,
          req,
        );
        return;
      }

      try {
        const blob = buildClipboardBlob(body.skill, agentId);
        const response: ExportSkillResponse = {
          skill: body.skill.name,
          agentId,
          blob: blob.blob,
          pasteInstructionsUrl: blob.pasteInstructionsUrl,
        };
        if (blob.docsUrl) response.docsUrl = blob.docsUrl;
        sendJson(res, response, 200, req);
      } catch (err) {
        const message = err instanceof Error ? err.message : String(err);
        sendJson(res, { error: "export-failed", detail: message }, 500, req);
      }
    },
  );
}
