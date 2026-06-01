// ---------------------------------------------------------------------------
// Studio scope-transfer routes — aggregate registration
// ---------------------------------------------------------------------------
// Registered from src/eval-server/eval-server.ts alongside the existing
// registerSkillCreateRoutes() etc. Keeps all scope-transfer HTTP surface in
// one module so cross-route concerns (SSE headers, error shape) stay
// consistent.
// ---------------------------------------------------------------------------

import type { Router } from "../../eval-server/router.js";
import { registerPromoteRoute } from "./promote.js";
import { registerTestInstallRoute } from "./test-install.js";
import { registerRevertRoute } from "./revert.js";
import { registerOpsRoutes } from "./ops.js";
import { registerDetectEnginesRoute } from "../../eval-server/detect-engines-route.js";
import { registerInstallEngineRoutes } from "../../eval-server/install-engine-routes.js";
import { registerInstallSkillRoutes } from "../../eval-server/install-skill-routes.js";
import { registerInstallStateRoutes } from "../../eval-server/install-state-routes.js";
import { registerSupportedAgentsRoutes } from "../../eval-server/supported-agents-routes.js";
import { registerExportSkillRoutes } from "../../eval-server/export-skill-routes.js";
import { registerRemoveSkillRoutes } from "../../eval-server/remove-skill-routes.js";

export function registerScopeTransferRoutes(router: Router, rootArg: string | (() => string)): void {
  const getRoot = typeof rootArg === "function" ? rootArg : () => rootArg;
  registerPromoteRoute(router, getRoot);
  registerTestInstallRoute(router, getRoot);
  registerRevertRoute(router, getRoot);
  registerOpsRoutes(router);
  registerDetectEnginesRoute(router, getRoot);
  registerInstallEngineRoutes(router, getRoot);
  registerInstallSkillRoutes(router, getRoot);
  // 0827 — per-skill install-state for the panel's scope picker.
  registerInstallStateRoutes(router, getRoot);
  // 0845 — cross-tool install targets (every supported agent, detected or not).
  registerSupportedAgentsRoutes(router);
  // 0845 T-015 — Tier-3 clipboard export (ChatGPT, v0, bolt.new).
  registerExportSkillRoutes(router);
  // 0850 — per-agent skill remove from the InstallTargetsModal.
  registerRemoveSkillRoutes(router, getRoot);
}
