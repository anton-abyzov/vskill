// 0827 — GET /api/studio/install-state?skill=<publisher>/<slug>
//
// Reports per-scope install state (project, user) for a single skill, plus the
// list of agent tools detected on the host. Drives the SkillDetailPanel's
// installed-state-aware buttons (US-001, US-002).
//
// Design decisions (see .specweave/increments/0827.../plan.md §A and ADRs):
//   - Lockfile (vskill.lock) is the single source of truth for install state.
//     Project lockfile = project-scope; ~/.agents/vskill.lock = user-scope.
//   - detectInstalledAgents() (agents-registry.ts:853) drives the
//     `detectedAgentTools` list — same heuristic used by `vskill install`,
//     so the studio's tooltips list exactly the destinations the CLI would
//     touch.
//   - Localhost-only (mirrors install-skill-routes.ts:49). No auth, no
//     platform-proxy involvement.
//   - SAFE_NAME validation (mirrors install-skill-routes.ts:29) — rejects
//     paths starting with --, shell metacharacters, etc., before the
//     identifier touches any filesystem code.

import * as http from "node:http";
import { homedir } from "node:os";
import { join } from "node:path";

import type { Router } from "./router.js";
import { sendJson } from "./router.js";
import { readLockfile } from "../lockfile/lockfile.js";
import { detectInstalledAgents } from "../agents/agents-registry.js";

const SAFE_NAME = /^[a-zA-Z0-9._@/\-]+$/;
const PLACEHOLDER_VERSION = "0.0.0";

export interface DetectedAgentTool {
  id: string;
  displayName: string;
  localDir: string;
  globalDir: string;
}

export interface InstallStateForScope {
  installed: boolean;
  installedAgentTools: string[];
  version: string | null;
}

export interface InstallStateResponse {
  skill: string;
  detectedAgentTools: DetectedAgentTool[];
  scopes: {
    project: InstallStateForScope;
    user: InstallStateForScope;
  };
}

function isLocalhost(req: http.IncomingMessage): boolean {
  const addr = req.socket.remoteAddress ?? "";
  return addr === "127.0.0.1" || addr === "::1" || addr === "::ffff:127.0.0.1";
}

function userLockDir(): string {
  return join(homedir(), ".agents");
}

function lastSegment(name: string): string {
  const idx = name.lastIndexOf("/");
  return idx === -1 ? name : name.slice(idx + 1);
}

/**
 * Look up a skill in a lockfile by either the full publisher/slug name or its
 * last segment. The lockfile keys skills by short name (e.g. "postiz"), but
 * the studio passes full names ("gitroomhq/postiz-agent/postiz"). When two
 * skills collide on the same short name, the `source` field disambiguates —
 * we accept the entry only if `source` references the publisher path.
 */
function findSkillEntry(
  lock: { skills?: Record<string, { version?: string; source?: string }> } | null,
  fullName: string,
): { version?: string; source?: string } | null {
  if (!lock?.skills) return null;
  const short = lastSegment(fullName);
  const entry = lock.skills[short];
  if (!entry) return null;

  // Disambiguate by `source` when present. Format: "marketplace:<owner>/<repo>#<skill>"
  // or "github:<owner>/<repo>". If we recognize the format, require the publisher
  // path to be a prefix of the requested fullName. Unknown formats pass through.
  if (entry.source && fullName.includes("/")) {
    const ownerRepoMatch = entry.source.match(/(?:marketplace|github):([^#]+?)(?:#|$)/);
    if (ownerRepoMatch) {
      const ownerRepo = ownerRepoMatch[1];
      // fullName is `<owner>/<repo>/<slug>`; ownerRepo is `<owner>/<repo>`.
      const expectedPrefix = `${ownerRepo}/`;
      if (!fullName.startsWith(expectedPrefix)) return null;
    }
  }
  return entry;
}

function buildScopeState(
  lock: { agents?: string[]; skills?: Record<string, { version?: string; source?: string }> } | null,
  fullName: string,
): InstallStateForScope {
  const entry = findSkillEntry(lock, fullName);
  if (!entry) {
    return { installed: false, installedAgentTools: [], version: null };
  }
  const installedAgentTools = Array.isArray(lock?.agents) ? [...lock!.agents!] : [];
  const rawVersion = typeof entry.version === "string" ? entry.version : "";
  const version = rawVersion && rawVersion !== PLACEHOLDER_VERSION ? rawVersion : null;
  return { installed: true, installedAgentTools, version };
}

export function registerInstallStateRoutes(router: Router, root: string): void {
  router.get(
    "/api/studio/install-state",
    async (req: http.IncomingMessage, res: http.ServerResponse) => {
      if (!isLocalhost(req)) {
        sendJson(res, { error: "localhost-only endpoint" }, 403, req);
        return;
      }

      const url = new URL(req.url ?? "/", `http://${req.headers.host || "localhost"}`);
      const skill = url.searchParams.get("skill")?.trim() ?? "";
      // Reject leading "-" in addition to the regex check so identifiers can't
      // be confused with CLI flags downstream (defense-in-depth even though
      // this handler doesn't spawn a process).
      if (!skill || skill.startsWith("-") || !SAFE_NAME.test(skill)) {
        sendJson(res, { error: "invalid skill identifier" }, 400, req);
        return;
      }

      const detectedAgents = await detectInstalledAgents();
      const detectedAgentTools: DetectedAgentTool[] = detectedAgents.map((a) => ({
        id: a.id,
        displayName: a.displayName,
        localDir: a.localSkillsDir,
        globalDir: a.globalSkillsDir,
      }));

      const projectLock = readLockfile(root);
      const userLock = readLockfile(userLockDir());

      const body: InstallStateResponse = {
        skill,
        detectedAgentTools,
        scopes: {
          project: buildScopeState(projectLock, skill),
          user: buildScopeState(userLock, skill),
        },
      };

      sendJson(res, body, 200, req);
    },
  );
}
